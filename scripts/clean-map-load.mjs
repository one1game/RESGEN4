import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.DB_PATH || path.join(ROOT, 'data', 'local.db');
const PREFIX = 'synthetic-map-';
const db = new DatabaseSync(DB_FILE);

let removed;
db.exec('BEGIN');
try {
  const stats = db.prepare(`DELETE FROM player_public_stats WHERE user_id LIKE ?`).run(`${PREFIX}%`);
  const saves = db.prepare(`DELETE FROM game_saves WHERE user_id LIKE ?`).run(`${PREFIX}%`);
  const profiles = db.prepare(`DELETE FROM profiles WHERE id LIKE ?`).run(`${PREFIX}%`);
  removed = { stats: stats.changes, saves: saves.changes, profiles: profiles.changes };
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(JSON.stringify({ ok: true, database: DB_FILE, removed, prefix: PREFIX }, null, 2));
db.close();
