import Store from 'electron-store';
import {homedir} from 'os';
import {join} from 'path';

export type WebEngine = 'nginx' | 'apache';

export interface WebSettings {
    containerName: string;
    image: string;
    engine: WebEngine;
    httpPort: number;
    httpsPort: number;
}

export interface AiSettings {
    enabled: boolean;
    containerName: string;
    image: string;
    port: number;
}

export interface AppSettings {
    dockerSocketPath: string;
    networkName: string;
    sitesRoot: string;
    stopOnQuit: boolean;
    autoStart: boolean;
    web: WebSettings;
    ai: AiSettings;
}

const defaults: AppSettings = {
    dockerSocketPath: '',
    networkName: 'webserv-network',
    sitesRoot: join(homedir(), 'Sites'),
    stopOnQuit: true,
    autoStart: true,
    web: {
        containerName: 'webserv-web',
        image: 'nginx:alpine',
        engine: 'nginx',
        httpPort: 9080,
        httpsPort: 9443,
    },
    ai: {
        enabled: true,
        containerName: 'webserv-ollama',
        image: 'ollama/ollama:latest',
        port: 11434,
    },
};

const store = new Store<AppSettings>({name: 'webserv-config', defaults});

export function getSettings(): AppSettings {
    return store.store;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return store.get(key);
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
    for (const [k, v] of Object.entries(patch)) {
        store.set(k as keyof AppSettings, v as AppSettings[keyof AppSettings]);
    }
    return store.store;
}
