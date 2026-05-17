// ======== save.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ОБЛАЧНОЙ СИНХРОНИЗАЦИЕЙ ========

import { supabase } from './supabase.js';

// Константы для версионирования
const SAVE_VERSION = 3;
const CONFLICT_RESOLUTION_STRATEGY = 'server_wins'; // или 'client_wins', 'merge'

// ========== ГЛАВНАЯ ФУНКЦИЯ СОХРАНЕНИЯ ==========
export async function saveGameToCloud(gameInstance, force = false) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Не авторизован" };

        // 1. Получаем ПОЛНОЕ состояние из Rust
        let rustState = null;
        try {
            const statsJson = gameInstance.get_statistics();
            if (statsJson) {
                rustState = JSON.parse(statsJson);
            }
        } catch(e) {}

        // 2. Получаем чертежи
        const blueprints = getBlueprints();
        
        // 3. Получаем флот
        const fleet = getFleet();
        
        // 4. Формируем ЕДИНЫЙ формат сохранения
        const saveData = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            
            // Основные ресурсы (из Rust)
            inventory: {
                coal: rustState?.coal_inventory || 0,
                ore: rustState?.ore_inventory || 0,
                chips: rustState?.chips_inventory || 0,
                plasma: rustState?.plasma_inventory || 0,
                trash: rustState?.trash_inventory || 0
            },
            
            // Улучшения
            upgrades: {
                mining: rustState?.mining_level || 0,
                defense: rustState?.defense_active || false,
                defense_level: rustState?.defense_level || 0,
                crit_level: rustState?.crit_level || 0,
                cooling_level: rustState?.cooling_level || 0
            },
            
            // Прогресс
            computational_power: rustState?.computational_power || 0,
            max_computational_power: rustState?.max_computational_power || 1000,
            nights_survived: rustState?.nights_survived || 0,
            total_mined: rustState?.total_clicks || 0,
            
            // Нейро-система
            neuro: {
                evolution: rustState?.neuro_evolution || 0,
                consciousness: rustState?.neuro_consciousness || 0,
                score: rustState?.neuro_score || 0,
                ai_mode: rustState?.current_ai_mode || "Обычный"
            },
            
            // Состояние игры
            game_time: rustState?.game_time || 24,
            is_day: rustState?.is_day !== undefined ? rustState.is_day : true,
            coal_enabled: rustState?.coal_enabled || false,
            rebel_activity: rustState?.rebel_activity || 0,
            turbine_heat: rustState?.turbine_heat || 0,
            turbine_upgrade_level: rustState?.turbine_upgrade_level || 0,
            
            // Статистика
            statistics: {
                total_coal_mined: rustState?.coal_mined || 0,
                total_trash_mined: rustState?.trash_mined || 0,
                total_plasma_mined: rustState?.plasma_mined || 0,
                total_ore_mined: rustState?.ore_mined || 0,
                total_coal_burned: rustState?.coal_burned || 0,
                total_coal_stolen: rustState?.coal_stolen || 0,
                rebel_attacks: rustState?.rebel_attacks_count || 0,
                attacks_defended: rustState?.attacks_defended || 0
            },
            
            // Дополнительные модули
            blueprints: blueprints,
            fleet: fleet,
            
            // Пассивные ставки (из конфига)
            passive_rates: getPassiveRates(),
            
            // Престиж
            prestige_level: parseInt(localStorage.getItem('corebox_prestige_level')) || 0,
            
            // Последний AI порог
            last_ai_coal_threshold: rustState?.last_ai_coal_threshold || 0,
            
            // Тип текущей ночи
            current_night_type: rustState?.current_night_type || ""
        };
        
        // 5. Проверяем конфликт (если не force)
        if (!force) {
            const existing = await getLatestCloudSave(user.id);
            if (existing && existing.timestamp > saveData.timestamp) {
                console.warn("Облачное сохранение новее, пропускаем");
                return { 
                    success: false, 
                    error: "Конфликт: облако новее",
                    server_save: existing
                };
            }
        }
        
        // 6. Сохраняем в базу
        const { error } = await supabase.from('game_saves').upsert({
            user_id: user.id,
            full_state: saveData,
            // Дублируем основные поля для быстрых запросов (лидерборд и т.д.)
            coal: saveData.inventory.coal,
            ore: saveData.inventory.ore,
            chips: saveData.inventory.chips,
            plasma: saveData.inventory.plasma,
            trash: saveData.inventory.trash,
            total_mined: saveData.total_mined,
            nights_survived: saveData.nights_survived,
            neuro_evolution: saveData.neuro.evolution,
            neuro_score: saveData.neuro.score,
            computational_power: saveData.computational_power,
            updated_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
        }, { onConflict: 'user_id' });
        
        if (error) throw error;
        
        // 7. Сохраняем локальную резервную копию
        localStorage.setItem('corebox_save_backup', JSON.stringify(saveData));
        
        console.log("✅ Облачное сохранение успешно");
        return { success: true, timestamp: saveData.timestamp };
        
    } catch (error) {
        console.error("❌ Ошибка сохранения в облако:", error);
        return { success: false, error: error.message };
    }
}

