// Локальный сервер CoreBox — эмулирует Supabase API (REST, RPC, Auth, Realtime) на SQLite.
// Запуск:  node local-db-server.js   (порт по умолчанию 8787, можно PORT=...)
// Отдаёт и статику (игра), и API — копируем папку куда угодно и запускаем.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, AUTH_SCHEMA, createSchema, toDb, fromDb, defaultsForInsert, uuid, nowIso, epochSec, getJsonCols, getBoolCols } from './local-schema.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(process.env.STATIC_ROOT || import.meta.dirname || '.');
const DB_DIR = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(ROOT, 'data'));
const DB_FILE = process.env.DB_PATH || path.join(DB_DIR, 'local.db');
const JWT_SECRET = process.env.JWT_SECRET || 'corebox-local-secret';
const TOKEN_TTL = 3600; // сек
const REFRESH_TTL = 30 * 24 * 3600;

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
createSchema(db);

// ---------- helpers ----------
const VALID_TABLES = new Set(Object.keys(SCHEMA));
function colNames(table) {
  return SCHEMA[table].cols.map(([n]) => n);
}
function tableExists(table) { return VALID_TABLES.has(table); }
function sqlIdent(name) { return `"${name}"`; }

function getRow(table, idCol, idVal) {
  const row = db.prepare(`SELECT * FROM ${sqlIdent(table)} WHERE ${sqlIdent(idCol)} = ?`).get(idVal);
  return row ? fromDb(table, row) : null;
}
function selectAll(table, whereSql, params) {
  return db.prepare(`SELECT * FROM ${sqlIdent(table)} ${whereSql}`).all(...params).map(r => fromDb(table, r));
}

// лог изменений для realtime
let seqCounter = 0;
const changeLog = []; // {seq, table, type, new, old}
function emitChange(table, type, newRow, oldRow) {
  seqCounter++;
  changeLog.push({ seq: seqCounter, table, type, new: newRow, old: oldRow });
  if (changeLog.length > 5000) changeLog.splice(0, changeLog.length - 5000);
}

// presence
const presenceChannels = new Map(); // channel -> Map(userId -> payload)
const presenceVersion = new Map(); // channel -> int
function bumpPresence(channel) {
  presenceVersion.set(channel, (presenceVersion.get(channel) || 0) + 1);
}

// ---------- фильтры PostgREST ----------
function parseScalar(v) {
  if (v === 'null' || v === 'NULL') return { isNull: true };
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (v !== '' && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v)) return n;
  return v;
}

// Разбор одного условия "col=op.value"
function parseCondition(cond) {
  const nullNot = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=not\.is\.null$/);
  if (nullNot) return { col: nullNot[1], op: 'not.is', val: null };
  const m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=((?:not\.)?(?:eq|neq|gt|gte|lt|lte|in|is|like|ilike))\.(.+)$/);
  if (!m) return null;
  const [, col, op, raw] = m;
  let val = raw;
  if (op === 'in') {
    val = val.slice(1, -1).split(',').map(parseScalar);
  }
  return { col, op, val };
}

// Условие в SQL. Возвращает {sql, params}
function condToSql(c) {
  const col = sqlIdent(c.col);
  switch (c.op) {
    case 'eq': return { sql: `${col} = ?`, params: [c.val] };
    case 'neq': return { sql: `${col} != ?`, params: [c.val] };
    case 'gt': return { sql: `${col} > ?`, params: [c.val] };
    case 'gte': return { sql: `${col} >= ?`, params: [c.val] };
    case 'lt': return { sql: `${col} < ?`, params: [c.val] };
    case 'lte': return { sql: `${col} <= ?`, params: [c.val] };
    case 'like': return { sql: `${col} LIKE ?`, params: [String(c.val)] };
    case 'ilike': return { sql: `${col} LIKE ? COLLATE NOCASE`, params: [String(c.val).replace(/%/g, '%')] };
    case 'is': {
      if (c.val === true) return { sql: `${col} = 1`, params: [] };
      if (c.val === false) return { sql: `${col} = 0`, params: [] };
      return { sql: `${col} IS NULL`, params: [] };
    }
    case 'not.is': {
      if (c.val === true) return { sql: `${col} != 1`, params: [] };
      if (c.val === false) return { sql: `${col} != 0`, params: [] };
      return { sql: `${col} IS NOT NULL`, params: [] };
    }
    case 'in': return { sql: `${col} IN (${c.val.map(() => '?').join(',')})`, params: c.val };
    default: return null;
  }
}

