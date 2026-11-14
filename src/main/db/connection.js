const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runSeed } = require('./seed');

let dbInstance = null;
let currentDbPath = null;

function resolveDbPath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.POS_DB_PATH) return path.resolve(process.env.POS_DB_PATH);

  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'pos_inventory.db');
    }
  } catch {
    // Ejecución fuera del ciclo de Electron app
  }
  return path.join(process.cwd(), 'pos_inventory.db');
}

function initDatabase(customPath = null) {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = resolveDbPath(customPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  runSeed(db);

  dbInstance = db;
  currentDbPath = dbPath;
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

function getDatabasePath() {
  return currentDbPath || resolveDbPath();
}

function closeDatabase() {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignorar si ya está cerrada o es memoria
    }
    dbInstance.close();
    dbInstance = null;
  }
}

function reopenDatabase(customPath = null) {
  const target = customPath || currentDbPath;
  closeDatabase();
  return initDatabase(target);
}

module.exports = {
  initDatabase,
  getDb,
  getDatabasePath,
  closeDatabase,
  reopenDatabase
};
