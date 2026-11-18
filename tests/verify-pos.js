const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDatabase, getDb, closeDatabase } = require('../src/main/db/connection');
const { createIpcHandlers } = require('../src/main/ipc');
const backupService = require('../src/main/backup');
const session = require('../src/main/session');
const { generateQrSvg } = require('../src/main/qr');
const { startLanServer } = require('../src/main/lan-server');

async function expectErrorStatus(fn, expectedStatus, label) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `Se esperaba error (${label}), pero tuvo éxito.`);
  if (expectedStatus !== null) {
    assert.equal(caught.statusCode, expectedStatus, `${label}: se esperaba statusCode ${expectedStatus}, recibido ${caught.statusCode} (${caught.message})`);
  }
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-verify-'));
  const tempDbPath = path.join(tempDir, 'test_pos.db');
  const backupOutPath = path.join(tempDir, 'backup_copy.db');

  try {
    console.log('1. Inicializando base de datos temporal SQLite y seed...');
    const db = initDatabase(tempDbPath);
    const handlers = createIpcHandlers({
      getDb,
      getMainWindow: () => null,
      backupService
    });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    for (const tbl of ['workers', 'products', 'sales', 'sale_items', 'stock_movements']) {
      assert.ok(tables.includes(tbl), `Falta la tabla "${tbl}" en el esquema SQLite.`);
    }

    const activeWorkers = await handlers['auth:get-workers']();
    assert.equal(activeWorkers.length, 2, 'El seed debe crear 2 trabajadores iniciales.');
    const adminProfile = activeWorkers.find((w) => w.role === 'admin');
    const sellerProfile = activeWorkers.find((w) => w.role === 'seller');
    assert.ok(adminProfile && sellerProfile, 'Deben existir un Administrador y un Vendedor iniciales.');

    // Verificar rechazo sin sesión
    await expectErrorStatus(() => handlers['products:list'](), 401, 'Acceso sin login a products:list');

    console.log('2. Verificando autenticación con scrypt y rechazo de PIN incorrecto...');
    await expectErrorStatus(
      () => handlers['auth:login']({ workerId: sellerProfile.id, credential: '9999' }),
      null,
      'PIN incorrecto vendedor'
    );
    assert.equal(session.getSession(), null, 'No debe quedar sesión activa tras login fallido.');

    const adminSession = await handlers['auth:login']({ workerId: adminProfile.id, credential: '1234' });
    assert.equal(adminSession.role, 'admin');
    assert.equal(adminSession.workerId, adminProfile.id);

    const sellerSession = await handlers['auth:login']({ workerId: sellerProfile.id, credential: '0000' });
    assert.equal(sellerSession.role, 'seller');
    assert.equal(sellerSession.workerId, sellerProfile.id);

    console.log('3. Verificando bloqueo RBAC (403) para acciones de Administrador bajo sesión Vendedor...');
    await expectErrorStatus(
      () => handlers['products:create']({ name: 'Intento no autorizado', stock: 5, price: 10 }),
      403,
      'Vendedor intentando products:create'
    );
    await expectErrorStatus(
      () => handlers['products:adjust-stock']({ id: 1, delta: 1 }),
      403,
      'Vendedor intentando products:adjust-stock'
    );
    await expectErrorStatus(
      () => handlers['workers:create']({ name: 'Fake', role: 'admin', credential: '1234' }),
      403,
      'Vendedor intentando workers:create'
    );
    await expectErrorStatus(
      () => handlers['workers:list-all'](),
      403,
      'Vendedor intentando workers:list-all'
    );
    await expectErrorStatus(
      () => handlers['backup:export-db'](backupOutPath),
      403,
      'Vendedor intentando backup:export-db'
    );

    console.log('4. Verificando venta en mostrador, descuento de stock y trazabilidad por worker_id...');
    const productsBefore = await handlers['products:list']();
    const mouse = productsBefore.find((p) => p.sku === 'TEC-001');
    const keyboard = productsBefore.find((p) => p.sku === 'TEC-002');
    assert.ok(mouse && keyboard);
    const initialMouseStock = mouse.stock; // 24
    const initialKeyboardStock = keyboard.stock; // 5

    const sale = await handlers['sales:create']({
      items: [
        { product_id: mouse.id, quantity: 3 },
        { product_id: keyboard.id, quantity: 2 }
      ],
      payment_method: 'cash',
      amount_received: 250
    });

    assert.ok(sale.ticket_number.startsWith('TCK-'), 'El ticket debe tener formato TCK-...');
    assert.equal(sale.worker_id, sellerProfile.id, 'La venta debe quedar vinculada al vendedor activo.');
    assert.equal(sale.items.length, 2);
    const expectedTotal = Math.round((mouse.price * 3 + keyboard.price * 2) * 100) / 100;
    assert.equal(sale.total_amount, expectedTotal);
    assert.equal(sale.change_given, Math.round((250 - expectedTotal) * 100) / 100);

    const productsAfterSale = await handlers['products:list']();
    const mouseAfter = productsAfterSale.find((p) => p.id === mouse.id);
    const keyboardAfter = productsAfterSale.find((p) => p.id === keyboard.id);
    assert.equal(mouseAfter.stock, initialMouseStock - 3, 'El stock del ratón debe descontar exactamente 3 uds.');
    assert.equal(keyboardAfter.stock, initialKeyboardStock - 2, 'El stock del teclado debe descontar exactamente 2 uds.');

    const shiftSales = await handlers['sales:list-shift']();
    assert.equal(shiftSales.length, 1);
    assert.equal(shiftSales[0].ticket_number, sale.ticket_number);

    const saleMovements = db
      .prepare('SELECT * FROM stock_movements WHERE sale_id = ?')
      .all(sale.id);
    assert.equal(saleMovements.length, 2);
    for (const mov of saleMovements) {
      assert.equal(mov.worker_id, sellerProfile.id);
      assert.equal(mov.movement_type, 'sale');
    }

    console.log('5. Verificando rollback atómico ante stock insuficiente...');
    const salesCountBeforeFail = db.prepare('SELECT COUNT(*) AS cnt FROM sales').get().cnt;
    const movCountBeforeFail = db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt;

    await expectErrorStatus(
      () => handlers['sales:create']({
        items: [
          { product_id: mouse.id, quantity: 1 }, // Stock válido
          { product_id: keyboard.id, quantity: 999 } // Stock insuficiente -> debe revertir TODO
        ],
        payment_method: 'card'
      }),
      null,
      'Venta excediendo stock disponible'
    );

    const productsAfterFail = await handlers['products:list']();
    assert.equal(
      productsAfterFail.find((p) => p.id === mouse.id).stock,
      mouseAfter.stock,
      'El rollback debe dejar intacto el stock de la primera línea.'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS cnt FROM sales').get().cnt, salesCountBeforeFail);
    assert.equal(db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements').get().cnt, movCountBeforeFail);

    console.log('6. Verificando operaciones exclusivas de Administrador, anulación, backup y baja lógica...');
    await handlers['auth:login']({ workerId: adminProfile.id, credential: '1234' });

    // Crear nuevo trabajador vendedor y probar su alta
    const newSeller = await handlers['workers:create']({
      name: 'Carlos Turno Tarde',
      role: 'seller',
      credential: '5678'
    });
    assert.equal(newSeller.role, 'seller');

    // Baja lógica del vendedor original con ventas históricas
    const deactivated = await handlers['workers:toggle-active']({
      id: sellerProfile.id,
      isActive: false
    });
    assert.equal(deactivated.is_active, 0);

    // Verificar que las ventas históricas y movimientos de ese vendedor siguen intactos
    const allSalesAfterDeactivate = await handlers['sales:list-all']({});
    assert.equal(allSalesAfterDeactivate.length, 1);
    assert.equal(allSalesAfterDeactivate[0].worker_id, sellerProfile.id);

    const movementsAfterDeactivate = await handlers['audit:list-movements']({});
    assert.ok(movementsAfterDeactivate.some((m) => m.worker_id === sellerProfile.id && m.sale_id === sale.id));

    // Verificar que el vendedor desactivado no puede iniciar sesión
    await expectErrorStatus(
      () => handlers['auth:login']({ workerId: sellerProfile.id, credential: '0000' }),
      null,
      'Login de trabajador desactivado'
    );
    // Re-autenticar como admin porque auth:login anterior no modificó sesión, pero aseguramos estado limpio
    await handlers['auth:login']({ workerId: adminProfile.id, credential: '1234' });

    // Anular la venta y comprobar devolución automática de stock
    const cancelledSale = await handlers['sales:cancel']({
      saleId: sale.id,
      reason: 'Prueba de anulación'
    });
    assert.equal(cancelledSale.status, 'cancelled');
    const prodsAfterCancel = await handlers['products:list']();
    assert.equal(prodsAfterCancel.find((p) => p.id === mouse.id).stock, initialMouseStock);
    assert.equal(prodsAfterCancel.find((p) => p.id === keyboard.id).stock, initialKeyboardStock);

    // Importación compatible con Control_de_Stock.html
    const importRes = await handlers['products:import-json']({
      items: [
        { id: 'p_ext_1', sku: 'EXT-100', name: 'Producto Importado HTML', category: 'Importados', stock: 12, minStock: 3, price: 19.99, notes: 'Estante Z' }
      ],
      mode: 'merge'
    });
    assert.equal(importRes.created, 1);

    // Exportar backup SQLite completo y validar su integridad
    const backupResult = await handlers['backup:export-db'](backupOutPath);
    assert.equal(backupResult.canceled, false);
    assert.ok(fs.existsSync(backupOutPath), 'El archivo .db de respaldo debe existir.');
    backupService.validateBackupFile(backupOutPath);

    console.log('7. Verificando generador QR SVG y servidor HTTP LAN / RBAC móvil...');
    const qrSvg = generateQrSvg('http://192.168.1.50:3847');
    assert.ok(qrSvg.includes('<svg') && (qrSvg.includes('<rect') || qrSvg.includes('<path')), 'QR SVG inválido.');

    const lanServer = await startLanServer({
      handlers,
      getDb,
      port: 0,
      host: '0.0.0.0'
    });

    try {
      const baseUrl = `http://127.0.0.1:${lanServer.port}`;

      const lanInfoRes = await fetch(`${baseUrl}/api/lan-info`);
      assert.equal(lanInfoRes.status, 200);
      assert.equal(lanInfoRes.headers.get('access-control-allow-origin'), '*');
      const lanInfoJson = await lanInfoRes.json();
      assert.equal(lanInfoJson.ok, true);
      assert.equal(lanInfoJson.data.port, lanServer.port);
      assert.equal(lanInfoJson.data.status, 'online');
      assert.equal(lanInfoJson.data.host, '0.0.0.0');
      assert.ok(Array.isArray(lanInfoJson.data.interfaces));
      assert.ok(typeof lanInfoJson.data.primaryUrl === 'string' && lanInfoJson.data.primaryUrl.startsWith('http://'));
      for (const iface of lanInfoJson.data.interfaces) {
        assert.ok(iface.url && iface.url.includes(iface.ip), 'Cada interfaz debe incluir su URL.');
        assert.ok(typeof iface.qrSvg === 'string' && iface.qrSvg.includes('<svg'), 'Cada interfaz debe incluir QR SVG.');
      }
      const hotspotIndex = lanInfoJson.data.interfaces.findIndex((i) => i.ip && i.ip.startsWith('192.168.137.'));
      const activeIndex = lanInfoJson.data.interfaces.findIndex((i) => i.isRouted && !i.isHotspot);
      if (hotspotIndex !== -1 && activeIndex !== -1) {
        assert.ok(activeIndex < hotspotIndex, 'La interfaz de red activa debe priorizarse antes que 192.168.137.x.');
      }

      const corsPreflight = await fetch(`${baseUrl}/api/rpc`, { method: 'OPTIONS' });
      assert.equal(corsPreflight.status, 204);
      assert.equal(corsPreflight.headers.get('access-control-allow-origin'), '*');

      const indexRes = await fetch(`${baseUrl}/`);
      assert.equal(indexRes.status, 200);
      assert.equal(indexRes.headers.get('access-control-allow-origin'), '*');
      const cssRes = await fetch(`${baseUrl}/assets/css/styles.css`);
      assert.equal(cssRes.status, 200);

      const manifestRes = await fetch(`${baseUrl}/manifest.json`);
      assert.equal(manifestRes.status, 200);
      const swRes = await fetch(`${baseUrl}/sw.js`);
      assert.equal(swRes.status, 200);
      assert.equal(swRes.headers.get('service-worker-allowed'), '/');

      // Aislamiento de sesión móvil frente a sesión desktop activa (admin)
      const unauthRpcRes = await fetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'products:list', args: [] })
      });
      assert.equal(unauthRpcRes.status, 401, 'RPC móvil sin Bearer token debe devolver 401 incluso con admin activo en desktop.');

      // Login remoto como vendedor sin alterar sesión desktop admin
      const sellerLoginRes = await fetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'auth:login',
          args: [{ workerId: newSeller.id, credential: '5678' }]
        })
      });
      assert.equal(sellerLoginRes.status, 200);
      const sellerLoginJson = await sellerLoginRes.json();
      assert.equal(sellerLoginJson.ok, true);
      assert.equal(sellerLoginJson.data.role, 'seller');
      assert.equal(typeof sellerLoginJson.data.token, 'string');
      assert.ok(sellerLoginJson.data.token.length > 10);
      const sellerToken = sellerLoginJson.data.token;

      assert.equal(session.getSession().role, 'admin', 'La sesión de escritorio debe permanecer intacta tras login móvil.');

      // Venta remota como vendedor -> descuenta stock en SQLite y registra worker_id correcto
      const mobileSaleRes = await fetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerToken}`
        },
        body: JSON.stringify({
          channel: 'sales:create',
          args: [{ items: [{ product_id: mouse.id, quantity: 1 }], payment_method: 'card' }]
        })
      });
      assert.equal(mobileSaleRes.status, 200);
      const mobileSaleJson = await mobileSaleRes.json();
      assert.equal(mobileSaleJson.ok, true);
      assert.equal(mobileSaleJson.data.worker_id, newSeller.id);

      const prodsAfterMobileSale = await handlers['products:list']();
      assert.equal(
        prodsAfterMobileSale.find((p) => p.id === mouse.id).stock,
        initialMouseStock - 1,
        'La venta móvil debe descontar stock en tiempo real sobre SQLite.'
      );

      // Bloqueo RBAC (403) en móvil para vendedor
      const forbiddenCreateRes = await fetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerToken}`
        },
        body: JSON.stringify({
          channel: 'products:create',
          args: [{ name: 'Bloqueado Móvil', stock: 1, price: 5 }]
        })
      });
      assert.equal(forbiddenCreateRes.status, 403);

      const forbiddenBackupRes = await fetch(`${baseUrl}/api/backup/db`, {
        headers: { Authorization: `Bearer ${sellerToken}` }
      });
      assert.equal(forbiddenBackupRes.status, 403);

      // Login remoto como admin -> descarga copia SQLite válida
      const adminLoginRes = await fetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'auth:login',
          args: [{ workerId: adminProfile.id, credential: '1234' }]
        })
      });
      assert.equal(adminLoginRes.status, 200);
      const adminLoginJson = await adminLoginRes.json();
      const adminToken = adminLoginJson.data.token;
      assert.ok(adminToken);

      const adminBackupRes = await fetch(`${baseUrl}/api/backup/db`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(adminBackupRes.status, 200);
      const backupBuf = Buffer.from(await adminBackupRes.arrayBuffer());
      assert.ok(backupBuf.subarray(0, 15).toString('utf8') === 'SQLite format 3', 'Backup móvil debe ser un archivo SQLite válido.');
    } finally {
      await lanServer.close();
    }

    console.log('TODAS LAS PRUEBAS DE INTEGRACIÓN PASARON CORRECTAMENTE.');
  } finally {
    session.clearAllSessions();
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('FALLO EN VERIFICACIÓN:', err);
  process.exit(1);
});