// Парсинг всех фильтров из URL: col=eq.v + or=(...)
function parseFilters(url) {
  const filters = [];
  const orGroups = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'or' || k.startsWith('or=')) {
      orGroups.push(v);
    } else if (!['select', 'order', 'limit', 'offset', 'on_conflict', 'head', 'columns'].includes(k)) {
      if (v === 'not.is.null') {
        filters.push({ col: k, op: 'not.is', val: null });
        continue;
      }
      const c = parseCondition(`${k}=${v}`);
      if (c) filters.push(c);
    }
  }
  for (const og of orGroups) {
    let inner = og;
    if (inner.startsWith('or=')) inner = inner.slice(3);
    if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1);
    const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
    const ors = parts.map(p => parseCondition(p)).filter(Boolean);
    if (ors.length) filters.push({ or: ors });
  }
  return filters;
}

function buildWhere(filters) {
  const clauses = [];
  const params = [];
  for (const f of filters) {
    if (f.or) {
      const sub = [];
      for (const c of f.or) {
        const s = condToSql(c);
        if (s) { sub.push(s.sql); params.push(...s.params); }
      }
      if (sub.length) clauses.push(`(${sub.join(' OR ')})`);
    } else {
      const s = condToSql(f);
      if (s) { clauses.push(s.sql); params.push(...s.params); }
    }
  }
  return { sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

// Сопоставление JS-строки фильтра realtime (напр. "player_id=eq.x" или "or(a.eq.b,c.eq.d)")
function matchRealtimeFilter(row, filter) {
  if (!filter) return true;
  if (filter.startsWith('or')) {
    let inner = filter.slice(2);
    if (inner.startsWith('=')) inner = inner.slice(1);
    if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1);
    const conds = inner.split(',').map(p => parseCondition(p.trim())).filter(Boolean);
    return conds.some(c => evalCond(row, c));
  }
  const c = parseCondition(filter);
  return c ? evalCond(row, c) : true;
}
function evalCond(row, c) {
  if (!row || !(c.col in row)) return false;
  const v = row[c.col];
  switch (c.op) {
    case 'eq': return v === c.val || String(v) === String(c.val);
    case 'neq': return String(v) !== String(c.val);
    case 'gt': return v > c.val;
    case 'gte': return v >= c.val;
    case 'lt': return v < c.val;
    case 'lte': return v <= c.val;
    case 'in': return (c.val || []).some(x => String(x) === String(v));
    case 'is': {
      if (c.val === true) return v === true;
      if (c.val === false) return v === false;
      return v === null || v === undefined;
    }
    default: return true;
  }
}

// ---------- write helpers ----------
function nowTs() { return nowIso(); }

function insertRow(table, obj, { emit = true } = {}) {
  const cols = colNames(table);
  const row = { ...defaultsForInsert(table) };
  for (const [k, v] of Object.entries(obj || {})) {
    if (cols.includes(k)) row[k] = v;
    else if (emit) console.log(`  ⚠ ${table}: неизвестная колонка "${k}" пропущена`);
  }
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${sqlIdent(table)} (${keys.map(sqlIdent).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map(k => toDb(table, k, row[k])));
  const idCol = SCHEMA[table].pk[0];
  const out = getRow(table, idCol, row[idCol]);
  if (emit && out) emitChange(table, 'INSERT', out, null);
  return out;
}

function updateRowById(table, id, idVal, patch) {
  const cols = colNames(table);
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!cols.includes(k) || k === id) continue;
    sets.push(`${sqlIdent(k)} = ?`);
    params.push(toDb(table, k, v));
  }
  if (!sets.length) return getRow(table, id, idVal);
  sets.push('updated_at = ?');
  params.push(nowTs());
  params.push(idVal);
  db.prepare(`UPDATE ${sqlIdent(table)} SET ${sets.join(',')} WHERE ${sqlIdent(id)} = ?`).run(...params);
  const out = getRow(table, id, idVal);
  if (out) emitChange(table, 'UPDATE', out, null);
  return out;
}

function applyPatch(table, filters, patch) {
  const cols = colNames(table);
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) if (cols.includes(k)) clean[k] = v;
  const where = buildWhere(filters);
  const rows = selectAll(table, where.sql, where.params);
  const out = [];
  const idCol = SCHEMA[table].pk[0];
  for (const r of rows) {
    out.push(updateRowById(table, idCol, r[idCol], clean));
  }
  return out;
}

