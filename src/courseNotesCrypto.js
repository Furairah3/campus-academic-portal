import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Course note encryption requires a 32-byte key');
}

function decodePayload(payload) {
  const decoded = {};
  for (const field of ['ciphertext', 'iv', 'tag']) {
    const value = payload?.[field];
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error('Invalid encrypted course note');
    }
    decoded[field] = Buffer.from(value, 'base64');
    if (decoded[field].toString('base64') !== value) throw new Error('Invalid encrypted course note');
  }
  if (decoded.iv.length !== 12 || decoded.tag.length !== 16 || decoded.ciphertext.length === 0) {
    throw new Error('Invalid encrypted course note');
  }
  return decoded;
}

export function encryptCourseNote(key, note) {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ title: note.title, body: note.body }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptCourseNote(key, payload) {
  assertKey(key);
  const { ciphertext, iv, tag } = decodePayload(payload);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const note = JSON.parse(plaintext);
  if (typeof note.title !== 'string' || typeof note.body !== 'string') throw new Error('Invalid encrypted course note');
  return note;
}
