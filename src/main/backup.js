const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getDatabasePath, closeDatabase, reopenDatabase } = require('./db/connection');

const REQUIRED_TABLES = ['workers', 'products', 'sales', 'sale_items', 'stock_movements'];

function formatBackupDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDatabaseInfo() {
  const dbPath = getDatabasePath();
  let sizeBytes = 0;
  let updatedAt = null;
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    sizeBytes = stat.size;
    updatedAt = stat.mtimeMs;
  }
  return {
    dbPath,
    sizeBytes,
    updatedAt
  };
}

async function exportDatabaseBackup(mainWindow, db, directTargetPath = null) {
  let destinationPath = directTargetPath;

  if (!destinationPath) {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar copia de seguridad SQLite (.db)',
      defaultPath: `Backup_POS_Stock_${formatBackupDate()}.db`,
      filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    destinationPath = result.filePath;
  }

  const destDir = path.dirname(destinationPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  await db.backup(destinationPath);
  return {
    canceled: false,
    filePath: destinationPath,
    sizeBytes: fs.statSync(destinationPath).size
  };
}

async function saveFileDialog(mainWindow, payload) {
  const { dialog } = require('electron');
  const defaultName = String(payload.defaultName || `export_${formatBackupDate()}`);
  const filters = Array.isArray(payload.filters) ? payload.filters : [{ name: 'Todos los archivos', extensions: ['*'] }];

  const result = await dialog.showSaveDialog(mainWindow, {
    title: payload.title || 'Guardar archivo',
    defaultPath: defaultName,
    filters
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  if (payload.isBinary) {
    const buf = Buffer.from(payload.data);
    fs.writeFileSync(result.filePath, buf);
  } else {
    fs.writeFileSync(result.filePath, String(payload.data || ''), 'utf8');
  }

  return {
    canceled: false,
    filePath: result.filePath
  };
}

function validateBackupFile(filePath) {
  const tempDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = tempDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`El archivo de respaldo está dañado (integrity_check: ${integrity}).`);
    }
    const tables = tempDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);

    for (const reqTable of REQUIRED_TABLES) {
      if (!tables.includes(reqTable)) {
        throw new Error(`El archivo seleccionado no es un respaldo válido de esta aplicación (falta la tabla "${reqTable}").`);
      }
    }
  } finally {
    tempDb.close();
  }
}

async function restoreDatabaseBackup(mainWindow, sessionManager) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Restaurar copia de seguridad SQLite (.db)',
    properties: ['openFile'],
    filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const selectedPath = result.filePaths[0];
  validateBackupFile(selectedPath);

  const activeDbPath = getDatabasePath();
  const safetyPath = `${activeDbPath}.pre-restore-${Date.now()}.bak`;

  if (fs.existsSync(activeDbPath)) {
    fs.copyFileSync(activeDbPath, safetyPath);
  }

  closeDatabase();

  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${activeDbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }

  fs.copyFileSync(selectedPath, activeDbPath);
  reopenDatabase(activeDbPath);
  sessionManager.clearSession();

  return {
    canceled: false,
    restored: true,
    requireRelogin: true,
    safetyBackupPath: safetyPath
  };
}

module.exports = {
  getDatabaseInfo,
  exportDatabaseBackup,
  saveFileDialog,
  restoreDatabaseBackup,
  validateBackupFile
};
