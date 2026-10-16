import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const DEMO_NOTE = 'Student consultation note \u2013 demonstration data only';

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key');
}

function decodePayload(payload) {
  const fields = ['ciphertext', 'iv', 'tag'];
  if (!payload || fields.some(field => typeof payload[field] !== 'string')) throw new Error('Invalid encrypted note');
  const decoded = {};
  for (const field of fields) {
    const value = payload[field];
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid encrypted note');
    decoded[field] = Buffer.from(value, 'base64');
    if (decoded[field].toString('base64') !== value) throw new Error('Invalid encrypted note');
  }
  if (decoded.iv.length !== 12 || decoded.tag.length !== 16 || decoded.ciphertext.length === 0) throw new Error('Invalid encrypted note');
  return decoded;
}

export function encryptDemoNote(key, note = DEMO_NOTE) {
  assertKey(key);
  if (typeof note !== 'string' || note.length < 1 || note.length > 10150) throw new Error('Enter a note of up to 10,150 characters');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(note, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptDemoNote(key, payload) {
  assertKey(key);
  const { ciphertext, iv, tag } = decodePayload(payload);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function testDemoTampering(key, payload) {
  assertKey(key);
  const decoded = decodePayload(payload);
  decoded.ciphertext[0] ^= 1;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, decoded.iv);
    decipher.setAuthTag(decoded.tag);
    decipher.update(decoded.ciphertext);
    decipher.final();
    return false;
  } catch {
    return true;
  }
}

export function runAesDemo(key) {
  const payload = encryptDemoNote(key);
  return { note: DEMO_NOTE, ...payload, recovered: decryptDemoNote(key, payload), tamperDetected: testDemoTampering(key, payload) };
}
