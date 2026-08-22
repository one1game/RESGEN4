// Локальная SQLite-схема CoreBox — зеркало таблиц текущей игры в Supabase.
// Типы: text, int, real, ts (ISO-строка), json (хранится как TEXT), bool (0/1), epoch (bigint-секунды).
import crypto from 'node:crypto';

const T = {
  text: (def) => ({ t: 'TEXT', k: 'text', def }),
  int: (def) => ({ t: 'INTEGER', k: 'int', def }),
  real: (def) => ({ t: 'REAL', k: 'real', def }),
  ts: (def) => ({ t: 'TEXT', k: 'ts', def }),
  json: (def) => ({ t: 'TEXT', k: 'json', def }),
  bool: (def) => ({ t: 'INTEGER', k: 'bool', def }),
  epoch: (def) => ({ t: 'INTEGER', k: 'epoch', def }),
};

// Таблицы игры. col: [name, type, default?]
export const SCHEMA = {
  profiles: {
    pk: ['id'],
    uniq: [['username']],
    cols: [
      ['id', T.text(), 'uuid'],
      ['username', T.text()],
      ['created_at', T.ts(), 'now'],
      ['last_login', T.ts(), 'now'],
      ['zone', T.text('pve')],
      ['map_x', T.real(50)],
      ['map_y', T.real(50)],
      ['pvp_kills', T.int(0)],
      ['pvp_shield_until', T.ts()],
      ['spiral_index', T.int()],
    ],
  },
  game_saves: {
    pk: ['id'],
    uniq: [['user_id']],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['coal', T.int(0)],
      ['trash', T.int(0)],
      ['ore', T.int(0)],
      ['chips', T.int(0)],
      ['plasma', T.int(0)],
      ['total_mined', T.int(0)],
      ['nights_survived', T.int(0)],
      ['neuro_evolution', T.int(0)],
      ['neuro_score', T.int(0)],
      ['rebel_attacks', T.int(0)],
      ['mining_level', T.int(0)],
      ['defense_level', T.int(0)],
      ['defense_active', T.bool(false)],
      ['coal_enabled', T.bool(false)],
      ['ore_unlocked', T.bool(false)],
      ['completed_quests', T.json()],
      ['full_state', T.json()],
      ['game_time', T.real(0)],
      ['is_day', T.bool(true)],
      ['updated_at', T.ts(), 'now'],
      ['computational_power', T.int(0)],
      ['map_x', T.real(50)],
      ['map_y', T.real(50)],
      ['last_seen', T.ts(), 'now'],
      ['last_ai_coal_threshold', T.int(0)],
      ['blueprint_cargo_unlocked', T.bool(false)],
      ['blueprint_scout_unlocked', T.bool(false)],
      ['blueprint_combat_unlocked', T.bool(false)],
      ['power_tier', T.int(0)],
      ['prestige_level', T.int(0)],
      ['turbine_upgrade_level', T.int(0)],
      ['crit_level', T.int(0)],
      ['cooling_level', T.int(0)],
      ['time_changed', T.bool(false)],
      ['trade_blocked', T.bool(false)],
      ['current_night_type', T.text('')],
      ['max_computational_power', T.int(1000)],
      ['thermal_overload', T.real(0)],
      ['quantum_engrams', T.int(0)],
      ['singularity_count', T.int(0)],
      ['ram_used', T.int(0)],
      ['ram_total', T.int(1000)],
      ['enemy_nodes_count', T.int(0)],
      ['current_season', T.text('normal')],
    ],
  },
  corebox_leaderboard: {
    pk: ['id'],
    uniq: [['user_id']],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['username', T.text('Игрок')],
      ['total_mined', T.int(0)],
      ['neuro_score', T.int(0)],
      ['nights', T.int(0)],
      ['updated_at', T.ts(), 'now'],
    ],
  },
  missions: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['attacker_id', T.text()],
      ['target_id', T.text()],
      ['ship_type', T.text()],
      ['status', T.text('flying')],
      ['fleet_ship_id', T.text()],
      ['arrives_at', T.ts()],
      ['returns_at', T.ts()],
      ['scout_data', T.json()],
      ['loot', T.json()],
      ['launched_at', T.ts(), 'now'],
      ['created_at', T.ts(), 'now'],
      ['combat_mission_id', T.text()],
    ],
  },
  notifications: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['player_id', T.text()],
      ['type', T.text()],
      ['message', T.text()],
      ['payload', T.json()],
      ['is_read', T.bool(false)],
      ['created_at', T.ts(), 'now'],
    ],
  },
  battle_log: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['attacker_id', T.text()],
      ['defender_id', T.text()],
      ['ship_type', T.text()],
      ['outcome', T.text()],
      ['resources_stolen', T.json()],
      ['happened_at', T.ts(), 'now'],
    ],
  },
  fleet_released: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['ship_id', T.text()],
      ['mission_id', T.text()],
      ['ship_type', T.text()],
      ['loot', T.json({})],
      ['released_at', T.ts(), 'now'],
      ['applied', T.bool(false)],
    ],
  },
  planets: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['name', T.text()],
      ['type', T.text()],
      ['x', T.real()],
      ['y', T.real()],
      ['discovered_by', T.text()],
      ['discovered_at', T.ts(), 'now'],
      ['resources', T.json({ ore: 0, coal: 0, plasma: 0 })],
      ['resources_remaining', T.json({ ore: 0, coal: 0, plasma: 0 })],
    ],
  },
  planet_missions: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['planet_id', T.text()],
      ['user_id', T.text()],
      ['ship_type', T.text()],
      ['cargo_capacity', T.int(100)],
      ['departs_at', T.ts(), 'now'],
      ['arrives_at', T.ts()],
      ['returns_at', T.ts()],
      ['status', T.text('flying')],
      ['loot', T.json({})],
      ['completed_at', T.ts()],
      ['fleet_ship_id', T.text('')],
      ['ship_name', T.text('')],
      ['created_at', T.ts(), 'now'],
      ['updated_at', T.ts(), 'now'],
      ['coal_taken', T.int(0)],
      ['plasma_taken', T.int(0)],
      ['ore_taken', T.int(0)],
    ],
  },
  pvp_missions: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['attacker_id', T.text()],
      ['defender_id', T.text()],
      ['ship_type', T.text()],
      ['ship_level', T.int(0)],
      ['fleet_ship_id', T.text()],
      ['status', T.text('flying')],
      ['phase', T.text('scout')],
      ['scout_result', T.json()],
      ['combat_result', T.json()],
      ['loot_result', T.json()],
      ['departs_at', T.ts(), 'now'],
      ['arrives_at', T.ts()],
      ['returns_at', T.ts()],
      ['created_at', T.ts(), 'now'],
    ],
  },
  pvp_combat_log: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['player_id', T.text()],
      ['log_type', T.text()],
      ['message', T.text()],
      ['details', T.json()],
      ['seen', T.bool(false)],
      ['created_at', T.ts(), 'now'],
    ],
  },
  player_reputation: {
    pk: ['id'],
    uniq: [['user_id', 'target_id']],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['target_id', T.text()],
      ['score', T.int(0)],
      ['updated_at', T.ts(), 'now'],
      ['created_at', T.ts(), 'now'],
    ],
  },
  fleet_status: {
    pk: ['user_id'],
    cols: [
      ['user_id', T.text()],
      ['has_defense_ship', T.bool(false)],
      ['defense_ship_level', T.int(0)],
      ['defense_ship_name', T.text()],
      ['updated_at', T.ts(), 'now'],
    ],
  },
  pvp_pending_rewards: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['ore', T.int(0)],
      ['chips', T.int(0)],
      ['plasma', T.int(0)],
      ['claimed', T.bool(false)],
      ['created_at', T.ts(), 'now'],
    ],
  },
  map_zones: {
    pk: ['id'],
    cols: [
      ['id', T.text()],
      ['label', T.text()],
      ['x_pct', T.real()],
      ['width_pct', T.real()],
      ['color', T.text()],
      ['allow_pvp', T.bool(false)],
      ['resource_bonus', T.real(0)],
      ['description', T.text()],
    ],
  },
  player_public_stats: {
    pk: ['user_id'],
    cols: [
      ['user_id', T.text()],
      ['username', T.text('Игрок')],
      ['map_x', T.int(500)],
      ['map_y', T.int(500)],
      ['total_mined', T.int(0)],
      ['neuro_evolution', T.int(0)],
      ['nights_survived', T.int(0)],
      ['computational_power', T.int(0)],
      ['defense_active', T.bool(false)],
      ['defense_level', T.int(0)],
      ['inventory_ore', T.int(0)],
      ['inventory_coal', T.int(0)],
      ['inventory_chips', T.int(0)],
      ['inventory_plasma', T.int(0)],
      ['inventory_trash', T.int(0)],
      ['last_seen', T.ts(), 'now'],
      ['updated_at', T.ts(), 'now'],
      ['ore', T.int(0)],
      ['coal', T.int(0)],
      ['chips', T.int(0)],
      ['plasma', T.int(0)],
      ['trash', T.int(0)],
      ['has_defense_ship', T.bool(false)],
      ['defense_ship_level', T.int(0)],
    ],
  },
  space_nodes: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['user_id', T.text()],
      ['faction', T.text()],
      ['x', T.real()],
      ['y', T.real()],
      ['hp', T.int(500)],
      ['max_hp', T.int(500)],
      ['income_penalty', T.real(0.1)],
      ['captured_at', T.epoch('epoch')],
      ['destroyed_at', T.epoch()],
      ['destroyed_by_fleet', T.text()],
      ['created_at', T.ts(), 'now'],
    ],
  },
  prestige_data: {
    pk: ['user_id'],
    cols: [
      ['user_id', T.text()],
      ['quantum_engrams', T.int(0)],
      ['singularity_count', T.int(0)],
      ['dark_matter_unlocked', T.bool(false)],
      ['chrono_accelerator_mult', T.real(1.0)],
      ['rebel_diplomacy', T.real(0.0)],
      ['start_crit_bonus', T.real(0.0)],
      ['start_cooling_bonus', T.real(0.0)],
      ['last_singularity_at', T.ts()],
      ['total_engrams_earned', T.int(0)],
      ['updated_at', T.ts(), 'now'],
    ],
  },
  ai_modules_state: {
    pk: ['user_id', 'module_name'],
    cols: [
      ['user_id', T.text()],
      ['module_name', T.text()],
      ['ram_cost', T.int()],
      ['activated_at', T.epoch('epoch')],
    ],
  },
  trade_offers: {
    pk: ['id'],
    cols: [
      ['id', T.text(), 'uuid'],
      ['seller_id', T.text()],
      ['give_resource', T.text()],
      ['give_amount', T.int()],
      ['want_resource', T.text()],
      ['want_amount', T.int()],
      ['status', T.text('active')],
      ['created_at', T.ts(), 'now'],
      ['updated_at', T.ts(), 'now'],
    ],
  },
};

