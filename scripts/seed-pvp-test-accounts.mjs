import crypto from 'node:crypto';

const base = process.env.COREBOX_API || 'http://127.0.0.1:8787';
const password = process.env.COREBOX_TEST_PASSWORD;
if (!password || password.length < 6) throw new Error('Set COREBOX_TEST_PASSWORD (minimum 6 characters)');
const accounts = [
  { email: 'pvp-test-01@corebox.local', username: 'NOVA_WARDEN', x: 650, y: 820, ore: 420, coal: 180, chips: 45, plasma: 8 },
  { email: 'pvp-test-02@corebox.local', username: 'GHOST_RELAY', x: 1320, y: 1180, ore: 680, coal: 260, chips: 72, plasma: 14 },
  { email: 'pvp-test-03@corebox.local', username: 'IRON_MOTH', x: 2080, y: 740, ore: 910, coal: 340, chips: 96, plasma: 18 },
  { email: 'pvp-test-04@corebox.local', username: 'VOID_CARTEL', x: 2860, y: 1620, ore: 1240, coal: 460, chips: 120, plasma: 25 },
  { email: 'pvp-test-05@corebox.local', username: 'NEON_ORACLE', x: 3740, y: 2480, ore: 1600, coal: 580, chips: 150, plasma: 32 },
];

async function request(path, options = {}) {
  const headers = { 'content-type': 'application/json', apikey: 'corebox-local', ...(options.headers || {}) };
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const seeded = [];
for (const a of accounts) {
  let auth = null;
  try {
    auth = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: a.email, password, data: { username: a.username } }) });
  } catch (e) {
    auth = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: a.email, password }) });
  }
  const userId = auth?.user?.id;
  if (!userId) throw new Error(`No user id for ${a.email}`);
  const now = new Date().toISOString();
  const save = {
    id: crypto.randomUUID(), user_id: userId, ore: a.ore, coal: a.coal, trash: 80,
    chips: a.chips, plasma: a.plasma, total_mined: a.ore + a.coal + 80,
    computational_power: 220, max_computational_power: 1000,
    map_x: a.x, map_y: a.y, last_seen: now, updated_at: now,
    is_day: true, game_time: 6, blueprint_cargo_unlocked: true,
    blueprint_scout_unlocked: true, blueprint_combat_unlocked: true,
    full_state: { seededFor: 'local-pvp-test', seedVersion: 1 },
  };
  await request('/rest/v1/game_saves?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(save) });
  await request('/rest/v1/player_public_stats?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, username: a.username, map_x: a.x, map_y: a.y, total_mined: save.total_mined, computational_power: save.computational_power, inventory_ore: a.ore, inventory_coal: a.coal, inventory_chips: a.chips, inventory_plasma: a.plasma, inventory_trash: 80, ore: a.ore, coal: a.coal, chips: a.chips, plasma: a.plasma, trash: 80, last_seen: now, updated_at: now }) });
  seeded.push({ email: a.email, username: a.username, userId, map: [a.x, a.y] });
}
console.log(JSON.stringify({ ok: true, backend: 'local-sqlite', count: seeded.length, password: '<provided via COREBOX_TEST_PASSWORD>', accounts: seeded }, null, 2));
