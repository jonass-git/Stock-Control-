(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  let products = [];
  let statusFilter = 'all';

  async function loadInventory() {
    products = await window.posAPI.listProducts();
    refreshCategoryOptions();
    renderInventory();
  }

  function refreshCategoryOptions() {
    const { escapeHtml } = POSApp.utils;
    const categories = [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort();
    const filterSelect = document.getElementById('invCategoryFilter');
    const currentVal = filterSelect.value || 'all';
    filterSelect.innerHTML = '<option value="all">Todas las categorías</option>' +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (categories.includes(currentVal)) {
      filterSelect.value = currentVal;
    }

    const datalist = document.getElementById('categorySuggestions');
    datalist.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">`).join('');
  }

  function setStatusFilter(filter) {
    statusFilter = filter;
    document.querySelectorAll('#invStatusPills .pill').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
    renderInventory();
  }

  function renderInventory() {
    const { formatNumber, formatCurrency, escapeHtml, getStockStatus } = POSApp.utils;

    const totalProducts = products.length;
    const totalUnits = products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
    const totalValue = products.reduce((sum, p) => sum + Number(p.stock || 0) * Number(p.price || 0), 0);
    const alertCount = products.filter((p) => Number(p.stock || 0) <= Number(p.min_stock || 0)).length;

    document.getElementById('kpiProducts').textContent = formatNumber(totalProducts);
    document.getElementById('kpiUnits').textContent = formatNumber(totalUnits);
    document.getElementById('kpiValue').textContent = formatCurrency(totalValue);
    document.getElementById('kpiAlerts').textContent = formatNumber(alertCount);

    const query = document.getElementById('invSearchInput').value.trim().toLowerCase();
    const catFilter = document.getElementById('invCategoryFilter').value || 'all';
    const sortBy = document.getElementById('invSortSelect').value;

    const filtered = products.filter((p) => {
      const matchesQuery = !query ||
        (p.name || '').toLowerCase().includes(query) ||
        (p.sku || '').toLowerCase().includes(query) ||
        (p.category || '').toLowerCase().includes(query) ||
        (p.notes || '').toLowerCase().includes(query);

      const matchesCat = catFilter === 'all' || (p.category || '') === catFilter;
      const st = getStockStatus(p).key;
      let matchesStatus = true;
      if (statusFilter === 'ok') matchesStatus = st === 'ok';
      else if (statusFilter === 'low') matchesStatus = st === 'low';
      else if (statusFilter === 'out') matchesStatus = st === 'out';
      else if (statusFilter === 'alerts') matchesStatus = (st === 'low' || st === 'out');

      return matchesQuery && matchesCat && matchesStatus;
    });

    filtered.sort((a, b) => {
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '', 'es');
      if (sortBy === 'stock_asc') return a.stock - b.stock;
      if (sortBy === 'stock_desc') return b.stock - a.stock;
      if (sortBy === 'value_desc') return (b.stock * b.price) - (a.stock * a.price);
      return (b.updated_at || 0) - (a.updated_at || 0);
    });

    document.getElementById('invResultsCounter').textContent =
      `Mostrando ${filtered.length} de ${products.length} producto${products.length === 1 ? '' : 's'}`;

    const tbody = document.getElementById('inventoryTableBody');
    const tableCard = document.getElementById('invTableCard');
    const emptyState = document.getElementById('invEmptyState');

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      tableCard.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    tableCard.classList.remove('hidden');
    emptyState.classList.add('hidden');

    tbody.innerHTML = filtered
      .map((p) => {
        const st = getStockStatus(p);
        const total = Number(p.stock) * Number(p.price);
        return `
          <tr>
            <td data-label="Producto">
              <div class="prod-title">${escapeHtml(p.name)}</div>
              <div class="prod-meta">
                ${p.sku ? `<span>SKU: <strong>${escapeHtml(p.sku)}</strong></span>` : ''}
                <span>Mín: ${p.min_stock}</span>
                ${p.notes ? `<span>• ${escapeHtml(p.notes)}</span>` : ''}
              </div>
            </td>
            <td data-label="Categoría"><span class="cat-tag">${escapeHtml(p.category || 'General')}</span></td>
            <td data-label="Precio Unit."><strong>${formatCurrency(p.price)}</strong></td>
            <td data-label="Stock Actual">
              <div class="stepper">
                <button type="button" class="step-btn minus" data-inv-action="step-minus" data-id="${p.id}" title="Restar 1 unidad">−</button>
                <span class="step-val" data-inv-action="open-adjust" data-id="${p.id}" title="Clic para ajuste exacto con motivo">${formatNumber(p.stock)}</span>
                <button type="button" class="step-btn plus" data-inv-action="step-plus" data-id="${p.id}" title="Sumar 1 unidad">+</button>
              </div>
            </td>
            <td data-label="Valor Total"><strong>${formatCurrency(total)}</strong></td>
            <td data-label="Estado"><span class="badge ${st.cls}">${st.label}</span></td>
            <td data-label="Acciones">
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" data-inv-action="edit" data-id="${p.id}">Editar</button>
                <button type="button" class="btn btn-danger-soft btn-sm" data-inv-action="delete" data-id="${p.id}">Eliminar</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function openProductModal(id = null) {
    const form = document.getElementById('productForm');
    form.reset();
    document.getElementById('prodId').value = '';

    if (id) {
      const p = products.find((item) => item.id === Number(id));
      if (!p) return;
      document.getElementById('productModalTitle').textContent = 'Editar Producto';
      document.getElementById('prodId').value = p.id;
      document.getElementById('prodName').value = p.name;
      document.getElementById('prodSku').value = p.sku || '';
      document.getElementById('prodCategory').value = p.category || '';
      document.getElementById('prodStock').value = p.stock;
      document.getElementById('prodMinStock').value = p.min_stock;
      document.getElementById('prodPrice').value = p.price;
      document.getElementById('prodNotes').value = p.notes || '';
    } else {
      document.getElementById('productModalTitle').textContent = 'Añadir Producto';
      try {
        document.getElementById('prodSku').value = await window.posAPI.generateSku();
      } catch {
        // Ignorar si falla
      }
    }

    POSApp.utils.openModal('productModal');
    setTimeout(() => document.getElementById('prodName').focus(), 60);
  }

  async function saveProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prodId').value;
    const payload = {
      name: document.getElementById('prodName').value.trim(),
      sku: document.getElementById('prodSku').value.trim(),
      category: document.getElementById('prodCategory').value.trim() || 'General',
      stock: Number.parseInt(document.getElementById('prodStock').value, 10) || 0,
      min_stock: Number.parseInt(document.getElementById('prodMinStock').value, 10) || 0,
      price: Number.parseFloat(document.getElementById('prodPrice').value) || 0,
      notes: document.getElementById('prodNotes').value.trim()
    };

    try {
      if (id) {
        await window.posAPI.updateProduct(Number(id), payload);
        POSApp.utils.showToast('Producto actualizado correctamente', 'success');
      } else {
        await window.posAPI.createProduct(payload);
        POSApp.utils.showToast('Producto añadido al inventario', 'success');
      }
      POSApp.utils.closeModal('productModal');
      await loadInventory();
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo guardar el producto.', 'error');
    }
  }

  function openStockAdjustModal(id) {
    const p = products.find((item) => item.id === Number(id));
    if (!p) return;
    document.getElementById('adjustProductId').value = p.id;
    document.getElementById('adjustProductName').textContent = p.name;
    document.getElementById('adjustCurrentStock').textContent = POSApp.utils.formatNumber(p.stock);
    document.getElementById('adjustExactInput').value = p.stock;
    document.getElementById('adjustReasonInput').value = '';
    POSApp.utils.openModal('stockAdjustModal');
    setTimeout(() => document.getElementById('adjustExactInput').focus(), 60);
  }

  async function submitStockAdjust(e) {
    e.preventDefault();
    const id = Number(document.getElementById('adjustProductId').value);
    const exactStock = Number.parseInt(document.getElementById('adjustExactInput').value, 10);
    const reason = document.getElementById('adjustReasonInput').value.trim() || 'Ajuste manual exacto';

    if (Number.isNaN(exactStock) || exactStock < 0) {
      POSApp.utils.showToast('Introduce un número válido mayor o igual a 0.', 'error');
      return;
    }

    try {
      await window.posAPI.adjustStock(id, { exactStock, reason });
      POSApp.utils.closeModal('stockAdjustModal');
      await loadInventory();
      POSApp.utils.showToast('Stock actualizado y registrado en Kardex', 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al ajustar stock.', 'error');
    }
  }

  async function quickStep(id, delta) {
    try {
      await window.posAPI.adjustStock(Number(id), {
        delta,
        reason: delta > 0 ? 'Ajuste rápido (+1)' : 'Ajuste rápido (-1)'
      });
      await loadInventory();
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al ajustar stock.', 'error');
    }
  }

  async function deleteProduct(id) {
    const p = products.find((item) => item.id === Number(id));
    if (!p) return;
    const confirmed = await POSApp.utils.confirmDialog({
      title: 'Eliminar producto',
      message: `¿Seguro que quieres dar de baja "${p.name}" del catálogo activo? Se conservará su historial de ventas en el Kardex.`,
      confirmText: 'Sí, eliminar',
      danger: true
    });
    if (!confirmed) return;

    try {
      await window.posAPI.deleteProduct(p.id);
      await loadInventory();
      POSApp.utils.showToast(`"${p.name}" eliminado del catálogo`, 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo eliminar el producto.', 'error');
    }
  }

  function getCachedProducts() {
    return products;
  }

  function init() {
    document.getElementById('btnAddProduct').addEventListener('click', () => openProductModal(null));
    document.getElementById('btnAddProductEmpty').addEventListener('click', () => openProductModal(null));
    document.getElementById('btnExportInventoryExcel').addEventListener('click', () => POSApp.xlsx.exportInventoryXlsx(products));
    document.getElementById('kpiCardProducts').addEventListener('click', () => setStatusFilter('all'));
    document.getElementById('kpiCardAlerts').addEventListener('click', () => setStatusFilter('alerts'));

    document.getElementById('invSearchInput').addEventListener('input', POSApp.utils.debounce(renderInventory, 120));
    document.getElementById('invCategoryFilter').addEventListener('change', renderInventory);
    document.getElementById('invSortSelect').addEventListener('change', renderInventory);

    document.getElementById('invStatusPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      setStatusFilter(btn.getAttribute('data-filter'));
    });

    document.getElementById('inventoryTableBody').addEventListener('click', (e) => {
      const target = e.target.closest('[data-inv-action]');
      if (!target) return;
      const action = target.getAttribute('data-inv-action');
      const id = Number(target.getAttribute('data-id'));
      if (action === 'step-minus') quickStep(id, -1);
      else if (action === 'step-plus') quickStep(id, 1);
      else if (action === 'open-adjust') openStockAdjustModal(id);
      else if (action === 'edit') openProductModal(id);
      else if (action === 'delete') deleteProduct(id);
    });

    document.getElementById('btnGenerateSku').addEventListener('click', async () => {
      try {
        document.getElementById('prodSku').value = await window.posAPI.generateSku();
      } catch (err) {
        POSApp.utils.showToast(err.message, 'error');
      }
    });

    document.getElementById('productForm').addEventListener('submit', saveProduct);
    document.getElementById('stockAdjustForm').addEventListener('submit', submitStockAdjust);

    document.getElementById('adjustReasonPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reason]');
      if (!btn) return;
      document.getElementById('adjustReasonInput').value = btn.getAttribute('data-reason');
    });
  }

  POSApp.inventoryView = {
    init,
    loadInventory,
    getCachedProducts
  };
})(window);