// Локальные служебные таблицы (auth).
export const AUTH_SCHEMA = {
  auth_users: {
    pk: ['id'],
    uniq: [['email']],
    cols: [
      ['id', T.text(), 'uuid'],
      ['email', T.text()],
      ['password_hash', T.text()],
      ['username', T.text()],
      ['confirmed', T.bool(true)],
      ['created_at', T.ts(), 'now'],
      ['last_login', T.ts()],
    ],
  },
  auth_sessions: {
    pk: ['refresh_token'],
    cols: [
      ['refresh_token', T.text()],
      ['user_id', T.text()],
      ['created_at', T.ts(), 'now'],
      ['expires_at', T.ts()],
    ],
  },
};

// JSON-колонки (объекты/массивы, сериализуются в TEXT).
const JSON_COLS = {};
// Bool-колонки (хранятся 0/1, наружу отдаются true/false).
const BOOL_COLS = {};

function collect() {
  for (const [table, def] of Object.entries(SCHEMA)) {
    JSON_COLS[table] = [];
    BOOL_COLS[table] = new Set();
    for (const [name, type] of def.cols) {
      if (type.k === 'json') JSON_COLS[table].push(name);
      if (type.k === 'bool') BOOL_COLS[table].add(name);
    }
  }
}
collect();

