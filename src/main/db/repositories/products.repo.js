const { SAMPLE_PRODUCTS } = require('../seed');

function normalizeSku(rawSku) {
  const s = String(rawSku || '').trim();
  return s.length > 0 ? s : null;
}

function listActiveProducts(db) {
  return db.prepare(`
    SELECT id, legacy_id, sku, name, category, stock, min_stock, price, notes, is_active, created_at, updated_at
    FROM products
    WHERE is_active = 1
    ORDER BY updated_at DESC, id DESC
  `).all();
}

function getProductById(db, id) {
  return db.prepare(`
    SELECT id, legacy_id, sku, name, category, stock, min_stock, price, notes, is_active, created_at, updated_at
    FROM products
    WHERE id = ?
  `).get(id) || null;
}

function generateAutoSku(db) {
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM products').get().cnt + 1;
  for (let i = 0; i < 50; i++) {
    const rand = Math.floor(100 + Math.random() * 900);
    const candidate = `PRD-${String(count).padStart(3, '0')}-${rand}`;
    const exists = db.prepare('SELECT id FROM products WHERE LOWER(sku) = LOWER(?)').get(candidate);
    if (!exists) return candidate;
  }
  return `PRD-${Date.now().toString().slice(-6)}`;
}

function createProduct(db, data, workerId) {
  const name = String(data.name || '').trim();
  if (!name) {
    throw new Error('El nombre del producto es obligatorio.');
  }

  const sku = normalizeSku(data.sku);
  const category = String(data.category || '').trim() || 'General';
  const stock = Math.max(0, Number.parseInt(data.stock, 10) || 0);
  const minStock = Math.max(0, Number.parseInt(data.min_stock ?? data.minStock, 10) || 0);
  const price = Math.max(0, Math.round((Number.parseFloat(data.price) || 0) * 100) / 100);
  const notes = String(data.notes || '').trim();
  const reason = String(data.reason || 'Alta inicial de producto').trim();

  const tx = db.transaction(() => {
    if (sku) {
      const dup = db.prepare('SELECT id, is_active FROM products WHERE LOWER(sku) = LOWER(?)').get(sku);
      if (dup) {
        if (dup.is_active === 1) {
          throw new Error(`Ya existe un producto activo con el SKU "${sku}".`);
        }
        // Liberar el SKU de un producto archivado para permitir reutilizarlo limpiamente
        db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(`${sku}_ARCH_${dup.id}`, dup.id);
      }
    }

    const now = Date.now();
    const info = db.prepare(`
      INSERT INTO products (legacy_id, sku, name, category, stock, min_stock, price, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(data.legacy_id || null, sku, name, category, stock, minStock, price, notes, now, now);

    const productId = info.lastInsertRowid;

    db.prepare(`
      INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
      VALUES (?, ?, NULL, 'initial', 0, ?, ?, ?, ?)
    `).run(productId, workerId, stock, stock, reason, now);

    return getProductById(db, productId);
  });

  return tx();
}

function updateProduct(db, id, data, workerId) {
  const name = String(data.name || '').trim();
  if (!name) {
    throw new Error('El nombre del producto es obligatorio.');
  }

  const sku = normalizeSku(data.sku);
  const category = String(data.category || '').trim() || 'General';
  const nextStock = Math.max(0, Number.parseInt(data.stock, 10) || 0);
  const minStock = Math.max(0, Number.parseInt(data.min_stock ?? data.minStock, 10) || 0);
  const price = Math.max(0, Math.round((Number.parseFloat(data.price) || 0) * 100) / 100);
  const notes = String(data.notes || '').trim();
  const reason = String(data.reason || 'Actualización de ficha de producto').trim();

  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
    if (!existing) {
      throw new Error('Producto no encontrado.');
    }

    if (sku) {
      const dup = db.prepare('SELECT id, is_active FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?').get(sku, id);
      if (dup) {
        if (dup.is_active === 1) {
          throw new Error(`El SKU "${sku}" ya está asignado a otro producto.`);
        }
        db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(`${sku}_ARCH_${dup.id}`, dup.id);
      }
    }

    const now = Date.now();
    db.prepare(`
      UPDATE products
      SET sku = ?, name = ?, category = ?, stock = ?, min_stock = ?, price = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(sku, name, category, nextStock, minStock, price, notes, now, id);

    if (nextStock !== existing.stock) {
      const delta = nextStock - existing.stock;
      db.prepare(`
        INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
        VALUES (?, ?, NULL, 'manual_set', ?, ?, ?, ?, ?)
      `).run(id, workerId, existing.stock, delta, nextStock, reason, now);
    }

    return getProductById(db, id);
  });

  return tx();
}

function adjustStock(db, id, { delta, exactStock, reason }, workerId) {
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
    if (!existing) {
      throw new Error('Producto no encontrado.');
    }

    const previousStock = existing.stock;
    let nextStock = previousStock;
    let movementType = 'manual_set';
    let defaultReason = 'Ajuste manual de stock';

    if (exactStock !== undefined && exactStock !== null && exactStock !== '') {
      const parsed = Number.parseInt(exactStock, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error('Introduce una cantidad válida mayor o igual a 0.');
      }
      nextStock = parsed;
      movementType = 'manual_set';
      defaultReason = 'Fijación exacta de stock';
    } else {
      const parsedDelta = Number.parseInt(delta, 10);
      if (Number.isNaN(parsedDelta) || parsedDelta === 0) {
        throw new Error('La variación de stock debe ser distinta de cero.');
      }
      nextStock = Math.max(0, previousStock + parsedDelta);
      movementType = parsedDelta > 0 ? 'manual_add' : 'manual_sub';
      defaultReason = parsedDelta > 0 ? 'Entrada rápida de inventario' : 'Salida rápida de inventario';
    }

    const actualDelta = nextStock - previousStock;
    if (actualDelta === 0) {
      return existing;
    }

    const now = Date.now();
    db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(nextStock, now, id);

    db.prepare(`
      INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workerId,
      movementType,
      previousStock,
      actualDelta,
      nextStock,
      String(reason || '').trim() || defaultReason,
      now
    );

    return getProductById(db, id);
  });

  return tx();
}

function deleteProduct(db, id, workerId) {
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
    if (!existing) {
      throw new Error('Producto no encontrado.');
    }

    const now = Date.now();
    const archivedSku = existing.sku ? `${existing.sku}_ARCH_${existing.id}` : null;

    if (existing.stock > 0) {
      db.prepare(`
        INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
        VALUES (?, ?, NULL, 'manual_set', ?, ?, 0, 'Baja de producto del catálogo', ?)
      `).run(id, workerId, existing.stock, -existing.stock, now);
    }

    db.prepare(`
      UPDATE products
      SET is_active = 0, stock = 0, sku = ?, updated_at = ?
      WHERE id = ?
    `).run(archivedSku, now, id);

    return { deletedId: id, name: existing.name };
  });

  return tx();
}

function importProducts(db, incomingItems, mode = 'merge', workerId) {
  if (!Array.isArray(incomingItems)) {
    throw new Error('Formato de importación no válido: se esperaba una lista de productos.');
  }

  const sanitized = incomingItems.map((item) => ({
    legacy_id: item.id ? String(item.id) : null,
    sku: normalizeSku(item.sku),
    name: String(item.name || 'Producto sin nombre').trim() || 'Producto sin nombre',
    category: String(item.category || 'General').trim() || 'General',
    stock: Math.max(0, Number.parseInt(item.stock, 10) || 0),
    min_stock: Math.max(0, Number.parseInt(item.min_stock ?? item.minStock, 10) || 0),
    price: Math.max(0, Math.round((Number.parseFloat(item.price) || 0) * 100) / 100),
    notes: String(item.notes || '').trim()
  }));

  const tx = db.transaction(() => {
    const now = Date.now();

    if (mode === 'replace') {
      const currentActives = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
      const archiveStmt = db.prepare('UPDATE products SET is_active = 0, stock = 0, sku = ?, legacy_id = NULL, updated_at = ? WHERE id = ?');
      const movStmt = db.prepare(`
        INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
        VALUES (?, ?, NULL, 'import', ?, ?, 0, 'Reemplazo masivo por importación JSON', ?)
      `);

      for (const p of currentActives) {
        if (p.stock > 0) {
          movStmt.run(p.id, workerId, p.stock, -p.stock, now);
        }
        archiveStmt.run(p.sku ? `${p.sku}_ARCH_${p.id}` : null, now, p.id);
      }
    }

    let created = 0;
    let updated = 0;

    for (const inc of sanitized) {
      let existing = null;
      if (mode === 'merge') {
        if (inc.sku) {
          existing = db.prepare('SELECT * FROM products WHERE is_active = 1 AND LOWER(sku) = LOWER(?)').get(inc.sku);
        }
        if (!existing) {
          existing = db.prepare('SELECT * FROM products WHERE is_active = 1 AND LOWER(name) = LOWER(?)').get(inc.name);
        }
      }

      if (existing) {
        // Evitar conflicto de SKU si coincide con otro archivado o diferente
        let skuToSave = inc.sku || existing.sku;
        if (skuToSave) {
          const dup = db.prepare('SELECT id, is_active FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?').get(skuToSave, existing.id);
          if (dup) {
            if (dup.is_active === 0) {
              db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(`${skuToSave}_ARCH_${dup.id}`, dup.id);
            } else {
              skuToSave = existing.sku;
            }
          }
        }

        db.prepare(`
          UPDATE products
          SET sku = ?, name = ?, category = ?, stock = ?, min_stock = ?, price = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `).run(skuToSave, inc.name, inc.category, inc.stock, inc.min_stock, inc.price, inc.notes, now, existing.id);

        if (inc.stock !== existing.stock) {
          db.prepare(`
            INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
            VALUES (?, ?, NULL, 'import', ?, ?, ?, 'Actualización por importación JSON', ?)
          `).run(existing.id, workerId, existing.stock, inc.stock - existing.stock, inc.stock, now);
        }
        updated += 1;
      } else {
        let finalSku = inc.sku;
        if (finalSku) {
          const dup = db.prepare('SELECT id, is_active FROM products WHERE LOWER(sku) = LOWER(?)').get(finalSku);
          if (dup) {
            if (dup.is_active === 0) {
              db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(`${finalSku}_ARCH_${dup.id}`, dup.id);
            } else {
              finalSku = `${finalSku}-${Math.floor(100 + Math.random() * 900)}`;
            }
          }
        }

        let legacyId = inc.legacy_id;
        if (legacyId) {
          const dupLeg = db.prepare('SELECT id FROM products WHERE legacy_id = ?').get(legacyId);
          if (dupLeg) legacyId = null;
        }

        const res = db.prepare(`
          INSERT INTO products (legacy_id, sku, name, category, stock, min_stock, price, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(legacyId, finalSku, inc.name, inc.category, inc.stock, inc.min_stock, inc.price, inc.notes, now, now);

        db.prepare(`
          INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
          VALUES (?, ?, NULL, 'import', 0, ?, ?, 'Alta por importación JSON', ?)
        `).run(res.lastInsertRowid, workerId, inc.stock, inc.stock, now);
        created += 1;
      }
    }

    return { imported: sanitized.length, created, updated };
  });

  return tx();
}

function loadSampleProducts(db, workerId) {
  return importProducts(db, SAMPLE_PRODUCTS, 'merge', workerId);
}

function clearAllProducts(db, workerId) {
  const tx = db.transaction(() => {
    const now = Date.now();
    const actives = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
    for (const p of actives) {
      if (p.stock > 0) {
        db.prepare(`
          INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
          VALUES (?, ?, NULL, 'manual_set', ?, ?, 0, 'Vaciado manual de inventario', ?)
        `).run(p.id, workerId, p.stock, -p.stock, now);
      }
      db.prepare('UPDATE products SET is_active = 0, stock = 0, sku = ?, legacy_id = NULL, updated_at = ? WHERE id = ?')
        .run(p.sku ? `${p.sku}_ARCH_${p.id}` : null, now, p.id);
    }
    return { clearedCount: actives.length };
  });
  return tx();
}

module.exports = {
  listActiveProducts,
  getProductById,
  generateAutoSku,
  createProduct,
  updateProduct,
  adjustStock,
  deleteProduct,
  importProducts,
  loadSampleProducts,
  clearAllProducts
};
