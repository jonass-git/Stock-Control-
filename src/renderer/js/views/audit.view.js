(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  let allSales = [];
  let allMovements = [];
  let activeSubtab = 'sales';

  async function loadAuditData() {
    const workers = await window.posAPI.listAllWorkers();
    populateWorkerFilters(workers);
    await Promise.all([loadSales(), loadMovements()]);
  }

  function populateWorkerFilters(workers) {
    const { escapeHtml } = POSApp.utils;
    const optionsHtml = '<option value="">Todos los trabajadores</option>' +
      workers.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.employee_code)})</option>`).join('');

    const salesSel = document.getElementById('auditSalesWorkerFilter');
    const prevSales = salesSel.value;
    salesSel.innerHTML = optionsHtml;
    if (prevSales) salesSel.value = prevSales;

    const kardexSel = document.getElementById('kardexWorkerFilter');
    const prevKardex = kardexSel.value;
    kardexSel.innerHTML = optionsHtml;
    if (prevKardex) kardexSel.value = prevKardex;
  }

  async function loadSales() {
    const workerIdFilter = document.getElementById('auditSalesWorkerFilter').value || undefined;
    const status = document.getElementById('auditSalesStatusFilter').value || undefined;
    allSales = await window.posAPI.listAllSales({ workerIdFilter, status, limit: 250 });
    renderSalesTable();
  }

  function renderSalesTable() {
    const { escapeHtml, formatCurrency, formatDateTime, paymentLabel } = POSApp.utils;
    const tbody = document.getElementById('allSalesTableBody');

    if (allSales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:26px;">No hay tickets que coincidan con el filtro.</td></tr>';
      return;
    }

    tbody.innerHTML = allSales
      .map((s) => {
        const summary = (s.items || []).map((i) => `${i.quantity}x ${i.product_name_snapshot}`).join(', ');
        const statusBadge = s.status === 'cancelled'
          ? '<span class="badge badge-out">Anulada</span>'
          : '<span class="badge badge-ok">Completada</span>';

        return `
          <tr>
            <td data-label="Ticket"><strong>${escapeHtml(s.ticket_number)}</strong></td>
            <td data-label="Fecha / Hora" style="font-size:0.83rem;">${escapeHtml(formatDateTime(s.created_at))}</td>
            <td data-label="Trabajador">
              <div>
                <strong>${escapeHtml(s.worker_name)}</strong>
                <div style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(s.worker_code)}</div>
              </div>
            </td>
            <td data-label="Artículos" class="td-truncate" title="${escapeHtml(summary)}">${escapeHtml(summary)}</td>
            <td data-label="Pago">${escapeHtml(paymentLabel(s.payment_method))}</td>
            <td data-label="Total"><strong>${formatCurrency(s.total_amount)}</strong></td>
            <td data-label="Estado">${statusBadge}</td>
            <td data-label="Acciones">
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" data-audit-sale="receipt" data-id="${s.id}">Ticket</button>
                ${s.status === 'completed'
                  ? `<button type="button" class="btn btn-danger-soft btn-sm" data-audit-sale="cancel" data-id="${s.id}">Anular</button>`
                  : ''}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function loadMovements() {
    const workerId = document.getElementById('kardexWorkerFilter').value || undefined;
    const movementType = document.getElementById('kardexTypeFilter').value || undefined;
    allMovements = await window.posAPI.listMovements({ workerId, movementType, limit: 300 });
    renderKardexTable();
  }

  function renderKardexTable() {
    const { escapeHtml, formatDateTime, formatNumber, movementLabel } = POSApp.utils;
    const tbody = document.getElementById('kardexTableBody');

    if (allMovements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:26px;">No hay movimientos registrados con este filtro.</td></tr>';
      return;
    }

    tbody.innerHTML = allMovements
      .map((m) => {
        const badge = movementLabel(m.movement_type);
        const deltaStr = m.quantity_delta > 0 ? `+${m.quantity_delta}` : `${m.quantity_delta}`;
        const deltaCls = m.quantity_delta > 0 ? 'delta-pos' : m.quantity_delta < 0 ? 'delta-neg' : '';
        return `
          <tr>
            <td data-label="Fecha / Hora" style="font-size:0.82rem;white-space:nowrap;">${escapeHtml(formatDateTime(m.created_at))}</td>
            <td data-label="Producto">
              <div>
                <div class="prod-title" style="font-size:0.88rem;">${escapeHtml(m.product_name)}</div>
                <div class="prod-meta">${m.product_sku ? `SKU: ${escapeHtml(m.product_sku)}` : ''}</div>
              </div>
            </td>
            <td data-label="Tipo"><span class="badge ${badge.cls}">${badge.label}</span></td>
            <td data-label="Anterior">${formatNumber(m.previous_stock)}</td>
            <td data-label="Variación" class="${deltaCls}">${escapeHtml(deltaStr)}</td>
            <td data-label="Nuevo"><strong>${formatNumber(m.new_stock)}</strong></td>
            <td data-label="Trabajador">
              <div>
                <strong>${escapeHtml(m.worker_name)}</strong>
                <div style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(m.worker_code)}</div>
              </div>
            </td>
            <td data-label="Motivo / Ticket" style="font-size:0.82rem;color:var(--text-muted);">
              <span>${m.ticket_number ? `<strong>${escapeHtml(m.ticket_number)}</strong> · ` : ''}${escapeHtml(m.reason || '—')}</span>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openCancelSaleModal(saleId) {
    const sale = allSales.find((s) => s.id === Number(saleId));
    if (!sale) return;
    document.getElementById('cancelSaleId').value = sale.id;
    document.getElementById('cancelSaleTicket').textContent = sale.ticket_number;
    document.getElementById('cancelSaleReason').value = '';
    POSApp.utils.openModal('cancelSaleModal');
    setTimeout(() => document.getElementById('cancelSaleReason').focus(), 60);
  }

  async function submitCancelSale(e) {
    e.preventDefault();
    const saleId = Number(document.getElementById('cancelSaleId').value);
    const reason = document.getElementById('cancelSaleReason').value.trim();
    if (!reason) {
      POSApp.utils.showToast('Indica el motivo de anulación.', 'error');
      return;
    }

    try {
      await window.posAPI.cancelSale(saleId, reason);
      POSApp.utils.closeModal('cancelSaleModal');
      POSApp.utils.showToast('Ticket anulado y stock restaurado en SQLite', 'success');
      await loadAuditData();
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo anular el ticket.', 'error');
    }
  }

  function switchSubtab(subtab) {
    activeSubtab = subtab;
    document.querySelectorAll('#auditSubTabs .tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtab);
    });
    document.getElementById('auditSalesPane').classList.toggle('hidden', subtab !== 'sales');
    document.getElementById('auditKardexPane').classList.toggle('hidden', subtab !== 'kardex');
  }

  function getCachedSales() {
    return allSales;
  }

  function getCachedMovements() {
    return allMovements;
  }

  function init() {
    document.getElementById('auditSubTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-subtab]');
      if (!btn) return;
      switchSubtab(btn.getAttribute('data-subtab'));
    });

    document.getElementById('auditSalesWorkerFilter').addEventListener('change', loadSales);
    document.getElementById('auditSalesStatusFilter').addEventListener('change', loadSales);
    document.getElementById('kardexWorkerFilter').addEventListener('change', loadMovements);
    document.getElementById('kardexTypeFilter').addEventListener('change', loadMovements);

    document.getElementById('allSalesTableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-audit-sale]');
      if (!btn) return;
      const action = btn.getAttribute('data-audit-sale');
      const id = Number(btn.getAttribute('data-id'));
      if (action === 'receipt') {
        const sale = allSales.find((s) => s.id === id);
        if (sale) POSApp.utils.showReceiptModal(sale);
      } else if (action === 'cancel') {
        openCancelSaleModal(id);
      }
    });

    document.getElementById('cancelSaleForm').addEventListener('submit', submitCancelSale);
    document.getElementById('btnExportSalesExcel').addEventListener('click', () => POSApp.xlsx.exportSalesXlsx(allSales));
    document.getElementById('btnExportKardexExcel').addEventListener('click', () => POSApp.xlsx.exportMovementsXlsx(allMovements));
  }

  POSApp.auditView = {
    init,
    loadAuditData,
    getCachedSales,
    getCachedMovements
  };
})(window);
