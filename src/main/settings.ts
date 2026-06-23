import Store from 'electron-store';
import { homedir } from 'os';
import { join } from 'path';

export interface NpmSettings {
  enabled: boolean;
  containerName: string;
  image: string;
  adminEmail: string;
  adminPassword: string;
  adminPort: number;
  httpPort: number;
  httpsPort: number;
  token?: string;
  tokenExpires?: string;
}

export interface WebSettings {
  containerName: string;
  image: string;
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
  tldSuffix: string;
  networkName: string;
  workspaceDir: string;
  sitesRoot: string;
  web: WebSettings;
  npm: NpmSettings;
  ai: AiSettings;
}

const defaults: AppSettings = {
  dockerSocketPath: '',
  tldSuffix: '.test',
  networkName: 'webserv-network',
  workspaceDir: join(homedir(), 'WebServProjects'),
  sitesRoot: join(homedir(), 'Sites'),
  web: {
    containerName: 'webserv-web',
    image: 'nginx:alpine',
    httpPort: 9080,
    httpsPort: 9443,
  },
  npm: {
    enabled: true,
    containerName: 'webserv-npm',
    image: 'jc21/nginx-proxy-manager:latest',
    adminEmail: 'admin@example.com',
    adminPassword: 'changeme',
    adminPort: 9081,
    httpPort: 9082,
    httpsPort: 9444,
  },
  ai: {
    enabled: true,
    containerName: 'webserv-ollama',
    image: 'ollama/ollama:latest',
    port: 11434,
  },
};

const store = new Store<AppSettings>({ name: 'webserv-config', defaults });

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

export function updateNpm(patch: Partial<NpmSettings>): NpmSettings {
  const next = { ...store.get('npm'), ...patch };
  store.set('npm', next);
  return next;
}
