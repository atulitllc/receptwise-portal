'use strict';
// AES-256-GCM for third-party tokens. The key is TOKEN_ENCRYPTION_KEY (any string; hashed to 32 bytes).
const crypto = require('crypto');
const config = require('./config');

function keyBytes() {
  if (!config.tokenKey) {
    const err = new Error('TOKEN_ENCRYPTION_KEY is not set, so tokens cannot be stored.');
    err.status = 409;
    err.code = 'NOT_CONFIGURED';
    err.missing = ['TOKEN_ENCRYPTION_KEY'];
    throw err;
  }
  return crypto.createHash('sha256').update(String(config.tokenKey)).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(String(payload || ''), 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Stored token is unreadable.');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