function deleteRows(table, filters) {
  const where = buildWhere(filters);
  const rows = selectAll(table, where.sql, where.params);
  const idCol = SCHEMA[table].pk[0];
  for (const r of rows) {
    db.prepare(`DELETE FROM ${sqlIdent(table)} WHERE ${sqlIdent(idCol)} = ?`).run(r[idCol]);
    emitChange(table, 'DELETE', null, r);
  }
  return rows;
}

// ---------- auth ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function signJwt(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token) {
  try {
    const [h, b, s] = token.split('.');
    const exp = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (exp !== s) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
function userObject(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated',
    email: u.email, email_confirmed_at: u.confirmed ? nowTs() : null,
    phone: '', confirmed_at: u.confirmed ? nowTs() : null,
    last_sign_in_at: u.last_login,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { username: u.username },
    created_at: u.created_at, updated_at: u.created_at,
  };
}
function tokenResponse(user, refreshToken) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const access = signJwt({ sub: user.id, email: user.email, role: 'authenticated', iat: Math.floor(Date.now() / 1000), exp });
  return {
    access_token: access, token_type: 'bearer', expires_in: TOKEN_TTL, expires_at: exp,
    refresh_token: refreshToken, user: userObject(user),
  };
}
function createSession(user) {
  const refresh = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000).toISOString();
  db.prepare(`INSERT INTO auth_sessions (refresh_token, user_id, created_at, expires_at) VALUES (?,?,?,?)`)
    .run(refresh, user.id, nowTs(), expiresAt);
  return tokenResponse(user, refresh);
}
function getUserByEmail(email) {
  const r = db.prepare(`SELECT * FROM auth_users WHERE email = ?`).get(String(email).toLowerCase());
  return r ? fromDb('auth_users', r) : null;
}
function getUserById(id) {
  const r = db.prepare(`SELECT * FROM auth_users WHERE id = ?`).get(id);
  return r ? fromDb('auth_users', r) : null;
}
function bearerUser(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = verifyJwt(m[1]);
  return payload ? getUserById(payload.sub) : null;
}

// ---------- realtime endpoints ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, prefer, apikey, x-client-info', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', ...extraHeaders });
  res.end(body);
}

// ---------- RPC ----------
// Автоматические локальные PvP-стенды для тестового режима. Не трогают реальные аккаунты.
const LOCAL_PVP_SEEDS = [
  { email: 'pvp-test-01@corebox.local', username: 'NOVA_WARDEN', x: 650, y: 820, ore: 420, coal: 180, chips: 45, plasma: 8 },
  { email: 'pvp-test-02@corebox.local', username: 'GHOST_RELAY', x: 1320, y: 1180, ore: 680, coal: 260, chips: 72, plasma: 14 },
  { email: 'pvp-test-03@corebox.local', username: 'IRON_MOTH', x: 2080, y: 740, ore: 910, coal: 340, chips: 96, plasma: 18 },
  { email: 'pvp-test-04@corebox.local', username: 'VOID_CARTEL', x: 2860, y: 1620, ore: 1240, coal: 460, chips: 120, plasma: 25 },
  { email: 'pvp-test-05@corebox.local', username: 'NEON_ORACLE', x: 3740, y: 2480, ore: 1600, coal: 580, chips: 150, plasma: 32 },
];
const LOCAL_PVP_PASSWORD = 'CoreBox-PvP-2026!';

