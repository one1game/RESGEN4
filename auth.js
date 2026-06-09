// ======== auth.js (ИСПРАВЛЕНАЯ ВЕРСИЯ v3.5) ========
// ИСПРАВЛЕНИЯ:
// БАГ A-01: initAuth — хранение cleanup-функции и предотвращение дублирования подписок
// БАГ A-02: logout — использование событийной шины вместо хардкода
// БАГ A-03: resetPassword — добавлена валидация email
// БАГ #A1: race condition при двойном вызове onLogin
// БАГ #A2: утечка _onLogoutCallback
// БАГ #A3: валидация email
// БАГ #MIN-01: валидация пароля
// БАГ #MIN-05: закрытие BroadcastChannel

import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';

let _sessionId = Math.random().toString(36).substring(2, 10);
let _authChannel = null;
let _onLogoutCallback = null;
let _currentAuthCleanup = null;

function getAuthChannel() {
    if (!_authChannel && typeof BroadcastChannel !== 'undefined') {
        try {
            _authChannel = new BroadcastChannel('corebox_auth');
            _authChannel.onmessage = (e) => {
                if (e.data.type === 'logout' && e.data.sessionId !== _sessionId) {
                    console.log('🔓 Выход из системы в другой вкладке');
                    if (_onLogoutCallback) _onLogoutCallback();
                }
            };
        } catch(e) {}
    }
    return _authChannel;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
    return password.length >= 6;
}

export async function register(email, password, username) {
    try {
        if (!isValidEmail(email)) {
            return { success: false, error: 'Неверный формат email' };
        }
        
        if (!isValidPassword(password)) {
            return { success: false, error: 'Пароль должен быть минимум 6 символов' };
        }
        
        const cleanUsername = (username || email.split('@')[0]).trim();
        if (cleanUsername.length < 3) {
            return { success: false, error: 'Имя должно быть минимум 3 символа' };
        }
        if (cleanUsername.length > 20) {
            return { success: false, error: 'Имя не должно быть длиннее 20 символов' };
        }
        if (!/^[a-zA-ZА-Яа-я0-9_\-\.]+$/.test(cleanUsername)) {
            return { success: false, error: 'Имя содержит недопустимые символы' };
        }
        
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: { data: { username: cleanUsername } }
        });

        if (error) throw error;

        if (data.user) {
            const { error: updateError } = await supabase
                .from('profiles')
                .upsert({ id: data.user.id, username: cleanUsername }, { onConflict: 'id' });
            if (updateError) console.warn("Не удалось обновить username:", updateError);
        }

        return { success: true, user: data.user };
        
    } catch (error) {
        console.error("Ошибка регистрации:", error.message);
        return { success: false, error: error.message };
    }
}

export async function login(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        if (data.user) {
            await supabase
                .from('profiles')
                .update({ last_login: new Date().toISOString() })
                .eq('id', data.user.id);
        }

        return { success: true, user: data.user };
        
    } catch (error) {
        console.error("Ошибка входа:", error.message);
        return { success: false, error: error.message };
    }
}

// БАГ A-02: logout — использование событийной шины
export async function logout() {
    try {
        const channel = getAuthChannel();
        if (channel) {
            try {
                channel.postMessage({ type: 'logout', sessionId: _sessionId, timestamp: Date.now() });
            } catch(e) {}
        }
        
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        localStorage.removeItem('corebox_current_user');
        
        // БАГ A-02: Используем событийную шину вместо хардкода
        GameBus.emit(EVENTS.LOGOUT);
        
        return { success: true };
        
    } catch (error) {
        console.error("Ошибка выхода:", error.message);
        return { success: false, error: error.message };
    }
}

export async function getCurrentUser() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        return user;
    } catch (error) {
        console.error("Ошибка получения пользователя:", error.message);
        return null;
    }
}

// БАГ A-01: initAuth — хранение cleanup-функции и предотвращение дублирования
export function initAuth(onLogin, onLogout) {
    // БАГ A-01: очищаем предыдущую подписку перед созданием новой
    if (_currentAuthCleanup) {
        _currentAuthCleanup();
        _currentAuthCleanup = null;
    }
    
    let loginHandled = false;
    let isInitialized = false;
    
    _onLogoutCallback = onLogout;
    
    getAuthChannel();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log(`🔐 Auth state change: ${event}, session: ${!!session}`);
        
        if (event === 'INITIAL_SESSION') {
            if (session?.user) {
                loginHandled = true;
                onLogin(session.user);
            } else {
                onLogout();
            }
            isInitialized = true;
            return;
        }
        
        if (event === 'SIGNED_IN') {
            if (loginHandled && isInitialized) {
                return;
            }
            if (session?.user) {
                loginHandled = true;
                onLogin(session.user);
            }
        } else if (event === 'SIGNED_OUT') {
            loginHandled = false;
            onLogout();
        } else if (event === 'TOKEN_REFRESHED') {
            console.log('🔄 Токен обновлён');
        }
    });
    
    // БАГ A-01: создаём и сохраняем cleanup-функцию
    const cleanup = () => {
        subscription?.unsubscribe();
        _onLogoutCallback = null;
        if (_authChannel) {
            _authChannel.close();
            _authChannel = null;
        }
    };
    
    _currentAuthCleanup = cleanup;
    
    return cleanup;
}

// БАГ A-03: resetPassword — добавлена валидация email
export async function resetPassword(email) {
    try {
        if (!isValidEmail(email)) {
            return { success: false, error: 'Неверный формат email' };
        }
        
        const origin = window.location.origin || 'https://corebox-game.com';
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: origin + '/reset-password.html'
        });
        
        if (error) throw error;
        
        return { success: true };
        
    } catch (error) {
        console.error("Ошибка сброса пароля:", error.message);
        return { success: false, error: error.message };
    }
}

// Добавляем событие LOGOUT в EVENTS если его нет
if (typeof EVENTS !== 'undefined' && EVENTS && !EVENTS.LOGOUT) {
    EVENTS.LOGOUT = 'auth:logout';
}