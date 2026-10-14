import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
}

export async function seedDemoData() {
  await db.transaction(async tx => {
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S1', 'Ama Mensah', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['S2', 'Kojo Owusu', 'student']);
    await tx.run('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)', ['L1', 'Dr. Abena Boateng', 'lecturer']);
    await tx.run('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)', ['IS451', 'Information and Systems Security', 'L1']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S1']);
    await tx.run('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)', ['IS451', 'S2']);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S1', 'Security lab', 86]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S1', 'Quiz', 91]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S2', 'Security lab', 78]);
    await tx.run('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)', ['IS451', 'S2', 'Quiz', 84]);
  });
}
