import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { createHash, randomBytes } from 'node:crypto';
import { db, seedDemoData } from './db.js';
import { canReadStudent, canEditGrade, isValidGradeChange } from './policy.js';
import { runAesDemo, encryptDemoNote, decryptDemoNote, testDemoTampering } from './cryptoDemo.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

seedDemoData();
const app = express();
const port = Number(process.env.PORT || 3000);
const rpID = process.env.RP_ID || 'localhost';
const origin = process.env.ORIGIN || 'http://localhost:3000';
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const aesKey = process.env.AES_DEMO_KEY ? Buffer.from(process.env.AES_DEMO_KEY, 'base64') : randomBytes(32);
if (aesKey.length !== 32) throw new Error('AES_DEMO_KEY must be a base64 encoded 32-byte key');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

class SQLiteStore extends session.Store {
  get(sid, cb) { try { const row = db.prepare('SELECT data,expires_at FROM sessions WHERE sid=?').get(sid); if (!row || row.expires_at < Date.now()) return cb(null, null); cb(null, JSON.parse(row.data)); } catch (e) { cb(e); } }
  set(sid, value, cb = () => {}) { try { const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000; db.prepare('INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').run(sid, JSON.stringify(value), expires); cb(); } catch (e) { cb(e); } }
  destroy(sid, cb = () => {}) { try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(); } catch (e) { cb(e); } }
  touch(sid, value, cb = () => {}) { this.set(sid, value, cb); }
}
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
app.use(session({
  name: 'campus.sid', secret: sessionSecret,
  store: new SQLiteStore(), resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
}));

