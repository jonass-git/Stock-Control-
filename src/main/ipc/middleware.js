const session = require('../session');

/**
 * Envuelve un manejador de negocio aplicando verificación de autenticación y rol
 * antes de acceder a SQLite.
 * @param {'public'|'auth'|'admin'} accessLevel
 * @param {Function} handler
 */
function guardIpc(accessLevel, handler) {
  return async (...args) => {
    let activeSession = null;
    if (accessLevel === 'auth') {
      activeSession = session.requireAuth();
    } else if (accessLevel === 'admin') {
      activeSession = session.requireAdmin();
    }
    return handler(activeSession, ...args);
  };
}

module.exports = {
  guardIpc
};