function seedLocalPvpAccounts() {
  for (const seed of LOCAL_PVP_SEEDS) {
    let user = getUserByEmail(seed.email);
    if (!user) {
      const id = uuid();
      insertRow('auth_users', { id, email: seed.email, password_hash: hashPassword(LOCAL_PVP_PASSWORD), username: seed.username, confirmed: true, created_at: nowTs(), last_login: null }, { emit: false });
      user = getUserByEmail(seed.email);
    }
    if (!user) continue;
    if (!db.prepare('SELECT id FROM profiles WHERE id = ?').get(user.id)) {
      insertRow('profiles', { id: user.id, username: seed.username, map_x: seed.x, map_y: seed.y, last_login: nowTs() }, { emit: false });
    }
    if (!db.prepare('SELECT id FROM game_saves WHERE user_id = ?').get(user.id)) {
      const now = nowTs();
      insertRow('game_saves', { id: uuid(), user_id: user.id, ore: seed.ore, coal: seed.coal, trash: 80, chips: seed.chips, plasma: seed.plasma, total_mined: seed.ore + seed.coal + 80, computational_power: 220, max_computational_power: 1000, map_x: seed.x, map_y: seed.y, last_seen: now, updated_at: now, game_time: 6, blueprint_cargo_unlocked: true, blueprint_scout_unlocked: true, blueprint_combat_unlocked: true, full_state: { seededFor: 'local-pvp-test', seedVersion: 1 } }, { emit: false });
    }
    if (!db.prepare('SELECT user_id FROM player_public_stats WHERE user_id = ?').get(user.id)) {
      const save = db.prepare('SELECT * FROM game_saves WHERE user_id = ?').get(user.id);
      insertRow('player_public_stats', { user_id: user.id, username: seed.username, map_x: seed.x, map_y: seed.y, total_mined: save?.total_mined || 0, computational_power: save?.computational_power || 0, inventory_ore: save?.ore || 0, inventory_coal: save?.coal || 0, inventory_chips: save?.chips || 0, inventory_plasma: save?.plasma || 0, inventory_trash: save?.trash || 0, ore: save?.ore || 0, coal: save?.coal || 0, chips: save?.chips || 0, plasma: save?.plasma || 0, trash: save?.trash || 0, last_seen: nowTs(), updated_at: nowTs() }, { emit: false });
    }
  }
}

function getSaveOrError(userId) {
  const r = db.prepare(`SELECT * FROM game_saves WHERE user_id = ?`).get(userId);
  return r ? fromDb('game_saves', r) : null;
}
function addResource(userId, resource, amount) {
  const r = db.prepare(`SELECT * FROM game_saves WHERE user_id = ?`).get(userId);
  if (!r) return false;
  const cur = Number(r[resource] || 0);
  db.prepare(`UPDATE game_saves SET ${sqlIdent(resource)} = ?, updated_at = ? WHERE user_id = ?`).run(cur + Number(amount), nowTs(), userId);
  emitChange('game_saves', 'UPDATE', fromDb('game_saves', getRow('game_saves', 'id', r.id)), null);
  return true;
}
function setResource(userId, resource, amount) {
  const r = db.prepare(`SELECT * FROM game_saves WHERE user_id = ?`).get(userId);
  if (!r) return false;
  db.prepare(`UPDATE game_saves SET ${sqlIdent(resource)} = ?, updated_at = ? WHERE user_id = ?`).run(Math.max(0, Number(amount)), nowTs(), userId);
  emitChange('game_saves', 'UPDATE', fromDb('game_saves', getRow('game_saves', 'id', r.id)), null);
  return true;
}
const RESOURCES = ['ore', 'chips', 'plasma', 'coal', 'trash'];

