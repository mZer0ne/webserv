import Docker from 'dockerode';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getSettings } from './settings.js';

let dockerInstance: Docker | null = null;

export function getDocker(): Docker {
  if (dockerInstance) return dockerInstance;

  const configured = getSettings().dockerSocketPath;
  if (configured && existsSync(configured)) {
    dockerInstance = new Docker({ socketPath: configured });
    return dockerInstance;
  }

  const defaultPath = '/var/run/docker.sock';
  const userPath = join(homedir(), '.docker/run/docker.sock');

  if (process.platform === 'darwin' && !existsSync(defaultPath) && existsSync(userPath)) {
    dockerInstance = new Docker({ socketPath: userPath });
  } else {
    dockerInstance = new Docker();
  }
  return dockerInstance;
}

export function resetDocker(): void {
  dockerInstance = null;
}

/** Ensure a user-defined bridge network exists; returns its id. */
export async function ensureNetwork(name: string): Promise<string> {
  const docker = getDocker();
  const networks = await docker.listNetworks({ filters: { name: [name] } });
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
    await network.connect({ Container: containerId });
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
    await network.disconnect({ Container: containerId, Force: true });
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
