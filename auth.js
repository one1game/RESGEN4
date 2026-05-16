// auth.js
// Модуль авторизации - регистрация, вход, выход

import { supabase } from './supabase.js';

// ─────────────────────────────────────────────
// 📝 РЕГИСТРАЦИЯ НОВОГО ПОЛЬЗОВАТЕЛЯ
// ─────────────────────────────────────────────
export async function register(email, password, username) {
    try {
        // 1. Регистрируем пользователя в Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { username: username }  // Сохраняем имя в метаданных
            }
        });

        if (error) throw error;

        // 2. Обновляем username в таблице profiles (на случай, если триггер не сработал)
        if (data.user) {
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ username: username })
                .eq('id', data.user.id);
            
            if (updateError) console.warn("Не удалось обновить username:", updateError);
        }

        console.log("✅ Регистрация успешна:", data.user?.email);
        return { success: true, user: data.user };
        
    } catch (error) {
        console.error("❌ Ошибка регистрации:", error.message);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────
// 🔑 ВХОД В СИСТЕМУ
// ─────────────────────────────────────────────
export async function login(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // Обновляем last_login в профиле
        if (data.user) {
            await supabase
                .from('profiles')
                .update({ last_login: new Date().toISOString() })
                .eq('id', data.user.id);
        }

        console.log("✅ Вход выполнен:", data.user?.email);
        return { success: true, user: data.user };
        
    } catch (error) {
        console.error("❌ Ошибка входа:", error.message);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────
// 🚪 ВЫХОД ИЗ СИСТЕМЫ
// ─────────────────────────────────────────────
export async function logout() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        // Очищаем локальные данные игры
        localStorage.removeItem('corebox_current_user');
        localStorage.removeItem('corebox_save');
        
        console.log("✅ Выход выполнен");
        return { success: true };
        
    } catch (error) {
        console.error("❌ Ошибка выхода:", error.message);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────
// 👤 ПОЛУЧИТЬ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
// ─────────────────────────────────────────────
export async function getCurrentUser() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        
        return user;
    } catch (error) {
        console.error("❌ Ошибка получения пользователя:", error.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// 🔄 ИНИЦИАЛИЗАЦИЯ АВТОРИЗАЦИИ (слушаем изменения)
// ✅ ИСПРАВЛЕНИЕ БАГА 3: игнорируем повторные INITIAL_SESSION
// ─────────────────────────────────────────────
export function initAuth(onLogin, onLogout) {
    let initialSessionHandled = false;  // ← новый флаг для предотвращения дублей
    
    supabase.auth.onAuthStateChange((event, session) => {
        console.log("🔔 Auth state changed:", event);
        
        // ✅ ИСПРАВЛЕНИЕ: обрабатываем INITIAL_SESSION только один раз
        if (event === 'INITIAL_SESSION') {
            if (initialSessionHandled) {
                console.log("⏭️ Пропускаем повторный INITIAL_SESSION");
                return;
            }
            initialSessionHandled = true;
        }
        
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (session?.user) {
                onLogin(session.user);
            } else {
                onLogout();
            }
        } else if (event === 'SIGNED_OUT') {
            initialSessionHandled = false;  // Сбрасываем при выходе
            onLogout();
        }
    });
}

// ─────────────────────────────────────────────
// 🔐 СБРОС ПАРОЛЯ (если нужно)
// ─────────────────────────────────────────────
export async function resetPassword(email) {
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });
        
        if (error) throw error;
        
        console.log("✅ Инструкция по сбросу пароля отправлена на", email);
        return { success: true };
        
    } catch (error) {
        console.error("❌ Ошибка сброса пароля:", error.message);
        return { success: false, error: error.message };
    }
}