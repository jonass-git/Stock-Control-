const session = require('../session');

/**
 * Envuelve un manejador de negocio aplicando verificación de autenticación y rol
 * antes de acceder a SQLite, soportando tanto el contexto IPC de escritorio como
 * sesiones remotas por token Bearer desde dispositivos móviles LAN.
 * @param {'public'|'auth'|'admin'} accessLevel
 * @param {Function} handler
 */
function guardIpc(accessLevel, handler) {
  const runWithSession = async (sessionContext, ...args) => {
    let activeSession = null;
    if (accessLevel === 'auth') {
      activeSession = session.requireAuth(sessionContext);
    } else if (accessLevel === 'admin') {
      activeSession = session.requireAdmin(sessionContext);
    } else if (sessionContext && sessionContext.isRemote) {
      activeSession = sessionContext;
    }
    return handler(activeSession, ...args);
  };

  const desktopFn = (...args) => runWithSession(undefined, ...args);
  desktopFn.withSession = runWithSession;
  return desktopFn;
}

module.exports = {
  guardIpc
};
