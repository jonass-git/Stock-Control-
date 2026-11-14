const { hashCredential } = require('../security');

const SAMPLE_PRODUCTS = [
  {
    legacy_id: 'p_1',
    sku: 'TEC-001',
    name: 'Ratón Inalámbrico Ergonómico',
    category: 'Electrónica',
    stock: 24,
    min_stock: 8,
    price: 29.95,
    notes: 'Pasillo A - Estante 2'
  },
  {
    legacy_id: 'p_2',
    sku: 'TEC-002',
    name: 'Teclado Mecánico Compacto',
    category: 'Electrónica',
    stock: 5,
    min_stock: 6,
    price: 64.50,
    notes: 'Pasillo A - Estante 3'
  },
  {
    legacy_id: 'p_3',
    sku: 'OFI-014',
    name: 'Cuaderno Tapa Dura A4',
    category: 'Papelería',
    stock: 42,
    min_stock: 15,
    price: 6.80,
    notes: 'Caja 4'
  },
  {
    legacy_id: 'p_4',
    sku: 'ACC-009',
    name: 'Cable USB-C Carga Rápida 2m',
    category: 'Accesorios',
    stock: 0,
    min_stock: 10,
    price: 12.90,
    notes: 'Pendiente pedido proveedor'
  }
];

function runSeed(db) {
  const seedTransaction = db.transaction(() => {
    const now = Date.now();
    const workersCount = db.prepare('SELECT COUNT(*) AS count FROM workers').get().count;

    if (workersCount === 0) {
      const insertWorker = db.prepare(`
        INSERT INTO workers (employee_code, name, role, credential_hash, avatar_color, is_active, created_at, updated_at)
        VALUES (@employee_code, @name, @role, @credential_hash, @avatar_color, 1, @now, @now)
      `);

      insertWorker.run({
        employee_code: 'ADM-001',
        name: 'Administrador',
        role: 'admin',
        credential_hash: hashCredential('1234'),
        avatar_color: '#4f46e5',
        now
      });

      insertWorker.run({
        employee_code: 'VEN-001',
        name: 'Vendedor Turno 1',
        role: 'seller',
        credential_hash: hashCredential('0000'),
        avatar_color: '#16a34a',
        now
      });
    }

    const productsCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    if (productsCount === 0) {
      const firstAdmin = db.prepare("SELECT id FROM workers WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get()
        || db.prepare('SELECT id FROM workers ORDER BY id ASC LIMIT 1').get();

      const insertProduct = db.prepare(`
        INSERT INTO products (legacy_id, sku, name, category, stock, min_stock, price, notes, is_active, created_at, updated_at)
        VALUES (@legacy_id, @sku, @name, @category, @stock, @min_stock, @price, @notes, 1, @now, @now)
      `);

      const insertMovement = db.prepare(`
        INSERT INTO stock_movements (product_id, worker_id, sale_id, movement_type, previous_stock, quantity_delta, new_stock, reason, created_at)
        VALUES (?, ?, NULL, 'initial', 0, ?, ?, 'Catálogo inicial de tienda', ?)
      `);

      SAMPLE_PRODUCTS.forEach((prod, idx) => {
        const ts = now - (idx + 1) * 3600000;
        const result = insertProduct.run({ ...prod, now: ts });
        if (firstAdmin) {
          insertMovement.run(result.lastInsertRowid, firstAdmin.id, prod.stock, prod.stock, ts);
        }
      });
    }
  });

  seedTransaction();
}

module.exports = {
  SAMPLE_PRODUCTS,
  runSeed
};
