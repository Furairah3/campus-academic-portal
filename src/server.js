import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { createHash, randomBytes } from 'node:crypto';
import { db, initializeDatabase, seedDemoData } from './db.js';
import { canReadStudent, canEditGrade, isValidGradeChange } from './policy.js';
import { runAesDemo, encryptDemoNote, decryptDemoNote, testDemoTampering } from './cryptoDemo.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

await initializeDatabase();
await seedDemoData();

const app = express();
const port = Number(process.env.PORT || 3000);
const rpID = process.env.RP_ID || 'localhost';
const origin = process.env.ORIGIN || 'http://localhost:3000';
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const aesKey = process.env.AES_DEMO_KEY ? Buffer.from(process.env.AES_DEMO_KEY, 'base64') : randomBytes(32);
if (aesKey.length !== 32) throw new Error('AES_DEMO_KEY must be a base64 encoded 32-byte key');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

class DatabaseSessionStore extends session.Store {
  get(sid, callback) {
    db.get('SELECT data,expires_at FROM sessions WHERE sid=?', [sid])
      .then(row => {
        if (!row || Number(row.expires_at) < Date.now()) return callback(null, null);
        callback(null, JSON.parse(row.data));
      })
      .catch(callback);
  }
  set(sid, value, callback = () => {}) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
    db.run('INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at', [sid, JSON.stringify(value), expires])
      .then(() => callback())
      .catch(callback);
  }
  destroy(sid, callback = () => {}) {
    db.run('DELETE FROM sessions WHERE sid=?', [sid]).then(() => callback()).catch(callback);
  }
  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }
}

if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  if (!process.env.AES_DEMO_KEY) throw new Error('AES_DEMO_KEY is required in production');
  if (!process.env.RP_ID || !process.env.ORIGIN) throw new Error('RP_ID and ORIGIN are required in production');
}

app.use(session({
  name: 'campus.sid',
  secret: sessionSecret,
  store: new DatabaseSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
}));

