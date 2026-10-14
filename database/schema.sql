PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','lecturer'))
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lecturer_id TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS enrolments (
  course_id TEXT NOT NULL REFERENCES courses(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(course_id, student_id)
);
CREATE TABLE IF NOT EXISTS grades (
  course_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assessment TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK(grade BETWEEN 0 AND 100),
  PRIMARY KEY(course_id, student_id, assessment),
  FOREIGN KEY(course_id, student_id) REFERENCES enrolments(course_id, student_id)
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS enrolment_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  challenge TEXT PRIMARY KEY,
  sid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('registration','authentication')),
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
