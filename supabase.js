const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

let _supabaseClient = null;
let _initError = null;
let _serverTimeOffset = 0;

export function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;
    if (_initError) throw _initError;

    try {

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase CDN не загружен. Проверьте интернет.');
        }

        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            },
            global: {
                headers: { 'x-client-info': 'corebox/3.2' }
            }
        });

        window.supabaseClient = _supabaseClient;

        console.log('✅ Supabase клиент инициализирован');
        return _supabaseClient;
    } catch (e) {
        _initError = e;
        console.error('❌ Ошибка инициализации Supabase:', e);
        throw e;
    }
}

export const supabase = new Proxy({}, {
    get(_, prop) {
        try {
            const client = getSupabaseClient();
            const value = client[prop];

            if (value === undefined || value === null) {
                console.warn(`⚠️ supabase.${String(prop)} не существует в клиенте`);
                return undefined;
            }

            if (typeof value === 'function') {
                return value.bind(client);
            }
            return value;
        } catch (e) {
            console.error(`Ошибка доступа к supabase.${String(prop)}:`, e);

            if (['from', 'channel', 'auth', 'rpc', 'storage'].includes(prop)) {
                return (...args) => {
                    console.warn(`⚠️ Supabase недоступен, вызов ${String(prop)} проигнорирован`);
                    return {
                        then: (resolve) => resolve({ data: null, error: { message: 'Supabase unavailable' } }),
                        select: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        insert: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        update: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        upsert: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        eq: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        neq: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        gte: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        lte: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        in: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        order: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        limit: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        maybeSingle: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                        single: () => ({ then: (r) => r({ data: null, error: { message: 'Supabase unavailable' } }) }),
                    };
                };
            }
            return undefined;
        }
    }
});

export async function syncServerTime() {
    try {
        const client = getSupabaseClient();
        const { data, error } = await client.rpc('get_server_time');
        if (error) throw error;
        if (data) {
            const serverTime = new Date(data).getTime();
            _serverTimeOffset = serverTime - Date.now();
            console.log(`🕐 Серверное время синхронизировано: смещение ${_serverTimeOffset}мс`);
            return _serverTimeOffset;
        }
    } catch (e) {
        console.warn('⚠️ Ошибка синхронизации серверного времени:', e.message);
    }
    return 0;
}

export function serverNow() {
    return Date.now() + _serverTimeOffset;
}

export async function getServerTimeISO() {
    try {
        const client = getSupabaseClient();
        const { data, error } = await client.rpc('get_server_time');
        if (error) throw error;
        return data;
    } catch (e) {
        console.warn('⚠️ Ошибка получения серверного времени:', e.message);
        return new Date().toISOString();
    }
}

export async function checkSupabaseConnection() {
    try {
        const client = getSupabaseClient();

        const { data: session } = await client.auth.getSession();
        if (!session?.session) {
            console.warn('⚠️ Нет активной сессии');
            return false;
        }

        const { error } = await client
            .from('game_saves')
            .select('user_id')
            .eq('user_id', session.session.user.id)
            .limit(1);

        if (error) throw error;

        console.log('✅ Supabase соединение работает');
        return true;
    } catch (e) {
        console.warn('⚠️ Supabase недоступен:', e.message);
        return false;
    }
}

export async function diagnoseSupabase() {
    console.log('=== SUPABASE DIAGNOSTICS ===');
    console.log('1. CDN загружен:', !!window.supabase);
    console.log('2. createClient существует:', typeof window.supabase?.createClient);
    console.log('3. Клиент инициализирован:', !!_supabaseClient);
    console.log('4. Ошибка инициализации:', _initError);

    try {
        const client = getSupabaseClient();
        console.log('5. Клиент получен:', !!client);
        console.log('6. client.from существует:', typeof client.from);
        console.log('7. client.auth существует:', typeof client.auth);

        const { data, error } = await client.from('game_saves').select('count', { count: 'exact', head: true });
        console.log('8. Запрос к БД:', error ? `Ошибка: ${error.message}` : `Успех: ${JSON.stringify(data)}`);

        const { data: sessionData } = await client.auth.getSession();
        console.log('9. Сессия:', sessionData.session ? `Пользователь: ${sessionData.session.user.id}` : 'Нет сессии');

        console.log('✅ Supabase полностью работает!');
        return true;
    } catch (e) {
        console.error('❌ Ошибка:', e);
        return false;
    }
}

try {
    const client = getSupabaseClient();
    window.supabaseClient = client;
    console.log('✅ Supabase клиент автоинициализирован при загрузке модуля');

    client.from('game_saves')
        .select('count', { count: 'exact', head: true })
        .then(r => {
            if (r.error) {
                console.error('❌ Ошибка подключения к БД:', r.error);
            } else {
                console.log('✅ Подключение к БД работает');
            }
        });
} catch (e) {
    console.error('❌ Ошибка автоинициализации Supabase:', e);
}