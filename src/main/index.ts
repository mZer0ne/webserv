import {app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu} from 'electron';
import {join} from 'path';
import {getDocker, resetDocker, stopManagedContainers} from './docker.js';
import {recordRunningManaged, restoreManaged} from './lifecycle.js';
import {getSettings, setSettings} from './settings.js';
import {
    listDatabaseContainers,
    listDatabases,
    listTables,
    runQuery,
} from './database.js';
import {getSystemMetrics} from './system.js';
import {listServices, controlService, serviceLogs} from './services.js';
import {
    listRuntimes,
    installRuntime,
    uninstallRuntime,
    listDbFamilies,
    installFamily,
    saveServiceConfig,
    readPhpIni,
    writePhpIni
} from './runtimes.js';
import {getServiceConfig} from './serviceConfig.js';
import {caStatus, installCA, caCertPath} from './tls.js';
import {
    listSites,
    addSite,
    updateSite,
    removeSite,
    getWebStatus,
    ensureWeb,
    stopWeb,
    removeWeb,
    setWebEngine
} from './sites.js';
import {getAiStatus, bootstrapAi, listModels, pullModel, deleteModel, generate} from './ai.js';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
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
        return {active: false, error: err.message || 'Could not connect to Docker socket'};
    }
}

function registerHandlers() {
    // --- Docker ---
    ipcMain.handle('docker:check-status', dockerStatus);
    ipcMain.handle('docker:get-stats', dockerStatus);

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
    ipcMain.handle('runtimes:get-config', (_e, key: string) => getServiceConfig(key));
    ipcMain.handle('runtimes:save-config', (_e, key: string, cfg: any) => saveServiceConfig(key, cfg));
    ipcMain.handle('runtimes:read-php-ini', (_e, id: string) => readPhpIni(id));
    ipcMain.handle('runtimes:write-php-ini', (_e, id: string, content: string) => writePhpIni(id, content));

    // --- Sites (shared MAMP-style nginx) ---
    ipcMain.handle('sites:list', () => listSites());
    ipcMain.handle('sites:add', (_e, input: any) => addSite(input));
    ipcMain.handle('sites:update', (_e, id: string, input: any) => updateSite(id, input));
    ipcMain.handle('sites:remove', (_e, id: string) => removeSite(id));
    ipcMain.handle('sites:web-status', () => getWebStatus());
    ipcMain.handle('sites:ensure-web', () => ensureWeb());
    ipcMain.handle('sites:stop-web', () => stopWeb());
    ipcMain.handle('sites:remove-web', () => removeWeb());
    ipcMain.handle('sites:set-engine', (_e, engine: 'nginx' | 'apache') => setWebEngine(engine));

    // --- TLS / local CA ---
    ipcMain.handle('tls:status', () => caStatus());
    ipcMain.handle('tls:install-ca', () => installCA());
    ipcMain.handle('tls:reveal-ca', () => {
        shell.showItemInFolder(caCertPath());
    });

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

    mainWindow.webContents.setWindowOpenHandler(({url}) => {
        if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
        return {action: 'deny'};
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    const iconPath = join(__dirname, '../../build/icon.png');
    tray = new Tray(iconPath);

    tray.setToolTip('WebServ');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                } else {
                    createWindow();
                }
            },
        },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
        } else {
            createWindow();
        }
    });
}

app.whenReady().then(() => {
    // Show the app icon on the dock during development (packaged builds use the .icns).
    if (process.platform === 'darwin' && app.dock) {
        try {
            app.dock.setIcon(join(__dirname, '../../build/icon.png'));
        } catch { /* ignore */
        }
    }
    registerHandlers();
    createWindow();
    // createTray(); // Call createTray here
    // Auto-start the managed containers that were running at last quit.
    if (getSettings().autoStart) {
        restoreManaged().catch((err) => console.error('Autostart failed:', err));
    }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // On macOS, it's common for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On quit, stop all WebServ-managed containers (web server, PHP/DB runtimes, etc.).
let isQuitting = false;
app.on('before-quit', (e) => {
    if (isQuitting || !getSettings().stopOnQuit) return;
    e.preventDefault();
    isQuitting = true;
    // Remember what's running (for autostart next launch), then stop it.
    // Don't let a hung Docker call block the quit forever.
    const guard = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
    const work = (async () => {
        await recordRunningManaged().catch(() => {
        });
        await stopManagedContainers().catch(() => {
        });
    })();
    Promise.race([work, guard]).finally(() => app.quit());
});
