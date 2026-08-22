/**
 * CoreBox database adapter contract.
 *
 * Any future backend must implement the same small surface used by the game:
 *   adapter.from(table) -> query builder with select/filters/write/then
 *   adapter.rpc(name, args) -> Promise<{data, error}>
 *   adapter.channel(name) -> realtime channel
 *   adapter.auth -> getUser/getSession/signUp/signInWithPassword/signOut/
 *                   onAuthStateChange/resetPasswordForEmail
 *
 * Install before importing supabase.js:
 *   window.__COREBOX_DATABASE_ADAPTER__ = createDatabaseAdapter({...});
 *
 * The game never needs to know whether the implementation is SQLite, Postgres,
 * IndexedDB, an HTTP API, or another database.
 */

const REQUIRED_AUTH = [
    'getUser', 'getSession', 'signUp', 'signInWithPassword', 'signOut',
    'onAuthStateChange', 'resetPasswordForEmail'
];

export function assertDatabaseAdapter(adapter) {
    if (!adapter || typeof adapter.from !== 'function' || typeof adapter.rpc !== 'function' || typeof adapter.channel !== 'function') {
        throw new TypeError('Invalid CoreBox database adapter: from/rpc/channel are required');
    }
    if (!adapter.auth || REQUIRED_AUTH.some((name) => typeof adapter.auth[name] !== 'function')) {
        throw new TypeError('Invalid CoreBox database adapter: incomplete auth interface');
    }
    return adapter;
}

export function createDatabaseAdapter({ from, rpc, channel, auth, metadata = {} }) {
    const adapter = { from, rpc, channel, auth, metadata: { ...metadata, contractVersion: 1 } };
    return assertDatabaseAdapter(adapter);
}

export function installDatabaseAdapter(adapter) {
    const valid = assertDatabaseAdapter(adapter);
    if (typeof window === 'undefined') throw new Error('Database adapter installation requires a browser window');
    window.__COREBOX_DATABASE_ADAPTER__ = valid;
    return valid;
}
