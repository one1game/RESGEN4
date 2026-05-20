// auth.js
// Модуль авторизации - регистрация, вход, выход

import { supabase } from './supabase.js';

export async function register(email, password, username) {
    try {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { username: username }
            }
        });

        if (error) throw error;

        if (data.user) {
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ username: username })
                .eq('id', data.user.id);
            
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
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        localStorage.removeItem('corebox_current_user');
        
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
    let initialSessionHandled = false;
    
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') {
            if (initialSessionHandled) return;
            initialSessionHandled = true;
        }
        
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (session?.user) {
                onLogin(session.user);
            } else {
                onLogout();
            }
        } else if (event === 'SIGNED_OUT') {
            initialSessionHandled = false;
            onLogout();
        }
    });
}

export async function resetPassword(email) {
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });
        
        if (error) throw error;
        
        return { success: true };
        
    } catch (error) {
        console.error("Ошибка сброса пароля:", error.message);
        return { success: false, error: error.message };
    }
}