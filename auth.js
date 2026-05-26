// ======== auth.js (Новая папка/auth.js) ========
// ИСПРАВЛЕН: БАГ #9 двойной вызов onLogin, БАГ #34 валидация username, БАГ #35 fallback домен

import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';

// ПАТЧ 3.3: глобальный счётчик сессий для синхронизации между вкладками
let _sessionId = Math.random().toString(36).substring(2, 10);
let _authChannel = null;

function getAuthChannel() {
    if (!_authChannel && typeof BroadcastChannel !== 'undefined') {
        try {
            _authChannel = new BroadcastChannel('corebox_auth');
            _authChannel.onmessage = (e) => {
                if (e.data.type === 'logout' && e.data.sessionId !== _sessionId) {
                    console.log('🔓 Выход из системы в другой вкладке');
                    if (window._onLogoutCallback) {
                        window._onLogoutCallback();
                    }
                }
            };
        } catch(e) {}
    }
    return _authChannel;
}

export async function register(email, password, username) {
    try {
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
            options: {
                data: { username: cleanUsername }
            }
        });

        if (error) throw error;

        if (data.user) {
            const { error: updateError } = await supabase
                .from('profiles')
                .upsert({ 
                    id: data.user.id, 
                    username: cleanUsername
                }, { onConflict: 'id' });
            
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

export async function logout() {
    try {
        const channel = getAuthChannel();
        if (channel) {
            try {
                channel.postMessage({
                    type: 'logout',
                    sessionId: _sessionId,
                    timestamp: Date.now()
                });
            } catch(e) {}
        }
        
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        localStorage.removeItem('corebox_current_user');
        
        if (window.craftModule?.cleanup) window.craftModule.cleanup();
        if (window.designModule?.cleanup) window.designModule.cleanup();
        if (window.fleetModule?.cleanup) window.fleetModule.cleanup();
        if (window.spaceModule?.cleanup) window.spaceModule.cleanup();
        
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

export function initAuth(onLogin, onLogout) {
    let loginHandled = false;
    let isInitialized = false;
    
    window._onLogoutCallback = onLogout;
    
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
                loginHandled = false;
                return;
            }
            if (session?.user) {
                loginHandled = false;
                onLogin(session.user);
            }
        } else if (event === 'SIGNED_OUT') {
            loginHandled = false;
            onLogout();
        } else if (event === 'TOKEN_REFRESHED') {
            console.log('🔄 Токен обновлён');
        }
    });
    
    return () => {
        subscription?.unsubscribe();
        window._onLogoutCallback = null;
    };
}

export async function resetPassword(email) {
    try {
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