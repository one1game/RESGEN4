// supabase.js
// Инициализация подключения к Supabase (ИСПРАВЛЕНА - ЛЕНИВАЯ ЗАГРУЗКА + ОБРАБОТКА ОШИБОК)

const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

// Ленивая инициализация — создаём клиент только при первом обращении
let _supabaseClient = null;
let _initError = null;

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

// Функция для проверки доступности Supabase (можно вызывать перед операциями)
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

// Прокси для ленивого доступа к методам клиента
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
            // Возвращаем заглушку для методов, чтобы не падало
            if (typeof prop === 'string' && ['from', 'channel', 'auth', 'rpc'].includes(prop)) {
                return () => {
                    console.warn(`Supabase метод ${prop} вызван, но клиент не инициализирован`);
                    return Promise.reject(new Error('Supabase не доступен'));
                };
            }
            return undefined;
        }
    }
});