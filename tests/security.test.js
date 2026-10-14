import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadStudent, canEditGrade, isValidGradeChange } from '../src/policy.js';
import { DEMO_NOTE, encryptDemoNote, decryptDemoNote, testDemoTampering, runAesDemo } from '../src/cryptoDemo.js';
import { randomBytes } from 'node:crypto';

test('students can read only their own record', () => {
  assert.equal(canReadStudent({ role: 'student', userId: 'S1', targetId: 'S1' }), true);
  assert.equal(canReadStudent({ role: 'student', userId: 'S1', targetId: 'S2' }), false);
  assert.equal(canReadStudent({ role: 'student', userId: 'S2', targetId: 'S1' }), false);
});

test('lecturer reads and edits only assigned course records', () => {
  assert.equal(canReadStudent({ role: 'lecturer', userId: 'L1', targetId: 'S1', assignedToLecturer: true }), true);
  assert.equal(canReadStudent({ role: 'lecturer', userId: 'L1', targetId: 'S1', assignedToLecturer: false }), false);
  assert.equal(canEditGrade({ role: 'lecturer', assignedToLecturer: true, studentEnrolled: true }), true);
  assert.equal(canEditGrade({ role: 'lecturer', assignedToLecturer: false, studentEnrolled: true }), false);
  assert.equal(canEditGrade({ role: 'student', assignedToLecturer: true, studentEnrolled: true }), false);
});

test('grade input is validated', () => {
  assert.equal(isValidGradeChange({ studentId: 'S1', courseId: 'IS451', assessment: 'Quiz', grade: 86 }), true);
  assert.equal(isValidGradeChange({ studentId: 'S1', courseId: 'IS451', assessment: 'Quiz', grade: 101 }), false);
  assert.equal(isValidGradeChange({ studentId: 'S3', courseId: 'IS451', assessment: 'Quiz', grade: 86 }), false);
  assert.equal(isValidGradeChange({ studentId: 'S1', courseId: 'IS451', assessment: '  ', grade: 86 }), false);
});

test('AES-GCM recovers the note and rejects altered ciphertext', () => {
  const key = randomBytes(32); const result = runAesDemo(key);
  assert.equal(DEMO_NOTE, 'Student consultation note \u2013 demonstration data only');
  assert.equal(result.note, DEMO_NOTE);
  assert.equal(result.recovered, DEMO_NOTE);
  assert.equal(Buffer.from(result.iv, 'base64').length, 12);
  assert.equal(result.tamperDetected, true);
});

test('academic note encrypt and decrypt endpoints use separate operations', () => {
  const key = randomBytes(32);
  const payload = encryptDemoNote(key);
  assert.equal(decryptDemoNote(key, payload), DEMO_NOTE);
  assert.equal(testDemoTampering(key, payload), true);
  const invalid = { ...payload, iv: Buffer.alloc(12).toString('base64') };
  assert.throws(() => decryptDemoNote(key, invalid));
});

test('AES demo rejects a key of the wrong size', () => {
  assert.throws(() => runAesDemo(randomBytes(16)), /32-byte key/);
});