function rpcAssignSpiral(args) {
  const { p_user_id } = args;
  const prof = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(p_user_id);
  if (prof && prof.spiral_index !== null && prof.spiral_index !== undefined && prof.map_x != null) {
    return { reused: true, x: prof.map_x, y: prof.map_y };
  }
  const maxRow = db.prepare(`SELECT MAX(spiral_index) AS m FROM profiles`).get();
  const index = (maxRow?.m || 0) + 1;
  db.prepare(`UPDATE profiles SET spiral_index = ? WHERE id = ?`).run(index, p_user_id);
  emitChange('profiles', 'UPDATE', fromDb('profiles', db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(p_user_id)), null);
  return { reused: false, index };
}
function rpcCreateTradeOffer(args) {
  const { p_seller_id, p_give_resource, p_give_amount, p_want_resource, p_want_amount } = args;
  if (!RESOURCES.includes(p_give_resource) || !RESOURCES.includes(p_want_resource)) return { success: false, error: 'Неизвестный ресурс' };
  if (p_give_amount <= 0 || p_want_amount <= 0) return { success: false, error: 'Некорректное количество' };
  const save = getSaveOrError(p_seller_id);
  if (!save) return { success: false, error: 'Игрок не найден' };
  if (Number(save[p_give_resource] || 0) < p_give_amount) return { success: false, error: 'Недостаточно ресурсов' };
  setResource(p_seller_id, p_give_resource, Number(save[p_give_resource]) - p_give_amount);
  const offer = insertRow('trade_offers', {
    seller_id: p_seller_id, give_resource: p_give_resource, give_amount: p_give_amount,
    want_resource: p_want_resource, want_amount: p_want_amount, status: 'active',
  });
  return { success: true, id: offer.id };
}
function rpcAcceptTradeOffer(args) {
  const { p_buyer_id, p_trade_id } = args;
  const offer = db.prepare(`SELECT * FROM trade_offers WHERE id = ?`).get(p_trade_id);
  if (!offer) return { success: false, error: 'Предложение не найдено' };
  const off = fromDb('trade_offers', offer);
  if (off.status !== 'active') return { success: false, error: 'Предложение уже неактивно' };
  if (off.seller_id === p_buyer_id) return { success: false, error: 'Нельзя обменять самому себе' };
  const buyer = getSaveOrError(p_buyer_id);
  if (!buyer) return { success: false, error: 'Игрок не найден' };
  if (Number(buyer[off.want_resource] || 0) < off.want_amount) return { success: false, error: 'Недостаточно ресурсов' };
  setResource(p_buyer_id, off.want_resource, Number(buyer[off.want_resource]) - off.want_amount);
  addResource(p_buyer_id, off.give_resource, off.give_amount);
  const seller = getSaveOrError(off.seller_id);
  if (seller) addResource(off.seller_id, off.want_resource, off.want_amount);
  db.prepare(`UPDATE trade_offers SET status = 'completed', updated_at = ? WHERE id = ?`).run(nowTs(), off.id);
  emitChange('trade_offers', 'UPDATE', fromDb('trade_offers', db.prepare(`SELECT * FROM trade_offers WHERE id = ?`).get(off.id)), null);
  return { success: true, received_resource: off.give_resource, received: off.give_amount, paid_resource: off.want_resource, paid: off.want_amount };
}
function rpcCancelTradeOffer(args) {
  const { p_seller_id, p_trade_id } = args;
  const offer = db.prepare(`SELECT * FROM trade_offers WHERE id = ?`).get(p_trade_id);
  if (!offer) return { success: false, error: 'Предложение не найдено' };
  const off = fromDb('trade_offers', offer);
  if (off.seller_id !== p_seller_id) return { success: false, error: 'Это не ваше предложение' };
  if (off.status !== 'active') return { success: false, error: 'Предложение уже неактивно' };
  addResource(p_seller_id, off.give_resource, off.give_amount);
  db.prepare(`UPDATE trade_offers SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(nowTs(), off.id);
  emitChange('trade_offers', 'UPDATE', fromDb('trade_offers', db.prepare(`SELECT * FROM trade_offers WHERE id = ?`).get(off.id)), null);
  return { success: true };
}
function computeSteal(defender, percent) {
  const p = Math.min(1, Math.max(0, Number(percent) || 0));
  const loot = { ore: 0, chips: 0, plasma: 0, coal: 0, trash: 0 };
  if (!defender) return loot;
  for (const res of ['ore', 'chips', 'plasma', 'coal', 'trash']) {
    loot[res] = Math.floor((Number(defender[res]) || 0) * p);
  }
  return loot;
}
function rpcAtomicPvpSteal(args) {
  const { p_attacker_id, p_defender_id, p_percent } = args;
  const defender = getSaveOrError(p_defender_id);
  const loot = computeSteal(defender, p_percent);
  if (defender) {
    for (const res of RESOURCES) setResource(p_defender_id, res, Number(defender[res]) - loot[res]);
  }
  const attacker = getSaveOrError(p_attacker_id);
  if (attacker) {
    for (const res of RESOURCES) if (loot[res] > 0) addResource(p_attacker_id, res, loot[res]);
  }
  return { loot };
}
function rpcStealPvpResources(args) {
  const { p_defender_id, p_percent } = args;
  const defender = getSaveOrError(p_defender_id);
  const loot = computeSteal(defender, p_percent);
  if (defender) {
    for (const res of RESOURCES) setResource(p_defender_id, res, Number(defender[res]) - loot[res]);
  }
  return loot;
}
function rpcAddPvpCompensation(args) {
  const { p_user_id, p_ore, p_chips, p_plasma } = args;
  if (getSaveOrError(p_user_id)) {
    if (p_ore) addResource(p_user_id, 'ore', p_ore);
    if (p_chips) addResource(p_user_id, 'chips', p_chips);
    if (p_plasma) addResource(p_user_id, 'plasma', p_plasma);
  }
  return { success: true };
}
function rpcGetDefenseShipInfo(args) {
  const { p_user_id } = args;
  const r = db.prepare(`SELECT * FROM fleet_status WHERE user_id = ?`).get(p_user_id);
  if (!r) return { has_defense_ship: false, defense_level: 0, defense_ship_level: 0, defense_ship_name: null };
  const row = fromDb('fleet_status', r);
  return { has_defense_ship: row.has_defense_ship, defense_level: row.defense_ship_level, defense_ship_level: row.defense_ship_level, defense_ship_name: row.defense_ship_name };
}
function rpcStealFromTrades(args) {
  const { p_victim_id, p_resource, p_amount } = args;
  const offers = db.prepare(`SELECT * FROM trade_offers WHERE seller_id = ? AND status = 'active' AND give_resource = ?`).all(p_victim_id, p_resource);
  let cancelled = 0;
  let remaining = Number(p_amount) || Infinity;
  for (const o of offers) {
    const off = fromDb('trade_offers', o);
    if (remaining !== Infinity) {
      if (remaining <= 0) break;
      if (off.give_amount > remaining) continue;
      remaining -= off.give_amount;
    }
    db.prepare(`UPDATE trade_offers SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(nowTs(), off.id);
    emitChange('trade_offers', 'UPDATE', fromDb('trade_offers', db.prepare(`SELECT * FROM trade_offers WHERE id = ?`).get(off.id)), null);
    cancelled++;
  }
  return { trades_cancelled: cancelled };
}