// ========== ГЛАВНАЯ ФУНКЦИЯ ЗАГРУЗКИ ==========
export async function loadGameFromCloud(mergeWithLocal = true) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        
        // 1. Загружаем из облака
        const { data, error } = await supabase
            .from('game_saves')
            .select('full_state, updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
        
        if (error || !data?.full_state) {
            console.log("Нет облачного сохранения");
            return null;
        }
        
        const cloudSave = data.full_state;
        
        // 2. Проверяем версию
        if (cloudSave.version !== SAVE_VERSION) {
            console.warn(`Версия сохранения не совпадает: ${cloudSave.version} vs ${SAVE_VERSION}`);
            // Пытаемся мигрировать
            const migrated = migrateSave(cloudSave);
            if (migrated) return migrated;
        }
        
        // 3. Если нужно смержить с локальным
        if (mergeWithLocal) {
            const localSave = getLocalSave();
            if (localSave && localSave.timestamp > cloudSave.timestamp) {
                console.log("Локальное сохранение новее, используем его");
                return localSave;
            }
        }
        
        // 4. Восстанавливаем чертежи из облака
        if (cloudSave.blueprints) {
            restoreBlueprints(cloudSave.blueprints);
        }
        
        // 5. Восстанавливаем флот
        if (cloudSave.fleet) {
            restoreFleet(cloudSave.fleet);
        }
        
        // 6. Восстанавливаем престиж
        if (cloudSave.prestige_level) {
            localStorage.setItem('corebox_prestige_level', cloudSave.prestige_level.toString());
        }
        
        console.log(`✅ Загружено облачное сохранение от ${new Date(cloudSave.timestamp).toLocaleString()}`);
        return cloudSave;
        
    } catch (error) {
        console.error("❌ Ошибка загрузки из облака:", error);
        return null;
    }
}

// ========== ПОЛУЧИТЬ ПОСЛЕДНЕЕ ОБЛАЧНОЕ СОХРАНЕНИЕ ==========
export async function getLatestCloudSave(userId) {
    try {
        const { data, error } = await supabase
            .from('game_saves')
            .select('full_state')
            .eq('user_id', userId)
            .single();
        
        if (error || !data?.full_state) return null;
        return data.full_state;
    } catch(e) {
        return null;
    }
}

// ========== СИНХРОНИЗАЦИЯ СТАТИСТИКИ В ОБЛАКО ==========
export async function syncStatisticsToCloud(statistics) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        // Обновляем лидерборд
        await supabase.from('leaderboard').upsert({
            user_id: user.id,
            username: user.user_metadata?.username || user.email?.split('@')[0] || 'Игрок',
            total_mined: statistics.total_mined || 0,
            neuro_score: statistics.neuro_score || 0,
            nights: statistics.nights_survived || 0,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        
    } catch(error) {
        console.error("Ошибка синхронизации статистики:", error);
    }
}

// ========== ПОЛУЧИТЬ ЛИДЕРБОРД ==========
export async function getLeaderboard(limit = 10) {
    try {
        const { data, error } = await supabase
            .from('leaderboard')
            .select('username, total_mined, neuro_score, nights')
            .order('total_mined', { ascending: false })
            .limit(limit);
        
        return error ? [] : (data || []);
    } catch(error) { 
        console.error("Ошибка получения лидерборда:", error);
        return []; 
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getBlueprints() {
    try {
        const saved = localStorage.getItem('corebox_ship_blueprints');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch(e) {}
    return [
        { id: 'cargo', unlocked: false },
        { id: 'scout', unlocked: false },
        { id: 'combat', unlocked: false }
    ];
}

function restoreBlueprints(blueprints) {
    if (blueprints && Array.isArray(blueprints)) {
        localStorage.setItem('corebox_ship_blueprints', JSON.stringify(blueprints));
    }
}

function getFleet() {
    try {
        const saved = localStorage.getItem('corebox_fleet');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch(e) {}
    return [];
}

function restoreFleet(fleet) {
    if (fleet && Array.isArray(fleet)) {
        localStorage.setItem('corebox_fleet', JSON.stringify(fleet));
    }
}

function getPassiveRates() {
    try {
        const cfg = localStorage.getItem('corebox_config_cache');
        if (cfg) {
            const pc = JSON.parse(cfg)?.mining_config?.passive_chances;
            if (pc) {
                return { coal: pc.coal ?? 0.004, trash: pc.trash ?? 0.008, ore: pc.ore ?? 0.003 };
            }
        }
    } catch(e) {}
    return { coal: 0.004, trash: 0.008, ore: 0.003 };
}

function getLocalSave() {
    try {
        const raw = localStorage.getItem('corebox_save_backup');
        if (raw) {
            return JSON.parse(raw);
        }
    } catch(e) {}
    return null;
}

function migrateSave(oldSave) {
    // Миграция с версии 2 на 3
    if (oldSave.version === 2) {
        const migrated = {
            version: 3,
            timestamp: oldSave.timestamp || Date.now(),
            inventory: oldSave.inventory || {},
            upgrades: oldSave.upgrades || {},
            computational_power: oldSave.computational_power || 0,
            max_computational_power: oldSave.max_computational_power || 1000,
            nights_survived: oldSave.nights_survived || 0,
            total_mined: oldSave.total_mined || 0,
            neuro: oldSave.neuro || { evolution: 0, consciousness: 0, score: 0, ai_mode: "Обычный" },
            game_time: oldSave.game_time || 24,
            is_day: oldSave.is_day !== undefined ? oldSave.is_day : true,
            coal_enabled: oldSave.coal_enabled || false,
            blueprints: oldSave.blueprints || [],
            fleet: oldSave.fleet || [],
            prestige_level: oldSave.prestige_level || 0
        };
        return migrated;
    }
    return null;
}