function csrf(req, res, next) {
  if (req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin rejected' });
  if (req.get('x-csrf-token') !== req.session.csrfToken) return res.status(403).json({ error: 'Request verification failed' });
  next();
}

async function authenticated(req, res, next) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Sign in required' });
    const user = await db.get('SELECT id,display_name AS displayName,role FROM users WHERE id=?', [req.session.userId]);
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function lecturer(req, res, next) {
  if (req.user.role !== 'lecturer') return res.status(403).json({ error: 'Access denied' });
  next();
}

async function saveChallenge(req, kind, userId, challenge, codeHash = null) {
  const now = Date.now();
  await db.run('DELETE FROM challenges WHERE expires_at < ? OR consumed_at IS NOT NULL', [now]);
  await db.run('DELETE FROM challenges WHERE sid=? AND kind=? AND consumed_at IS NULL', [req.sessionID, kind]);
  await db.run('INSERT INTO challenges(challenge,sid,kind,user_id,code_hash,expires_at) VALUES(?,?,?,?,?,?)', [challenge, req.sessionID, kind, userId, codeHash, now + 5 * 60 * 1000]);
}

async function consumeChallenge(req, kind) {
  return db.transaction(async tx => {
    const now = Date.now();
    const row = await tx.get('SELECT * FROM challenges WHERE sid=? AND kind=? AND expires_at>=? AND consumed_at IS NULL', [req.sessionID, kind, now]);
    if (!row) return null;
    const result = await tx.run('UPDATE challenges SET consumed_at=? WHERE challenge=? AND sid=? AND consumed_at IS NULL AND expires_at>=?', [now, row.challenge, req.sessionID, now]);
    return result.changes === 1 ? row : null;
  });
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/csrf', (req, res) => {
  req.session.csrfToken ||= randomBytes(24).toString('base64url');
  res.json({ csrfToken: req.session.csrfToken });
});
app.get('/api/me', authenticated, (req, res) => res.json({ user: req.user }));
app.post('/api/logout', authenticated, csrf, (req, res, next) => req.session.destroy(error => {
  if (error) return next(error);
  res.clearCookie('campus.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
}));

app.post('/api/enrol/options', csrf, async (req, res, next) => {
  try {
    if (req.body.createDemoAccount) {
      if (req.session.demoAccountId) return res.status(409).json({ error: 'A demo account has already been created in this browser session' });
      const displayName = String(req.body.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (displayName.length < 2) return res.status(400).json({ error: 'Enter a name with at least 2 characters' });
      const created = await db.transaction(async tx => {
        const count = await tx.get("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'D-%'");
        if (Number(count?.count || 0) >= 100) return null;
        let userId;
        do {
          userId = 'D-' + randomBytes(4).toString('hex').toUpperCase();
        } while (await tx.get('SELECT 1 FROM users WHERE id=?', [userId]));
        const code = randomBytes(18).toString('base64url');
        const codeHash = createHash('sha256').update(code).digest('hex');
        await tx.run('INSERT INTO users(id,display_name,role) VALUES(?,?,?)', [userId, displayName, 'student']);
        await tx.run('INSERT INTO enrolments(course_id,student_id) VALUES(?,?)', ['IS451', userId]);
        await tx.run('INSERT INTO enrolment_codes(code_hash,user_id,expires_at) VALUES(?,?,?)', [codeHash, userId, Date.now() + 48 * 60 * 60 * 1000]);
        return { userId, code };
      });
      if (!created) return res.status(429).json({ error: 'The classroom demo has reached its account limit' });
      req.session.demoAccountId = created.userId;
      return res.status(201).json({ demoAccount: created });
    }
    const userId = String(req.body.userId || '').trim().toUpperCase();
    const code = String(req.body.code || '').trim();
    const user = await db.get('SELECT * FROM users WHERE id=?', [userId]);
    const hash = createHash('sha256').update(code).digest('hex');
    const row = await db.get('SELECT * FROM enrolment_codes WHERE code_hash=? AND user_id=?', [hash, userId]);
    if (!user || !row || row.used_at || Number(row.expires_at) < Date.now() || code.length < 12) {
      return res.status(400).json({ error: 'Invalid or expired enrolment details' });
    }
    const existing = (await db.all('SELECT id,transports FROM credentials WHERE user_id=?', [userId]))
      .map(credential => ({ id: credential.id, transports: JSON.parse(credential.transports) }));
    const options = await generateRegistrationOptions({
      rpName: process.env.RP_NAME || 'Campus Academic Portal',
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.id,
      userDisplayName: user.display_name,
      attestationType: 'none',
      excludeCredentials: existing,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await saveChallenge(req, 'registration', userId, options.challenge, hash);
    res.json(options);
  } catch (error) {
    next(error);
  }
});

app.post('/api/enrol/verify', csrf, async (req, res, next) => {
  try {
    const row = await consumeChallenge(req, 'registration');
    if (!row) return res.status(400).json({ error: 'Enrolment expired; start again' });
    const result = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: row.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!result.verified || !result.registrationInfo) return res.status(400).json({ error: 'Passkey verification failed' });
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const persisted = await db.transaction(async tx => {
      const validCode = await tx.get('SELECT 1 FROM enrolment_codes WHERE code_hash=? AND user_id=? AND used_at IS NULL AND expires_at>=?', [row.code_hash, row.user_id, Date.now()]);
      if (!validCode) return false;
      await tx.run(
        'INSERT INTO credentials(id,user_id,public_key,counter,transports,device_type,backed_up) VALUES(?,?,?,?,?,?,?)',
        [credential.id, row.user_id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0],
      );
      const used = await tx.run('UPDATE enrolment_codes SET used_at=? WHERE code_hash=? AND user_id=? AND used_at IS NULL AND expires_at>=?', [Date.now(), row.code_hash, row.user_id, Date.now()]);
      return used.changes === 1;
    });
    if (!persisted) return res.status(400).json({ error: 'Invalid or expired enrolment details' });
    res.json({ verified: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login/options', csrf, async (req, res, next) => {
  try {
    const userId = String(req.body.userId || '').trim().toUpperCase();
    const user = await db.get('SELECT id FROM users WHERE id=?', [userId]);
    if (!user) return res.status(400).json({ error: 'No passkey available for that account' });
    const credentials = await db.all('SELECT id,transports FROM credentials WHERE user_id=?', [userId]);
    if (!credentials.length) return res.status(400).json({ error: 'No passkey available for that account' });
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map(credential => ({ id: credential.id, transports: JSON.parse(credential.transports) })),
      userVerification: 'preferred',
    });
    await saveChallenge(req, 'authentication', userId, options.challenge);
    res.json(options);
  } catch (error) {
    next(error);
  }
});

app.post('/api/login/verify', csrf, async (req, res, next) => {
  try {
    const challenge = await consumeChallenge(req, 'authentication');
    if (!challenge) return res.status(400).json({ error: 'Sign-in expired; start again' });
    const credential = await db.get('SELECT * FROM credentials WHERE id=? AND user_id=?', [req.body.id, challenge.user_id]);
    if (!credential) return res.status(401).json({ error: 'Passkey sign-in failed' });
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter),
        transports: JSON.parse(credential.transports),
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return res.status(401).json({ error: 'Passkey sign-in failed' });
    await db.run('UPDATE credentials SET counter=? WHERE id=?', [verification.authenticationInfo.newCounter, credential.id]);
    const userId = challenge.user_id;
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = userId;
      req.session.csrfToken = randomBytes(24).toString('base64url');
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.json({ ok: true });
      });
    });
  } catch (_error) {
    res.status(401).json({ error: 'Passkey sign-in failed' });
  }
});

