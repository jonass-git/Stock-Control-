const { hashCredential, verifyCredential } = require('../../security');

const AVATAR_COLORS = [
  '#4f46e5',
  '#16a34a',
  '#0284c7',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#0d9488',
  '#dc2626'
];

function validateCredentialFormat(role, credential) {
  if (typeof credential !== 'string') {
    throw new Error('Debes indicar una credencial válida.');
  }
  if (role === 'seller') {
    if (!/^\d{4,6}$/.test(credential)) {
      throw new Error('El PIN de un vendedor debe tener entre 4 y 6 dígitos numéricos.');
    }
  } else {
    if (credential.length < 4 || credential.length > 64) {
      throw new Error('La contraseña o PIN del administrador debe tener al menos 4 caracteres.');
    }
  }
}

function generateEmployeeCode(db, role) {
  const prefix = role === 'admin' ? 'ADM' : 'VEN';
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM workers').get().cnt + 1;
  for (let i = count; i < count + 500; i++) {
    const code = `${prefix}-${String(i).padStart(3, '0')}`;
    const exists = db.prepare('SELECT id FROM workers WHERE employee_code = ?').get(code);
    if (!exists) return code;
  }
  return `${prefix}-${Date.now().toString().slice(-5)}`;
}

function listActiveForLogin(db) {
  return db.prepare(`
    SELECT id, employee_code, name, role, avatar_color, last_login_at
    FROM workers
    WHERE is_active = 1
    ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name ASC
  `).all();
}

function listAll(db) {
  return db.prepare(`
    SELECT
      w.id,
      w.employee_code,
      w.name,
      w.role,
      w.avatar_color,
      w.is_active,
      w.created_at,
      w.updated_at,
      w.last_login_at,
      (SELECT COUNT(*) FROM sales s WHERE s.worker_id = w.id AND s.status = 'completed') AS sales_count,
      (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.worker_id = w.id AND s.status = 'completed') AS total_sold
    FROM workers w
    ORDER BY w.is_active DESC, CASE WHEN w.role = 'admin' THEN 0 ELSE 1 END, w.name ASC
  `).all();
}

function getPublicById(db, id) {
  return db.prepare(`
    SELECT id, employee_code, name, role, avatar_color, is_active, created_at, updated_at, last_login_at
    FROM workers
    WHERE id = ?
  `).get(id) || null;
}

function verifyWorkerLogin(db, workerId, credential) {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!worker) {
    throw new Error('Trabajador no encontrado.');
  }
  if (!worker.is_active) {
    throw new Error('Este perfil está desactivado. Contacta con el administrador.');
  }
  if (!verifyCredential(String(credential || ''), worker.credential_hash)) {
    return null;
  }

  const now = Date.now();
  db.prepare('UPDATE workers SET last_login_at = ? WHERE id = ?').run(now, worker.id);

  return {
    id: worker.id,
    employee_code: worker.employee_code,
    name: worker.name,
    role: worker.role,
    avatar_color: worker.avatar_color,
    is_active: worker.is_active,
    last_login_at: now
  };
}

function createWorker(db, payload) {
  const name = String(payload.name || '').trim();
  const role = payload.role === 'admin' ? 'admin' : 'seller';
  const credential = String(payload.credential || '');
  const employeeCode = String(payload.employee_code || '').trim().toUpperCase() || generateEmployeeCode(db, role);
  const avatarColor = String(payload.avatar_color || '').trim() || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  if (!name) {
    throw new Error('El nombre del trabajador es obligatorio.');
  }
  validateCredentialFormat(role, credential);

  const dup = db.prepare('SELECT id FROM workers WHERE employee_code = ?').get(employeeCode);
  if (dup) {
    throw new Error(`Ya existe un trabajador con el código "${employeeCode}".`);
  }

  const now = Date.now();
  const credentialHash = hashCredential(credential);

  const info = db.prepare(`
    INSERT INTO workers (employee_code, name, role, credential_hash, avatar_color, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(employeeCode, name, role, credentialHash, avatarColor, now, now);

  return getPublicById(db, info.lastInsertRowid);
}

function updateWorker(db, id, payload) {
  const existing = db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Trabajador no encontrado.');
  }

  const name = String(payload.name || '').trim();
  const role = payload.role === 'admin' ? 'admin' : 'seller';
  const employeeCode = String(payload.employee_code || existing.employee_code).trim().toUpperCase();
  const avatarColor = String(payload.avatar_color || existing.avatar_color).trim();

  if (!name) {
    throw new Error('El nombre del trabajador es obligatorio.');
  }

  if (existing.role === 'admin' && role !== 'admin' && existing.is_active === 1) {
    const otherAdmins = db.prepare(
      "SELECT COUNT(*) AS cnt FROM workers WHERE role = 'admin' AND is_active = 1 AND id != ?"
    ).get(id).cnt;
    if (otherAdmins === 0) {
      throw new Error('Debe permanecer al menos un Administrador activo en el sistema.');
    }
  }

  const dup = db.prepare('SELECT id FROM workers WHERE employee_code = ? AND id != ?').get(employeeCode, id);
  if (dup) {
    throw new Error(`El código "${employeeCode}" ya pertenece a otro trabajador.`);
  }

  db.prepare(`
    UPDATE workers
    SET employee_code = ?, name = ?, role = ?, avatar_color = ?, updated_at = ?
    WHERE id = ?
  `).run(employeeCode, name, role, avatarColor, Date.now(), id);

  return getPublicById(db, id);
}

function resetCredential(db, id, newCredential) {
  const existing = db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Trabajador no encontrado.');
  }

  const credential = String(newCredential || '');
  validateCredentialFormat(existing.role, credential);

  const hash = hashCredential(credential);
  db.prepare('UPDATE workers SET credential_hash = ?, updated_at = ? WHERE id = ?').run(hash, Date.now(), id);
  return getPublicById(db, id);
}

function toggleActive(db, id, isActive, currentAdminId) {
  const existing = db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('Trabajador no encontrado.');
  }

  const nextActive = isActive ? 1 : 0;
  if (nextActive === 0) {
    if (Number(id) === Number(currentAdminId)) {
      throw new Error('No puedes desactivar tu propio usuario mientras tienes la sesión iniciada.');
    }
    if (existing.role === 'admin') {
      const otherAdmins = db.prepare(
        "SELECT COUNT(*) AS cnt FROM workers WHERE role = 'admin' AND is_active = 1 AND id != ?"
      ).get(id).cnt;
      if (otherAdmins === 0) {
        throw new Error('No se puede desactivar el último Administrador activo.');
      }
    }
  }

  db.prepare('UPDATE workers SET is_active = ?, updated_at = ? WHERE id = ?').run(nextActive, Date.now(), id);
  return getPublicById(db, id);
}

module.exports = {
  AVATAR_COLORS,
  listActiveForLogin,
  listAll,
  getPublicById,
  verifyWorkerLogin,
  createWorker,
  updateWorker,
  resetCredential,
  toggleActive
};
