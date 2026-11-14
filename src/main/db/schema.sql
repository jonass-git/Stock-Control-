-- Esquema SQLite para Control de Stock + POS Offline

-- 1. Trabajadores (Operadores de caja y Administradores)
CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'seller')),
    credential_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#4f46e5',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
);

-- 2. Productos (Catálogo e Inventario)
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    min_stock INTEGER NOT NULL DEFAULT 5 CHECK (min_stock >= 0),
    price REAL NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    notes TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 3. Cabecera de Ventas (Tickets de Mostrador)
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT NOT NULL UNIQUE,
    worker_id INTEGER NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'other')),
    amount_received REAL DEFAULT NULL,
    change_given REAL DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT
);

-- 4. Líneas de Venta (Snapshots inmutables de precio y nombre)
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    product_sku_snapshot TEXT DEFAULT '',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    subtotal REAL NOT NULL CHECK (subtotal >= 0),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- 5. Kardex / Auditoría de Movimientos de Stock
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    sale_id INTEGER,
    movement_type TEXT NOT NULL CHECK (
        movement_type IN ('sale', 'manual_add', 'manual_sub', 'manual_set', 'initial', 'import', 'cancellation')
    ),
    previous_stock INTEGER NOT NULL,
    quantity_delta INTEGER NOT NULL,
    new_stock INTEGER NOT NULL CHECK (new_stock >= 0),
    reason TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL
);

-- Índices para búsquedas rápidas en mostrador y reportes
CREATE INDEX IF NOT EXISTS idx_products_active_cat ON products(is_active, category);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_sales_worker_date ON sales(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_product_date ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_worker_date ON stock_movements(worker_id, created_at DESC);
