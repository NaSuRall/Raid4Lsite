import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'album.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    filename TEXT NOT NULL,
    original_name TEXT,
    content_hash TEXT,
    uploaded_at TEXT NOT NULL,
    crop_x REAL,
    crop_y REAL,
    crop_zoom REAL DEFAULT 1,
    crop_mode TEXT DEFAULT 'cover'
  );

  CREATE TABLE IF NOT EXISTS album (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT,
    pdf_path TEXT,
    zip_path TEXT,
    photo_count INTEGER,
    participant_count INTEGER,
    page_count INTEGER,
    generated_at TEXT,
    sent_at TEXT,
    recipient_count INTEGER,
    recipient_names TEXT,
    cover_photo_id TEXT,
    layout_json TEXT,
    excluded_photo_ids TEXT DEFAULT '[]'
  );
`);

// Migration guards for databases created before these columns existed.
for (const stmt of [
  'ALTER TABLE album ADD COLUMN cover_photo_id TEXT',
  'ALTER TABLE album ADD COLUMN layout_json TEXT',
  'ALTER TABLE photos ADD COLUMN crop_x REAL',
  'ALTER TABLE photos ADD COLUMN crop_y REAL',
  'ALTER TABLE photos ADD COLUMN crop_zoom REAL DEFAULT 1',
  "ALTER TABLE photos ADD COLUMN crop_mode TEXT DEFAULT 'cover'",
  'ALTER TABLE photos ADD COLUMN content_hash TEXT',
  "ALTER TABLE album ADD COLUMN excluded_photo_ids TEXT DEFAULT '[]'",
]) {
  try {
    db.exec(stmt);
  } catch {
    // column already present
  }
}

db.exec('CREATE INDEX IF NOT EXISTS idx_photos_participant_hash ON photos(participant_id, content_hash);');

export default db;
