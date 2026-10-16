import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { createClient } from '@libsql/client';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('API rejects unauthenticated access and invalid cross-origin enrollment', async t => {
  const port = await freePort();
  const dbPath = join(tmpdir(), `is451-api-${randomBytes(8).toString('hex')}.db`);
  const base = `http://localhost:${port}`;
  const lecturerInviteCode = randomBytes(24).toString('base64url');
  const sessionSecret = randomBytes(32).toString('hex');
  const serverEnv = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, ORIGIN: base, LECTURER_INVITE_CODE: lecturerInviteCode, SESSION_SECRET: sessionSecret };
  let child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: 'ignore',
  });
  let restartedChild;
  let testDb;
  t.after(async () => {
    child.kill();
    restartedChild?.kill();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1500)]);
    if (restartedChild) await Promise.race([new Promise(resolve => restartedChild.once('exit', resolve)), pause(1500)]);
    await testDb?.close();
    for (const suffix of ['', '-shm', '-wal']) {
      for (let attempt = 0; ; attempt++) {
        try { rmSync(dbPath + suffix, { force: true }); break; }
        catch (error) {
          if (error.code !== 'EPERM' || attempt >= 20) throw error;
          await pause(100);
        }
      }
    }
  });

  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`API process exited with ${child.exitCode}`);
    try { health = await fetch(`${base}/api/health`); if (health.ok) break; } catch { /* server is starting */ }
    await pause(100);
  }
  assert.equal(health?.status, 200, 'API starts and serves its health check');
  assert.deepEqual(await health.json(), { status: 'ok' });

  testDb = createClient({ url: pathToFileURL(dbPath).href });
  const seededRosters = await testDb.execute("SELECT course_id,COUNT(*) AS total FROM enrolments WHERE student_id IN ('S3','S4','S5','S6') GROUP BY course_id ORDER BY course_id");
  assert.deepEqual(seededRosters.rows.map(row => [row.course_id, Number(row.total)]), [['CS230', 2], ['CS480', 2], ['FIN101', 2], ['IS451', 2]], 'fictional sample students are enrolled across every seeded course');
  const studentSessionId = randomBytes(18).toString('base64url');
  const studentCsrf = randomBytes(24).toString('base64url');
  const signedStudentSession = `s:${studentSessionId}.${createHmac('sha256', sessionSecret).update(studentSessionId).digest('base64').replace(/=+$/, '')}`;
  const sessionData = JSON.stringify({ cookie: { originalMaxAge: 28800000, httpOnly: true, path: '/', sameSite: 'lax' }, userId: 'S1', csrfToken: studentCsrf });
  await testDb.execute({ sql: 'INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?)', args: [studentSessionId, sessionData, Date.now() + 3600000] });
  const studentHeaders = { Origin: base, Cookie: `campus.sid=${signedStudentSession}`, 'X-CSRF-Token': studentCsrf, 'Content-Type': 'application/json' };
  const notesBefore = await fetch(`${base}/api/course-notes`, { headers: { Cookie: `campus.sid=${signedStudentSession}` } });
  assert.equal(notesBefore.status, 200, 'authenticated students can list notes for their enrolled courses');
  assert.deepEqual((await notesBefore.json()).notes, []);
  const createdNoteResponse = await fetch(`${base}/api/course-notes`, {
    method: 'POST', headers: studentHeaders,
    body: JSON.stringify({ courseId: 'IS451', title: 'Week one', body: 'Review the CIA triad.' }),
  });
  assert.equal(createdNoteResponse.status, 201, 'students can create a note for an enrolled course');
  const createdNote = await createdNoteResponse.json();
  const notesFromOtherCourse = await fetch(`${base}/api/course-notes`, { method: 'POST', headers: studentHeaders, body: JSON.stringify({ courseId: 'CS230', title: 'Not enrolled', body: 'Should fail.' }) });
  assert.equal(notesFromOtherCourse.status, 403, 'students cannot add notes to courses they are not enrolled in');
  const updateNoteResponse = await fetch(`${base}/api/course-notes/${createdNote.id}`, { method: 'PUT', headers: studentHeaders, body: JSON.stringify({ title: 'Week one revised', body: 'Review confidentiality, integrity, and availability.' }) });
  assert.equal(updateNoteResponse.status, 200, 'students can edit their own notes');
  const otherSessionId = randomBytes(18).toString('base64url');
  const otherSignedSession = `s:${otherSessionId}.${createHmac('sha256', sessionSecret).update(otherSessionId).digest('base64').replace(/=+$/, '')}`;
  await testDb.execute({ sql: 'INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?)', args: [otherSessionId, JSON.stringify({ cookie: { originalMaxAge: 28800000, httpOnly: true, path: '/', sameSite: 'lax' }, userId: 'S2', csrfToken: studentCsrf }), Date.now() + 3600000] });
  await testDb.close();
  testDb = null;
  const otherStudentEdit = await fetch(`${base}/api/course-notes/${createdNote.id}`, { method: 'PUT', headers: { ...studentHeaders, Cookie: `campus.sid=${otherSignedSession}` }, body: JSON.stringify({ title: 'Unauthorized edit', body: 'Must be denied.' }) });
  assert.equal(otherStudentEdit.status, 404, 'students cannot edit another student’s notes');
  const deleteNoteResponse = await fetch(`${base}/api/course-notes/${createdNote.id}`, { method: 'DELETE', headers: studentHeaders });
  assert.equal(deleteNoteResponse.status, 200, 'students can delete their own notes');

  assert.equal((await fetch(`${base}/api/records/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/records/students/S2`)).status, 401);
  assert.equal((await fetch(`${base}/api/grades`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/logout`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/api/crypto/demo/encrypt`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/api/crypto/demo`)).status, 401);

  const csrfResponse = await fetch(`${base}/api/csrf`);
  const csrf = (await csrfResponse.json()).csrfToken;
  const cookie = csrfResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'session cookie is issued for CSRF state');
  const demoAccountResponse = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ createDemoAccount: true, displayName: 'Guest Tester', courseIds: ['CS230'] }),
  });
  assert.equal(demoAccountResponse.status, 201);
  const { demoAccount } = await demoAccountResponse.json();
  assert.match(demoAccount.userId, /^D-[A-F0-9]{8}$/);
  assert.ok(demoAccount.code.length >= 12);
  const demoOptions = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: demoAccount.userId, code: demoAccount.code }),
  });
  assert.equal(demoOptions.status, 200, 'new demo account can request passkey registration options');
  const lecturerAccountResponse = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ createLecturerAccount: true, displayName: 'Dr. Course Tester', inviteCode: lecturerInviteCode, courseId: 'CS230' }),
  });
  assert.equal(lecturerAccountResponse.status, 201, 'a valid lecturer invitation creates an account');
  const { lecturerAccount } = await lecturerAccountResponse.json();
  assert.match(lecturerAccount.userId, /^L-[A-F0-9]{8}$/);
  const lecturerOptions = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: lecturerAccount.userId, code: lecturerAccount.code }),
  });
  assert.equal(lecturerOptions.status, 200, 'new lecturer account receives valid passkey registration options');
  const reusedInvite = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ createLecturerAccount: true, displayName: 'Second Lecturer', inviteCode: lecturerInviteCode, courseId: 'CS230' }),
  });
  assert.equal(reusedInvite.status, 400, 'lecturer invitations can only be claimed once');
  const publicCourseCreation = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ createCourse: true, courseId: 'CS310', title: 'Database Systems' }),
  });
  assert.equal(publicCourseCreation.status, 401, 'course creation requires an authenticated lecturer session');
  const duplicateDemoAccount = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ createDemoAccount: true, displayName: 'Another Tester' }),
  });
  assert.equal(duplicateDemoAccount.status, 409, 'a browser session can create only one demo account');
  const invalidCode = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'S1', code: 'incorrect-code' }),
  });
  assert.equal(invalidCode.status, 400);
  const wrongOrigin = await fetch(`${base}/api/enrol/options`, {
    method: 'POST', headers: { Origin: 'http://attacker.invalid', Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'S1', code: 'incorrect-code' }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await fetch(`${base}/api/users/S1/role`, { method: 'PUT' })).status, 404);

  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1500)]);
  restartedChild = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env: serverEnv, stdio: 'ignore' });
  let restartedHealth;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (restartedChild.exitCode !== null) break;
    try { restartedHealth = await fetch(`${base}/api/health`); if (restartedHealth.ok) break; } catch { /* server is starting */ }
    await pause(100);
  }
  assert.equal(restartedHealth?.status, 200, 'restart safely seeds existing demo accounts enrolled outside IS451');
});
