/**
 * Gestión de sesión activa en memoria privada del proceso principal (main).
 * El proceso renderer nunca decide su propio rol ni su worker_id.
 */

let activeSession = null;

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getSession() {
  return activeSession ? { ...activeSession } : null;
}

function setSession(worker) {
  if (!worker || !worker.id || !worker.role) {
    throw new Error('Datos de trabajador inválidos para iniciar sesión.');
  }
  activeSession = {
    workerId: worker.id,
    employeeCode: worker.employee_code,
    name: worker.name,
    role: worker.role,
    avatarColor: worker.avatar_color || '#4f46e5',
    loginAt: Date.now()
  };
  return getSession();
}

function clearSession() {
  activeSession = null;
}

function requireAuth() {
  if (!activeSession) {
    throw createHttpError(401, '401 Sesión no iniciada. Identifícate para continuar.');
  }
  return getSession();
}

function requireRole(allowedRole) {
  const session = requireAuth();
  if (session.role !== allowedRole) {
    throw createHttpError(403, `403 Permiso denegado. Esta acción requiere rol "${allowedRole}".`);
  }
  return session;
}

function requireAdmin() {
  return requireRole('admin');
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  requireAuth,
  requireRole,
  requireAdmin,
  createHttpError
};
