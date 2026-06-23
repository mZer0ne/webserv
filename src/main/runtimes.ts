import { app } from 'electron';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {getDocker, ensureNetwork} from './docker.js';
import {composeUpService, isWebServComposeContainer} from './compose.js';
import {getSettings} from './settings.js';

export interface RuntimeDef {
    id: string;
    category: string;
    label: string;
    image: string;
    icon: string;
    /** Nominal target version shown as "Latest Version" (the tag we install). */
    latest: string;
    env?: string[];
}

export interface RuntimeStatus extends RuntimeDef {
    installed: boolean;
    running: boolean;
    containerId?: string;
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
    })),
    {id: 'nginx', category: 'Web Server', label: 'Nginx', image: 'nginx:alpine', icon: '🌐', latest: 'mainline'},
    {id: 'caddy', category: 'Web Server', label: 'Caddy', image: 'caddy:alpine', icon: '🟢', latest: '2'},
];

// Database & cache engines offer a version selector (old → new) before install.
export interface DbFamilyDef {
    id: string;
    label: string;
    icon: string;
    category: string;
    versions: string[];
    image: (v: string) => string;
    env?: string[];
}

export const DB_FAMILIES: DbFamilyDef[] = [
    {
        id: 'postgres', label: 'PostgreSQL', icon: '🐘', category: 'Databases',
        versions: ['13', '14', '15', '16', '17', '18'],
        image: (v) => `postgres:${v}`, env: ['POSTGRES_PASSWORD=webserv'],
    },
    {
        id: 'mariadb', label: 'MariaDB', icon: '🐬', category: 'Databases',
        versions: ['10.4', '10.5', '10.6', '10.11', '11.4'],
        image: (v) => `mariadb:${v}`, env: ['MARIADB_ROOT_PASSWORD=webserv'],
    },
    {
        id: 'mysql', label: 'MySQL', icon: '🐬', category: 'Databases',
        versions: ['5.7', '8.0', '8.4'],
        image: (v) => `mysql:${v}`, env: ['MYSQL_ROOT_PASSWORD=webserv'],
    },
    {
        id: 'memcached', label: 'Memcached', icon: '💾', category: 'Cache',
        versions: ['1.6'],
        image: (v) => `memcached:${v}`,
    },
    {
        id: 'redis', label: 'Redis', icon: '🧱', category: 'Cache',
        versions: ['6', '7', '7.4'],
        image: (v) => `redis:${v}`,
    },
];

export interface FamilyVersionStatus {
    version: string;
    installed: boolean;
    running: boolean;
    containerId?: string;
}

export interface DbFamilyStatus {
    id: string;
    label: string;
    icon: string;
    category: string;
    versions: FamilyVersionStatus[];
}

function familyContainerName(id: string, version: string): string {
    return `webserv-rt-${id}-${version}`;
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
    const destination = destinations[familyId];
    if (!destination) return undefined;

    const dataDir = join(app.getPath('userData'), 'runtimes', familyId, version);
    mkdirSync(dataDir, {recursive: true});
    return [`${dataDir}:${destination}`];
}

async function removeStandaloneContainer(existing: { Id: string; State?: string }): Promise<void> {
    const container = getDocker().getContainer(existing.Id);
    if (existing.State === 'running') await container.stop().catch(() => {});
    await container.remove({force: true});
}

export async function listDbFamilies(): Promise<DbFamilyStatus[]> {
    const containers = await getDocker().listContainers({all: true});
    const byName = new Map(containers.map((c) => [c.Names?.[0]?.replace(/^\//, '') || '', c]));
    return DB_FAMILIES.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
        category: f.category,
        versions: f.versions.map((v) => {
            const c = byName.get(familyContainerName(f.id, v));
            return {version: v, installed: !!c, running: c?.State === 'running', containerId: c?.Id};
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
        const containers = await docker.listContainers({all: true});
        const existing = containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
        if (existing) {
            if (existing.State !== 'running') await docker.getContainer(existing.Id).start();
            return {success: true};
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
        const volumes = familyDataMount(familyId, version);
        if (volumes) service.volumes = volumes;
        await composeUpService(composeServiceName(`${familyId}-${version}`), service, networkName);
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
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
    return RUNTIME_CATALOG.map((def) => {
        const c = byName.get(containerName(def.id));
        return {
            ...def,
            installed: !!c,
            running: c?.State === 'running',
            containerId: c?.Id,
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
        // resolved by fastcgi (SCRIPT_FILENAME must exist inside the PHP container too).
        const binds = def.category === 'PHP'
            ? [`${getSettings().sitesRoot}:/var/www`]
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
        await composeUpService(composeServiceName(id), service, networkName);
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
