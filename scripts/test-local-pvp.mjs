const base = process.env.COREBOX_API || 'http://127.0.0.1:8787';
const password = process.env.COREBOX_TEST_PASSWORD;
if (!password) throw new Error('Set COREBOX_TEST_PASSWORD');
const attackers = ['pvp-test-01@corebox.local', 'pvp-test-02@corebox.local'];

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', apikey: 'corebox-local', ...(options.headers || {}) }, ...options });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const users = [];
for (const email of attackers) {
  const auth = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  users.push(auth.user);
}
const [attacker, defender] = users;
const before = await request(`/rest/v1/game_saves?select=user_id,ore,coal,chips,plasma,trash&user_id=eq.${defender.id}`);
const attackerBefore = await request(`/rest/v1/game_saves?select=user_id,ore,coal,chips,plasma,trash&user_id=eq.${attacker.id}`);
const result = await request('/rest/v1/rpc/atomic_pvp_steal', { method: 'POST', body: JSON.stringify({ p_attacker_id: attacker.id, p_defender_id: defender.id, p_percent: 0.1 }) });
const after = await request(`/rest/v1/game_saves?select=user_id,ore,coal,chips,plasma,trash&user_id=eq.${defender.id}`);
const attackerAfter = await request(`/rest/v1/game_saves?select=user_id,ore,coal,chips,plasma,trash&user_id=eq.${attacker.id}`);
const loot = result?.loot || {};
const defenderLoss = Object.keys(loot).every(k => Number(before[0]?.[k] || 0) - Number(after[0]?.[k] || 0) === Number(loot[k] || 0));
const attackerGain = Object.keys(loot).every(k => Number(attackerAfter[0]?.[k] || 0) - Number(attackerBefore[0]?.[k] || 0) === Number(loot[k] || 0));
console.log(JSON.stringify({ ok: defenderLoss && attackerGain, attacker: attacker.email, defender: defender.email, loot, defenderLoss, attackerGain }, null, 2));
if (!defenderLoss || !attackerGain) process.exitCode = 1;
