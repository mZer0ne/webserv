import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, restricted API window interface to the React renderer
contextBridge.exposeInMainWorld('api', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    templates: () => ipcRenderer.invoke('projects:templates'),
    create: (data: any) => ipcRenderer.invoke('projects:create', data),
    delete: (id: string, deleteVolumes: boolean) =>
      ipcRenderer.invoke('projects:delete', id, deleteVolumes),
    start: (id: string) => ipcRenderer.invoke('projects:start', id),
    stop: (id: string) => ipcRenderer.invoke('projects:stop', id),
    getLogs: (id: string, serviceName?: string) =>
      ipcRenderer.invoke('projects:get-logs', id, serviceName),
  },
  docker: {
    checkStatus: () => ipcRenderer.invoke('docker:check-status'),
    getStats: () => ipcRenderer.invoke('docker:get-stats'),
  },
  proxy: {
    status: () => ipcRenderer.invoke('proxy:status'),
    bootstrap: () => ipcRenderer.invoke('proxy:bootstrap'),
    listHosts: () => ipcRenderer.invoke('proxy:list-hosts'),
    upsertHost: (input: any) => ipcRenderer.invoke('proxy:upsert-host', input),
    setEnabled: (id: number, enabled: boolean) =>
      ipcRenderer.invoke('proxy:set-enabled', id, enabled),
    deleteHost: (id: number) => ipcRenderer.invoke('proxy:delete-host', id),
  },
  db: {
    listContainers: () => ipcRenderer.invoke('db:list-containers'),
    listDatabases: (id: string) => ipcRenderer.invoke('db:list-databases', id),
    listTables: (id: string, database: string) =>
      ipcRenderer.invoke('db:list-tables', id, database),
    runQuery: (id: string, database: string | null, sql: string) =>
      ipcRenderer.invoke('db:run-query', id, database, sql),
  },
  system: {
    metrics: () => ipcRenderer.invoke('system:metrics'),
  },
  services: {
    list: () => ipcRenderer.invoke('services:list'),
    control: (id: string, action: 'start' | 'stop' | 'restart') =>
      ipcRenderer.invoke('services:control', id, action),
    logs: (id: string) => ipcRenderer.invoke('services:logs', id),
  },
  runtimes: {
    list: () => ipcRenderer.invoke('runtimes:list'),
    install: (id: string) => ipcRenderer.invoke('runtimes:install', id),
    uninstall: (id: string) => ipcRenderer.invoke('runtimes:uninstall', id),
    listFamilies: () => ipcRenderer.invoke('runtimes:list-families'),
    installFamily: (familyId: string, version: string) =>
      ipcRenderer.invoke('runtimes:install-family', familyId, version),
  },
  sites: {
    list: () => ipcRenderer.invoke('sites:list'),
    add: (input: any) => ipcRenderer.invoke('sites:add', input),
    remove: (id: string) => ipcRenderer.invoke('sites:remove', id),
    webStatus: () => ipcRenderer.invoke('sites:web-status'),
    ensureWeb: () => ipcRenderer.invoke('sites:ensure-web'),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    bootstrap: () => ipcRenderer.invoke('ai:bootstrap'),
    listModels: () => ipcRenderer.invoke('ai:list-models'),
    pullModel: (name: string) => ipcRenderer.invoke('ai:pull-model', name),
    deleteModel: (name: string) => ipcRenderer.invoke('ai:delete-model', name),
    generate: (model: string, prompt: string) => ipcRenderer.invoke('ai:generate', model, prompt),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: any) => ipcRenderer.invoke('settings:set', patch),
  },
});
