// supabase.js
// Инициализация подключения к Supabase (ИСПРАВЛЕНА - ЛЕНИВАЯ ЗАГРУЗКА + ПОВТОРНЫЕ ПОПЫТКИ)

const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

// Ленивая инициализация — создаём клиент только при первом обращении
let _supabaseClient = null;
let _initAttempts = 0;
let _initPromise = null;
const MAX_INIT_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;
    
    // Если уже идёт инициализация, ждём её
    if (_initPromise) return _initPromise;
    
    _initPromise = (async () => {
        while (_initAttempts < MAX_INIT_ATTEMPTS) {
            try {
                // Проверяем наличие Supabase CDN
                if (!window.supabase || !window.supabase.createClient) {
                    console.warn(`⚠️ Supabase CDN не загружен, попытка ${_initAttempts + 1}/${MAX_INIT_ATTEMPTS}`);
                    
                    // Пытаемся загрузить Supabase CDN динамически, если его нет
                    if (_initAttempts === 0) {
                        await loadSupabaseCDN();
                    }
                    
                    if (!window.supabase || !window.supabase.createClient) {
                        _initAttempts++;
                        if (_initAttempts < MAX_INIT_ATTEMPTS) {
                            await wait(RETRY_DELAY);
                            continue;
                        }
                        throw new Error('Supabase CDN не загружен после нескольких попыток');
                    }
                }
                
                _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                    auth: {
                        autoRefreshToken: true,
                        persistSession: true,
                        detectSessionInUrl: true,
                        storage: localStorage
                    },
                    realtime: {
                        params: {
                            eventsPerSecond: 10
                        }
                    }
                });
                
                console.log("🔌 Supabase клиент инициализирован");
                _initAttempts = 0;
                return _supabaseClient;
                
            } catch (error) {
                console.error(`❌ Ошибка инициализации Supabase (попытка ${_initAttempts + 1}):`, error);
                _initAttempts++;
                
                if (_initAttempts >= MAX_INIT_ATTEMPTS) {
                    throw new Error(`Не удалось инициализировать Supabase: ${error.message}`);
                }
                
                await wait(RETRY_DELAY);
            }
        }
        
        throw new Error('Превышено максимальное количество попыток инициализации Supabase');
    })();
    
    return _initPromise;
}

async function loadSupabaseCDN() {
    return new Promise((resolve, reject) => {
        // Проверяем, загружен ли уже
        if (window.supabase && window.supabase.createClient) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        script.integrity = 'sha384-KyZXEAgN1Q0JqP8kK9oUyHrLk7pX8IcmYyLZqsR5JvDvLzEykQl0yM7nE6gGtI1F';
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            console.log('📦 Supabase CDN загружен');
            resolve();
        };
        script.onerror = () => {
            console.error('❌ Ошибка загрузки Supabase CDN');
            reject(new Error('Не удалось загрузить Supabase CDN'));
        };
        document.head.appendChild(script);
        
        // Таймаут на загрузку
        setTimeout(() => {
            if (!window.supabase || !window.supabase.createClient) {
                reject(new Error('Таймаут загрузки Supabase CDN'));
            }
        }, 10000);
    });
}

// Функция для проверки соединения с Supabase
export async function checkSupabaseConnection() {
    try {
        const client = await getSupabaseClient();
        const { error } = await client.from('game_saves').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log("✅ Supabase соединение установлено");
        return true;
    } catch (error) {
        console.warn("⚠️ Ошибка соединения с Supabase:", error);
        return false;
    }
}

// Функция для переподключения
export async function reconnectSupabase() {
    console.log("🔄 Переподключение к Supabase...");
    _supabaseClient = null;
    _initPromise = null;
    _initAttempts = 0;
    
    try {
        await getSupabaseClient();
        const isConnected = await checkSupabaseConnection();
        if (isConnected) {
            console.log("✅ Переподключение к Supabase успешно");
        }
        return isConnected;
    } catch (error) {
        console.error("❌ Ошибка переподключения:", error);
        return false;
    }
}

// Функция получения клиента с повторной попыткой
async function getSupabaseClientWithRetry(retries = 2) {
    let lastError = null;
    
    for (let i = 0; i <= retries; i++) {
        try {
            return await getSupabaseClient();
        } catch (error) {
            lastError = error;
            if (i < retries) {
                console.log(`🔄 Повторная попытка получения клиента (${i + 1}/${retries})...`);
                await wait(RETRY_DELAY);
            }
        }
    }
    
    throw lastError || new Error('Не удалось получить Supabase клиент');
}

// Прокси для ленивого доступа к методам клиента с поддержкой async/await
export const supabase = new Proxy({}, {
    get(_, prop) {
        // Асинхронные методы должны возвращать Promise
        const handler = async (...args) => {
            try {
                const client = await getSupabaseClientWithRetry();
                const value = client[prop];
                
                if (typeof value === 'function') {
                    return value.apply(client, args);
                }
                return value;
            } catch (error) {
                console.error(`❌ Ошибка вызова supabase.${String(prop)}:`, error);
                
                // Возвращаем заглушку для методов, чтобы не ломать игру
                if (typeof value === 'function') {
                    return async () => ({ data: null, error: error.message });
                }
                return null;
            }
        };
        
        // Синхронные свойства можно возвращать напрямую
        const syncHandler = () => {
            // Для синхронного доступа используем fallback
            return null;
        };
        
        return prop === 'then' ? undefined : handler;
    }
});

// Экспортируем вспомогательные функции
export { getSupabaseClient as getClient, wait as delay };