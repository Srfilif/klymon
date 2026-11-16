import { app, BrowserWindow, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LauncherLogger, LauncherPaths } from '@klymon/core';
import { broadcast, createAppContext, resolveDataDirectory } from './services/context';
import { registerAssetProtocols, registerSchemes } from './protocols';
import { hardenSession, secureWindow } from './security';
import { registerIpcHandlers } from './ipc';
import { UpdaterService } from './services/updater';

const isDev = !app.isPackaged;
const devRendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? null;
const rendererRoot = join(__dirname, '../renderer');
const hasBuiltRenderer = existsSync(join(rendererRoot, 'index.html'));

registerSchemes();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b12',
    title: 'Klymon Launcher',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  window.once('ready-to-show', () => window.show());
  secureWindow(window, devRendererUrl ? [devRendererUrl] : ['app://bundle']);

  if (devRendererUrl) {
    void window.loadURL(devRendererUrl);
  } else {
    void window.loadURL('app://bundle/index.html');
  }
  return window;
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData');
  const dataDirectory = await resolveDataDirectory(userDataDir);
  const paths = new LauncherPaths(dataDirectory);
  await paths.ensureAll();
  const logger = new LauncherLogger({ logFile: paths.logFile, level: isDev ? 'debug' : 'info' });
  logger.info('app', `Klymon Launcher starting (${app.getVersion()}) — data: ${paths.root}`);

  const context = await createAppContext({ userDataDir, paths, logger });

  logger.onLine((line) => broadcast('log:line', line));

  process.on('uncaughtException', (error) => logger.error('app', `Uncaught exception: ${error.message}`));
  process.on('unhandledRejection', (reason) => logger.error('app', `Unhandled rejection: ${String(reason)}`));

  hardenSession(devRendererUrl);
  registerAssetProtocols(() => ({
    data: context.paths.root,
    // The dev server takes precedence; otherwise serve the built bundle
    // (also when running `electron .` against a production build).
    renderer: devRendererUrl || !hasBuiltRenderer ? null : rendererRoot,
    music: context.settings.get().musicDirectory,
  }));

  const updater = new UpdaterService(context.settings, logger, (status) => context.emit('update:status', status));
  registerIpcHandlers(context, updater);

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('before-quit', () => {
    try {
      context.game.kill();
      context.db.close();
      logger.info('app', 'Launcher shutting down');
    } catch (error) {
      logger.error('app', `Shutdown error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

app.whenReady().then(bootstrap).catch((error: unknown) => {
  // Failing before the logger exists: surface the error and exit cleanly.
  console.error('Klymon failed to start:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});
