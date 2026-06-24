import Docker from 'dockerode';
import type {DockerOptions} from 'dockerode';
import {existsSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {getSettings} from './settings.js';

let dockerInstance: Docker | null = null;

function dockerOptionsFromHost(value: string): DockerOptions | null {
    const configured = value.trim();
    if (!configured) return null;

    if (/^npipe:\/\//i.test(configured)) {
        return {socketPath: '//./pipe/docker_engine'};
    }

    if (/^(tcp|http|https):\/\//i.test(configured)) {
        const normalized = configured.replace(/^tcp:\/\//i, 'http://');
        const url = new URL(normalized);
        return {
            protocol: url.protocol.replace(':', '') as 'http' | 'https',
            host: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 2375),
        };
    }

    const normalizedPipe = configured.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^\/\/\.\/pipe\/docker_engine/i.test(normalizedPipe)) {
        return {socketPath: normalizedPipe};
    }

    if (existsSync(configured)) {
        return {socketPath: configured};
    }

    return null;
}

function autoDockerOptions(): DockerOptions {
    const defaultPath = '/var/run/docker.sock';
    const userPath = join(homedir(), '.docker/run/docker.sock');

    if (process.platform === 'win32') {
        // Docker Desktop with the WSL2 backend exposes the engine through this pipe.
        return {socketPath: '//./pipe/docker_engine'};
    }

    if (process.platform === 'darwin' && !existsSync(defaultPath) && existsSync(userPath)) {
        return {socketPath: userPath};
    }

    return {};
}

export function getDocker(): Docker {
    if (dockerInstance) return dockerInstance;

    const configured = getSettings().dockerSocketPath;
    const configuredOptions = dockerOptionsFromHost(configured);
    if (configuredOptions) {
        dockerInstance = new Docker(configuredOptions);
        return dockerInstance;
    }

    dockerInstance = new Docker(autoDockerOptions());
    return dockerInstance;
}

export function resetDocker(): void {
    dockerInstance = null;
}

/** Stop all running containers managed by WebServ (label com.webserv.managed=true). */
export async function stopManagedContainers(): Promise<void> {
    const docker = getDocker();
    const containers = await docker.listContainers({
        filters: {label: ['com.webserv.managed=true'], status: ['running']},
    });
    await Promise.all(
        containers.map((c) => docker.getContainer(c.Id).stop({t: 5}).catch(() => {
        }))
    );
}

/** Ensure a user-defined bridge network exists; returns its id. */
export async function ensureNetwork(name: string): Promise<string> {
    const docker = getDocker();
    const networks = await docker.listNetworks({filters: {name: [name]}});
    const exact = networks.find((n) => n.Name === name);
    if (exact) return exact.Id;

    const created = await docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        CheckDuplicate: true,
    });
    return created.id;
}

/** Connect a container to a network if not already attached. Safe to call repeatedly. */
export async function connectToNetwork(networkName: string, containerId: string): Promise<void> {
    const docker = getDocker();
    try {
        const network = docker.getNetwork(networkName);
        await network.connect({Container: containerId});
    } catch (err: any) {
        // Error 403 / "already exists" means it is already attached — ignore.
        if (!/already exists|endpoint with name/i.test(err?.message || '')) {
            throw err;
        }
    }
}

export async function disconnectFromNetwork(networkName: string, containerId: string): Promise<void> {
    const docker = getDocker();
    try {
        const network = docker.getNetwork(networkName);
        await network.disconnect({Container: containerId, Force: true});
    } catch {
        // not connected — ignore
    }
}

/** Pull an image, resolving once the pull stream finishes. */
export function pullImage(image: string): Promise<void> {
    const docker = getDocker();
    return new Promise((resolve, reject) => {
        docker.pull(image, (err: any, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (doneErr: any) => {
                if (doneErr) return reject(doneErr);
                resolve();
            });
        });
    });
}

export async function imageExists(image: string): Promise<boolean> {
    const docker = getDocker();
    try {
        await docker.getImage(image).inspect();
        return true;
    } catch {
        return false;
    }
}