export function getJsonCols(table) { return JSON_COLS[table] || []; }
export function getBoolCols(table) { return BOOL_COLS[table] || new Set(); }

function defaultFor(type, def) {
  if (def === undefined) return null;
  if (def === 'uuid') return crypto.randomUUID();
  if (def === 'now') return new Date().toISOString();
  if (def === 'epoch') return String(Math.floor(Date.now() / 1000));
  if (typeof def === 'object') return JSON.stringify(def);
  return def;
}

// Преобразование значения из JS → SQLite-совместимое.
export function toDb(table, col, value) {
  if (value === undefined || value === null) return null;
  const isJson = (JSON_COLS[table] || []).includes(col);
  if (isJson) {
    return (typeof value === 'string') ? value : JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 1 : 0; // node:sqlite не биндит булеаны
  return value;
}

// Преобразование строки из SQLite → JS.
export function fromDb(table, row) {
  if (!row) return row;
  const out = {};
  const bools = BOOL_COLS[table] || new Set();
  const jsons = JSON_COLS[table] || [];
  for (const [k, v] of Object.entries(row)) {
    let val = v;
    if (val !== null && bools.has(k)) val = val === 1 || val === true;
    else if (val !== null && jsons.includes(k)) {
      if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
        try { val = JSON.parse(val); } catch { /* оставить строкой */ }
      }
    }
    out[k] = val;
  }
  return out;
}

