import {app} from 'electron';
import {mkdirSync, existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {getDocker, ensureNetwork} from './docker.js';
import {composeUpService, isWebServComposeContainer} from './compose.js';
import {getSettings} from './settings.js';
import {getServiceConfig, allServiceConfigs, setServiceConfig, type ServiceConfig} from './serviceConfig.js';

export interface RuntimeDef {
    id: string;
    category: string;
    label: string;
    image: string;
    icon: string;
    /** Nominal target version shown as "Latest Version" (the tag we install). */
    latest: string;
    /** Port the service listens on inside the container. */
    internalPort: number;
    env?: string[];
}

export interface RuntimeStatus extends RuntimeDef {
    installed: boolean;
    running: boolean;
    containerId?: string;
    /** Host port mapped to internalPort, from per-version settings. */
    hostPort?: number;
}

const PHP_VERSIONS = ['5.6', '7.0', '7.1', '7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];

export const RUNTIME_CATALOG: RuntimeDef[] = [
    ...PHP_VERSIONS.map((v) => ({
        id: `php-${v}`,
        category: 'PHP',
        label: `PHP ${v}`,
        image: `php:${v}-fpm`,
        icon: '🐘',
        latest: v,
        internalPort: 9000,
    })),
    // The web server is the shared site-serving nginx managed in sites.ts
    // (surfaced in the "Web Servers" section), so it is not a standalone runtime here.
];

// Database & cache engines offer a version selector (old → new) before install.
export interface DbFamilyDef {
    id: string;
    label: string;
    icon: string;
    category: string;
    versions: string[];
    image: (v: string) => string;
    internalPort: number;
    env?: string[];
}

export const DB_FAMILIES: DbFamilyDef[] = [
    {
        id: 'postgres', label: 'PostgreSQL', icon: '🐘', category: 'Databases',
        versions: ['13', '14', '15', '16', '17', '18'],
        image: (v) => `postgres:${v}`, internalPort: 5432, env: ['POSTGRES_PASSWORD=webserv'],
    },
    {
        id: 'mariadb', label: 'MariaDB', icon: '🐬', category: 'Databases',
        versions: ['10.4', '10.5', '10.6', '10.11', '11.4'],
        image: (v) => `mariadb:${v}`, internalPort: 3306, env: ['MARIADB_ROOT_PASSWORD=webserv'],
    },
    {
        id: 'mysql', label: 'MySQL', icon: '🐬', category: 'Databases',
        versions: ['5.7', '8.0', '8.4'],
        image: (v) => `mysql:${v}`, internalPort: 3306, env: ['MYSQL_ROOT_PASSWORD=webserv'],
    },
    {
        id: 'memcached', label: 'Memcached', icon: '💾', category: 'Cache',
        versions: ['1.6'],
        image: (v) => `memcached:${v}`, internalPort: 11211,
    },
    {
        id: 'redis', label: 'Redis', icon: '🧱', category: 'Cache',
        versions: ['6', '7', '7.4'],
        image: (v) => `redis:${v}`, internalPort: 6379,
    },
];

export interface FamilyVersionStatus {
    version: string;
    installed: boolean;
    running: boolean;
    containerId?: string;
    hostPort?: number;
}

export interface DbFamilyStatus {
    id: string;
    label: string;
    icon: string;
    category: string;
    internalPort: number;
    versions: FamilyVersionStatus[];
}

function familyContainerName(id: string, version: string): string {
    return `webserv-rt-${id}-${version}`;
}

const PHP_INI_MOUNT = '/usr/local/etc/php/conf.d/zz-webserv.ini';

const DEFAULT_PHP_INI = `; WebServ overrides for PHP — edit and save to apply (the container restarts).
; These directives are layered on top of the image defaults.

memory_limit = 256M
max_execution_time = 120
max_input_time = 120

upload_max_filesize = 64M
post_max_size = 64M

display_errors = On
display_startup_errors = On
error_reporting = E_ALL

date.timezone = UTC

; opcache.enable = 1
; opcache.memory_consumption = 128
`;

/** Path to the editable php.ini overlay for a PHP runtime (seeded on first use). */
export function phpIniPath(id: string): string {
    const dir = join(app.getPath('userData'), 'php', id);
    mkdirSync(dir, {recursive: true});
    const file = join(dir, 'php.ini');
    if (!existsSync(file)) writeFileSync(file, DEFAULT_PHP_INI, 'utf8');
    return file;
}

/** Merge per-version settings (host port + extra env) into a compose service. */
function decorateService(
    service: Record<string, unknown>,
    key: string,
    internalPort: number,
    baseEnv?: string[]
): void {
    const cfg = getServiceConfig(key);
    const env = [...(baseEnv || []), ...(cfg.env || [])];
    if (env.length) service.environment = env;
    if (cfg.hostPort) service.ports = [`${cfg.hostPort}:${internalPort}`];
}

function composeServiceName(id: string): string {
    return `rt-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function familyDataMount(familyId: string, version: string): string[] | undefined {
    const destinations: Record<string, string> = {
        postgres: '/var/lib/postgresql/data',
        mariadb: '/var/lib/mysql',
        mysql: '/var/lib/mysql',
        redis: '/data',
    };
    let destination = destinations[familyId];
    if (!destination) return undefined;

    // PostgreSQL 18+ images store data under a major-version subdirectory and
    // require the mount at /var/lib/postgresql (the parent), not /…/data.
    // See https://github.com/docker-library/postgres/pull/1259
    if (familyId === 'postgres' && parseInt(version, 10) >= 18) {
        destination = '/var/lib/postgresql';
    }

    const dataDir = join(app.getPath('userData'), 'runtimes', familyId, version);
    mkdirSync(dataDir, {recursive: true});
    return [`${dataDir}:${destination}`];
}

async function removeStandaloneContainer(existing: { Id: string; State?: string }): Promise<void> {
    const container = getDocker().getContainer(existing.Id);
    if (existing.State === 'running') await container.stop().catch(() => {
    });
    await container.remove({force: true});
}

export async function listDbFamilies(): Promise<DbFamilyStatus[]> {
    const containers = await getDocker().listContainers({all: true});
    const byName = new Map(containers.map((c) => [c.Names?.[0]?.replace(/^\//, '') || '', c]));
    const configs = allServiceConfigs();
    return DB_FAMILIES.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
        category: f.category,
        internalPort: f.internalPort,
        versions: f.versions.map((v) => {
            const c = byName.get(familyContainerName(f.id, v));
            return {
                version: v,
                installed: !!c,
                running: c?.State === 'running',
                containerId: c?.Id,
                hostPort: configs[`${f.id}-${v}`]?.hostPort,
            };
        }),
    }));
}

export async function installFamily(familyId: string, version: string): Promise<{ success: boolean; error?: string }> {
    const f = DB_FAMILIES.find((x) => x.id === familyId);
    if (!f) return {success: false, error: `Unknown family: ${familyId}`};
    if (!f.versions.includes(version)) return {success: false, error: `Unknown version: ${version}`};

    const docker = getDocker();
    const {networkName} = getSettings();
    try {
        await ensureNetwork(networkName);
        const name = familyContainerName(familyId, version);
        const volumes = familyDataMount(familyId, version);
        const desiredDest = volumes?.[0]?.slice(volumes[0].lastIndexOf(':') + 1);
        const containers = await docker.listContainers({all: true});
        const existing = containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
        if (existing) {
            // Reuse the container only if its data mount matches the current layout
            // (e.g. the PostgreSQL 18 mount path differs from older versions).
            const info = await docker.getContainer(existing.Id).inspect();
            const mountOk = !desiredDest || (info.Mounts || []).some((m) => m.Destination === desiredDest);
            if (mountOk) {
                if (existing.State !== 'running') await docker.getContainer(existing.Id).start();
                return {success: true};
            }
            if (info.State?.Running) await docker.getContainer(existing.Id).stop().catch(() => {
            });
            await docker.getContainer(existing.Id).remove({force: true});
        }
        const image = f.image(version);
        const service: Record<string, unknown> = {
            container_name: name,
            image,
            environment: f.env || [],
            labels: {
                'com.webserv.managed': 'true',
                'com.webserv.runtime': `${familyId}-${version}`,
                'com.webserv.category': f.category,
            },
            restart: 'unless-stopped',
            networks: [networkName],
        };
        if (volumes) service.volumes = volumes;
        decorateService(service, `${familyId}-${version}`, f.internalPort, f.env);
        await composeUpService(composeServiceName(`${familyId}-${version}`), service, networkName);
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

/** Persist per-version settings and recreate the container if it already exists. */
export async function saveServiceConfig(key: string, cfg: ServiceConfig): Promise<{
    success: boolean;
    error?: string
}> {
    setServiceConfig(key, cfg);
    const docker = getDocker();

    const rt = RUNTIME_CATALOG.find((r) => r.id === key);
    if (rt) {
        const existing = await findContainer(key);
        if (existing) {
            await removeStandaloneContainer({Id: existing.Id, State: existing.State});
            return installRuntime(key);
        }
        return {success: true};
    }

    for (const f of DB_FAMILIES) {
        if (!key.startsWith(`${f.id}-`)) continue;
        const version = key.slice(f.id.length + 1);
        if (!f.versions.includes(version)) continue;
        const containers = await docker.listContainers({all: true});
        const existing = containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === familyContainerName(f.id, version)));
        if (existing) {
            await removeStandaloneContainer({Id: existing.Id, State: existing.State});
            return installFamily(f.id, version);
        }
        return {success: true};
    }
    return {success: true};
}

function containerName(id: string): string {
    return `webserv-rt-${id}`;
}

async function findContainer(id: string) {
    const docker = getDocker();
    const name = containerName(id);
    const containers = await docker.listContainers({all: true});
    return containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
}

export async function listRuntimes(): Promise<RuntimeStatus[]> {
    const docker = getDocker();
    const containers = await docker.listContainers({all: true});
    const byName = new Map(
        containers.map((c) => [c.Names?.[0]?.replace(/^\//, '') || '', c])
    );
    const configs = allServiceConfigs();
    return RUNTIME_CATALOG.map((def) => {
        const c = byName.get(containerName(def.id));
        return {
            ...def,
            installed: !!c,
            running: c?.State === 'running',
            containerId: c?.Id,
            hostPort: configs[def.id]?.hostPort,
        };
    });
}

export async function installRuntime(id: string): Promise<{ success: boolean; error?: string }> {
    const def = RUNTIME_CATALOG.find((r) => r.id === id);
    if (!def) return {success: false, error: `Unknown runtime: ${id}`};

    const docker = getDocker();
    const {networkName} = getSettings();
    try {
        await ensureNetwork(networkName);

        const existing = await findContainer(id);
        if (existing) {
            if (isWebServComposeContainer(existing)) {
                if (existing.State !== 'running') await docker.getContainer(existing.Id).start();
                return {success: true};
            }
            await removeStandaloneContainer(existing);
        }

        // PHP-FPM runtimes mount the sites root so the shared nginx can serve files
        // resolved by fastcgi (SCRIPT_FILENAME must exist inside the PHP container too),
        // plus an editable php.ini overlay.
        const binds = def.category === 'PHP'
            ? [`${getSettings().sitesRoot}:/var/www`, `${phpIniPath(id)}:${PHP_INI_MOUNT}`]
            : undefined;

        const service: Record<string, unknown> = {
            container_name: containerName(id),
            image: def.image,
            environment: def.env || [],
            labels: {
                'com.webserv.managed': 'true',
                'com.webserv.runtime': def.id,
                'com.webserv.category': def.category,
            },
            restart: 'unless-stopped',
            networks: [networkName],
        };
        if (binds) service.volumes = binds;
        decorateService(service, id, def.internalPort, def.env);
        await composeUpService(composeServiceName(id), service, networkName);
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export function readPhpIni(id: string): string {
    return readFileSync(phpIniPath(id), 'utf8');
}

export async function writePhpIni(id: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
        writeFileSync(phpIniPath(id), content, 'utf8');
        // Apply: recreate the container if it exists (picks up the mount + reloads config).
        const existing = await findContainer(id);
        if (existing) {
            await removeStandaloneContainer({Id: existing.Id, State: existing.State});
            return installRuntime(id);
        }
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export async function uninstallRuntime(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        const existing = await findContainer(id);
        if (existing) {
            await getDocker().getContainer(existing.Id).remove({force: true});
        }
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}
