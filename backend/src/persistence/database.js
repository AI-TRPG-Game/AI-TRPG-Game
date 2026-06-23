import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDatabase(dbPath) {
  if (db) return db;

  const resolvedPath = dbPath || path.join(__dirname, '../../data/trpg.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(resolvedPath);
  runMigrations(db);
  return db;
}

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新剧本',
      phase TEXT NOT NULL DEFAULT 'WORLD_SETTING',
      sub_state TEXT NOT NULL DEFAULT 'AWAITING_INPUT',
      opening_done INTEGER NOT NULL DEFAULT 0,
      world_settings TEXT NOT NULL DEFAULT '',
      protagonist TEXT NOT NULL DEFAULT '',
      chat_record TEXT NOT NULL DEFAULT '[]',
      setup_history TEXT NOT NULL DEFAULT '{"world":[],"character":[]}',
      option_buffer TEXT NOT NULL DEFAULT '',
      locations TEXT NOT NULL DEFAULT '[]',
      npcs TEXT NOT NULL DEFAULT '[]',
      inventory TEXT NOT NULL DEFAULT '[]',
      pending_dice_flow TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