// Генерация CREATE TABLE + подготовка умолчаний.
export function createSchema(db) {
  for (const [table, def] of Object.entries(SCHEMA)) {
    const pkCols = def.pk || [];
    const composite = pkCols.length > 1;
    const parts = def.cols.map(([name, type]) => {
      let sql = `"${name}" ${type.t}`;
      const isPk = pkCols.length === 1 && pkCols[0] === name;
      if (isPk) sql += ' PRIMARY KEY';
      if (!isPk && type.t !== 'TEXT') sql += ' DEFAULT ' + sqlDefault(type);
      return sql;
    });
    if (composite) parts.push(`PRIMARY KEY (${pkCols.map(sqlIdent).join(', ')})`);
    for (const uniq of def.uniq || []) {
      if (uniq.length === 1 && !pkCols.includes(uniq[0])) {
        parts.push(`UNIQUE("${uniq[0]}")`);
      } else if (uniq.length > 1) {
        parts.push(`UNIQUE(${uniq.map(sqlIdent).join(', ')})`);
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${parts.join(', ')})`);
  }
  for (const [table, def] of Object.entries(AUTH_SCHEMA)) {
    const pkCols = def.pk || [];
    const composite = pkCols.length > 1;
    const parts = def.cols.map(([name, type]) => {
      let sql = `"${name}" ${type.t}`;
      const isPk = pkCols.length === 1 && pkCols[0] === name;
      if (isPk) sql += ' PRIMARY KEY';
      if (!isPk && type.t !== 'TEXT') sql += ' DEFAULT ' + sqlDefault(type);
      return sql;
    });
    if (composite) parts.push(`PRIMARY KEY (${pkCols.map(sqlIdent).join(', ')})`);
    for (const uniq of def.uniq || []) {
      if (uniq.length === 1 && !pkCols.includes(uniq[0])) {
        parts.push(`UNIQUE("${uniq[0]}")`);
      } else if (uniq.length > 1) {
        parts.push(`UNIQUE(${uniq.map(sqlIdent).join(', ')})`);
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${parts.join(', ')})`);
  }
}

function sqlIdent(name) { return `"${name}"`; }

function sqlDefault(type) {
  if (type.t === 'INTEGER') return '0';
  if (type.t === 'REAL') return '0.0';
  return "''";
}

// Умолчания для INSERT (когда колонка не передана).
export function defaultsForInsert(table) {
  const def = SCHEMA[table];
  if (!def) return {};
  const out = {};
  for (const [name, type, d] of def.cols) {
    if (d !== undefined) out[name] = defaultFor(type, d);
  }
  return out;
}

export function uuid() { return crypto.randomUUID(); }
export function nowIso() { return new Date().toISOString(); }
export function epochSec() { return String(Math.floor(Date.now() / 1000)); }
