import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(root, process.env.DATABASE_PATH || 'database/portal.db');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.exec(readFileSync(resolve(root, 'database/schema.sql'), 'utf8'));

export function seedDemoData() {
  const insertUser = db.prepare('INSERT OR IGNORE INTO users(id, display_name, role) VALUES (?, ?, ?)');
  const addSeed = db.transaction(() => {
    insertUser.run('S1', 'Ama Mensah', 'student');
    insertUser.run('S2', 'Kojo Owusu', 'student');
    insertUser.run('L1', 'Dr. Abena Boateng', 'lecturer');
    db.prepare('INSERT OR IGNORE INTO courses(id,title,lecturer_id) VALUES (?,?,?)').run('IS451', 'Information and Systems Security', 'L1');
    const enroll = db.prepare('INSERT OR IGNORE INTO enrolments(course_id,student_id) VALUES (?,?)');
    enroll.run('IS451', 'S1'); enroll.run('IS451', 'S2');
    const grade = db.prepare('INSERT OR IGNORE INTO grades(course_id,student_id,assessment,grade) VALUES (?,?,?,?)');
    grade.run('IS451', 'S1', 'Security lab', 86); grade.run('IS451', 'S1', 'Quiz', 91);
    grade.run('IS451', 'S2', 'Security lab', 78); grade.run('IS451', 'S2', 'Quiz', 84);
  });
  addSeed();
}
