import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

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
  const serverEnv = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, ORIGIN: base, LECTURER_INVITE_CODE: lecturerInviteCode };
  let child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: 'ignore',
  });
  let restartedChild;
  t.after(async () => {
    child.kill();
    restartedChild?.kill();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1500)]);
    for (const suffix of ['', '-shm', '-wal']) rmSync(dbPath + suffix, { force: true });
  });

  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`API process exited with ${child.exitCode}`);
    try { health = await fetch(`${base}/api/health`); if (health.ok) break; } catch { /* server is starting */ }
    await pause(100);
  }
  assert.equal(health?.status, 200, 'API starts and serves its health check');
  assert.deepEqual(await health.json(), { status: 'ok' });

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
