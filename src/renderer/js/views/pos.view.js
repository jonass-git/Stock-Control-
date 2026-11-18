(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  let products = [];
  let cart = [];
  let activeCategory = 'all';
  let paymentMethod = 'cash';
  let shiftSalesCache = [];

  async function loadProducts() {
    products = await window.posAPI.listProducts();
    syncCartStockLimits();
    renderCategoryPills();
    renderPosCatalog();
    renderReadonlyCatalog();
    renderTicket();
  }

  function syncCartStockLimits() {
    const byId = new Map(products.map((p) => [p.id, p]));
    cart = cart
      .map((line) => {
        const prod = byId.get(line.product_id);
        if (!prod || prod.stock <= 0) return null;
        return {
          ...line,
          name: prod.name,
          sku: prod.sku || '',
          price: Number(prod.price),
          maxStock: prod.stock,
          quantity: Math.min(line.quantity, prod.stock)
        };
      })
      .filter(Boolean);
  }

  function renderCategoryPills() {
    const { escapeHtml } = POSApp.utils;
    const cats = [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort();

    if (activeCategory !== 'all' && !cats.includes(activeCategory)) {
      activeCategory = 'all';
    }

    const pillsHtml = [`<button type="button" class="pill ${activeCategory === 'all' ? 'active' : ''}" data-pos-cat="all">Todas</button>`]
      .concat(cats.map((c) => `<button type="button" class="pill ${activeCategory === c ? 'active' : ''}" data-pos-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`))
      .join('');
    document.getElementById('posCategoryPills').innerHTML = pillsHtml;

    const roSelect = document.getElementById('roCategoryFilter');
    const prev = roSelect.value || 'all';
    roSelect.innerHTML = '<option value="all">Todas las categorías</option>' +
      cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (cats.includes(prev)) roSelect.value = prev;
  }

  function getFilteredProducts(queryText, categoryVal) {
    const q = String(queryText || '').trim().toLowerCase();
    return products.filter((p) => {
      const matchQuery = !q ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q);
      const matchCat = categoryVal === 'all' || (p.category || '') === categoryVal;
      return matchQuery && matchCat;
    });
  }

  function renderPosCatalog() {
    const { escapeHtml, formatCurrency, formatNumber, getStockStatus } = POSApp.utils;
    const query = document.getElementById('posSearchInput').value;
    const filtered = getFilteredProducts(query, activeCategory);
    const grid = document.getElementById('posProductsGrid');
    const empty = document.getElementById('posEmptyState');

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = filtered
      .map((p) => {
        const st = getStockStatus(p);
        const inCart = cart.find((c) => c.product_id === p.id);
        const availableLeft = Math.max(0, p.stock - (inCart ? inCart.quantity : 0));
        const isOut = p.stock <= 0;

        return `
          <div class="pos-prod-card ${isOut ? 'out-of-stock' : ''}">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px;">
                <span class="cat-tag">${escapeHtml(p.category || 'General')}</span>
                <span class="badge ${st.cls}">${st.label} (${formatNumber(p.stock)})</span>
              </div>
              <div class="prod-title">${escapeHtml(p.name)}</div>
              <div class="prod-meta">
                ${p.sku ? `<span>SKU: <strong>${escapeHtml(p.sku)}</strong></span>` : ''}
                ${inCart ? `<span style="color:var(--primary);font-weight:700;">En ticket: ${inCart.quantity}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;">
              <span class="pos-prod-price">${formatCurrency(p.price)}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-add-product="${p.id}"
                ${availableLeft <= 0 ? 'disabled' : ''}
              >
                ${isOut ? 'Sin stock' : availableLeft <= 0 ? 'Máx. en ticket' : '+ Añadir'}
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function addToCart(productId) {
    const prod = products.find((p) => p.id === Number(productId));
    if (!prod) return;
    if (prod.stock <= 0) {
      POSApp.utils.showToast(`"${prod.name}" está agotado.`, 'error');
      return;
    }

    const existing = cart.find((c) => c.product_id === prod.id);
    if (existing) {
      if (existing.quantity >= prod.stock) {
        POSApp.utils.showToast(`Solo hay ${prod.stock} unidades disponibles de "${prod.name}".`, 'error');
        return;
      }
      existing.quantity += 1;
    } else {
      cart.push({
        product_id: prod.id,
        name: prod.name,
        sku: prod.sku || '',
        price: Number(prod.price),
        maxStock: prod.stock,
        quantity: 1
      });
    }

    renderPosCatalog();
    renderTicket();
  }

  function updateCartQty(productId, delta) {
    const idx = cart.findIndex((c) => c.product_id === Number(productId));
    if (idx === -1) return;
    const item = cart[idx];
    const nextQty = item.quantity + delta;
    if (nextQty <= 0) {
      cart.splice(idx, 1);
    } else if (nextQty > item.maxStock) {
      POSApp.utils.showToast(`Stock máximo disponible: ${item.maxStock} uds.`, 'error');
      return;
    } else {
      item.quantity = nextQty;
    }
    renderPosCatalog();
    renderTicket();
  }

  function removeFromCart(productId) {
    cart = cart.filter((c) => c.product_id !== Number(productId));
    renderPosCatalog();
    renderTicket();
  }

  function clearCart() {
    cart = [];
    document.getElementById('posCashReceived').value = '';
    document.getElementById('posTicketNotes').value = '';
    renderPosCatalog();
    renderTicket();
  }

  function getCartTotal() {
    return Math.round(cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  }

  function updateChangeDisplay() {
    const total = getCartTotal();
    const cashSection = document.getElementById('posCashSection');
    const changeBox = document.getElementById('posChangeBox');
    const changeAmountEl = document.getElementById('posChangeAmount');

    if (paymentMethod !== 'cash' || cart.length === 0) {
      cashSection.classList.toggle('hidden', paymentMethod !== 'cash');
      changeBox.classList.add('hidden');
      return;
    }

    cashSection.classList.remove('hidden');
    const rawVal = document.getElementById('posCashReceived').value;
    if (rawVal === '') {
      changeBox.classList.add('hidden');
      return;
    }

    const received = Number(rawVal);
    changeBox.classList.remove('hidden');
    if (Number.isNaN(received) || received < total) {
      changeBox.classList.add('insufficient');
      changeAmountEl.textContent = `Faltan ${POSApp.utils.formatCurrency(total - (Number.isNaN(received) ? 0 : received))}`;
    } else {
      changeBox.classList.remove('insufficient');
      changeAmountEl.textContent = POSApp.utils.formatCurrency(received - total);
    }
  }

  function renderTicket() {
    const { escapeHtml, formatCurrency } = POSApp.utils;
    const linesEl = document.getElementById('posTicketLines');
    const countEl = document.getElementById('posTicketCount');
    const totalEl = document.getElementById('posTotalAmount');
    const checkoutBtn = document.getElementById('posCheckoutBtn');

    const totalUnits = cart.reduce((s, x) => s + x.quantity, 0);
    const total = getCartTotal();

    countEl.textContent = `${totalUnits} artículo${totalUnits === 1 ? '' : 's'}`;
    totalEl.textContent = formatCurrency(total);
    checkoutBtn.disabled = cart.length === 0;

    if (cart.length === 0) {
      linesEl.innerHTML = '<div style="text-align:center;padding:28px 10px;color:var(--text-muted);font-size:0.86rem;">Añade productos desde el catálogo para iniciar una venta.</div>';
      updateChangeDisplay();
      return;
    }

    linesEl.innerHTML = cart
      .map((item) => {
        const sub = item.price * item.quantity;
        return `
          <div class="pos-line">
            <div style="min-width:0;flex:1;">
              <div class="prod-title" style="font-size:0.88rem;">${escapeHtml(item.name)}</div>
              <div class="prod-meta">${formatCurrency(item.price)} / ud. · Disp: ${item.maxStock}</div>
            </div>
            <div class="stepper">
              <button type="button" class="step-btn minus" data-cart-dec="${item.product_id}">−</button>
              <span class="step-val" style="cursor:default;min-width:30px;">${item.quantity}</span>
              <button type="button" class="step-btn plus" data-cart-inc="${item.product_id}">+</button>
            </div>
            <div style="text-align:right;min-width:68px;">
              <strong style="font-size:0.88rem;">${formatCurrency(sub)}</strong><br/>
              <button type="button" class="btn btn-danger-soft btn-sm" style="padding:2px 6px;font-size:0.7rem;" data-cart-rm="${item.product_id}">Quitar</button>
            </div>
          </div>
        `;
      })
      .join('');

    updateChangeDisplay();
  }

  async function handleCheckout() {
    if (cart.length === 0) return;

    const total = getCartTotal();
    const cashInput = document.getElementById('posCashReceived').value;
    const notes = document.getElementById('posTicketNotes').value.trim();

    if (paymentMethod === 'cash' && cashInput !== '') {
      const received = Number(cashInput);
      if (Number.isNaN(received) || received < total) {
        POSApp.utils.showToast('El efectivo entregado es menor que el total a cobrar.', 'error');
        return;
      }
    }

    const btn = document.getElementById('posCheckoutBtn');
    btn.disabled = true;
    try {
      const sale = await window.posAPI.createSale({
        items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
        payment_method: paymentMethod,
        amount_received: paymentMethod === 'cash' && cashInput !== '' ? Number(cashInput) : total,
        notes
      });

      clearCart();
      await loadProducts();
      POSApp.utils.showToast(`Venta ${sale.ticket_number} registrada (${POSApp.utils.formatCurrency(sale.total_amount)})`, 'success');
      POSApp.utils.showReceiptModal(sale);
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al registrar la venta.', 'error');
      await loadProducts();
    } finally {
      btn.disabled = cart.length === 0;
    }
  }

  function renderReadonlyCatalog() {
    const { escapeHtml, formatCurrency, formatNumber, getStockStatus } = POSApp.utils;
    const q = document.getElementById('roSearchInput').value;
    const cat = document.getElementById('roCategoryFilter').value || 'all';
    const filtered = getFilteredProducts(q, cat);
    const tbody = document.getElementById('readonlyTableBody');

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:28px;">No se encontraron productos.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((p) => {
        const st = getStockStatus(p);
        return `
          <tr>
            <td data-label="Producto">
              <div>
                <div class="prod-title">${escapeHtml(p.name)}</div>
                <div class="prod-meta">
                  ${p.sku ? `<span>SKU: <strong>${escapeHtml(p.sku)}</strong></span>` : ''}
                  ${p.notes ? `<span>• ${escapeHtml(p.notes)}</span>` : ''}
                </div>
              </div>
            </td>
            <td data-label="Categoría"><span class="cat-tag">${escapeHtml(p.category || 'General')}</span></td>
            <td data-label="Precio Unit."><strong>${formatCurrency(p.price)}</strong></td>
            <td data-label="Stock"><span><strong>${formatNumber(p.stock)}</strong> uds.</span></td>
            <td data-label="Estado"><span class="badge ${st.cls}">${st.label}</span></td>
          </tr>
        `;
      })
      .join('');
  }

  async function loadMyShiftSales() {
    const { escapeHtml, formatCurrency, formatDateTime, paymentLabel } = POSApp.utils;
    shiftSalesCache = await window.posAPI.listMyShiftSales({ limit: 150 });

    const completed = shiftSalesCache.filter((s) => s.status === 'completed');
    const totalSum = completed.reduce((acc, s) => acc + Number(s.total_amount || 0), 0);
    document.getElementById('shiftTotalSales').textContent = POSApp.utils.formatNumber(completed.length);
    document.getElementById('shiftTotalAmount').textContent = formatCurrency(totalSum);

    const tbody = document.getElementById('myShiftSalesBody');
    if (shiftSalesCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px;">Aún no has registrado ventas con este usuario.</td></tr>';
      return;
    }

    tbody.innerHTML = shiftSalesCache
      .map((s) => {
        const summary = (s.items || []).map((i) => `${i.quantity}x ${i.product_name_snapshot}`).join(', ');
        const statusBadge = s.status === 'cancelled'
          ? '<span class="badge badge-out">Anulada</span>'
          : '<span class="badge badge-ok">Completada</span>';
        return `
          <tr>
            <td data-label="Ticket"><strong>${escapeHtml(s.ticket_number)}</strong></td>
            <td data-label="Fecha / Hora">${escapeHtml(formatDateTime(s.created_at))}</td>
            <td data-label="Artículos" class="td-truncate" title="${escapeHtml(summary)}">${escapeHtml(summary)}</td>
            <td data-label="Pago">${escapeHtml(paymentLabel(s.payment_method))}</td>
            <td data-label="Total"><strong>${formatCurrency(s.total_amount)}</strong></td>
            <td data-label="Estado">${statusBadge}</td>
            <td data-label="Detalle" style="text-align:right;">
              <button type="button" class="btn btn-outline btn-sm" data-shift-receipt="${s.id}">Ver Ticket</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function resetOnLogout() {
    cart = [];
    activeCategory = 'all';
    paymentMethod = 'cash';
    document.getElementById('posSearchInput').value = '';
    document.getElementById('posCashReceived').value = '';
    document.getElementById('posTicketNotes').value = '';
  }

  function init() {
    const searchInput = document.getElementById('posSearchInput');
    const debouncedPosRender = POSApp.utils.debounce(renderPosCatalog, 120);
    searchInput.addEventListener('input', debouncedPosRender);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = searchInput.value.trim().toLowerCase();
        if (!q) return;
        const exactSku = products.find((p) => (p.sku || '').toLowerCase() === q);
        if (exactSku) {
          addToCart(exactSku.id);
          searchInput.value = '';
          renderPosCatalog();
          return;
        }
        const filtered = getFilteredProducts(q, activeCategory);
        if (filtered.length === 1) {
          addToCart(filtered[0].id);
          searchInput.value = '';
          renderPosCatalog();
        }
      }
    });

    document.getElementById('posCategoryPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pos-cat]');
      if (!btn) return;
      activeCategory = btn.getAttribute('data-pos-cat');
      renderCategoryPills();
      renderPosCatalog();
    });

    document.getElementById('posProductsGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add-product]');
      if (!btn) return;
      addToCart(btn.getAttribute('data-add-product'));
    });

    document.getElementById('posTicketLines').addEventListener('click', (e) => {
      const inc = e.target.closest('[data-cart-inc]');
      if (inc) return updateCartQty(inc.getAttribute('data-cart-inc'), 1);
      const dec = e.target.closest('[data-cart-dec]');
      if (dec) return updateCartQty(dec.getAttribute('data-cart-dec'), -1);
      const rm = e.target.closest('[data-cart-rm]');
      if (rm) return removeFromCart(rm.getAttribute('data-cart-rm'));
    });

    document.getElementById('posClearCartBtn').addEventListener('click', clearCart);
    document.getElementById('posCheckoutBtn').addEventListener('click', handleCheckout);

    document.getElementById('posPaymentMethods').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pay]');
      if (!btn) return;
      paymentMethod = btn.getAttribute('data-pay');
      document.querySelectorAll('#posPaymentMethods .pay-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      updateChangeDisplay();
    });

    document.getElementById('posCashReceived').addEventListener('input', updateChangeDisplay);
    document.getElementById('posQuickCashRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cash]');
      if (!btn) return;
      const val = btn.getAttribute('data-cash');
      document.getElementById('posCashReceived').value = val === 'exact' ? getCartTotal().toFixed(2) : val;
      updateChangeDisplay();
    });

    document.getElementById('roSearchInput').addEventListener('input', POSApp.utils.debounce(renderReadonlyCatalog, 120));
    document.getElementById('roCategoryFilter').addEventListener('change', renderReadonlyCatalog);

    document.getElementById('myShiftSalesBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shift-receipt]');
      if (!btn) return;
      const sale = shiftSalesCache.find((s) => s.id === Number(btn.getAttribute('data-shift-receipt')));
      if (sale) POSApp.utils.showReceiptModal(sale);
    });
  }

  POSApp.posView = {
    init,
    loadProducts,
    loadMyShiftSales,
    resetOnLogout
  };
})(window);
