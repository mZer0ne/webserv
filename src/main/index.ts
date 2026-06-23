import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'path';
import { getDocker, resetDocker } from './docker.js';
import { getSettings, setSettings } from './settings.js';
import {
  getProjectsList,
  startProject,
  stopProject,
  getProjectLogs,
} from './projects.js';
import {
  getProxyStatus,
  bootstrapNpm,
  listProxyHosts,
  upsertProxyHost,
  setProxyHostEnabled,
  deleteProxyHost,
} from './proxy.js';
import {
  listDatabaseContainers,
  listDatabases,
  listTables,
  runQuery,
} from './database.js';
import { TEMPLATES, createProject, deleteProject } from './scaffold.js';
import { getSystemMetrics } from './system.js';
import { listServices, controlService, serviceLogs } from './services.js';
import { listRuntimes, installRuntime, uninstallRuntime, listDbFamilies, installFamily } from './runtimes.js';
import { listSites, addSite, removeSite, getWebStatus, ensureWeb } from './sites.js';
import { getAiStatus, bootstrapAi, listModels, pullModel, deleteModel, generate } from './ai.js';

let mainWindow: BrowserWindow | null = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function gbFromBytes(bytes?: number): string {
  return bytes ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : 'N/A';
}

async function dockerStatus() {
  try {
    const info = await getDocker().info();
    return {
      active: true,
      version: info.ServerVersion || 'Unknown',
      containers: info.Containers || 0,
      containersRunning: info.ContainersRunning || 0,
      images: info.Images || 0,
      memory: gbFromBytes(info.MemTotal),
    };
  } catch (err: any) {
    return { active: false, error: err.message || 'Could not connect to Docker socket' };
  }
}

function registerHandlers() {
  // --- Docker ---
  ipcMain.handle('docker:check-status', dockerStatus);
  ipcMain.handle('docker:get-stats', dockerStatus);

  // --- Projects ---
  ipcMain.handle('projects:list', () => getProjectsList());
  ipcMain.handle('projects:start', (_e, id: string) => startProject(id));
  ipcMain.handle('projects:stop', (_e, id: string) => stopProject(id));
  ipcMain.handle('projects:get-logs', (_e, id: string, svc?: string) => getProjectLogs(id, svc));
  ipcMain.handle('projects:templates', () => TEMPLATES);
  ipcMain.handle('projects:create', (_e, data: any) => createProject(data));
  ipcMain.handle('projects:delete', (_e, id: string, vols: boolean) => deleteProject(id, vols));

  // --- Proxy (NPM) ---
  ipcMain.handle('proxy:status', () => getProxyStatus());
  ipcMain.handle('proxy:bootstrap', () => bootstrapNpm());
  ipcMain.handle('proxy:list-hosts', () => listProxyHosts());
  ipcMain.handle('proxy:upsert-host', (_e, input: any) => upsertProxyHost(input));
  ipcMain.handle('proxy:set-enabled', (_e, id: number, enabled: boolean) =>
    setProxyHostEnabled(id, enabled)
  );
  ipcMain.handle('proxy:delete-host', (_e, id: number) => deleteProxyHost(id));

  // --- Databases ---
  ipcMain.handle('db:list-containers', () => listDatabaseContainers());
  ipcMain.handle('db:list-databases', (_e, id: string) => listDatabases(id));
  ipcMain.handle('db:list-tables', (_e, id: string, database: string) => listTables(id, database));
  ipcMain.handle('db:run-query', (_e, id: string, database: string | null, sql: string) =>
    runQuery(id, database, sql)
  );

  // --- System metrics & services ---
  ipcMain.handle('system:metrics', () => getSystemMetrics());
  ipcMain.handle('services:list', () => listServices());
  ipcMain.handle('services:control', (_e, id: string, action: 'start' | 'stop' | 'restart') =>
    controlService(id, action)
  );
  ipcMain.handle('services:logs', (_e, id: string) => serviceLogs(id));

  // --- Runtimes (PHP versions, web servers, DBs, caches) ---
  ipcMain.handle('runtimes:list', () => listRuntimes());
  ipcMain.handle('runtimes:install', (_e, id: string) => installRuntime(id));
  ipcMain.handle('runtimes:uninstall', (_e, id: string) => uninstallRuntime(id));
  ipcMain.handle('runtimes:list-families', () => listDbFamilies());
  ipcMain.handle('runtimes:install-family', (_e, familyId: string, version: string) =>
    installFamily(familyId, version)
  );

  // --- Sites (shared MAMP-style nginx) ---
  ipcMain.handle('sites:list', () => listSites());
  ipcMain.handle('sites:add', (_e, input: any) => addSite(input));
  ipcMain.handle('sites:remove', (_e, id: string) => removeSite(id));
  ipcMain.handle('sites:web-status', () => getWebStatus());
  ipcMain.handle('sites:ensure-web', () => ensureWeb());

  // --- AI / LLM (Ollama) ---
  ipcMain.handle('ai:status', () => getAiStatus());
  ipcMain.handle('ai:bootstrap', () => bootstrapAi());
  ipcMain.handle('ai:list-models', () => listModels());
  ipcMain.handle('ai:pull-model', (_e, name: string) => pullModel(name));
  ipcMain.handle('ai:delete-model', (_e, name: string) => deleteModel(name));
  ipcMain.handle('ai:generate', (_e, model: string, prompt: string) => generate(model, prompt));

  // --- Native dialogs ---
  ipcMain.handle('dialog:pick-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getSettings().sitesRoot,
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: any) => {
    const next = setSettings(patch);
    resetDocker();
    return next;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0e12',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
