import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { db, initializeDatabase, seedDemoData } from '../src/db.js';

await initializeDatabase();
await seedDemoData();

const expiry = Date.now() + 48 * 60 * 60 * 1000;
const codes = await db.transaction(async tx => {
  const created = [];
  for (const userId of ['S1', 'S2', 'L1']) {
    if (await tx.get('SELECT 1 FROM credentials WHERE user_id=?', [userId])) continue;
    const code = randomBytes(18).toString('base64url');
    await tx.run('INSERT INTO enrolment_codes(code_hash,user_id,expires_at) VALUES(?,?,?)', [createHash('sha256').update(code).digest('hex'), userId, expiry]);
    created.push({ userId, code });
  }
  return created;
});

if (codes.length) {
  console.log('One-time classroom enrollment codes (copy privately; they are not shown again):');
  for (const item of codes) console.log(item.userId + ': ' + item.code);
  console.log('Each code expires in 48 hours. Do not include codes in screenshots or shared logs.');
} else {
  console.log('All demo accounts already have passkeys; no enrollment codes created.');
}

await db.close();
