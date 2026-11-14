(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  async function loadBackupInfo() {
    const info = await window.posAPI.getDatabaseInfo();
    const kb = ((info.sizeBytes || 0) / 1024).toFixed(1);
    document.getElementById('dbInfoBox').innerHTML =
      `<strong>Archivo activo:</strong> ${POSApp.utils.escapeHtml(info.dbPath)}<br/>` +
      `<strong>Tamaño actual:</strong> ${kb} KB`;
  }

  async function handleExportDb() {
    try {
      const res = await window.posAPI.exportDatabaseBackup();
      if (!res.canceled) {
        POSApp.utils.showToast(`Copia SQLite guardada en ${res.filePath}`, 'success');
      }
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al exportar base de datos.', 'error');
    }
  }

  async function handleRestoreDb() {
    const confirmed = await POSApp.utils.confirmDialog({
      title: 'Restaurar copia de seguridad (.db)',
      message: 'Se validará el archivo seleccionado y reemplazará los datos actuales (guardando una copia previa de seguridad automática). Tras restaurar volverás a la pantalla de inicio de turno.',
      confirmText: 'Seleccionar archivo .db',
      danger: true
    });
    if (!confirmed) return;

    try {
      const res = await window.posAPI.restoreDatabaseBackup();
      if (!res.canceled && res.restored) {
        POSApp.utils.showToast('Base de datos restaurada correctamente.', 'success');
        await POSApp.handleForcedLogout();
      }
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al restaurar la copia de seguridad.', 'error');
    }
  }

  async function handleDownloadJson() {
    try {
      const products = await window.posAPI.listProducts();
      const payload = {
        app: 'ControlStock',
        version: 2,
        exportedAt: new Date().toISOString(),
        totalProducts: products.length,
        products: products.map((p) => ({
          id: p.legacy_id || `p_${p.id}`,
          sku: p.sku || '',
          name: p.name,
          category: p.category || 'General',
          stock: p.stock,
          minStock: p.min_stock,
          price: p.price,
          notes: p.notes || '',
          updatedAt: p.updated_at
        }))
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      const res = await window.posAPI.saveFile({
        title: 'Exportar respaldo JSON de inventario',
        defaultName: `Backup_Stock_${dateStr}.json`,
        filters: [{ name: 'Archivo JSON', extensions: ['json'] }],
        data: JSON.stringify(payload, null, 2),
        isBinary: false
      });

      if (!res.canceled) {
        POSApp.utils.showToast(`JSON guardado en ${res.filePath}`, 'success');
      }
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al exportar JSON.', 'error');
    }
  }

  async function processImportedJsonText(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      const incoming = Array.isArray(parsed) ? parsed : parsed.products;
      if (!Array.isArray(incoming)) {
        throw new Error('El JSON no contiene una lista válida de productos.');
      }

      const mode = document.getElementById('importModeSelect').value;
      if (mode === 'replace') {
        const ok = await POSApp.utils.confirmDialog({
          title: 'Reemplazar catálogo actual',
          message: `Se reemplazarán todos los productos activos por los ${incoming.length} productos del archivo JSON. ¿Continuar?`,
          confirmText: 'Reemplazar',
          danger: true
        });
        if (!ok) return;
      }

      const res = await window.posAPI.importProductsJson(incoming, mode);
      document.getElementById('importJsonText').value = '';
      await loadBackupInfo();
      POSApp.utils.showToast(`Importación completada: ${res.created} creados, ${res.updated} actualizados`, 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message || 'El texto o archivo JSON no es válido.', 'error');
    }
  }

  function handleJsonFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      await processImportedJsonText(evt.target.result);
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  async function handleLoadSamples() {
    const ok = await POSApp.utils.confirmDialog({
      title: 'Cargar productos de ejemplo',
      message: 'Se añadirán o actualizarán los 4 productos de demostración iniciales en el inventario.',
      confirmText: 'Cargar ejemplos'
    });
    if (!ok) return;

    try {
      await window.posAPI.loadSampleProducts();
      await loadBackupInfo();
      POSApp.utils.showToast('Productos de ejemplo cargados', 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message, 'error');
    }
  }

  async function handleClearInventory() {
    const ok = await POSApp.utils.confirmDialog({
      title: 'Vaciar catálogo activo',
      message: '¿Estás seguro de que quieres archivar todos los productos activos y dejar el stock a cero? El historial de ventas previas se conservará en auditoría.',
      confirmText: 'Sí, vaciar inventario',
      danger: true
    });
    if (!ok) return;

    try {
      await window.posAPI.clearAllProducts();
      await loadBackupInfo();
      POSApp.utils.showToast('Catálogo activo vaciado', 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message, 'error');
    }
  }

  function init() {
    document.getElementById('btnExportDbBackup').addEventListener('click', handleExportDb);
    document.getElementById('btnRestoreDbBackup').addEventListener('click', handleRestoreDb);

    document.getElementById('btnBackupExcelInv').addEventListener('click', async () => {
      const prods = await window.posAPI.listProducts();
      await POSApp.xlsx.exportInventoryXlsx(prods);
    });
    document.getElementById('btnBackupExcelSales').addEventListener('click', async () => {
      const sales = await window.posAPI.listAllSales({ limit: 500 });
      await POSApp.xlsx.exportSalesXlsx(sales);
    });
    document.getElementById('btnBackupExcelKardex').addEventListener('click', async () => {
      const movs = await window.posAPI.listMovements({ limit: 1000 });
      await POSApp.xlsx.exportMovementsXlsx(movs);
    });

    document.getElementById('btnDownloadJson').addEventListener('click', handleDownloadJson);
    document.getElementById('importJsonFile').addEventListener('change', handleJsonFileChange);
    document.getElementById('btnImportJsonText').addEventListener('click', () => {
      const raw = document.getElementById('importJsonText').value.trim();
      if (!raw) {
        POSApp.utils.showToast('Pega primero el código JSON o selecciona un archivo.', 'error');
        return;
      }
      processImportedJsonText(raw);
    });

    document.getElementById('btnLoadSamples').addEventListener('click', handleLoadSamples);
    document.getElementById('btnClearAllInventory').addEventListener('click', handleClearInventory);
  }

  POSApp.backupsView = {
    init,
    loadBackupInfo
  };
})(window);