const RPCS = {
  get_server_time: () => nowIso(),
  create_trade_offer: rpcCreateTradeOffer,
  accept_trade_offer: rpcAcceptTradeOffer,
  cancel_trade_offer: rpcCancelTradeOffer,
  atomic_pvp_steal: rpcAtomicPvpSteal,
  steal_pvp_resources: rpcStealPvpResources,
  add_pvp_compensation: rpcAddPvpCompensation,
  get_defense_ship_info: rpcGetDefenseShipInfo,
  assign_spiral_position: rpcAssignSpiral,
  steal_from_trades: rpcStealFromTrades,
};

// ---------- REST ----------
function parseSelect(select) {
  if (!select || select === '*') return '*';
  return select;
}

async function handleRest(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // rest, v1, {table}
  if (parts.length < 3) return sendJson(res, 404, { message: 'Not Found' });
  const table = parts[2];
  if (!tableExists(table)) return sendJson(res, 404, { message: `Table "${table}" does not exist` });
  const cols = colNames(table);
  const method = req.method;
  const prefer = (req.headers.prefer || '');
  const returnRep = prefer.includes('return=representation');

  if (method === 'GET') {
    const select = url.searchParams.get('select') || '*';
    const head = url.searchParams.get('head') === 'true';
    const isCount = select === 'count';
    const filters = parseFilters(url);
    const where = buildWhere(filters);
    if (isCount && head) {
      const n = db.prepare(`SELECT COUNT(*) AS c FROM ${sqlIdent(table)} ${where.sql}`).get(...where.params).c;
      sendJson(res, 200, [{ count: n }], { 'Content-Range': `0-0/${n}` });
      return;
    }
    let sql = `SELECT * FROM ${sqlIdent(table)} ${where.sql}`;
    const order = url.searchParams.get('order');
    if (order) {
      const ords = order.split(',').map(o => {
        const [c, dir] = o.trim().split('.');
        return `${sqlIdent(c)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
      });
      sql += ' ORDER BY ' + ords.join(', ');
    }
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');
    const limit = limitRaw !== null && /^\d+$/.test(limitRaw) ? Number(limitRaw) : null;
    const offset = offsetRaw !== null && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : null;
    if (limit !== null) sql += ' LIMIT ' + limit;
    if (offset !== null) sql += ' OFFSET ' + offset;
    let rows = db.prepare(sql).all(...where.params).map(r => fromDb(table, r));
    if (select !== '*') {
      const want = select.split(',').map(s => s.trim()).filter(Boolean);
      rows = rows.map(r => {
        const o = {};
        for (const w of want) if (w in r) o[w] = r[w];
        return o;
      });
    }
    const total = rows.length;
    sendJson(res, 200, rows, { 'Content-Range': `0-${Math.max(0, total - 1)}/${total}` });
    return;
  }

  if (method === 'POST') {
    const body = await readBody(req);
    const onConflict = url.searchParams.get('on_conflict');
    const merge = prefer.includes('resolution=merge-duplicates');
    const ignore = prefer.includes('resolution=ignore-duplicates');
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    const idCol = SCHEMA[table].pk[0];
    for (const item of items) {
      if (onConflict) {
        const conflictCols = onConflict.split(',').map((name) => name.trim()).filter(Boolean);
        if (conflictCols.length && conflictCols.every((name) => cols.includes(name) && item[name] !== undefined)) {
          const where = conflictCols.map((name) => `${sqlIdent(name)} = ?`).join(' AND ');
          const existing = db.prepare(`SELECT * FROM ${sqlIdent(table)} WHERE ${where}`).get(...conflictCols.map((name) => toDb(table, name, item[name])));
          if (existing) {
            if (ignore) { out.push(fromDb(table, existing)); continue; }
            out.push(updateRowById(table, idCol, existing[idCol], item));
            continue;
          }
        }
      }
      out.push(insertRow(table, item));
    }
    if (returnRep || prefer.includes('return=representation')) {
      sendJson(res, 201, out);
    } else {
      sendJson(res, 201, []);
    }
    return;
  }

  if (method === 'PATCH') {
    const body = await readBody(req);
    const filters = parseFilters(url);
    const out = applyPatch(table, filters, body);
    sendJson(res, 200, returnRep ? out : []);
    return;
  }

  if (method === 'DELETE') {
    const filters = parseFilters(url);
    const out = deleteRows(table, filters);
    sendJson(res, 200, returnRep ? out : []);
    return;
  }

  sendJson(res, 405, { message: 'Method Not Allowed' });
}

// ---------- RPC ----------
async function handleRpc(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // rest, v1, rpc, {fn}
  const fn = parts[3];
  if (!fn || !RPCS[fn]) return sendJson(res, 404, { message: `RPC "${fn}" not found` });
  const body = await readBody(req);
  try {
    const result = RPCS[fn](body || {});
    sendJson(res, 200, result);
  } catch (e) {
    console.error(`❌ RPC ${fn} ошибка:`, e);
    sendJson(res, 500, { message: e.message });
  }
}

// ---------- auth routes ----------
async function handleAuth(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // auth, v1, ...
  const route = parts[2] || '';
  if (route === 'signup' && req.method === 'POST') {
    const b = await readBody(req);
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    const username = String(b.data?.username || b.username || '').trim() || email.split('@')[0];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 422, { code: 'invalid_email', message: 'Неверный email' });
    if (password.length < 6) return sendJson(res, 422, { code: 'weak_password', message: 'Пароль должен быть минимум 6 символов' });
    if (getUserByEmail(email)) return sendJson(res, 400, { code: 'user_already_exists', message: 'User already registered' });
    const id = uuid();
    db.prepare(`INSERT INTO auth_users (id, email, password_hash, username, confirmed, created_at) VALUES (?,?,?,?,1,?)`)
      .run(id, email, hashPassword(password), username, nowTs());
    const profile = insertRow('profiles', { id, username, created_at: nowTs(), last_login: nowTs() });
    if (!profile) console.log('⚠ Не удалось создать profile для', id);
    const user = getUserById(id);
    const session = createSession(user);
    return sendJson(res, 200, session);
  }
  if (route === 'token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const b = await readBody(req);
    if (grant === 'refresh_token') {
      const rt = String(b.refresh_token || '');
      const sess = db.prepare(`SELECT * FROM auth_sessions WHERE refresh_token = ?`).get(rt);
      if (!sess || new Date(sess.expires_at) < new Date()) return sendJson(res, 400, { code: 'refresh_token_not_found', message: 'Refresh Token Not Found' });
      const user = getUserById(sess.user_id);
      db.prepare(`DELETE FROM auth_sessions WHERE refresh_token = ?`).run(rt);
      return sendJson(res, 200, createSession(user));
    }
    // password
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    let user = getUserByEmail(email);
    if (!user) user = db.prepare(`SELECT * FROM auth_users WHERE username = ? COLLATE NOCASE`).get(email);
    console.log(`[auth] login attempt: ${JSON.stringify(email)} → ${user ? 'user found (' + user.username + ')' : 'NOT FOUND'}`);
    if (!user || !verifyPassword(password, user.password_hash)) return sendJson(res, 400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
    db.prepare(`UPDATE auth_users SET last_login = ? WHERE id = ?`).run(nowTs(), user.id);
    const session = createSession(user);
    return sendJson(res, 200, session);
  }
  if (route === 'logout' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.refresh_token) db.prepare(`DELETE FROM auth_sessions WHERE refresh_token = ?`).run(String(b.refresh_token));
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }
  if (route === 'user' && req.method === 'GET') {
    const user = bearerUser(req);
    if (!user) return sendJson(res, 400, { code: 'bad_jwt', message: 'invalid JWT' });
    return sendJson(res, 200, userObject(user));
  }
  if (route === 'recover' && req.method === 'POST') {
    const b = await readBody(req);
    console.log(`🔐 Запрос сброса пароля для: ${b.email} (локальный режим: код не отправляется)`);
    return sendJson(res, 200, {});
  }
  if (route === 'settings' || route === 'otp' || route === 'verify') {
    return sendJson(res, 200, {});
  }
  return sendJson(res, 404, { message: 'Not Found' });
}

// ---------- realtime ----------
async function handleRealtime(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // realtime, v1, action
  const action = parts[2] || '';
  if (action === 'events' && req.method === 'GET') {
    let channels = [];
    try { channels = JSON.parse(url.searchParams.get('channels') || '[]'); } catch { channels = []; }
    const since = Number(url.searchParams.get('since') || 0);
    const channelName = url.searchParams.get('channel') || '';
    const out = [];
    for (const ev of changeLog) {
      if (ev.seq <= since) continue;
      for (const ch of channels) {
        if (!ch || !ch.table) continue;
        const eventOk = !ch.event || ch.event === '*' || ch.event === ev.type;
        if (!eventOk || ch.table !== ev.table) continue;
        if (ch.filter) {
          const row = ev.type === 'DELETE' ? ev.old : ev.new;
          if (!matchRealtimeFilter(row, ch.filter)) continue;
        }
        out.push({ seq: ev.seq, payload: { id: ev.seq, schema: 'public', table: ev.table, commit_timestamp: nowIso(), eventType: ev.type, new: ev.new, old: ev.old } });
        break;
      }
    }
    const last_seq = changeLog.length ? changeLog[changeLog.length - 1].seq : since;
    const presence = presenceChannels.get(channelName);
    const state = presence ? Object.fromEntries(presence) : {};
    sendJson(res, 200, { changes: out, last_seq, presence: { version: presenceVersion.get(channelName) || 0, state } });
    return;
  }
  if (action === 'track' && req.method === 'POST') {
    const b = await readBody(req);
    const { channel, userId, payload } = b;
    if (!presenceChannels.has(channel)) presenceChannels.set(channel, new Map());
    presenceChannels.get(channel).set(userId, payload || {});
    bumpPresence(channel);
    sendJson(res, 200, {});
    return;
  }
  if (action === 'untrack' && req.method === 'POST') {
    const b = await readBody(req);
    const { channel, userId } = b;
    if (presenceChannels.has(channel)) presenceChannels.get(channel).delete(userId);
    bumpPresence(channel);
    sendJson(res, 200, {});
    return;
  }
  sendJson(res, 404, { message: 'Not Found' });
}

// ---------- static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.xml': 'application/xml', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf', '.zip': 'application/zip',
};
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + p);
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.wasm' ? 'no-cache' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health' && req.method === 'GET') {
      try {
        const row = db.prepare('SELECT 1 AS ok').get();
        return sendJson(res, row?.ok === 1 ? 200 : 503, { ok: row?.ok === 1, backend: 'local-sqlite', database: DB_FILE, timestamp: nowIso() });
      } catch (e) {
        return sendJson(res, 503, { ok: false, backend: 'local-sqlite', error: e.message });
      }
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, prefer, apikey, x-client-info, x-supabase-api-version',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.startsWith('/rest/v1/rpc/')) { await handleRpc(req, res, url); return; }
      await handleRest(req, res, url); return;
    }
    if (url.pathname.startsWith('/auth/v1/')) { await handleAuth(req, res, url); return; }
    if (url.pathname.startsWith('/realtime/v1/')) { await handleRealtime(req, res, url); return; }
    serveStatic(req, res, url);
  } catch (e) {
    console.error('❌ Ошибка сервера:', e);
    try { sendJson(res, 500, { message: e.message }); } catch {}
  }
});

seedLocalPvpAccounts();
server.listen(PORT, HOST, () => {
  console.log('🟢 CoreBox локальная база запущена');
  console.log(`   Игра:  http://${HOST}:${PORT}/`);
  console.log(`   API:   http://${HOST}:${PORT}/rest/v1/`);
  console.log(`   База:  ${DB_FILE}`);
});
