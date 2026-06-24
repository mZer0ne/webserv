import Store from 'electron-store';

/** Per-service-version settings. Keyed by service key:
 *  runtimes  -> the runtime id        (e.g. "php-8.3", "nginx")
 *  families  -> `${familyId}-${ver}`  (e.g. "postgres-18", "redis-7")
 */
export interface ServiceConfig {
    hostPort?: number;
    env?: string[];
}

interface ServiceConfigStore {
    configs: Record<string, ServiceConfig>;
}

const store = new Store<ServiceConfigStore>({name: 'webserv-services', defaults: {configs: {}}});

export function getServiceConfig(key: string): ServiceConfig {
    return store.get('configs')[key] || {};
}

export function allServiceConfigs(): Record<string, ServiceConfig> {
    return store.get('configs');
}

export function setServiceConfig(key: string, cfg: ServiceConfig): void {
    const all = {...store.get('configs')};
    const clean: ServiceConfig = {};
    if (cfg.hostPort && Number.isFinite(cfg.hostPort)) clean.hostPort = cfg.hostPort;
    if (cfg.env && cfg.env.length) clean.env = cfg.env;
    if (clean.hostPort === undefined && !clean.env) delete all[key];
    else all[key] = clean;
    store.set('configs', all);
}
