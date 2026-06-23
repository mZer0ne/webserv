import {getDocker, ensureNetwork, imageExists, pullImage} from './docker.js';
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
        if (!(await imageExists(image))) await pullImage(image);
        const container = await docker.createContainer({
            name,
            Image: image,
            Env: f.env || [],
            Labels: {
                'com.webserv.managed': 'true',
                'com.webserv.runtime': `${familyId}-${version}`,
                'com.webserv.category': f.category,
            },
            HostConfig: {RestartPolicy: {Name: 'unless-stopped'}, NetworkMode: networkName},
        });
        await container.start();
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
            if (existing.State !== 'running') await docker.getContainer(existing.Id).start();
            return {success: true};
        }

        if (!(await imageExists(def.image))) {
            await pullImage(def.image);
        }

        // PHP-FPM runtimes mount the sites root so the shared nginx can serve files
        // resolved by fastcgi (SCRIPT_FILENAME must exist inside the PHP container too).
        const binds = def.category === 'PHP'
            ? [`${getSettings().sitesRoot}:/var/www`]
            : undefined;

        const container = await docker.createContainer({
            name: containerName(id),
            Image: def.image,
            Env: def.env || [],
            Labels: {
                'com.webserv.managed': 'true',
                'com.webserv.runtime': def.id,
                'com.webserv.category': def.category,
            },
            HostConfig: {
                RestartPolicy: {Name: 'unless-stopped'},
                NetworkMode: networkName,
                Binds: binds,
            },
        });
        await container.start();
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
