function formatDateKey(ts) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function generateTicketNumber(db, now) {
  const datePart = formatDateKey(now);
  const prefix = `TCK-${datePart}-`;
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE ticket_number LIKE ?').get(`${prefix}%`);
  let seq = (row ? row.cnt : 0) + 1;

  while (true) {
    const candidate = `${prefix}${String(seq).padStart(4, '0')}`;
    const exists = db.prepare('SELECT id FROM sales WHERE ticket_number = ?').get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function createSale(db, payload, workerId) {
  const rawItems = payload && Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) {
    throw new Error('El ticket está vacío. Añade al menos un producto para cobrar.');
  }

  const paymentMethod = ['cash', 'card', 'other'].includes(payload.payment_method)
    ? payload.payment_method
    : 'cash';
  const notes = String(payload.notes || '').trim();

  // Consolidar cantidades por product_id para evitar lecturas duplicadas de stock
  const grouped = new Map();
  for (const raw of rawItems) {
    const productId = Number(raw.product_id ?? raw.productId);
    const qty = Number.parseInt(raw.quantity, 10);
    if (!productId || Number.isNaN(qty) || qty <= 0) {
      throw new Error('Cada línea del ticket debe tener un producto válido y cantidad mayor que 0.');
    }
    grouped.set(productId, (grouped.get(productId) || 0) + qty);
  }

  const tx = db.transaction(() => {
    const now = Date.now();
    const selectProduct = db.prepare('SELECT id, sku, name, stock, price, is_active FROM products WHERE id = ?');
    const preparedLines = [];
    let totalAmount = 0;

    for (const [productId, quantity] of grouped.entries()) {
      const product = selectProduct.get(productId);
      if (!product || product.is_active !== 1) {
        throw new Error(`El producto (ID ${productId}) no existe o ya no está activo.`);
      }
      if (product.stock < quantity) {
        throw new Error(`Stock insuficiente para "${product.name}" (disponible: ${product.stock}, solicitado: ${quantity}).`);
      }

      const unitPrice = Math.round(Number(product.price) * 100) / 100;
      const subtotal = Math.round(unitPrice * quantity * 100) / 100;
      totalAmount += subtotal;

      preparedLines.push({
        product,
        quantity,
        unitPrice,
        subtotal
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    let amountReceived = totalAmount;
    let changeGiven = 0;
    if (paymentMethod === 'cash' && payload.amount_received !== undefined && payload.amount_received !== null && payload.amount_received !== '') {
      const parsedReceived = Math.round(Number(payload.amount_received) * 100) / 100;
      if (Number.isNaN(parsedReceived) || parsedReceived < totalAmount) {
        throw new Error('El efectivo entregado es inferior al importe total del ticket.');
      }
      amountReceived = parsedReceived;
      changeGiven = Math.round((amountReceived - totalAmount) * 100) / 100;
    }

    const ticketNumber = generateTicketNumber(db, now);

    const saleRes = db.prepare(`
      INSERT INTO sales (ticket_number, worker_id, total_amount, payment_method, amount_received, change_given, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `).run(ticketNumber, workerId, totalAmount, paymentMethod, amountReceived, changeGiven, notes, now);

    const saleId = saleRes.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, product_sku_snapshot, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProductStock = db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?');
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
      VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, ?)
    `);

    for (const line of preparedLines) {
      const newStock = line.product.stock - line.quantity;

      insertItem.run(
        saleId,
        line.product.id,
        line.product.name,
        line.product.sku || '',
        line.quantity,
        line.unitPrice,
        line.subtotal
      );

      updateProductStock.run(newStock, now, line.product.id);

      insertMovement.run(
        line.product.id,
        workerId,
        saleId,
        line.product.stock,
        -line.quantity,
        newStock,
        `Venta ${ticketNumber}`,
        now
      );
    }

    return getSaleById(db, saleId);
  });

  return tx();
}

function getSaleById(db, saleId) {
  const sale = db.prepare(`
    SELECT
      s.*,
      w.name AS worker_name,
      w.employee_code AS worker_code,
      w.role AS worker_role
    FROM sales s
    INNER JOIN workers w ON w.id = s.worker_id
    WHERE s.id = ?
  `).get(saleId);

  if (!sale) return null;

  sale.items = db.prepare(`
    SELECT id, sale_id, product_id, product_name_snapshot, product_sku_snapshot, quantity, unit_price, subtotal
    FROM sale_items
    WHERE sale_id = ?
    ORDER BY id ASC
  `).all(saleId);

  return sale;
}

function listSales(db, filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.workerIdFilter) {
    conditions.push('s.worker_id = ?');
    params.push(Number(filters.workerIdFilter));
  }
  if (filters.status && ['completed', 'cancelled'].includes(filters.status)) {
    conditions.push('s.status = ?');
    params.push(filters.status);
  }
  if (filters.dateFrom) {
    conditions.push('s.created_at >= ?');
    params.push(Number(filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push('s.created_at <= ?');
    params.push(Number(filters.dateTo));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 150));

  const sales = db.prepare(`
    SELECT
      s.*,
      w.name AS worker_name,
      w.employee_code AS worker_code,
      w.role AS worker_role
    FROM sales s
    INNER JOIN workers w ON w.id = s.worker_id
    ${whereClause}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ?
  `).all(...params, limit);

  if (sales.length === 0) return [];

  const saleIds = sales.map((s) => s.id);
  const placeholders = saleIds.map(() => '?').join(',');
  const allItems = db.prepare(`
    SELECT id, sale_id, product_id, product_name_snapshot, product_sku_snapshot, quantity, unit_price, subtotal
    FROM sale_items
    WHERE sale_id IN (${placeholders})
    ORDER BY id ASC
  `).all(...saleIds);

  const itemsBySale = new Map();
  for (const item of allItems) {
    if (!itemsBySale.has(item.sale_id)) {
      itemsBySale.set(item.sale_id, []);
    }
    itemsBySale.get(item.sale_id).push(item);
  }

  return sales.map((s) => ({
    ...s,
    items: itemsBySale.get(s.id) || []
  }));
}

function cancelSale(db, saleId, reason, adminWorkerId) {
  const tx = db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) {
      throw new Error('Ticket de venta no encontrado.');
    }
    if (sale.status === 'cancelled') {
      throw new Error('Este ticket ya fue anulado anteriormente.');
    }

    const now = Date.now();
    const cancelNote = String(reason || '').trim() || `Anulado por administrador`;
    const mergedNotes = sale.notes ? `${sale.notes} | Anulación: ${cancelNote}` : `Anulación: ${cancelNote}`;

    db.prepare("UPDATE sales SET status = 'cancelled', notes = ? WHERE id = ?").run(mergedNotes, saleId);

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    const selectProd = db.prepare('SELECT id, stock FROM products WHERE id = ?');
    const updateProd = db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?');
    const insertMov = db.prepare(`
      INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
      VALUES (?, ?, ?, 'cancellation', ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const prod = selectProd.get(item.product_id);
      if (prod) {
        const nextStock = prod.stock + item.quantity;
        updateProd.run(nextStock, now, prod.id);
        insertMov.run(
          prod.id,
          adminWorkerId,
          saleId,
          prod.stock,
          item.quantity,
          nextStock,
          `Anulación ${sale.ticket_number}: ${cancelNote}`,
          now
        );
      }
    }

    return getSaleById(db, saleId);
  });

  return tx();
}

module.exports = {
  createSale,
  getSaleById,
  listSales,
  cancelSale
};
