const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const { initDatabase, getDb, closeDatabase } = require('./db/connection');
const { registerIpcHandlers } = require('./ipc');
const { startLanServer } = require('./lan-server');
const backupService = require('./backup');

let mainWindow = null;
let lanServerHandle = null;

function setupOfflineNetworkLock() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    const isLocal =
      url.startsWith('file://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools://') ||
      url.startsWith('http://127.0.0.1:') ||
      url.startsWith('http://localhost:');

    callback({ cancel: !isLocal });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 360,
    minHeight: 620,
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

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    setupOfflineNetworkLock();
    initDatabase();

    let lanRef = null;
    let lanError = null;
    const handlers = registerIpcHandlers(ipcMain, {
      getDb,
      getMainWindow: () => mainWindow,
      backupService,
      getLanInfo: () =>
        lanRef
          ? lanRef.getLanInfo()
          : {
              status: 'error',
              error: lanError || 'Servidor LAN no iniciado',
              host: '0.0.0.0',
              port: 3847,
              ips: [],
              urls: [],
              interfaces: [],
              primaryUrl: '',
              qrSvg: ''
            }
    });

    try {
      const requestedPort = process.env.POS_SMOKE_TEST === '1' ? 0 : 3847;
      lanRef = await startLanServer({ handlers, getDb, port: requestedPort, host: '0.0.0.0' });
      lanServerHandle = lanRef;
    } catch (err) {
      lanError = err && err.message ? err.message : 'No se pudo iniciar el servidor LAN local.';
      console.error('No se pudo iniciar el servidor LAN local:', lanError);
    }

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
            const checkViewport = async (w, h) => {
              mainWindow.setContentSize(w, h);
              await new Promise((r) => setTimeout(r, 120));
              return mainWindow.webContents.executeJavaScript(`
                (() => ({
                  width: window.innerWidth,
                  clientWidth: document.documentElement.clientWidth,
                  scrollWidth: document.documentElement.scrollWidth,
                  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
                }))()
              `);
            };

            const domState = await mainWindow.webContents.executeJavaScript(`
              (() => {
                const loginEl = document.getElementById('loginScreen');
                const loginText = loginEl ? loginEl.innerText : '';
                const docStyle = getComputedStyle(document.documentElement);
                const bodyStyle = getComputedStyle(document.body);
                return {
                  title: document.title,
                  hasApiClient: typeof window.apiClient === 'object',
                  hasPosAPI: typeof window.posAPI === 'object',
                  workerCards: document.querySelectorAll('#loginWorkersGrid .worker-card').length,
                  loginVisible: !loginEl.classList.contains('hidden'),
                  loginHintRemoved: !document.getElementById('loginDefaultHint'),
                  hasDefaultPinText: /\\b1234\\b|\\b0000\\b/i.test(loginText),
                  rootOverflowHidden: docStyle.overflow === 'hidden' && bodyStyle.overflow === 'hidden'
                };
              })()
            `);

            // Verificar login como Admin y comprobar vista en 1280px, 412px (Android) y 375px (iPhone)
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                document.getElementById('loginCredentialInput').value = '1234';
                document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
              })()
            `);
            await new Promise((r) => setTimeout(r, 400));

            const vp1280 = await checkViewport(1280, 800);
            const vp412 = await checkViewport(412, 820);
            const vp375 = await checkViewport(375, 760);

            const navState = await mainWindow.webContents.executeJavaScript(`
              (() => {
                const shell = document.getElementById('appShell');
                const main = document.querySelector('main.container');
                const topbar = document.querySelector('.topbar');
                return {
                  appShellVisible: !shell.classList.contains('hidden'),
                  appShellDisplay: getComputedStyle(shell).display,
                  mainOverflowY: getComputedStyle(main).overflowY,
                  topbarTop: Math.round(topbar.getBoundingClientRect().top),
                  mobileNavDisplay: getComputedStyle(document.getElementById('mobileBottomNav')).display,
                  desktopNavDisplay: getComputedStyle(document.getElementById('mainNavTabs')).display,
                  inventoryRows: document.querySelectorAll('#inventoryTableBody tr').length
                };
              })()
            `);

            mainWindow.setSize(1280, 800);
            await new Promise((r) => setTimeout(r, 180));
            const desktopInvState = await mainWindow.webContents.executeJavaScript(`
              (() => {
                const invBtn = document.querySelector('#mainNavTabs [data-view="inventory"]');
                if (invBtn) invBtn.click();
                const main = document.querySelector('main.container');
                const wrap = document.querySelector('#invTableCard .table-wrap');
                const card = document.getElementById('invTableCard');
                const posGrid = document.getElementById('posProductsGrid');
                return {
                  desktopMainOverflowY: main ? getComputedStyle(main).overflowY : '',
                  invTableWrapOverflowY: wrap ? getComputedStyle(wrap).overflowY : '',
                  invTableCardHeight: card ? Math.round(card.getBoundingClientRect().height) : 0,
                  desktopPosGridOverflowY: posGrid ? getComputedStyle(posGrid).overflowY : ''
                };
              })()
            `);

            console.log('SMOKE_DOM_STATE:', JSON.stringify({ domState, navState, desktopInvState, vp1280, vp412, vp375 }));
            const hasOverflow = vp1280.overflowX || vp412.overflowX || vp375.overflowX;
            const layoutBad =
              !domState.rootOverflowHidden ||
              navState.appShellDisplay !== 'flex' ||
              navState.mainOverflowY !== 'auto' ||
              navState.topbarTop !== 0 ||
              desktopInvState.desktopMainOverflowY !== 'hidden' ||
              desktopInvState.invTableWrapOverflowY !== 'auto' ||
              desktopInvState.desktopPosGridOverflowY !== 'auto';
            const loginBad = !domState.loginHintRemoved || domState.hasDefaultPinText;
            if (!domState.hasApiClient || !domState.hasPosAPI || domState.workerCards < 2 || !navState.appShellVisible || hasOverflow || layoutBad || loginBad || smokeErrors.length > 0) {
              console.error('SMOKE_ERRORS:', JSON.stringify({ smokeErrors, hasOverflow, layoutBad, loginBad }));
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

  async function shutdownServices() {
    if (lanServerHandle) {
      try {
        await lanServerHandle.close();
      } catch {
        // Ignorar
      }
      lanServerHandle = null;
    }
    closeDatabase();
  }

  app.on('window-all-closed', async () => {
    await shutdownServices();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    await shutdownServices();
  });
}
