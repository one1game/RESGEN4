// ======== supabase.js (ИСПРАВЛЕНАЯ ВЕРСИЯ v3.4) ========
// ИСПРАВЛЕНИЯ:
// БАГ SB-01: Proxy fallback возвращает chainable mock-объект

const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

let _supabaseClient = null;
let _initError = null;

// БАГ SB-01: создание chainable mock-объекта для fallback
function createChainableMock() {
    const error = new Error('Supabase недоступен');
    const mock = new Proxy({}, {
        get(_, prop) {
            if (typeof prop === 'string') {
                return () => mock;
            }
            return undefined;
        }
    });
    return mock;
}

function getSupabaseClient() {
    if (_initError) {
        console.warn("Supabase клиент ранее не инициализирован:", _initError);
        throw _initError;
    }
    
    if (!_supabaseClient) {
        if (!window.supabase || !window.supabase.createClient) {
            const err = new Error('Supabase CDN не загружен. Проверьте подключение к интернету.');
            console.error(err.message);
            _initError = err;
            throw err;
        }
        try {
            _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log("🔌 Supabase клиент инициализирован");
        } catch (e) {
            _initError = e;
            console.error("❌ Ошибка инициализации Supabase:", e);
            throw e;
        }
    }
    return _supabaseClient;
}

export async function checkSupabaseConnection() {
    try {
        const client = getSupabaseClient();
        const { error } = await client.from('game_saves').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log("✅ Supabase соединение работает");
        return true;
    } catch (e) {
        console.warn("⚠️ Supabase недоступен:", e.message);
        return false;
    }
}

// БАГ SB-01: Proxy с chainable fallback
export const supabase = new Proxy({}, {
    get(_, prop) {
        try {
            const client = getSupabaseClient();
            const value = client[prop];
            if (typeof value === 'function') {
                return value.bind(client);
            }
            return value;
        } catch (e) {
            console.error(`Ошибка доступа к supabase.${String(prop)}:`, e);
            if (typeof prop === 'string' && ['from', 'channel', 'auth', 'rpc'].includes(prop)) {
                // БАГ SB-01: возвращаем chainable mock вместо Promise.reject
                return () => createChainableMock();
            }
            return undefined;
        }
    }
});