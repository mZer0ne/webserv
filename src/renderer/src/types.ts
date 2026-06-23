export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: any[];
}

export interface Project {
  id: string;
  name: string;
  stack: string;
  domain: string;
  status: 'running' | 'stopped' | 'starting';
  services: string[];
  containers: ContainerInfo[];
}

export interface DockerStatus {
  active: boolean;
  version?: string;
  containers?: number;
  containersRunning?: number;
  images?: number;
  memory?: string;
  error?: string;
}

export interface ProxyStatus {
  ready: boolean;
  installed: boolean;
  running: boolean;
  containerId?: string;
  adminUrl?: string;
  error?: string;
}

export interface ProxyHost {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_host: string;
  forward_port: number;
  enabled: boolean;
  ssl_forced: boolean;
  certificate_id: number;
}

export interface Template {
  id: string;
  label: string;
  description: string;
  stack: string;
}

export interface DbContainer {
  id: string;
  name: string;
  image: string;
  engine: 'mysql' | 'postgres' | 'mongo' | 'redis' | 'unknown';
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

export interface AppSettings {
  dockerSocketPath: string;
  tldSuffix: string;
  networkName: string;
  workspaceDir: string;
  npm: {
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
  };
}

export interface SystemMetrics {
  cpu: { usage: number; system: number; user: number; nice: number; idle: number; history: number[] };
  memory: { usedGB: number; totalGB: number; pressure: number; app: number; wired: number; compressed: number };
  storage: { usedTB: number; totalTB: number; percent: number };
  network: { ip: string; uploadKbps: number; downloadKbps: number };
}

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
}

export interface RuntimeStatus {
  id: string;
  category: string;
  label: string;
  image: string;
  icon: string;
  latest: string;
  installed: boolean;
  running: boolean;
  containerId?: string;
}

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

export interface Site {
  id: string;
  domain: string;
  root: string;
  php: string | null;
  createdAt: string;
}

export interface WebStatus {
  installed: boolean;
  running: boolean;
  httpPort: number;
  sitesRoot: string;
}

export interface AiStatus {
  installed: boolean;
  running: boolean;
  ready: boolean;
  port: number;
  url?: string;
  error?: string;
}

export interface AiModel {
  name: string;
  size: number;
  parameterSize?: string;
  quantization?: string;
  modified?: string;
}

export interface Api {
  projects: {
    list: () => Promise<Project[]>;
    templates: () => Promise<Template[]>;
    create: (data: { name: string; template: string }) => Promise<{ success: boolean; project?: string; dir?: string; error?: string }>;
    delete: (id: string, deleteVolumes: boolean) => Promise<{ success: boolean; error?: string }>;
    start: (id: string) => Promise<{ success: boolean; error?: string }>;
    stop: (id: string) => Promise<{ success: boolean; error?: string }>;
    getLogs: (id: string, serviceName?: string) => Promise<string>;
  };
  docker: {
    checkStatus: () => Promise<DockerStatus>;
    getStats: () => Promise<DockerStatus>;
  };
  proxy: {
    status: () => Promise<ProxyStatus>;
    bootstrap: () => Promise<ProxyStatus>;
    listHosts: () => Promise<ProxyHost[]>;
    upsertHost: (input: { domain: string; forwardHost: string; forwardPort: number; forwardScheme?: string }) => Promise<ProxyHost>;
    setEnabled: (id: number, enabled: boolean) => Promise<void>;
    deleteHost: (id: number) => Promise<void>;
  };
  db: {
    listContainers: () => Promise<DbContainer[]>;
    listDatabases: (id: string) => Promise<string[]>;
    listTables: (id: string, database: string) => Promise<string[]>;
    runQuery: (id: string, database: string | null, sql: string) => Promise<QueryResult>;
  };
  system: {
    metrics: () => Promise<SystemMetrics>;
  };
  services: {
    list: () => Promise<ServiceInfo[]>;
    control: (id: string, action: 'start' | 'stop' | 'restart') => Promise<{ success: boolean; error?: string }>;
    logs: (id: string) => Promise<string>;
  };
  runtimes: {
    list: () => Promise<RuntimeStatus[]>;
    install: (id: string) => Promise<{ success: boolean; error?: string }>;
    uninstall: (id: string) => Promise<{ success: boolean; error?: string }>;
    listFamilies: () => Promise<DbFamilyStatus[]>;
    installFamily: (familyId: string, version: string) => Promise<{ success: boolean; error?: string }>;
  };
  sites: {
    list: () => Promise<Site[]>;
    add: (input: { domain: string; root: string; php: string | null }) => Promise<{ success: boolean; site?: Site; error?: string }>;
    remove: (id: string) => Promise<{ success: boolean; error?: string }>;
    webStatus: () => Promise<WebStatus>;
    ensureWeb: () => Promise<void>;
  };
  ai: {
    status: () => Promise<AiStatus>;
    bootstrap: () => Promise<AiStatus>;
    listModels: () => Promise<AiModel[]>;
    pullModel: (name: string) => Promise<{ success: boolean; error?: string }>;
    deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>;
    generate: (model: string, prompt: string) => Promise<{ response?: string; error?: string }>;
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
