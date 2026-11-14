(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  function formatCurrency(num) {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR'
    }).format(Number(num) || 0);
  }

  function formatNumber(num) {
    return new Intl.NumberFormat('es-ES').format(Number(num) || 0);
  }

  function formatDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    return d.toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function getStockStatus(p) {
    const stock = Number(p.stock || 0);
    const minStock = Number(p.min_stock ?? p.minStock ?? 0);
    if (stock <= 0) return { key: 'out', label: 'Agotado', cls: 'badge-out' };
    if (stock <= minStock) return { key: 'low', label: 'Stock Bajo', cls: 'badge-low' };
    return { key: 'ok', label: 'Óptimo', cls: 'badge-ok' };
  }

  function paymentLabel(method) {
    if (method === 'card') return 'Tarjeta';
    if (method === 'other') return 'Otro';
    return 'Efectivo';
  }

  function movementLabel(type) {
    const map = {
      sale: { label: 'Venta POS', cls: 'badge-info' },
      manual_add: { label: 'Ajuste (+)', cls: 'badge-ok' },
      manual_sub: { label: 'Ajuste (-)', cls: 'badge-low' },
      manual_set: { label: 'Ajuste exacto', cls: 'badge-muted' },
      initial: { label: 'Alta inicial', cls: 'badge-ok' },
      import: { label: 'Importación', cls: 'badge-info' },
      cancellation: { label: 'Anulación', cls: 'badge-out' }
    };
    return map[type] || { label: type, cls: 'badge-muted' };
  }

  function showToast(msg, variant = 'info') {
    const wrap = document.getElementById('toastContainer');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `toast ${variant === 'error' ? 'error' : variant === 'success' ? 'success' : ''}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s';
      setTimeout(() => el.remove(), 220);
    }, 3000);
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  function initModalClosers() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close-modal'));
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop && backdrop.id !== 'confirmModal') {
          closeModal(backdrop.id);
        }
      });
    });
  }

  let confirmResolver = null;

  function confirmDialog({ title = 'Confirmar', message = '', confirmText = 'Confirmar', danger = false }) {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      document.getElementById('confirmModalTitle').textContent = title;
      document.getElementById('confirmModalMessage').textContent = message;
      const acceptBtn = document.getElementById('confirmModalAccept');
      acceptBtn.textContent = confirmText;
      acceptBtn.className = danger ? 'btn btn-danger-soft' : 'btn btn-primary';
      openModal('confirmModal');
    });
  }

  function initConfirmDialog() {
    const finish = (val) => {
      closeModal('confirmModal');
      if (confirmResolver) {
        const res = confirmResolver;
        confirmResolver = null;
        res(val);
      }
    };
    document.getElementById('confirmModalAccept').addEventListener('click', () => finish(true));
    document.getElementById('confirmModalCancel').addEventListener('click', () => finish(false));
    document.getElementById('confirmModalCloseX').addEventListener('click', () => finish(false));
  }

  function showReceiptModal(sale) {
    const container = document.getElementById('receiptContent');
    if (!sale || !container) return;

    const linesHtml = (sale.items || [])
      .map((item) => `
        <div style="display:flex;justify-content:space-between;gap:8px;margin:4px 0;">
          <span>${item.quantity}x ${escapeHtml(item.product_name_snapshot)}</span>
          <strong>${formatCurrency(item.subtotal)}</strong>
        </div>
      `)
      .join('');

    const statusLine = sale.status === 'cancelled'
      ? `<div style="color:var(--danger);font-weight:800;text-align:center;margin-bottom:8px;">*** TICKET ANULADO ***</div>`
      : '';

    container.innerHTML = `
      ${statusLine}
      <div style="text-align:center;margin-bottom:10px;">
        <strong style="font-size:1rem;">CONTROL DE STOCK &amp; POS</strong><br/>
        <span>Ticket: <strong>${escapeHtml(sale.ticket_number)}</strong></span><br/>
        <span>Fecha: ${escapeHtml(formatDateTime(sale.created_at))}</span><br/>
        <span>Atendido por: ${escapeHtml(sale.worker_name)} (${escapeHtml(sale.worker_code)})</span>
      </div>
      <hr style="border:none;border-top:1px dashed var(--border);margin:8px 0;" />
      ${linesHtml}
      <hr style="border:none;border-top:1px dashed var(--border);margin:8px 0;" />
      <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;">
        <span>TOTAL</span>
        <span>${formatCurrency(sale.total_amount)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;">
        <span>Método de pago:</span>
        <span>${escapeHtml(paymentLabel(sale.payment_method))}</span>
      </div>
      ${sale.payment_method === 'cash' && sale.amount_received != null ? `
        <div style="display:flex;justify-content:space-between;">
          <span>Entregado:</span>
          <span>${formatCurrency(sale.amount_received)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span>Cambio:</span>
          <span>${formatCurrency(sale.change_given || 0)}</span>
        </div>
      ` : ''}
      ${sale.notes ? `<div style="margin-top:8px;font-size:0.78rem;color:var(--text-muted);">Nota: ${escapeHtml(sale.notes)}</div>` : ''}
    `;

    openModal('receiptModal');
  }

  POSApp.utils = {
    formatCurrency,
    formatNumber,
    formatDateTime,
    escapeHtml,
    getInitials,
    getStockStatus,
    paymentLabel,
    movementLabel,
    showToast,
    openModal,
    closeModal,
    initModalClosers,
    confirmDialog,
    initConfirmDialog,
    showReceiptModal
  };
})(window);
