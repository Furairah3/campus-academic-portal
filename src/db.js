import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encryptCourseNote } from './courseNotesCrypto.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(root, process.env.DATABASE_PATH || 'database/portal.db');
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (process.env.VERCEL && !tursoUrl) {
  throw new Error('TURSO_DATABASE_URL is required when running on Vercel');
}
if (tursoUrl && !tursoAuthToken) {
  throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set');
}

if (!tursoUrl) mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient(tursoUrl
  ? { url: tursoUrl, authToken: tursoAuthToken }
  : { url: pathToFileURL(dbPath).href });

function createQueries(connection) {
  return {
    async get(sql, args = []) {
      const result = await connection.execute({ sql, args });
      return result.rows[0] ?? null;
    },
    async all(sql, args = []) {
      const result = await connection.execute({ sql, args });
      return result.rows;
    },
    async run(sql, args = []) {
      const result = await connection.execute({ sql, args });
      return { changes: Number(result.rowsAffected), lastInsertRowid: result.lastInsertRowid };
    },
  };
}

export const db = {
  ...createQueries(client),
  async transaction(callback) {
    const transaction = await client.transaction('write');
    try {
      const result = await callback(createQueries(transaction));
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
  close() {
    return client.close();
  },
};

export async function initializeDatabase() {
  await client.execute('PRAGMA foreign_keys = ON');
  const statements = readFileSync(resolve(root, 'database/schema.sql'), 'utf8')
    .replace(/^PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*/i, '')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
  await client.batch(statements, 'write');
  const columns = await client.execute('PRAGMA table_info(course_notes)');
  const existing = new Set(columns.rows.map(column => column.name));
  for (const name of ['ciphertext', 'iv', 'tag']) {
    if (existing.has(name)) continue;
    try {
      await client.execute(`ALTER TABLE course_notes ADD COLUMN ${name} TEXT`);
    } catch (error) {
      const refreshed = await client.execute('PRAGMA table_info(course_notes)');
      if (!refreshed.rows.some(column => column.name === name)) throw error;
    }
  }
}

export async function migrateLegacyCourseNotes(key) {
  const legacyNotes = await db.all('SELECT id,title,body FROM course_notes WHERE ciphertext IS NULL OR iv IS NULL OR tag IS NULL');
  for (const note of legacyNotes) {
    const encrypted = encryptCourseNote(key, { title: note.title, body: note.body });
    await db.run(
      "UPDATE course_notes SET title='Encrypted',body='Encrypted',ciphertext=?,iv=?,tag=? WHERE id=? AND (ciphertext IS NULL OR iv IS NULL OR tag IS NULL)",
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, note.id],
    );
  }
}

export async function seedDemoData() {
  await db.transaction(async tx => {
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S1', 'Ama Mensah', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S2', 'Kojo Owusu', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S3', 'Nana Agyeman', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S4', 'Kwame Asante', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S5', 'Esi Tetteh', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S6', 'Kofi Adu', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['L1', 'Dr. Abena Boateng', 'lecturer']);
    await tx.run('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)', ['IS451', 'Information and Systems Security', 'L1']);
    await tx.run('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)', ['CS230', 'Operating Systems', 'L1']);
    await tx.run('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)', ['CS480', 'Capstone Project', 'L1']);
    await tx.run('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)', ['FIN101', 'Finance for Non-Finance Professionals', 'L1']);
    await tx.run('INSERT OR IGNORE INTO course_lecturers(course_id,lecturer_id) VALUES (?,?)', ['IS451', 'L1']);
    await tx.run('INSERT OR IGNORE INTO course_lecturers(course_id,lecturer_id) VALUES (?,?)', ['CS230', 'L1']);
    await tx.run('INSERT OR IGNORE INTO course_lecturers(course_id,lecturer_id) VALUES (?,?)', ['CS480', 'L1']);
    await tx.run('INSERT OR IGNORE INTO course_lecturers(course_id,lecturer_id) VALUES (?,?)', ['FIN101', 'L1']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S1']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S2']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S3']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S6']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['CS230', 'S3']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['CS230', 'S4']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['CS480', 'S4']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['CS480', 'S5']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['FIN101', 'S5']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['FIN101', 'S6']);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S1', 'Security lab', 86]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S1', 'Quiz', 91]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S2', 'Security lab', 78]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S2', 'Quiz', 84]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S3', 'Threat model', 89]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S6', 'Security quiz', 84]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['CS230', 'S3', 'OS concepts', 92]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['CS230', 'S4', 'Process scheduling', 87]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['CS480', 'S4', 'Capstone proposal', 91]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['CS480', 'S5', 'Requirements review', 88]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['FIN101', 'S5', 'Budget case', 86]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['FIN101', 'S6', 'Finance quiz', 90]);
    await tx.run("INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) SELECT e.course_id,e.student_id,'Information Security Quiz',88 FROM enrolments e WHERE e.course_id='IS451' AND e.student_id LIKE 'D-%'");
    await tx.run("INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) SELECT e.course_id,e.student_id,'Access Control Lab',92 FROM enrolments e WHERE e.course_id='IS451' AND e.student_id LIKE 'D-%'");
  });
}
