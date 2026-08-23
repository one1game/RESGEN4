/* CoreBox DEMO — localStorage database adapter.
   Полная замена серверного бэкенда для статического хостинга (GitHub Pages).
   Автоматический вход демо-пользователя, данные хранятся в localStorage браузера.
   Внедряется как window.__COREBOX_DATABASE_ADAPTER__ до загрузки supabase.js. */
(function () {
  'use strict';

  // ---------- сессия ----------
  var SESSION_KEY = 'corebox_auth_session';
  var DEMO_USER_ID = 'demo-1';
  var DEMO_EMAIL = 'demo@corebox.local';
  var DEMO_USERNAME = 'Пилот';
  var _session = null;
  var _authListeners = [];

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) _session = JSON.parse(raw);
    } catch (e) { _session = null; }
  }
  function saveSession(s) {
    _session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function emitAuth(event, session) {
    for (var i = 0; i < _authListeners.length; i++) {
      try { _authListeners[i](event, session || _session); } catch (e) {}
    }
  }
  function makeUser(email) {
    return {
      id: DEMO_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: email || DEMO_EMAIL,
      email_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_metadata: { username: DEMO_USERNAME },
      app_metadata: { provider: 'local', providers: ['local'] }
    };
  }
  function ensureSession() {
    loadSession();
    if (!_session || !_session.user) {
      var now = Date.now();
      var user = makeUser(DEMO_EMAIL);
      saveSession({
        access_token: 'demo-token-' + Math.random().toString(36).slice(2),
        refresh_token: 'demo-refresh-' + Math.random().toString(36).slice(2),
        expires_at: now + 365 * 24 * 3600 * 1000,
        expires_in: 31536000,
        token_type: 'bearer',
        user: user
      });
    }
  }
  ensureSession();

  // ---------- хранилище таблиц ----------
  function tableKey(t) { return 'corebox_db_' + t; }
  function readRows(t) {
    try {
      var raw = localStorage.getItem(tableKey(t));
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeRows(t, rows) {
    try { localStorage.setItem(tableKey(t), JSON.stringify(rows)); } catch (e) {}
  }
  function genId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ---------- query builder ----------
  function LQB(table) {
    this.table = table;
    this.ops = [];
    this._select = '*';
    this._write = null;
    this._writeOpts = {};
    this._single = null;
  }
  LQB.prototype._push = function (op, args) { this.ops.push([op, args]); return this; };
  LQB.prototype.select = function (cols) { this._select = cols || '*'; return this; };
  LQB.prototype.eq = function (c, v) { return this._push('eq', [c, v]); };
  LQB.prototype.neq = function (c, v) { return this._push('neq', [c, v]); };
  LQB.prototype.gt = function (c, v) { return this._push('gt', [c, v]); };
  LQB.prototype.gte = function (c, v) { return this._push('gte', [c, v]); };
  LQB.prototype.lt = function (c, v) { return this._push('lt', [c, v]); };
  LQB.prototype.lte = function (c, v) { return this._push('lte', [c, v]); };
  LQB.prototype.not = function (c, op, v) { return this._push('not', [c, op, v]); };
  LQB.prototype.in = function (c, v) { return this._push('in', [c, v]); };
  LQB.prototype.or = function (s) { return this._push('or', [s]); };
  LQB.prototype.order = function (c, o) { return this._push('order', [c, o || {}]); };
  LQB.prototype.limit = function (n) { return n === undefined || n === null || n === '' ? this : this._push('limit', [n]); };
  LQB.prototype.offset = function (n) { return n === undefined || n === null || n === '' ? this : this._push('offset', [n]); };
  LQB.prototype.single = function () { this._single = 'single'; return this; };
  LQB.prototype.maybeSingle = function () { this._single = 'maybe'; return this; };
  LQB.prototype.insert = function (body) { this._write = ['insert', body]; return this; };
  LQB.prototype.update = function (body) { this._write = ['update', body]; return this; };
  LQB.prototype.upsert = function (body, opts) { this._write = ['upsert', body]; this._writeOpts = opts || {}; return this; };
  LQB.prototype.delete = function () { this._write = ['delete', null]; return this; };

  function cmp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b) ? 0 : (String(a) < String(b) ? -1 : 1);
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;
    var na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
  }
  function matchOp(row, op, args) {
    var c = args[0], v = args[1];
    switch (op) {
      case 'eq': return String(row[c]) === String(v);
      case 'neq': return String(row[c]) !== String(v);
      case 'gt': return cmp(row[c], v) > 0;
      case 'gte': return cmp(row[c], v) >= 0;
      case 'lt': return cmp(row[c], v) < 0;
      case 'lte': return cmp(row[c], v) <= 0;
      case 'in': return (v || []).some(function (x) { return String(row[c]) === String(x); });
      case 'not':
        if (args[2] === null) return row[c] !== null && row[c] !== undefined;
        return !matchOp(row, args[1], [c, args[2]]);
      case 'or': {
        var parts = String(v).split(',');
        return parts.some(function (p) {
          var m = p.trim().match(/^([a-z_]+)\.(eq|neq|gt|gte|lt|lte)\.(.+)$/i);
          if (!m) return false;
          var val = m[3];
          if (val === 'null') val = null;
          return matchOp(row, m[2].toLowerCase(), [m[1], val]);
        });
      }
    }
    return true;
  }

  function applyFilters(rows, ops) {
    var out = rows.slice();
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i][0];
      if (op === 'order') {
        var c = ops[i][1][0], o = ops[i][1][1] || {};
        out.sort(function (a, b) {
          var r = cmp(a[c], b[c]);
          return o.ascending === false ? -r : r;
        });
      } else if (op === 'limit') {
        out = out.slice(0, Number(ops[i][1][0]));
      } else if (op === 'offset') {
        out = out.slice(Number(ops[i][1][0]));
      }
    }
    for (var j = 0; j < ops.length; j++) {
      var opj = ops[j][0];
      if (opj === 'eq' || opj === 'neq' || opj === 'gt' || opj === 'gte' || opj === 'lt' || opj === 'lte' || opj === 'in' || opj === 'not' || opj === 'or') {
        out = out.filter(function (row) { return matchOp(row, opj, ops[j][1]); });
      }
    }
    return out;
  }

  LQB.prototype._exec = function () {
    var self = this;
    return Promise.resolve().then(function () {
      var rows = readRows(self.table);
      if (self._write) {
        var kind = self._write[0], body = self._write[1];
        var conflictKey = (self._writeOpts.onConflict || 'id').split(',')[0].trim();
        if (kind === 'insert' || kind === 'upsert') {
          var items = Array.isArray(body) ? body : [body];
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var existingIdx = -1;
            if (item[conflictKey] !== undefined && item[conflictKey] !== null) {
              for (var k = 0; k < rows.length; k++) {
                if (String(rows[k][conflictKey]) === String(item[conflictKey])) { existingIdx = k; break; }
              }
            }
            if (kind === 'upsert' && existingIdx >= 0) {
              var merged = {};
              for (var key in rows[existingIdx]) merged[key] = rows[existingIdx][key];
              for (var key2 in item) merged[key2] = item[key2];
              rows[existingIdx] = merged;
            } else if (existingIdx >= 0) {
              var merged2 = {};
              for (var key3 in rows[existingIdx]) merged2[key3] = rows[existingIdx][key3];
              for (var key4 in item) merged2[key4] = item[key4];
              rows[existingIdx] = merged2;
            } else {
              var row = {};
              for (var key5 in item) row[key5] = item[key5];
              if (row.id === undefined || row.id === null) row.id = genId();
              rows.push(row);
            }
          }
          writeRows(self.table, rows);
          rows = readRows(self.table);
        } else if (kind === 'update') {
          var affected = 0;
          for (var u = 0; u < rows.length; u++) {
            if (applyFilters([rows[u]], self.ops).length > 0) {
              for (var uk in body) rows[u][uk] = body[uk];
              affected++;
            }
          }
          writeRows(self.table, rows);
          rows = readRows(self.table);
        } else if (kind === 'delete') {
          rows = rows.filter(function (row) { return applyFilters([row], self.ops).length === 0; });
          writeRows(self.table, rows);
        }
        return okData(rows);
      }
      var result = applyFilters(rows, self.ops);
      if (self._single === 'maybe') {
        if (result.length > 1) return { data: null, error: mkErr('JSON object requested, multiple (or no) rows returned', 406, 'PGRST116') };
        return okData(result[0] || null);
      }
      if (self._single === 'single') {
        if (result.length !== 1) return { data: null, error: mkErr('JSON object requested, multiple (or no) rows returned', 406, 'PGRST116') };
        return okData(result[0]);
      }
      return okData(result);
    });
  };
  LQB.prototype.then = function (res, rej) { return this._exec().then(res, rej); };
  LQB.prototype.catch = function (rej) { return this._exec().catch(rej); };
  LQB.prototype.finally = function (cb) { return this._exec().finally(cb); };

  function mkErr(msg, status, code) {
    return { message: msg, status: status, code: code, details: '', hint: '', name: 'Error' };
  }
  function okData(data) { return { data: data, error: null }; }

  // ---------- rpc (демо-реализации) ----------
  function localRpc(fn, args) {
    switch (fn) {
      case 'get_server_time':
        return okData(new Date().toISOString());
      case 'assign_spiral_position': {
        var key = 'corebox_spiral_' + (args.p_user_id || DEMO_USER_ID);
        var pos = null;
        try { pos = JSON.parse(localStorage.getItem(key)); } catch (e) {}
        if (!pos) {
          var ang = Math.random() * Math.PI * 2;
          var rad = 120 + Math.random() * 600;
          pos = { x: Math.round(Math.cos(ang) * rad), y: Math.round(Math.sin(ang) * rad) };
          try { localStorage.setItem(key, JSON.stringify(pos)); } catch (e) {}
        }
        return okData(pos);
      }
      case 'create_trade_offer':
        return okData({ success: true, id: genId(), message: 'Предложение создано' });
      case 'accept_trade_offer':
        return okData({ success: false, error: 'Демо-режим: другие игроки недоступны' });
      case 'cancel_trade_offer':
        return okData({ success: true });
      case 'steal_from_trades':
        return okData(null);
      case 'get_defense_ship_info':
        return okData({ has_defense_ship: false, defense_level: 0 });
      case 'add_pvp_compensation':
        return okData(null);
      case 'steal_pvp_resources':
        return okData({ ore: 0, chips: 0, plasma: 0 });
      case 'atomic_pvp_steal':
        return okData({ loot: {}, success: true });
      default:
        return okData(null);
    }
  }

  // ---------- channel (noop) ----------
  function makeChannel() {
    var handlers = { sync: [], join: [], leave: [] };
    var changesCb = [];
    var ch = {
      on: function (type, cfg, cb) {
        if (type === 'postgres_changes') changesCb.push(cb);
        return ch;
      },
      subscribe: function (cb) {
        if (cb) setTimeout(function () { cb('SUBSCRIBED'); }, 0);
        return ch;
      },
      track: function () { return Promise.resolve(); },
      untrack: function () { return Promise.resolve(); },
      presenceState: function () { return {}; },
      unsubscribe: function () {}
    };
    return ch;
  }

  // ---------- auth ----------
  var auth = {
    async signUp(opts) {
      ensureSession();
      emitAuth('SIGNED_IN', _session);
      return { data: { user: _session.user, session: _session }, error: null };
    },
    async signInWithPassword(opts) {
      ensureSession();
      emitAuth('SIGNED_IN', _session);
      return { data: { user: _session.user, session: _session }, error: null };
    },
    async signOut() {
      saveSession(null);
      ensureSession();
      emitAuth('SIGNED_OUT', null);
      return { error: null };
    },
    async getUser() {
      ensureSession();
      return { data: { user: _session.user }, error: null };
    },
    async getSession() {
      ensureSession();
      return { data: { session: _session }, error: null };
    },
    onAuthStateChange(cb) {
      if (typeof cb === 'function') _authListeners.push(cb);
      setTimeout(function () { emitAuth('INITIAL_SESSION', _session); }, 0);
      var subscription = {
        unsubscribe: function () {
          var i = _authListeners.indexOf(cb);
          if (i >= 0) _authListeners.splice(i, 1);
        }
      };
      return { data: { subscription: subscription } };
    },
    async resetPasswordForEmail() {
      return { error: null };
    }
  };

  // ---------- экспорт ----------
  window.__COREBOX_DATABASE_ADAPTER__ = {
    from: function (table) { return new LQB(table); },
    rpc: function (fn, args) { return Promise.resolve(localRpc(fn, args || {})); },
    channel: function () { return makeChannel(); },
    auth: auth
  };
})();
