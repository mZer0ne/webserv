import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, restricted API window interface to the React renderer
contextBridge.exposeInMainWorld('api', {
  docker: {
    checkStatus: () => ipcRenderer.invoke('docker:check-status'),
    getStats: () => ipcRenderer.invoke('docker:get-stats'),
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
    getConfig: (key: string) => ipcRenderer.invoke('runtimes:get-config', key),
    saveConfig: (key: string, cfg: any) => ipcRenderer.invoke('runtimes:save-config', key, cfg),
    readPhpIni: (id: string) => ipcRenderer.invoke('runtimes:read-php-ini', id),
    writePhpIni: (id: string, content: string) => ipcRenderer.invoke('runtimes:write-php-ini', id, content),
  },
  sites: {
    list: () => ipcRenderer.invoke('sites:list'),
    add: (input: any) => ipcRenderer.invoke('sites:add', input),
    update: (id: string, input: any) => ipcRenderer.invoke('sites:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('sites:remove', id),
    webStatus: () => ipcRenderer.invoke('sites:web-status'),
    ensureWeb: () => ipcRenderer.invoke('sites:ensure-web'),
    stopWeb: () => ipcRenderer.invoke('sites:stop-web'),
    removeWeb: () => ipcRenderer.invoke('sites:remove-web'),
    setEngine: (engine: 'nginx' | 'apache') => ipcRenderer.invoke('sites:set-engine', engine),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    bootstrap: () => ipcRenderer.invoke('ai:bootstrap'),
    listModels: () => ipcRenderer.invoke('ai:list-models'),
    pullModel: (name: string) => ipcRenderer.invoke('ai:pull-model', name),
    deleteModel: (name: string) => ipcRenderer.invoke('ai:delete-model', name),
    generate: (model: string, prompt: string) => ipcRenderer.invoke('ai:generate', model, prompt),
  },
  tls: {
    status: () => ipcRenderer.invoke('tls:status'),
    installCa: () => ipcRenderer.invoke('tls:install-ca'),
    revealCa: () => ipcRenderer.invoke('tls:reveal-ca'),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: any) => ipcRenderer.invoke('settings:set', patch),
  },
});
