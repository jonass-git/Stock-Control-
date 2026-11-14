const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const { initDatabase, getDb, closeDatabase } = require('./db/connection');
const { registerIpcHandlers } = require('./ipc');
const backupService = require('./backup');

let mainWindow = null;

function setupOfflineNetworkLock() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    const isLocal =
      url.startsWith('file://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools://');

    if (isLocal) {
      callback({ cancel: false });
    } else {
      callback({ cancel: true });
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Control de Stock & POS — Mostrador Offline',
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });

  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

if (process.env.POS_SMOKE_USER_DATA) {
  app.setPath('userData', process.env.POS_SMOKE_USER_DATA);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupOfflineNetworkLock();
    initDatabase();

    registerIpcHandlers(ipcMain, {
      getDb,
      getMainWindow: () => mainWindow,
      backupService
    });

    createMainWindow();

    if (process.env.POS_SMOKE_TEST === '1') {
      const smokeErrors = [];
      mainWindow.webContents.on('console-message', (event) => {
        if (event.level === 'error' || Number(event.level) >= 3) {
          smokeErrors.push(`console[${event.level}]: ${event.message}`);
        }
      });
      mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
        smokeErrors.push(`did-fail-load(${errorCode}): ${errorDesc}`);
      });
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const domState = await mainWindow.webContents.executeJavaScript(`
              (() => ({
                title: document.title,
                hasPosAPI: typeof window.posAPI === 'object',
                workerCards: document.querySelectorAll('#loginWorkersGrid .worker-card').length,
                loginVisible: !document.getElementById('loginScreen').classList.contains('hidden')
              }))()
            `);
            console.log('SMOKE_DOM_STATE:', JSON.stringify(domState));
            if (!domState.hasPosAPI || domState.workerCards < 2 || !domState.loginVisible || smokeErrors.length > 0) {
              console.error('SMOKE_ERRORS:', JSON.stringify(smokeErrors));
              app.exit(1);
              return;
            }
            app.exit(0);
          } catch (err) {
            console.error('SMOKE_EXCEPTION:', err);
            app.exit(1);
          }
        }, 500);
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    closeDatabase();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    closeDatabase();
  });
}
