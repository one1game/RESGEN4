import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.DB_PATH || path.join(ROOT, 'data', 'local.db');
const COUNT = 2000;
const PREFIX = 'synthetic-map-';
const db = new DatabaseSync(DB_FILE);
const now = new Date().toISOString();

const clean = db.prepare(`DELETE FROM player_public_stats WHERE user_id LIKE ?`);
const cleanSaves = db.prepare(`DELETE FROM game_saves WHERE user_id LIKE ?`);
const cleanProfiles = db.prepare(`DELETE FROM profiles WHERE id LIKE ?`);
const insertProfile = db.prepare(`INSERT INTO profiles (id, username, created_at, last_login, zone, map_x, map_y, pvp_kills) VALUES (?, ?, ?, ?, 'pve', ?, ?, 0)`);
const insertSave = db.prepare(`INSERT INTO game_saves (id, user_id, coal, trash, ore, chips, plasma, total_mined, nights_survived, neuro_evolution, computational_power, map_x, map_y, updated_at, last_seen, game_time, is_day, max_computational_power, full_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 6, 1, 1000, ?)`);
const insertPublic = db.prepare(`INSERT INTO player_public_stats (user_id, username, map_x, map_y, total_mined, neuro_evolution, nights_survived, computational_power, inventory_ore, inventory_coal, inventory_chips, inventory_plasma, inventory_trash, ore, coal, chips, plasma, trash, last_seen, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function run() {
  db.exec('BEGIN');
  try {
    clean.run(`${PREFIX}%`);
    cleanSaves.run(`${PREFIX}%`);
    cleanProfiles.run(`${PREFIX}%`);
    for (let i = 0; i < COUNT; i++) {
    const id = `${PREFIX}${String(i + 1).padStart(4, '0')}`;
    const username = `SIM_${String(i + 1).padStart(4, '0')}`;
    const x = 100 + (i % 50) * 96;
    const y = 100 + Math.floor(i / 50) * 120;
    const ore = 100 + (i % 17) * 25;
    const coal = 50 + (i % 13) * 10;
    const chips = 10 + (i % 9) * 3;
    const plasma = i % 7;
    const trash = 20 + (i % 11) * 4;
    const mined = ore + coal + trash;
    insertProfile.run(id, username, now, now, x, y);
    insertSave.run(`${id}-save`, id, coal, trash, ore, chips, plasma, mined, 220 + (i % 5) * 40, x, y, now, now, JSON.stringify({ synthetic: true, batch: 2000 }));
      insertPublic.run(id, username, x, y, mined, 220 + (i % 5) * 40, ore, coal, chips, plasma, trash, ore, coal, chips, plasma, trash, now, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

run();
const count = db.prepare(`SELECT COUNT(*) AS n FROM game_saves WHERE user_id LIKE ?`).get(`${PREFIX}%`).n;
console.log(JSON.stringify({ ok: count === COUNT, database: DB_FILE, syntheticPlayers: count, coordinateGrid: '50 x 40', prefix: PREFIX }, null, 2));
db.close();
if (count !== COUNT) process.exitCode = 1;
