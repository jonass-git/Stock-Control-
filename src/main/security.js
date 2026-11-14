const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Genera un hash criptográfico local usando scrypt con salt aleatorio.
 * Formato devuelto: "<salt_hex>:<hash_hex>"
 */
function hashCredential(plainText) {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    throw new Error('La credencial no puede estar vacía.');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = crypto.scryptSync(plainText, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Verifica una credencial en texto plano frente al hash almacenado en SQLite
 * utilizando comparación en tiempo constante (timingSafeEqual).
 */
function verifyCredential(plainText, storedHash) {
  if (typeof plainText !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }

  try {
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const derivedBuf = crypto.scryptSync(plainText, salt, SCRYPT_KEYLEN);
    if (expectedBuf.length !== derivedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, derivedBuf);
  } catch {
    return false;
  }
}

module.exports = {
  hashCredential,
  verifyCredential
};
