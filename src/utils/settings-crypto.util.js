import crypto from 'crypto';
import config from '../config/index.js';
import ApiError from './ApiError.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKeyBuffer() {
  const hex = (config.settingsEncryptionKey || '').trim();
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }

  if (config.env === 'production') {
    throw new ApiError(
      500,
      'SETTINGS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) in production.'
    );
  }

  // Dev fallback: derive a stable 32-byte key from JWT secret
  return crypto.createHash('sha256').update(config.jwt.secret || 'dev-settings-key').digest();
}

/**
 * Encrypt a plaintext secret for at-rest storage.
 * @returns {{ ciphertext: string, iv: string, tag: string }}
 */
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') {
    throw new ApiError(400, 'Secret value is required for encryption.');
  }
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt a stored secret blob.
 * @param {{ ciphertext: string, iv: string, tag: string } | null} blob
 * @returns {string|null}
 */
export function decryptSecret(blob) {
  if (!blob?.ciphertext || !blob?.iv || !blob?.tag) return null;
  const key = getKeyBuffer();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskSecretLast4(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return null;
  if (plaintext.length <= 4) return '****';
  return `****${plaintext.slice(-4)}`;
}

export function canEncryptSecrets() {
  try {
    getKeyBuffer();
    return true;
  } catch {
    return false;
  }
}
