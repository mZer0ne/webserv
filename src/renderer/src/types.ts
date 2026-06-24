export interface DockerStatus {
    active: boolean;
    version?: string;
    containers?: number;
    containersRunning?: number;
    images?: number;
    memory?: string;
    error?: string;
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
    networkName: string;
    sitesRoot: string;
    stopOnQuit: boolean;
    autoStart: boolean;
    web: {
        containerName: string;
        image: string;
        engine: 'nginx' | 'apache';
        httpPort: number;
        httpsPort: number;
    };
    ai: {
        enabled: boolean;
        containerName: string;
        image: string;
        port: number;
    };
}

export interface SystemMetrics {
    cpu: { usage: number; system: number; user: number; nice: number; idle: number; history: number[] };
    memory: { usedGB: number; totalGB: number; pressure: number; app: number; wired: number; compressed: number };
    storage: { usedBytes: number; totalBytes: number; percent: number };
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
    internalPorts: number[];
    health?: string;
}

export interface RuntimeStatus {
    id: string;
    category: string;
    label: string;
    image: string;
    icon: string;
    latest: string;
    internalPort: number;
    installed: boolean;
    running: boolean;
    containerId?: string;
    hostPort?: number;
}

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

export interface ServiceConfig {
    hostPort?: number;
    env?: string[];
}

export type SiteType = 'app' | 'proxy';

export interface SiteInput {
    domain: string;
    type?: SiteType;
    root?: string;
    php?: string | null;
    target?: string;
    targetPort?: number;
}

export interface Site {
    id: string;
    domain: string;
    type?: SiteType;
    root: string;
    php: string | null;
    target?: string;
    targetPort?: number;
    createdAt: string;
}

export interface WebStatus {
    installed: boolean;
    running: boolean;
    httpPort: number;
    httpsPort: number;
    sitesRoot: string;
    engine: 'nginx' | 'apache';
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
    docker: {
        checkStatus: () => Promise<DockerStatus>;
        getStats: () => Promise<DockerStatus>;
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
        getConfig: (key: string) => Promise<ServiceConfig>;
        saveConfig: (key: string, cfg: ServiceConfig) => Promise<{ success: boolean; error?: string }>;
        readPhpIni: (id: string) => Promise<string>;
        writePhpIni: (id: string, content: string) => Promise<{ success: boolean; error?: string }>;
    };
    sites: {
        list: () => Promise<Site[]>;
        add: (input: SiteInput) => Promise<{ success: boolean; site?: Site; error?: string }>;
        update: (id: string, input: SiteInput) => Promise<{ success: boolean; site?: Site; error?: string }>;
        remove: (id: string) => Promise<{ success: boolean; error?: string }>;
        webStatus: () => Promise<WebStatus>;
        ensureWeb: () => Promise<void>;
        stopWeb: () => Promise<void>;
        removeWeb: () => Promise<void>;
        setEngine: (engine: 'nginx' | 'apache') => Promise<{ success: boolean; error?: string }>;
    };
    ai: {
        status: () => Promise<AiStatus>;
        bootstrap: () => Promise<AiStatus>;
        listModels: () => Promise<AiModel[]>;
        pullModel: (name: string) => Promise<{ success: boolean; error?: string }>;
        deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>;
        generate: (model: string, prompt: string) => Promise<{ response?: string; error?: string }>;
    };
    tls: {
        status: () => Promise<{ generated: boolean; trusted: boolean }>;
        installCa: () => Promise<{ success: boolean; error?: string }>;
        revealCa: () => Promise<void>;
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
