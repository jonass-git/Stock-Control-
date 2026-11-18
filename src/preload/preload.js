const { contextBridge, ipcRenderer } = require('electron');

async function invokeClean(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) {
    const err = new Error((res && res.error) || 'Error de comunicación interna.');
    err.statusCode = (res && res.statusCode) || 500;
    throw err;
  }
  return res.data;
}

const bridge = {
  isDesktop: true,

  // Red local Wi-Fi (LAN)
  getLanInfo: () => invokeClean('lan:get-info'),

  // Autenticación y Turno
  getActiveWorkers: () => invokeClean('auth:get-workers'),
  login: (workerId, credential) => invokeClean('auth:login', { workerId, credential }),
  getSession: () => invokeClean('auth:get-session'),
  logout: () => invokeClean('auth:logout'),

  // Catálogo (lectura para vendedor/admin)
  listProducts: () => invokeClean('products:list'),

  // Ventas en Mostrador (vendedor y admin)
  createSale: (payload) => invokeClean('sales:create', payload),
  listMyShiftSales: (filters) => invokeClean('sales:list-shift', filters),

  // Gestión de Inventario (solo admin)
  createProduct: (payload) => invokeClean('products:create', payload),
  updateProduct: (id, data) => invokeClean('products:update', { id, data }),
  adjustStock: (id, options) => invokeClean('products:adjust-stock', { id, ...options }),
  deleteProduct: (id) => invokeClean('products:delete', id),
  generateSku: () => invokeClean('products:generate-sku'),
  importProductsJson: (items, mode) => invokeClean('products:import-json', { items, mode }),
  loadSampleProducts: () => invokeClean('products:load-samples'),
  clearAllProducts: () => invokeClean('products:clear-all'),

  // Gestión de Trabajadores (solo admin)
  listAllWorkers: () => invokeClean('workers:list-all'),
  createWorker: (payload) => invokeClean('workers:create', payload),
  updateWorker: (id, data) => invokeClean('workers:update', { id, data }),
  resetWorkerCredential: (id, newCredential) => invokeClean('workers:reset-credential', { id, newCredential }),
  toggleWorkerActive: (id, isActive) => invokeClean('workers:toggle-active', { id, isActive }),

  // Auditoría, Kardex y Ventas Globales (solo admin)
  listAllSales: (filters) => invokeClean('sales:list-all', filters),
  cancelSale: (saleId, reason) => invokeClean('sales:cancel', { saleId, reason }),
  listMovements: (filters) => invokeClean('audit:list-movements', filters),

  // Copias de seguridad y guardado nativo (solo admin)
  getDatabaseInfo: () => invokeClean('backup:db-info'),
  exportDatabaseBackup: () => invokeClean('backup:export-db'),
  restoreDatabaseBackup: () => invokeClean('backup:restore-db'),
  saveFile: (payload) => invokeClean('backup:save-file', payload)
};

contextBridge.exposeInMainWorld('electronBridge', bridge);
