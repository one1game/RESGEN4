// supabase.js
// Инициализация подключения к Supabase (ИСПРАВЛЕНА - ЛЕНИВАЯ ЗАГРУЗКА)

const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

// Ленивая инициализация — создаём клиент только при первом обращении
let _supabaseClient = null;

function getSupabaseClient() {
    if (!_supabaseClient) {
        if (!window.supabase || !window.supabase.createClient) {
            console.error("Supabase CDN не загружен. Проверьте подключение к интернету.");
            throw new Error('Supabase CDN не загружен');
        }
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("🔌 Supabase клиент инициализирован");
    }
    return _supabaseClient;
}

// Прокси для ленивого доступа к методам клиента
export const supabase = new Proxy({}, {
    get(_, prop) {
        const client = getSupabaseClient();
        const value = client[prop];
        if (typeof value === 'function') {
            return value.bind(client);
        }
        return value;
    }
});