const base = process.env.COREBOX_API || 'http://127.0.0.1:8787';
const password = process.env.COREBOX_TEST_PASSWORD;
const cycles = Number(process.env.COREBOX_HEADLESS_CYCLES || 1000);
if (!password) throw new Error('Set COREBOX_TEST_PASSWORD');
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100000) throw new Error('Invalid COREBOX_HEADLESS_CYCLES');

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', apikey: 'corebox-local', ...(options.headers || {}) }, ...options });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const emails = Array.from({ length: 5 }, (_, i) => `pvp-test-0${i + 1}@corebox.local`);
const users = [];
for (const email of emails) {
  const auth = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  users.push(auth.user);
}

const resourceKeys = ['ore', 'coal', 'chips', 'plasma', 'trash'];
const snapshot = async () => {
  const rows = await request('/rest/v1/game_saves?select=user_id,ore,coal,chips,plasma,trash&user_id=in.(' + users.map(u => u.id).join(',') + ')');
  for (const row of rows) {
    if (resourceKeys.some(k => Number(row[k] || 0) < 0)) throw new Error(`Negative resource for ${row.user_id}`);
  }
  return new Map(rows.map(row => [row.user_id, row]));
};

let successful = 0;
let zeroLoot = 0;
let invalid = 0;
const checkEvery = 25;
const baseline = await snapshot();
const totalOf = rows => resourceKeys.reduce((sum, key) => sum + rows.reduce((n, row) => n + Number(row[key] || 0), 0), 0);
const baselineTotal = totalOf([...baseline.values()]);
const start = Date.now();
for (let startIndex = 0; startIndex < cycles; startIndex += 10) {
  const batch = Array.from({ length: Math.min(10, cycles - startIndex) }, (_, offset) => {
    const i = startIndex + offset;
    const attacker = users[i % users.length];
    const defender = users[(i + 1 + (i % (users.length - 1))) % users.length];
    return request('/rest/v1/rpc/atomic_pvp_steal', { method: 'POST', body: JSON.stringify({ p_attacker_id: attacker.id, p_defender_id: defender.id, p_percent: 0.1 }) });
  });
  const results = await Promise.all(batch);
  for (const result of results) {
    const loot = result?.loot || {};
    const validLoot = resourceKeys.every(k => Number(loot[k] || 0) >= 0);
    if (!validLoot) { invalid++; throw new Error(`Invalid loot: ${JSON.stringify(loot)}`); }
    if (Object.values(loot).some(v => Number(v) > 0)) successful++; else zeroLoot++;
  }
  const completed = Math.min(cycles, startIndex + results.length);
  if (completed % checkEvery === 0 || completed === cycles) {
    const check = await snapshot();
    const checkTotal = totalOf([...check.values()]);
    if (checkTotal !== baselineTotal) {
      invalid++;
      throw new Error(`Cycle ${completed} conservation failed: ${baselineTotal} -> ${checkTotal}`);
    }
  }
}

const finalRows = await snapshot();
const durationMs = Date.now() - start;
console.log(JSON.stringify({ ok: invalid === 0, cycles, successful, zeroLoot, invalid, durationMs, cyclesPerSecond: Number((cycles / Math.max(durationMs / 1000, 0.001)).toFixed(2)), players: users.length, backend: base }, null, 2));
