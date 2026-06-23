import {getDocker} from './docker.js';

export interface ServiceInfo {
    id: string;
    name: string;
    image: string;
    version: string;
    category: string;
    state: string;
    status: string;
    pid: number;
    project: string | null;
    managed: boolean;
    internalPorts: number[];
}

const CATEGORY_RULES: { test: RegExp; category: string }[] = [
    {test: /nginx|caddy|httpd|apache|traefik|proxy-manager/, category: 'Web Server'},
    {test: /php|laravel|sail|webdevops/, category: 'PHP'},
    {test: /mariadb/, category: 'MariaDB'},
    {test: /postgres|pgvector|timescale/, category: 'PostgreSQL'},
    {test: /mysql|percona/, category: 'MySQL'},
    {test: /redis|valkey/, category: 'Redis'},
    {test: /memcached/, category: 'Memcached'},
    {test: /mongo/, category: 'MongoDB'},
    {test: /node|next/, category: 'Node.js'},
    {test: /wordpress/, category: 'WordPress'},
];

function categorize(image: string): string {
    const i = image.toLowerCase();
    for (const r of CATEGORY_RULES) if (r.test.test(i)) return r.category;
    return 'Other';
}

function versionFromImage(image: string): string {
    const tag = image.includes(':') ? image.split(':').pop()! : 'latest';
    // Strip distro/variant suffixes for a cleaner version label (php:8.3-fpm -> 8.3).
    return tag.replace(/-(fpm|alpine|apache|cli|bookworm|bullseye|slim|buster).*/i, '') || tag;
}

// Most official images expose their version as an env var — readable from
// `inspect` even when the container is stopped.
const VERSION_ENV: Record<string, string[]> = {
    PHP: ['PHP_VERSION'],
    'Web Server': ['NGINX_VERSION', 'OPENRESTY_VERSION'],
    PostgreSQL: ['PG_VERSION'],
    MariaDB: ['MARIADB_VERSION'],
    MySQL: ['MYSQL_VERSION'],
    Redis: ['REDIS_VERSION'],
    Memcached: ['MEMCACHED_VERSION'],
    'Node.js': ['NODE_VERSION'],
    MongoDB: ['MONGO_VERSION'],
};

function versionFromEnv(env: string[] | null | undefined, category: string): string | null {
    const keys = VERSION_ENV[category];
    if (!keys || !env) return null;
    const map: Record<string, string> = {};
    for (const e of env) {
        const i = e.indexOf('=');
        if (i > 0) map[e.slice(0, i)] = e.slice(i + 1);
    }
    for (const k of keys) {
        const m = map[k]?.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (m) return m[1];
    }
    return null;
}

// Fallback: command + parser to read the version from inside a running container.
const VERSION_PROBES: { category: string; cmd: (image: string) => string[]; re: RegExp }[] = [
    {
        category: 'Web Server',
        cmd: (img) => (/caddy/i.test(img) ? ['caddy', 'version'] : ['nginx', '-v']),
        re: /(?:nginx\/|v)(\d+\.\d+\.\d+)/,
    },
    {category: 'PHP', cmd: () => ['php', '-v'], re: /PHP (\d+\.\d+\.\d+)/},
    {category: 'PostgreSQL', cmd: () => ['postgres', '-V'], re: /(\d+(?:\.\d+)?)/},
    {category: 'MariaDB', cmd: () => ['mariadbd', '--version'], re: /(\d+\.\d+\.\d+)/},
    {category: 'MySQL', cmd: () => ['mysqld', '--version'], re: /Ver (\d+\.\d+\.\d+)/},
    {category: 'Redis', cmd: () => ['redis-server', '--version'], re: /v=(\d+\.\d+\.\d+)/},
    {category: 'Memcached', cmd: () => ['memcached', '--version'], re: /(\d+\.\d+\.\d+)/},
    {category: 'Node.js', cmd: () => ['node', '-v'], re: /v?(\d+\.\d+\.\d+)/},
    {category: 'MongoDB', cmd: () => ['mongod', '--version'], re: /(\d+\.\d+\.\d+)/},
];

// Versions never change for a given container, so cache by container id.
const versionCache = new Map<string, string>();

async function execCapture(id: string, cmd: string[]): Promise<string> {
    const docker = getDocker();
    const exec = await docker.getContainer(id).exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
    });
    const stream = await exec.start({hijack: true, stdin: false});
    return new Promise((resolve, reject) => {
        const out: Buffer[] = [];
        const sink = {write: (c: Buffer) => out.push(c)} as any;
        docker.modem.demuxStream(stream, sink, sink);
        stream.on('end', () => resolve(Buffer.concat(out).toString('utf8')));
        stream.on('error', reject);
    });
}

async function realVersion(
    id: string,
    image: string,
    category: string,
    env: string[] | null | undefined,
    running: boolean,
    fallback: string
): Promise<string> {
    if (versionCache.has(id)) return versionCache.get(id)!;

    let version = versionFromEnv(env, category) || fallback;

    // If env didn't yield a version and the container is running, probe its binary.
    if (version === fallback && running) {
        const probe = VERSION_PROBES.find((p) => p.category === category);
        if (probe) {
            try {
                const text = await execCapture(id, probe.cmd(image));
                const m = text.match(probe.re);
                if (m) version = m[1];
            } catch {
                /* binary missing or exec failed — keep fallback */
            }
        }
    }

    versionCache.set(id, version);
    return version;
}

export async function listServices(): Promise<ServiceInfo[]> {
    const docker = getDocker();
    const containers = await docker.listContainers({all: true});
    const out: ServiceInfo[] = [];
    for (const c of containers) {
        const category = categorize(c.Image);
        const running = c.State === 'running';
        let pid = 0;
        let env: string[] | undefined;
        try {
            const info = await docker.getContainer(c.Id).inspect();
            pid = info.State?.Pid || 0;
            env = info.Config?.Env || undefined;
        } catch {
            /* ignore inspect failure */
        }
        const version = await realVersion(c.Id, c.Image, category, env, running, versionFromImage(c.Image));
        out.push({
            id: c.Id,
            name: c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12),
            image: c.Image,
            version,
            category,
            state: c.State,
            status: c.Status,
            pid,
            project: c.Labels?.['com.docker.compose.project'] || null,
            managed: c.Labels?.['com.webserv.managed'] === 'true',
            internalPorts: [...new Set((c.Ports || []).map((p) => p.PrivatePort).filter(Boolean))],
        });
    }
    return out;
}

export async function controlService(
    id: string,
    action: 'start' | 'stop' | 'restart'
): Promise<{ success: boolean; error?: string }> {
    try {
        const container = getDocker().getContainer(id);
        if (action === 'start') await container.start();
        else if (action === 'stop') await container.stop();
        else await container.restart();
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export async function serviceLogs(id: string): Promise<string> {
    try {
        const logs = await getDocker().getContainer(id).logs({
            stdout: true,
            stderr: true,
            tail: 300,
            timestamps: false,
        });
        return logs.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    } catch (err: any) {
        return `Error retrieving logs: ${err.message}`;
    }
}