app.get('/api/records/me', authenticated, async (req, res, next) => {
  try {
    const profile = await db.get('SELECT id,display_name AS name,role FROM users WHERE id=?', [req.user.id]);
    const grades = await db.all('SELECT c.title AS course, g.assessment, g.grade FROM grades g JOIN courses c ON c.id=g.course_id WHERE g.student_id=? ORDER BY c.title,g.assessment', [req.user.id]);
    const courses = (await db.all('SELECT c.title FROM enrolments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? ORDER BY c.title', [req.user.id]))
      .map(course => course.title);
    res.json({ profile, grades, courses });
  } catch (error) {
    next(error);
  }
});

app.get('/api/records/students/:id', authenticated, async (req, res, next) => {
  try {
    const studentId = String(req.params.id).toUpperCase();
    const student = await db.get("SELECT id,display_name AS name,role FROM users WHERE id=? AND role='student'", [studentId]);
    if (!student) return res.status(404).json({ error: 'Record not found' });
    const allowed = req.user.role === 'student' && req.user.id === studentId
      ? canReadStudent({ role: req.user.role, userId: req.user.id, targetId: studentId })
      : await db.get('SELECT 1 FROM enrolments e JOIN courses c ON e.course_id=c.id WHERE e.student_id=? AND c.lecturer_id=?', [studentId, req.user.id]);
    if (!canReadStudent({ role: req.user.role, userId: req.user.id, targetId: studentId, assignedToLecturer: Boolean(allowed) })) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const grades = await db.all('SELECT c.title AS course,g.assessment,g.grade FROM grades g JOIN courses c ON c.id=g.course_id WHERE g.student_id=?', [studentId]);
    res.json({ profile: student, grades });
  } catch (error) {
    next(error);
  }
});

app.get('/api/lecturer/roster', authenticated, lecturer, async (req, res, next) => {
  try {
    const course = await db.get('SELECT id,title FROM courses WHERE lecturer_id=?', [req.user.id]);
    if (!course) return res.json({ course: null, students: [] });
    const students = await db.all('SELECT u.id,u.display_name AS name,g.assessment,g.grade FROM enrolments e JOIN users u ON u.id=e.student_id LEFT JOIN grades g ON g.student_id=e.student_id AND g.course_id=e.course_id WHERE e.course_id=? ORDER BY u.id,g.assessment', [course.id]);
    res.json({ course, students });
  } catch (error) {
    next(error);
  }
});

app.post('/api/crypto/demo/encrypt', authenticated, csrf, (_req, res) => res.json(encryptDemoNote(aesKey)));
app.post('/api/crypto/demo/decrypt', authenticated, csrf, (req, res) => {
  try {
    res.json({ recovered: decryptDemoNote(aesKey, req.body) });
  } catch {
    res.status(400).json({ error: 'The note could not be decrypted.' });
  }
});
app.post('/api/crypto/demo/tamper', authenticated, csrf, (req, res) => {
  try {
    res.json({ tamperDetected: testDemoTampering(aesKey, req.body) });
  } catch {
    res.status(400).json({ error: 'The note could not be checked.' });
  }
});
app.get('/api/crypto/demo', authenticated, (_req, res) => res.json(runAesDemo(aesKey)));

app.put('/api/grades', authenticated, lecturer, csrf, async (req, res, next) => {
  try {
    const { studentId, courseId, assessment, grade } = req.body;
    if (!isValidGradeChange({ studentId, courseId, assessment, grade })) return res.status(400).json({ error: 'Invalid grade details' });
    const permitted = await db.get(
      'SELECT 1 FROM courses c JOIN enrolments e ON e.course_id=c.id WHERE c.id=? AND c.lecturer_id=? AND e.student_id=?',
      [courseId, req.user.id, studentId],
    );
    if (!canEditGrade({ role: req.user.role, assignedToLecturer: Boolean(permitted), studentEnrolled: Boolean(permitted) })) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await db.run(
      'INSERT INTO grades(course_id,student_id,assessment,grade) VALUES(?,?,?,?) ON CONFLICT(course_id,student_id,assessment) DO UPDATE SET grade=excluded.grade',
      [courseId, studentId, assessment.trim(), grade],
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
if (!process.env.VERCEL) app.use(express.static(resolve(root, 'dist')));
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error?.message || 'unknown error');
  res.status(500).json({ error: 'The request could not be completed' });
});

export default app;
if (!process.env.VERCEL) app.listen(port, () => console.log('API listening on http://localhost:' + port));
