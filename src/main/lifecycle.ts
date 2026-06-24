import Store from 'electron-store';
import {getDocker} from './docker.js';

interface LifecycleStore {
    /** Names of WebServ-managed containers that were running at last quit. */
    autostart: string[];
}

const store = new Store<LifecycleStore>({name: 'webserv-lifecycle', defaults: {autostart: []}});

function cleanName(names?: string[]): string {
    return names?.[0]?.replace(/^\//, '') || '';
}

/** Remember which managed containers are currently running (called before stopping on quit). */
export async function recordRunningManaged(): Promise<void> {
    const docker = getDocker();
    const running = await docker.listContainers({
        filters: {label: ['com.webserv.managed=true'], status: ['running']},
    });
    store.set('autostart', running.map((c) => cleanName(c.Names)).filter(Boolean));
}

/** Start the managed containers that were running at last quit (called on app launch). */
export async function restoreManaged(): Promise<void> {
    const names = store.get('autostart');
    if (!names.length) return;
    const docker = getDocker();
    const all = await docker.listContainers({
        all: true,
        filters: {label: ['com.webserv.managed=true']},
    });
    await Promise.all(
        all
            .filter((c) => c.State !== 'running' && names.includes(cleanName(c.Names)))
            .map((c) => docker.getContainer(c.Id).start().catch(() => {
            }))
    );
}
