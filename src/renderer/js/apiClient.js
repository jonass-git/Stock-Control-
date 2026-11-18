(function (global) {
  const TOKEN_KEY = 'control_stock_pos_mobile_token_v1';

  function getStoredToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function setStoredToken(token) {
    try {
      if (token) {
        sessionStorage.setItem(TOKEN_KEY, token);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Ignorar si sessionStorage no está disponible
    }
  }

  async function rpcCall(channel, ...args) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel, args })
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || !payload.ok) {
      const err = new Error((payload && payload.error) || `Error de red (${res.status})`);
      err.statusCode = (payload && payload.statusCode) || res.status || 500;
      throw err;
    }
    return payload.data;
  }

  function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  const isDesktop = Boolean(global.electronBridge && global.electronBridge.isDesktop);

  const webClient = {
    isDesktop: false,

    async getLanInfo() {
      const res = await fetch('/api/lan-info');
      const payload = await res.json();
      if (!payload || !payload.ok) {
        throw new Error('No se pudo obtener la información de red local.');
      }
      return payload.data;
    },

    getActiveWorkers: () => rpcCall('auth:get-workers'),

    async login(workerId, credential) {
      const data = await rpcCall('auth:login', { workerId, credential });
      if (data && data.token) {
        setStoredToken(data.token);
      }
      return data;
    },

    getSession: () => rpcCall('auth:get-session'),

    async logout() {
      try {
        await rpcCall('auth:logout');
      } finally {
        setStoredToken('');
      }
      return { loggedOut: true };
    },

    listProducts: () => rpcCall('products:list'),
    createSale: (payload) => rpcCall('sales:create', payload),
    listMyShiftSales: (filters) => rpcCall('sales:list-shift', filters),

    createProduct: (payload) => rpcCall('products:create', payload),
    updateProduct: (id, data) => rpcCall('products:update', { id, data }),
    adjustStock: (id, options) => rpcCall('products:adjust-stock', { id, ...options }),
    deleteProduct: (id) => rpcCall('products:delete', id),
    generateSku: () => rpcCall('products:generate-sku'),
    importProductsJson: (items, mode) => rpcCall('products:import-json', { items, mode }),
    loadSampleProducts: () => rpcCall('products:load-samples'),
    clearAllProducts: () => rpcCall('products:clear-all'),

    listAllWorkers: () => rpcCall('workers:list-all'),
    createWorker: (payload) => rpcCall('workers:create', payload),
    updateWorker: (id, data) => rpcCall('workers:update', { id, data }),
    resetWorkerCredential: (id, newCredential) => rpcCall('workers:reset-credential', { id, newCredential }),
    toggleWorkerActive: (id, isActive) => rpcCall('workers:toggle-active', { id, isActive }),

    listAllSales: (filters) => rpcCall('sales:list-all', filters),
    cancelSale: (saleId, reason) => rpcCall('sales:cancel', { saleId, reason }),
    listMovements: (filters) => rpcCall('audit:list-movements', filters),

    getDatabaseInfo: () => rpcCall('backup:db-info'),

    async exportDatabaseBackup() {
      const token = getStoredToken();
      const res = await fetch('/api/backup/db', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error((errBody && errBody.error) || 'No se pudo descargar la copia .db.');
      }
      const blob = await res.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `Backup_POS_Stock_${dateStr}.db`;
      triggerBrowserDownload(blob, fileName);
      return { canceled: false, filePath: fileName };
    },

    async restoreDatabaseBackup() {
      throw new Error('Por seguridad, la restauración de un archivo .db debe realizarse desde el ordenador principal.');
    },

    async saveFile(payload) {
      const name = String(payload.defaultName || 'exportacion');
      const blob = payload.isBinary
        ? new Blob([new Uint8Array(payload.data)], { type: 'application/octet-stream' })
        : new Blob([String(payload.data || '')], { type: 'text/plain;charset=utf-8' });
      triggerBrowserDownload(blob, name);
      return { canceled: false, filePath: name };
    }
  };

  const client = isDesktop ? global.electronBridge : webClient;
  global.apiClient = client;
  // Alias retrocompatible usado en los módulos de vista
  global.posAPI = client;
})(window);
