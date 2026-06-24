import {getDocker} from './docker.js';

export type DbEngine = 'mysql' | 'postgres' | 'mongo' | 'redis' | 'unknown';

export interface DbContainer {
    id: string;
    name: string;
    image: string;
    engine: DbEngine;
    state: string;
    user: string;
    hasPassword: boolean;
}

export interface QueryResult {
    columns: string[];
    rows: string[][];
    raw?: string;
    error?: string;
}

function detectEngine(image: string): DbEngine {
    const i = image.toLowerCase();
    if (/mariadb|mysql|percona/.test(i)) return 'mysql';
    if (/postgres|pgvector|timescale/.test(i)) return 'postgres';
    if (/mongo/.test(i)) return 'mongo';
    if (/redis|valkey/.test(i)) return 'redis';
    return 'unknown';
}

function envMap(env: string[] | null | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    for (const e of env || []) {
        const idx = e.indexOf('=');
        if (idx > 0) map[e.slice(0, idx)] = e.slice(idx + 1);
    }
    return map;
}

interface Creds {
    user: string;
    password: string;
}

function credsFor(engine: DbEngine, env: Record<string, string>): Creds {
    if (engine === 'mysql') {
        return {
            user: 'root',
            password: env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD || env.MYSQL_PASSWORD || '',
        };
    }
    if (engine === 'postgres') {
        return {
            user: env.POSTGRES_USER || 'postgres',
            password: env.POSTGRES_PASSWORD || '',
        };
    }
    return {user: '', password: ''};
}

/** Run a command inside a container and collect stdout/stderr. */
async function execInContainer(
    containerId: string,
    cmd: string[],
    env: string[] = []
): Promise<{ stdout: string; stderr: string }> {
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
        Cmd: cmd,
        Env: env,
        AttachStdout: true,
        AttachStderr: true,
    });
    const stream = await exec.start({hijack: true, stdin: false});

    return new Promise((resolve, reject) => {
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        const stdout = {write: (c: Buffer) => out.push(c)} as any;
        const stderr = {write: (c: Buffer) => err.push(c)} as any;
        docker.modem.demuxStream(stream, stdout, stderr);
        stream.on('end', () =>
            resolve({
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
            })
        );
        stream.on('error', reject);
    });
}

export async function listDatabaseContainers(): Promise<DbContainer[]> {
    const docker = getDocker();
    const containers = await docker.listContainers({all: true});
    const result: DbContainer[] = [];
    for (const c of containers) {
        const engine = detectEngine(c.Image);
        if (engine === 'unknown') continue;
        let user = '';
        let hasPassword = false;
        try {
            const info = await docker.getContainer(c.Id).inspect();
            const env = envMap(info.Config?.Env);
            const creds = credsFor(engine, env);
            user = creds.user;
            hasPassword = !!creds.password;
        } catch {
            // ignore inspect failure
        }
        result.push({
            id: c.Id,
            name: c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12),
            image: c.Image,
            engine,
            state: c.State,
            user,
            hasPassword,
        });
    }
    return result;
}

async function getCreds(containerId: string): Promise<{ engine: DbEngine; creds: Creds }> {
    const docker = getDocker();
    const info = await docker.getContainer(containerId).inspect();
    const engine = detectEngine(info.Config?.Image || '');
    const creds = credsFor(engine, envMap(info.Config?.Env));
    return {engine, creds};
}

function parseTabular(text: string): { columns: string[]; rows: string[][] } {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) return {columns: [], rows: []};
    const columns = lines[0].split('\t');
    const rows = lines.slice(1).map((l) => l.split('\t'));
    return {columns, rows};
}

export async function runQuery(
    containerId: string,
    database: string | null,
    sql: string
): Promise<QueryResult> {
    const {engine, creds} = await getCreds(containerId);
    try {
        if (engine === 'mysql') {
            const args = ['mysql', `-u${creds.user}`];
            if (creds.password) args.push(`-p${creds.password}`);
            if (database) args.push(database);
            args.push('--batch', '-e', sql);
            const {stdout, stderr} = await execInContainer(containerId, args);
            if (stderr && /error/i.test(stderr) && !stdout) {
                return {columns: [], rows: [], error: stderr.trim()};
            }
            return {...parseTabular(stdout), raw: stdout};
        }
        if (engine === 'postgres') {
            const args = ['psql', '-U', creds.user, '-A', '-F', '\t', '--pset', 'footer=off'];
            if (database) args.push('-d', database);
            args.push('-c', sql);
            const {stdout, stderr} = await execInContainer(containerId, args, [
                `PGPASSWORD=${creds.password}`,
            ]);
            if (stderr && /error/i.test(stderr) && !stdout) {
                return {columns: [], rows: [], error: stderr.trim()};
            }
            return {...parseTabular(stdout), raw: stdout};
        }
        return {columns: [], rows: [], error: `Queries not supported for engine "${engine}" yet.`};
    } catch (err: any) {
        return {columns: [], rows: [], error: err.message};
    }
}

export async function listDatabases(containerId: string): Promise<string[]> {
    const {engine} = await getCreds(containerId);
    const sql =
        engine === 'postgres'
            ? 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;'
            : 'SHOW DATABASES;';
    const res = await runQuery(containerId, null, sql);
    if (res.error) throw new Error(res.error);
    // first column holds the names (header included for mysql/postgres tabular output)
    return res.rows.map((r) => r[0]).filter(Boolean);
}

export async function listTables(containerId: string, database: string): Promise<string[]> {
    const {engine} = await getCreds(containerId);
    const sql =
        engine === 'postgres'
            ? "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
            : `SHOW TABLES FROM \`${database}\`;`;
    const res = await runQuery(containerId, engine === 'postgres' ? database : null, sql);
    if (res.error) throw new Error(res.error);
    return res.rows.map((r) => r[0]).filter(Boolean);
}
