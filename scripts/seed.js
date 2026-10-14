import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { db, seedDemoData } from '../src/db.js';

seedDemoData();
const expiry = Date.now() + 48 * 60 * 60 * 1000;
const insert = db.prepare('INSERT INTO enrolment_codes(code_hash,user_id,expires_at) VALUES(?,?,?)');
const codes = [];
const tx = db.transaction(() => {
  for (const userId of ['S1', 'S2', 'L1']) {
    if (db.prepare('SELECT 1 FROM credentials WHERE user_id=?').get(userId)) continue;
    const code = randomBytes(18).toString('base64url');
    insert.run(createHash('sha256').update(code).digest('hex'), userId, expiry);
    codes.push({ userId, code });
  }
});
tx();
if (codes.length) {
  console.log('One-time classroom enrollment codes (copy privately; they are not shown again):');
  for (const item of codes) console.log(`${item.userId}: ${item.code}`);
  console.log('Each code expires in 48 hours. Do not include codes in screenshots or shared logs.');
} else console.log('All demo accounts already have passkeys; no enrollment codes created.');
db.close();
