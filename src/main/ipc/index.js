const session = require('../session');
const { guardIpc } = require('./middleware');
const workersRepo = require('../db/repositories/workers.repo');
const productsRepo = require('../db/repositories/products.repo');
const salesRepo = require('../db/repositories/sales.repo');
const movementsRepo = require('../db/repositories/movements.repo');
const defaultBackupService = require('../backup');

function createIpcHandlers({ getDb, getMainWindow, backupService = defaultBackupService }) {
  return {
    // =========================================================================
    // AUTENTICACIÓN Y TURNO (Público - Pantalla de Bloqueo)
    // =========================================================================
    'auth:get-workers': guardIpc('public', () => {
      return workersRepo.listActiveForLogin(getDb());
    }),

    'auth:login': guardIpc('public', (_session, payload) => {
      const workerId = Number(payload && payload.workerId);
      const credential = String((payload && payload.credential) || '');
      if (!workerId) {
        throw new Error('Selecciona un trabajador para iniciar turno.');
      }
      const worker = workersRepo.verifyWorkerLogin(getDb(), workerId, credential);
      if (!worker) {
        throw new Error('PIN o contraseña incorrectos.');
      }
      return session.setSession(worker);
    }),

    'auth:get-session': guardIpc('public', () => {
      return session.getSession();
    }),

    'auth:logout': guardIpc('public', () => {
      session.clearSession();
      return { loggedOut: true };
    }),

    // =========================================================================
    // OPERATIVA DE MOSTRADOR / VENDEDOR Y ADMIN (Requiere sesión iniciada)
    // =========================================================================
    'products:list': guardIpc('auth', () => {
      return productsRepo.listActiveProducts(getDb());
    }),

    'sales:create': guardIpc('auth', (activeSession, payload) => {
      return salesRepo.createSale(getDb(), payload, activeSession.workerId);
    }),

    'sales:list-shift': guardIpc('auth', (activeSession, filters = {}) => {
      // Fuerza el filtro al worker_id de la sesión activa en el proceso main
      return salesRepo.listSales(getDb(), {
        ...filters,
        workerIdFilter: activeSession.workerId
      });
    }),

    // =========================================================================
    // GESTIÓN DE INVENTARIO (Exclusivo Administrador)
    // =========================================================================
    'products:create': guardIpc('admin', (activeSession, payload) => {
      return productsRepo.createProduct(getDb(), payload, activeSession.workerId);
    }),

    'products:update': guardIpc('admin', (activeSession, { id, data }) => {
      return productsRepo.updateProduct(getDb(), Number(id), data, activeSession.workerId);
    }),

    'products:adjust-stock': guardIpc('admin', (activeSession, { id, delta, exactStock, reason }) => {
      return productsRepo.adjustStock(
        getDb(),
        Number(id),
        { delta, exactStock, reason },
        activeSession.workerId
      );
    }),

    'products:delete': guardIpc('admin', (activeSession, id) => {
      return productsRepo.deleteProduct(getDb(), Number(id), activeSession.workerId);
    }),

    'products:generate-sku': guardIpc('admin', () => {
      return productsRepo.generateAutoSku(getDb());
    }),

    'products:import-json': guardIpc('admin', (activeSession, { items, mode }) => {
      return productsRepo.importProducts(getDb(), items, mode, activeSession.workerId);
    }),

    'products:load-samples': guardIpc('admin', (activeSession) => {
      return productsRepo.loadSampleProducts(getDb(), activeSession.workerId);
    }),

    'products:clear-all': guardIpc('admin', (activeSession) => {
      return productsRepo.clearAllProducts(getDb(), activeSession.workerId);
    }),

    // =========================================================================
    // GESTIÓN DE TRABAJADORES (Exclusivo Administrador)
    // =========================================================================
    'workers:list-all': guardIpc('admin', () => {
      return workersRepo.listAll(getDb());
    }),

    'workers:create': guardIpc('admin', (_activeSession, payload) => {
      return workersRepo.createWorker(getDb(), payload);
    }),

    'workers:update': guardIpc('admin', (_activeSession, { id, data }) => {
      return workersRepo.updateWorker(getDb(), Number(id), data);
    }),

    'workers:reset-credential': guardIpc('admin', (_activeSession, { id, newCredential }) => {
      return workersRepo.resetCredential(getDb(), Number(id), newCredential);
    }),

    'workers:toggle-active': guardIpc('admin', (activeSession, { id, isActive }) => {
      return workersRepo.toggleActive(getDb(), Number(id), Boolean(isActive), activeSession.workerId);
    }),

    // =========================================================================
    // AUDITORÍA, KARDEX Y VENTAS GLOBALES (Exclusivo Administrador)
    // =========================================================================
    'sales:list-all': guardIpc('admin', (_activeSession, filters = {}) => {
      return salesRepo.listSales(getDb(), filters);
    }),

    'sales:cancel': guardIpc('admin', (activeSession, { saleId, reason }) => {
      return salesRepo.cancelSale(getDb(), Number(saleId), reason, activeSession.workerId);
    }),

    'audit:list-movements': guardIpc('admin', (_activeSession, filters = {}) => {
      return movementsRepo.listMovements(getDb(), filters);
    }),

    // =========================================================================
    // COPIAS DE SEGURIDAD Y EXPORTACIONES LOCALES (Exclusivo Administrador)
    // =========================================================================
    'backup:db-info': guardIpc('admin', () => {
      return backupService.getDatabaseInfo();
    }),

    'backup:export-db': guardIpc('admin', (_activeSession, targetPath = null) => {
      return backupService.exportDatabaseBackup(getMainWindow ? getMainWindow() : null, getDb(), targetPath);
    }),

    'backup:restore-db': guardIpc('admin', () => {
      return backupService.restoreDatabaseBackup(getMainWindow ? getMainWindow() : null, session);
    }),

    'backup:save-file': guardIpc('admin', (_activeSession, payload) => {
      return backupService.saveFileDialog(getMainWindow ? getMainWindow() : null, payload);
    })
  };
}

function registerIpcHandlers(ipcMain, deps) {
  const handlers = createIpcHandlers(deps);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const data = await handler(...args);
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : 'Error inesperado en el proceso principal.',
          statusCode: err && err.statusCode ? err.statusCode : 400
        };
      }
    });
  }
  return handlers;
}

module.exports = {
  createIpcHandlers,
  registerIpcHandlers
};
