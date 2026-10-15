import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { db, initializeDatabase, seedDemoData } from '../src/db.js';

await initializeDatabase();
await seedDemoData();

const inviteCode = randomBytes(24).toString('base64url');
const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
const tokenHash = createHash('sha256').update(inviteCode).digest('hex');

await db.run('INSERT INTO lecturer_invites(token_hash,expires_at) VALUES(?,?)', [tokenHash, expiresAt]);
console.log('Lecturer invitation (copy privately; shown once):');
console.log(inviteCode);
console.log('Expires in 48 hours and can be used once.');
await db.close();
