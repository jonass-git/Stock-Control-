const crypto = require('node:crypto');

/**
 * Gestión de sesiones en memoria privada del proceso principal (main):
 * - desktopSession: sesión activa en la ventana Electron de mostrador.
 * - mobileSessions: sesiones independientes por token Bearer para móviles en red LAN.
 */

let desktopSession = null;
const mobileSessions = new Map();

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function buildSessionData(worker) {
  return {
    workerId: worker.id,
    employeeCode: worker.employee_code,
    name: worker.name,
    role: worker.role,
    avatarColor: worker.avatar_color || '#4f46e5',
    loginAt: Date.now()
  };
}

function getSession() {
  return desktopSession ? { ...desktopSession } : null;
}

function setSession(worker) {
  if (!worker || !worker.id || !worker.role) {
    throw new Error('Datos de trabajador inválidos para iniciar sesión.');
  }
  desktopSession = buildSessionData(worker);
  return getSession();
}

function clearSession() {
  desktopSession = null;
}

function createMobileSession(worker) {
  if (!worker || !worker.id || !worker.role) {
    throw new Error('Datos de trabajador inválidos para iniciar sesión móvil.');
  }
  const token = crypto.randomBytes(24).toString('hex');
  const sessionData = buildSessionData(worker);
  mobileSessions.set(token, { ...sessionData, lastSeenAt: Date.now() });
  return { token, session: { ...sessionData } };
}

function getMobileSession(token) {
  if (!token || typeof token !== 'string') return null;
  const entry = mobileSessions.get(token);
  if (!entry) return null;
  entry.lastSeenAt = Date.now();
  return {
    workerId: entry.workerId,
    employeeCode: entry.employeeCode,
    name: entry.name,
    role: entry.role,
    avatarColor: entry.avatarColor,
    loginAt: entry.loginAt
  };
}

function deleteMobileSession(token) {
  if (token) {
    mobileSessions.delete(token);
  }
}

function clearAllSessions() {
  desktopSession = null;
  mobileSessions.clear();
}

function resolveSession(sessionContext) {
  if (sessionContext && sessionContext.isRemote) {
    return sessionContext.session ? { ...sessionContext.session } : null;
  }
  return getSession();
}

function requireAuth(sessionContext) {
  const active = resolveSession(sessionContext);
  if (!active) {
    throw createHttpError(401, '401 Sesión no iniciada. Identifícate para continuar.');
  }
  return active;
}

function requireRole(allowedRole, sessionContext) {
  const active = requireAuth(sessionContext);
  if (active.role !== allowedRole) {
    throw createHttpError(403, `403 Permiso denegado. Esta acción requiere rol "${allowedRole}".`);
  }
  return active;
}

function requireAdmin(sessionContext) {
  return requireRole('admin', sessionContext);
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  createMobileSession,
  getMobileSession,
  deleteMobileSession,
  clearAllSessions,
  resolveSession,
  requireAuth,
  requireRole,
  requireAdmin,
  createHttpError
};
