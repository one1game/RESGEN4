// CoreBox — клиент локальной базы (эмуляция Supabase API).
// Работает только через local-db-server.js (SQLite). Внешняя Supabase отключена.
// Управление: window.__COREBOX_API__ = URL локального сервера (по умолчанию http://127.0.0.1:8787).

function isLocalApiUrl(value) {
    try {
        const url = new URL(value);
        return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.protocol === 'http:' || url.protocol === 'https:');
    } catch { return false; }
}

function detectApiBase() {
    if (typeof window !== 'undefined' && isLocalApiUrl(window.__COREBOX_API__)) return window.__COREBOX_API__;
    try {
        if (typeof location !== 'undefined' && isLocalApiUrl(location.origin)) return location.origin;
    } catch (e) {}
    return 'http://127.0.0.1:8787';
}
const API_BASE = detectApiBase();
const LOCAL = true;
const SESSION_KEY = 'corebox_auth_session';

// ---------- низкоуровневый fetch ----------
async function apiFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (LOCAL) headers['apikey'] = 'corebox-local';
    if (_session?.access_token && !headers.Authorization) headers.Authorization = `Bearer ${_session.access_token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 204) return { data: null, headers: res.headers };
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
        const msg = json?.message || json?.error_description || json?.msg || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.code = json?.code || 'error';
        err.details = json?.details || '';
        throw err;
    }
    return { data: json, headers: res.headers };
}

// ---------- ошибка в стиле supabase ----------
function mkError(e) {
    return { message: e?.message || String(e), status: e?.status || 400, code: e?.code || 'error', details: e?.details || '', hint: '', name: 'Error' };
}
function okData(data, count) { return { data, error: null, ...(count !== undefined ? { count } : {}) }; }

// ---------- сессия ----------
let _session = null;
const _authListeners = [];
let _initialEmitted = false;

function loadSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) _session = JSON.parse(raw);
    } catch (e) { _session = null; }
}
function saveSession(s) {
    _session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
function emitAuth(event, session) {
    for (const cb of _authListeners) {
        try { cb(event, session || _session); } catch (e) { console.warn('auth listener error:', e); }
    }
}

async function refreshIfNeeded() {
    if (!_session || !_session.refresh_token) return;
    const exp = _session.expires_at || 0;
    if (exp > Date.now() + 60 * 1000) return;
    try {
        const { data } = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: _session.refresh_token }),
        });
        const session = normalizeSession(data);
        saveSession(session);
        emitAuth('TOKEN_REFRESHED', session);
    } catch (e) {
        saveSession(null);
        emitAuth('SIGNED_OUT', null);
    }
}

function normalizeSession(data) {
    if (!data || !data.access_token) return null;
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: (data.expires_at || Date.now() + (data.expires_in || 3600) * 1000),
        expires_in: data.expires_in || 3600,
        token_type: data.token_type || 'bearer',
        user: data.user || null,
    };
}

// ---------- query builder ----------
class QueryBuilder {
    constructor(table, backend) {
        this.table = table;
        this.backend = backend;
        this.ops = [];
        this._write = null;
        this._writeOpts = {};
        this._single = null;
    }
    _push(op, args) { this.ops.push([op, args]); return this; }
    select(cols, opts) { this._select = cols || '*'; this._selectOpts = opts || {}; return this; }
    eq(c, v) { return this._push('eq', [c, v]); }
    neq(c, v) { return this._push('neq', [c, v]); }
    not(c, op, v) { return this._push('not', [c, op, v]); }
    gt(c, v) { return this._push('gt', [c, v]); }
    gte(c, v) { return this._push('gte', [c, v]); }
    lt(c, v) { return this._push('lt', [c, v]); }
    lte(c, v) { return this._push('lte', [c, v]); }
    in(c, v) { return this._push('in', [c, v]); }
    or(s) { return this._push('or', [s]); }
    order(c, o) { return this._push('order', [c, o || {}]); }
    limit(n) { return this._push('limit', [n]); }
    offset(n) { return this._push('offset', [n]); }
    single() { this._single = 'single'; return this; }
    maybeSingle() { this._single = 'maybe'; return this; }
    insert(body) { this._write = ['insert', body]; return this; }
    update(body) { this._write = ['update', body]; return this; }
    upsert(body, opts) { this._write = ['upsert', body]; this._writeOpts = opts || {}; return this; }
    delete() { this._write = ['delete', null]; return this; }

    then(resolve, reject) { return this._exec().then(resolve, reject); }
    catch(reject) { return this._exec().catch(reject); }
    finally(cb) { return this._exec().finally(cb); }

    async _exec() {
        try {
            if (this.backend.mode === 'cloud' && typeof window !== 'undefined' && window.supabase) {
                return await this._execCloud();
            }
            return await this._execLocal();
        } catch (e) {
            return { data: null, error: mkError(e) };
        }
    }

    async _execLocal() {
        if (this._write) {
            return this._writeLocal();
        }
        const params = new URLSearchParams();
        params.set('select', this._select || '*');
        if (this._selectOpts?.head) params.set('head', 'true');
        const prefer = [];
        if (this._selectOpts?.count === 'exact') prefer.push('count=exact');
        const filters = [];
        for (const [op, args] of this.ops) {
            const [c, v] = args;
            switch (op) {
                case 'eq': filters.push(`${c}=eq.${String(v)}`); break;
                case 'neq': filters.push(`${c}=neq.${String(v)}`); break;
                case 'not': filters.push(`${c}=not.${String(args[1])}.${args[2] === null ? 'null' : String(args[2])}`); break;
                case 'gt': filters.push(`${c}=gt.${String(v)}`); break;
                case 'gte': filters.push(`${c}=gte.${String(v)}`); break;
                case 'lt': filters.push(`${c}=lt.${String(v)}`); break;
                case 'lte': filters.push(`${c}=lte.${String(v)}`); break;
                case 'in': filters.push(`${c}=in.(${(v || []).map(x => String(x)).join(',')})`); break;
                case 'or': filters.push(`or=(${String(v)})`); break;
                case 'order': {
                    const dir = v.ascending === false ? 'desc' : 'asc';
                    params.set('order', (params.get('order') ? params.get('order') + ',' : '') + `${c}.${dir}`);
                    break;
                }
                case 'limit': params.set('limit', String(v)); break;
                case 'offset': params.set('offset', String(v)); break;
            }
        }
        for (const f of filters) {
            const [k, val] = f.split('=');
            params.append(k, val);
        }
        const qs = params.toString();
        const headers = {};
        if (prefer.length) headers['Prefer'] = prefer.join(',');
        const { data, headers: hdrs } = await apiFetch(`/rest/v1/${this.table}?${qs}`, { headers });
        let count;
        const cr = hdrs.get?.('content-range') || hdrs.get?.('Content-Range');
        if (cr) { const m = cr.match(/\/(\d+)$/); if (m) count = Number(m[1]); }
        let rows = data || [];
        if (this._single === 'maybe') {
            if (rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: '', hint: '', status: 406, name: 'Error' } };
            rows = rows[0] || null;
        } else if (this._single === 'single') {
            if (rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: '', hint: '', status: 406, name: 'Error' } };
            rows = rows[0];
        }
        return okData(rows, count);
    }

    async _writeLocal() {
        const [kind, body] = this._write;
        const filters = [];
        const params = new URLSearchParams();
        for (const [op, args] of this.ops) {
            const [c, v] = args;
            switch (op) {
                case 'eq': filters.push(`${c}=eq.${String(v)}`); break;
                case 'neq': filters.push(`${c}=neq.${String(v)}`); break;
                case 'not': filters.push(`${c}=not.${String(args[1])}.${args[2] === null ? 'null' : String(args[2])}`); break;
                case 'gt': filters.push(`${c}=gt.${String(v)}`); break;
                case 'gte': filters.push(`${c}=gte.${String(v)}`); break;
                case 'lt': filters.push(`${c}=lt.${String(v)}`); break;
                case 'lte': filters.push(`${c}=lte.${String(v)}`); break;
                case 'in': filters.push(`${c}=in.(${(v || []).map(x => String(x)).join(',')})`); break;
                case 'or': filters.push(`or=(${String(v)})`); break;
            }
        }
        const prefer = ['return=representation'];
        let method, path = `/rest/v1/${this.table}`;
        if (kind === 'insert' || kind === 'upsert') {
            method = 'POST';
            if (kind === 'upsert' && this._writeOpts.onConflict) {
                path += `?on_conflict=${encodeURIComponent(this._writeOpts.onConflict)}`;
                prefer.push('resolution=merge-duplicates');
            }
        } else if (kind === 'update') {
            method = 'PATCH';
            const qs = filters.map(f => { const [k, val] = f.split('='); return `${k}=${encodeURIComponent(val)}`; }).join('&');
            if (qs) path += `?${qs}`;
        } else {
            method = 'DELETE';
            const qs = filters.map(f => { const [k, val] = f.split('='); return `${k}=${encodeURIComponent(val)}`; }).join('&');
            if (qs) path += `?${qs}`;
        }
        const { data } = await apiFetch(path, { method, headers: { Prefer: prefer.join(',') }, body: kind === 'delete' ? undefined : JSON.stringify(body) });
        return okData(data || []);
    }

    async _execCloud() {
        throw new Error('Внешняя Supabase отключена: используется только локальный SQLite backend');
    }
}

// ---------- backend ----------
const backend = {
    mode: 'local',
    tryCloud() { return false; },
};

// ---------- auth ----------
const auth = {
    async signUp({ email, password, options }) {
        try {
            const { data } = await apiFetch('/auth/v1/signup', {
                method: 'POST',
                body: JSON.stringify({ email, password, data: options?.data || {} }),
            });
            const session = normalizeSession(data);
            saveSession(session);
            emitAuth('SIGNED_IN', session);
            return { data: { user: session?.user || null, session }, error: null };
        } catch (e) {
            return { data: { user: null, session: null }, error: mkError(e) };
        }
    },
    async signInWithPassword({ email, password }) {
        try {
            const { data } = await apiFetch('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
            });
            const session = normalizeSession(data);
            saveSession(session);
            emitAuth('SIGNED_IN', session);
            return { data: { user: session?.user || null, session }, error: null };
        } catch (e) {
            return { data: { user: null, session: null }, error: mkError(e) };
        }
    },
    async signOut() {
        try {
            await apiFetch('/auth/v1/logout', {
                method: 'POST',
                body: JSON.stringify({ refresh_token: _session?.refresh_token || '' }),
            });
        } catch (e) { /* не критично */ }
        saveSession(null);
        emitAuth('SIGNED_OUT', null);
        return { error: null };
    },
    async getUser() {
        return { data: { user: _session?.user || null }, error: null };
    },
    async getSession() {
        return { data: { session: _session ? { ..._session } : null }, error: null };
    },
    onAuthStateChange(cb) {
        if (typeof cb === 'function') _authListeners.push(cb);
        if (!_initialEmitted) {
            _initialEmitted = true;
            setTimeout(() => emitAuth('INITIAL_SESSION', _session), 0);
        }
        const subscription = { unsubscribe() { const i = _authListeners.indexOf(cb); if (i >= 0) _authListeners.splice(i, 1); } };
        return { data: { subscription } };
    },
    async resetPasswordForEmail(email) {
        try {
            await apiFetch('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email }) });
            return { error: null };
        } catch (e) {
            return { error: mkError(e) };
        }
    },
};

// ---------- realtime (channel) ----------
function makeChannel(name) {
    const configs = []; // postgres_changes конфиги
    const presenceHandlers = { sync: [], join: [], leave: [] };
    let changesCb = [];
    let timer = null;
    let subscribed = false;
    let lastSeq = 0;
    let presenceStateLocal = {};
    let lastVersion = -1;
    const userId = () => _session?.user?.id || '';

    const channel = {
        on(type, cfg, cb) {
            if (type === 'postgres_changes') {
                configs.push(cfg || {});
                changesCb.push(cb);
            } else if (type === 'presence') {
                const ev = cfg?.event;
                if (ev && presenceHandlers[ev]) presenceHandlers[ev].push(cb);
            }
            return channel;
        },
        subscribe(cb) {
            if (subscribed) { if (cb) cb('SUBSCRIBED'); return channel; }
            subscribed = true;
            lastSeq = 0;
            if (cb) setTimeout(() => cb('SUBSCRIBED'), 0);
            const poll = async () => {
                if (!subscribed) return;
                try {
                    const qs = new URLSearchParams({
                        channels: JSON.stringify(configs.map(c => ({ table: c.table, event: c.event, filter: c.filter }))),
                        since: String(lastSeq),
                        channel: name,
                        userId: userId(),
                    });
                    const { data } = await apiFetch(`/realtime/v1/events?${qs.toString()}`);
                    if (data) {
                        for (const ev of data.changes || []) {
                            lastSeq = Math.max(lastSeq, ev.seq);
                            for (const cb of changesCb) {
                                try { cb(ev.payload); } catch (e) { console.warn('realtime cb error:', e); }
                            }
                        }
                        const pr = data.presence || { version: 0, state: {} };
                        if (pr.version !== lastVersion) {
                            const prevKeys = Object.keys(presenceStateLocal);
                            const nextKeys = Object.keys(pr.state || {});
                            const oldState = presenceStateLocal;
                            const newState = pr.state || {};
                            presenceStateLocal = newState;
                            lastVersion = pr.version;
                            for (const h of presenceHandlers.sync) { try { h({ key: name, newPresences: newState, currentPresences: newState }) } catch (e) {} }
                            for (const k of nextKeys) {
                                if (!prevKeys.includes(k)) {
                                    for (const h of presenceHandlers.join) { try { h({ key: k, newPresence: newState[k], currentPresences: newState }) } catch (e) {} }
                                }
                            }
                            for (const k of prevKeys) {
                                if (!nextKeys.includes(k)) {
                                    for (const h of presenceHandlers.leave) { try { h({ key: k, leftPresence: oldState[k], currentPresences: newState }) } catch (e) {} }
                                }
                            }
                        }
                    }
                } catch (e) { /* сервер недоступен — молчим */ }
            };
            poll();
            timer = setInterval(poll, 1500);
            return channel;
        },
        async track(payload) {
            try { await apiFetch('/realtime/v1/track', { method: 'POST', body: JSON.stringify({ channel: name, userId: userId(), payload: payload || {} }) }); } catch (e) {}
        },
        async untrack() {
            try { await apiFetch('/realtime/v1/untrack', { method: 'POST', body: JSON.stringify({ channel: name, userId: userId() }) }); } catch (e) {}
        },
        presenceState() {
            const out = {};
            for (const [k, v] of Object.entries(presenceStateLocal)) out[k] = [v];
            return out;
        },
        unsubscribe() {
            subscribed = false;
            if (timer) clearInterval(timer);
            channel.untrack();
        },
    };
    return channel;
}

// ---------- клиент ----------
function createClient() {
    return {
        from(table) { return new QueryBuilder(table, backend); },
        async rpc(fn, args) {
            try {
                const { data } = await apiFetch(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });
                return okData(data);
            } catch (e) {
                return { data: null, error: mkError(e) };
            }
        },
        channel(name) { return makeChannel(name); },
        auth,
    };
}

// ---------- экспорт через сменный adapter ----------
function getInjectedAdapter() {
    const candidate = typeof window !== 'undefined' ? window.__COREBOX_DATABASE_ADAPTER__ : null;
    if (!candidate) return null;
    const authMethods = ['getUser', 'getSession', 'signUp', 'signInWithPassword', 'signOut', 'onAuthStateChange', 'resetPasswordForEmail'];
    const valid = typeof candidate.from === 'function' && typeof candidate.rpc === 'function' && typeof candidate.channel === 'function' && candidate.auth && authMethods.every((name) => typeof candidate.auth[name] === 'function');
    if (!valid) throw new TypeError('Invalid __COREBOX_DATABASE_ADAPTER__');
    return candidate;
}

export const supabase = getInjectedAdapter() || createClient();

export function getSupabaseClient() { return supabase; }

export async function syncServerTime() {
    try {
        const { data, error } = await supabase.rpc('get_server_time');
        if (!error && data) {
            window._serverTimeOffset = Date.now() - new Date(data).getTime();
            return true;
        }
    } catch (e) {}
    return false;
}

export function serverNow() {
    const off = window._serverTimeOffset || 0;
    return new Date(Date.now() - off);
}

export function getServerTimeISO() {
    return serverNow().toISOString();
}

export async function checkSupabaseConnection() {
    try {
        const res = await fetch(`${API_BASE}/rest/v1/game_saves?select=id&limit=1`);
        return res.ok;
    } catch (e) { return false; }
}

export async function diagnoseSupabase() {
    try {
        const ok = await checkSupabaseConnection();
        return { connected: ok, mode: LOCAL ? 'local' : 'cloud', apiBase: API_BASE };
    } catch (e) {
        return { connected: false, mode: LOCAL ? 'local' : 'cloud', apiBase: API_BASE, error: e.message };
    }
}

// ---------- init ----------
if (typeof window !== 'undefined') {
    loadSession();
    refreshIfNeeded();
    if (LOCAL) syncServerTime();
}