function csrf(req, res, next) {
  if (req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin rejected' });
  if (req.get('x-csrf-token') !== req.session.csrfToken) return res.status(403).json({ error: 'Request verification failed' });
  next();
}
function authenticated(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in required' });
  const user = db.prepare('SELECT id,display_name AS displayName,role FROM users WHERE id=?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  req.user = user; next();
}
function lecturer(req, res, next) { if (req.user.role !== 'lecturer') return res.status(403).json({ error: 'Access denied' }); next(); }
function saveChallenge(req, kind, userId, challenge, codeHash = null) {
  const now = Date.now();
  db.prepare('DELETE FROM challenges WHERE expires_at < ? OR consumed_at IS NOT NULL').run(now);
  db.prepare('DELETE FROM challenges WHERE sid=? AND kind=? AND consumed_at IS NULL').run(req.sessionID, kind);
  db.prepare('INSERT INTO challenges(challenge,sid,kind,user_id,code_hash,expires_at) VALUES(?,?,?,?,?,?)').run(challenge, req.sessionID, kind, userId, codeHash, now + 5 * 60 * 1000);
}
function consumeChallenge(req, kind) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM challenges WHERE sid=? AND kind=? AND expires_at>=? AND consumed_at IS NULL').get(req.sessionID, kind, Date.now());
    if (!row) return null;
    const result = db.prepare('UPDATE challenges SET consumed_at=? WHERE challenge=? AND sid=? AND consumed_at IS NULL AND expires_at>=?').run(Date.now(), row.challenge, req.sessionID, Date.now());
    return result.changes === 1 ? row : null;
  })();
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/csrf', (req, res) => { req.session.csrfToken ||= randomBytes(24).toString('base64url'); res.json({ csrfToken: req.session.csrfToken }); });
app.get('/api/me', authenticated, (req, res) => res.json({ user: req.user }));
app.post('/api/logout', authenticated, csrf, (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('campus.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }); res.json({ ok: true }); }));

app.post('/api/enrol/options', csrf, async (req, res, next) => {
  try {
    const userId = String(req.body.userId || '').trim().toUpperCase();
    const code = String(req.body.code || '').trim();
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const hash = createHash('sha256').update(code).digest('hex');
    const row = db.prepare('SELECT * FROM enrolment_codes WHERE code_hash=? AND user_id=?').get(hash, userId);
    if (!user || !row || row.used_at || row.expires_at < Date.now() || code.length < 12) return res.status(400).json({ error: 'Invalid or expired enrolment details' });
    const existing = db.prepare('SELECT id,transports FROM credentials WHERE user_id=?').all(userId).map(c => ({ id: c.id, transports: JSON.parse(c.transports) }));
    const options = await generateRegistrationOptions({ rpName: process.env.RP_NAME || 'Campus Academic Portal', rpID, userID: new TextEncoder().encode(user.id), userName: user.id, userDisplayName: user.display_name, attestationType: 'none', excludeCredentials: existing, authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } });
    saveChallenge(req, 'registration', userId, options.challenge, hash); res.json(options);
  } catch (err) { next(err); }
});
app.post('/api/enrol/verify', csrf, async (req, res, next) => {
  try {
    const row = consumeChallenge(req, 'registration');
    if (!row) return res.status(400).json({ error: 'Enrolment expired; start again' });
    const result = await verifyRegistrationResponse({ response: req.body, expectedChallenge: row.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    if (!result.verified || !result.registrationInfo) return res.status(400).json({ error: 'Passkey verification failed' });
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const persist = db.transaction(() => {
      const validCode = db.prepare('SELECT 1 FROM enrolment_codes WHERE code_hash=? AND user_id=? AND used_at IS NULL AND expires_at>=?').get(row.code_hash, row.user_id, Date.now());
      if (!validCode) return false;
      db.prepare('INSERT INTO credentials(id,user_id,public_key,counter,transports,device_type,backed_up) VALUES(?,?,?,?,?,?,?)').run(credential.id, row.user_id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0);
      const used = db.prepare('UPDATE enrolment_codes SET used_at=? WHERE code_hash=? AND user_id=? AND used_at IS NULL AND expires_at>=?').run(Date.now(), row.code_hash, row.user_id, Date.now());
      return used.changes === 1;
    });
    if (!persist()) return res.status(400).json({ error: 'Invalid or expired enrolment details' });
    res.json({ verified: true });
  } catch (err) { next(err); }
});
app.post('/api/login/options', csrf, async (req, res, next) => {
  try {
    const userId = String(req.body.userId || '').trim().toUpperCase();
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
    if (!user) return res.status(400).json({ error: 'No passkey available for that account' });
    const credentials = db.prepare('SELECT id,transports FROM credentials WHERE user_id=?').all(userId);
    if (!credentials.length) return res.status(400).json({ error: 'No passkey available for that account' });
    const options = await generateAuthenticationOptions({ rpID, allowCredentials: credentials.map(c => ({ id: c.id, transports: JSON.parse(c.transports) })), userVerification: 'preferred' });
    saveChallenge(req, 'authentication', userId, options.challenge); res.json(options);
  } catch (err) { next(err); }
});
app.post('/api/login/verify', csrf, async (req, res, next) => {
  try {
    const challenge = consumeChallenge(req, 'authentication');
    if (!challenge) return res.status(400).json({ error: 'Sign-in expired; start again' });
    const credential = db.prepare('SELECT * FROM credentials WHERE id=? AND user_id=?').get(req.body.id, challenge.user_id);
    if (!credential) return res.status(401).json({ error: 'Passkey sign-in failed' });
    const verification = await verifyAuthenticationResponse({ response: req.body, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter, transports: JSON.parse(credential.transports) }, requireUserVerification: false });
    if (!verification.verified) return res.status(401).json({ error: 'Passkey sign-in failed' });
    db.prepare('UPDATE credentials SET counter=? WHERE id=?').run(verification.authenticationInfo.newCounter, credential.id);
    const userId = challenge.user_id;
    req.session.regenerate(err => { if (err) return next(err); req.session.userId = userId; req.session.csrfToken = randomBytes(24).toString('base64url'); req.session.save(saveErr => { if (saveErr) return next(saveErr); res.json({ ok: true }); }); });
  } catch (_err) { res.status(401).json({ error: 'Passkey sign-in failed' }); }
});

app.get('/api/records/me', authenticated, (req, res) => {
  const profile = db.prepare('SELECT id,display_name AS name,role FROM users WHERE id=?').get(req.user.id);
  const grades = db.prepare('SELECT c.title AS course, g.assessment, g.grade FROM grades g JOIN courses c ON c.id=g.course_id WHERE g.student_id=? ORDER BY c.title,g.assessment').all(req.user.id);
  const courses = db.prepare('SELECT c.title FROM enrolments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? ORDER BY c.title').all(req.user.id).map(course => course.title);
  res.json({ profile, grades, courses });
});
app.get('/api/records/students/:id', authenticated, (req, res) => {
  const studentId = String(req.params.id).toUpperCase();
  const student = db.prepare("SELECT id,display_name AS name,role FROM users WHERE id=? AND role='student'").get(studentId);
  if (!student) return res.status(404).json({ error: 'Record not found' });
  const allowed = req.user.role === 'student' && req.user.id === studentId ? canReadStudent({ role: req.user.role, userId: req.user.id, targetId: studentId }) : db.prepare('SELECT 1 FROM enrolments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? AND c.lecturer_id=?').get(studentId, req.user.id);
  if (!canReadStudent({ role: req.user.role, userId: req.user.id, targetId: studentId, assignedToLecturer: Boolean(allowed) })) return res.status(404).json({ error: 'Record not found' });
  const grades = db.prepare('SELECT c.title AS course,g.assessment,g.grade FROM grades g JOIN courses c ON c.id=g.course_id WHERE g.student_id=?').all(studentId);
  res.json({ profile: student, grades });
});
app.get('/api/lecturer/roster', authenticated, lecturer, (req, res) => {
  const course = db.prepare('SELECT id,title FROM courses WHERE lecturer_id=?').get(req.user.id);
  if (!course) return res.json({ course: null, students: [] });
  const students = db.prepare('SELECT u.id,u.display_name AS name,g.assessment,g.grade FROM enrolments e JOIN users u ON u.id=e.student_id LEFT JOIN grades g ON g.student_id=e.student_id AND g.course_id=e.course_id WHERE e.course_id=? ORDER BY u.id,g.assessment').all(course.id);
  res.json({ course, students });
});
app.post('/api/crypto/demo/encrypt', authenticated, csrf, (_req, res) => res.json(encryptDemoNote(aesKey)));
app.post('/api/crypto/demo/decrypt', authenticated, csrf, (req, res) => {
  try { res.json({ recovered: decryptDemoNote(aesKey, req.body) }); }
  catch { res.status(400).json({ error: 'The note could not be decrypted.' }); }
});
app.post('/api/crypto/demo/tamper', authenticated, csrf, (req, res) => {
  try { res.json({ tamperDetected: testDemoTampering(aesKey, req.body) }); }
  catch { res.status(400).json({ error: 'The note could not be checked.' }); }
});
app.get('/api/crypto/demo', authenticated, (_req, res) => res.json(runAesDemo(aesKey)));
app.put('/api/grades', authenticated, lecturer, csrf, (req, res) => {
  const { studentId, courseId, assessment, grade } = req.body;
  if (!isValidGradeChange({ studentId, courseId, assessment, grade })) return res.status(400).json({ error: 'Invalid grade details' });
  const permitted = db.prepare('SELECT 1 FROM courses c JOIN enrolments e ON e.course_id=c.id WHERE c.id=? AND c.lecturer_id=? AND e.student_id=?').get(courseId, req.user.id, studentId);
  if (!canEditGrade({ role: req.user.role, assignedToLecturer: Boolean(permitted), studentEnrolled: Boolean(permitted) })) return res.status(403).json({ error: 'Access denied' });
  db.prepare('INSERT INTO grades(course_id,student_id,assessment,grade) VALUES(?,?,?,?) ON CONFLICT(course_id,student_id,assessment) DO UPDATE SET grade=excluded.grade').run(courseId, studentId, assessment.trim(), grade);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

app.use(express.static(resolve(root, 'dist')));
app.use((err, _req, res, _next) => { console.error('Request failed:', err?.message || 'unknown error'); res.status(500).json({ error: 'The request could not be completed' }); });
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
