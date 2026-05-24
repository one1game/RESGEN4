// save.js - ИСПРАВЛЕННАЯ ВЕРСИЯ (фикс конфликта сохранений и приоритет fleetModule)

import { supabase } from './supabase.js';

const SAVE_VERSION = 3;
const CONFLICT_RESOLUTION_STRATEGY = 'server_wins';

function getBlueprintsStorageKey() {
    const userId = window.currentUser?.id;
    return userId ? `corebox_ship_blueprints_${userId}` : 'corebox_ship_blueprints';
}

function getFleetStorageKey() {
    const userId = window.currentUser?.id;
    return userId ? `corebox_fleet_${userId}` : 'corebox_fleet';
}

// ИСПРАВЛЕНИЕ 1: getFleet с приоритетом из fleetModule
function getFleet() {
    // Приоритет — живой модуль fleetModule
    if (window.fleetModule && window.fleetModule.ships && window.fleetModule.ships.length > 0) {
        console.log(`📦 getFleet: возвращаем ${window.fleetModule.ships.length} кораблей из fleetModule`);
        return window.fleetModule.ships;
    }
    
    try {
        const key = getFleetStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            const parsed = JSON.parse(saved);
            console.log(`📦 getFleet: загружено ${parsed.length} кораблей из localStorage`);
            return parsed;
        }
    } catch(e) {
        console.warn('Ошибка загрузки флота из localStorage:', e);
    }
    return [];
}

// ИСПРАВЛЕНИЕ: restoreFleet с синхронизацией fleetModule
function restoreFleet(fleet) {
    if (fleet && Array.isArray(fleet)) {
        const key = getFleetStorageKey();
        localStorage.setItem(key, JSON.stringify(fleet));
        // Синхронизируем с fleetModule если он существует
        if (window.fleetModule) {
            window.fleetModule.ships = fleet;
            if (window.fleetModule._renderFleetTab) {
                window.fleetModule._renderFleetTab();
            }
        }
        console.log(`📦 restoreFleet: восстановлено ${fleet.length} кораблей`);
    }
}

function getBlueprints() {
    try {
        const key = getBlueprintsStorageKey();
        const saved = localStorage.getItem(key);
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
    let normalized = blueprints;
    
    if (blueprints && typeof blueprints === 'object' && !Array.isArray(blueprints)) {
        normalized = [
            { id: 'cargo', unlocked: blueprints.cargo === true },
            { id: 'scout', unlocked: blueprints.scout === true },
            { id: 'combat', unlocked: blueprints.combat === true }
        ];
    }
    
    if (normalized && Array.isArray(normalized)) {
        const key = getBlueprintsStorageKey();
        localStorage.setItem(key, JSON.stringify(normalized));
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
    if (oldSave.version === SAVE_VERSION) {
        return oldSave;
    }
    
    if (oldSave.version === 2) {
        let consciousness = oldSave.neuro?.consciousness || 0.05;
        if (consciousness > 1.5) {
            consciousness = consciousness / 100.0;
        }
        
        const migrated = {
            version: 3,
            timestamp: oldSave.timestamp || Date.now(),
            last_game_change: oldSave.last_game_change || Date.now(),
            inventory: oldSave.inventory || {},
            upgrades: oldSave.upgrades || {},
            computational_power: oldSave.computational_power || 0,
            max_computational_power: oldSave.max_computational_power || 1000,
            nights_survived: oldSave.nights_survived || 0,
            total_mined: oldSave.total_mined || 0,
            neuro: {
                evolution: oldSave.neuro?.evolution || 0,
                consciousness: consciousness,
                score: oldSave.neuro?.score || 0,
                ai_mode: oldSave.neuro?.ai_mode || "Обычный"
            },
            game_time: oldSave.game_time || 24,
            is_day: oldSave.is_day !== undefined ? oldSave.is_day : true,
            coal_enabled: oldSave.coal_enabled || false,
            rebel_activity: oldSave.rebel_activity || 0,
            rebel_protection_nights: oldSave.rebel_protection_nights || 0,
            rebel_protection_active: oldSave.rebel_protection_active || false,
            blueprints: oldSave.blueprints || [],
            fleet: oldSave.fleet || [],
            defense_ship_id: oldSave.defense_ship_id || null,
            fleet_log: oldSave.fleet_log || [],
            prestige_level: oldSave.prestige_level || 0,
            turbine_heat: oldSave.turbine_heat || 0,
            turbine_upgrade_level: oldSave.turbine_upgrade_level || 0,
            statistics: oldSave.statistics || {},
            passive_rates: oldSave.passive_rates || { coal: 0.004, trash: 0.008, ore: 0.003 },
            last_ai_coal_threshold: oldSave.last_ai_coal_threshold || 0,
            current_night_type: oldSave.current_night_type || "",
            attack_history: oldSave.attack_history || [],
            quests_progress: oldSave.quests_progress || [],
            auto_clicking: oldSave.auto_clicking || false,
            planets: oldSave.planets || [],
            active_planet_missions: oldSave.active_planet_missions || []
        };
        
        try {
            const bpKey = `corebox_ship_blueprints`;
            const bp = JSON.parse(localStorage.getItem(bpKey) || '[]');
            if (bp.length) migrated.blueprints = bp;
            console.log(`🔄 Миграция: восстановлено ${bp.length} чертежей из localStorage`);
        } catch(e) {
            console.warn('Ошибка восстановления чертежей при миграции:', e);
        }
        
        return migrated;
    }
    
    if (oldSave.version === 1) {
        let consciousness = oldSave.neuro_consciousness || 0.05;
        if (consciousness > 1.5) {
            consciousness = consciousness / 100.0;
        }
        
        const migrated = {
            version: 3,
            timestamp: Date.now(),
            last_game_change: Date.now(),
            inventory: {
                coal: oldSave.coal || 0,
                ore: oldSave.ore || 0,
                chips: oldSave.chips || 0,
                plasma: oldSave.plasma || 0,
                trash: oldSave.trash || 0
            },
            upgrades: {
                mining: oldSave.mining_level || 0,
                defense: oldSave.defense_active || false,
                defense_level: oldSave.defense_level || 0,
                crit_level: 0,
                cooling_level: 0
            },
            computational_power: oldSave.computational_power || 0,
            max_computational_power: oldSave.max_computational_power || 1000,
            nights_survived: oldSave.nights_survived || 0,
            total_mined: oldSave.total_mined || oldSave.total_clicks || 0,
            neuro: {
                evolution: oldSave.neuro_evolution || 0,
                consciousness: consciousness,
                score: oldSave.neuro_score || 0,
                ai_mode: "Обычный"
            },
            game_time: oldSave.game_time || 24,
            is_day: oldSave.is_day !== undefined ? oldSave.is_day : true,
            coal_enabled: oldSave.coal_enabled || false,
            rebel_activity: 0,
            rebel_protection_nights: 0,
            rebel_protection_active: false,
            blueprints: [],
            fleet: [],
            defense_ship_id: null,
            fleet_log: [],
            prestige_level: 0,
            turbine_heat: 0,
            turbine_upgrade_level: 0,
            statistics: {},
            passive_rates: { coal: 0.004, trash: 0.008, ore: 0.003 },
            last_ai_coal_threshold: 0,
            current_night_type: "",
            attack_history: [],
            quests_progress: [],
            auto_clicking: false,
            planets: [],
            active_planet_missions: []
        };
        
        try {
            const bpKey = `corebox_ship_blueprints`;
            const bp = JSON.parse(localStorage.getItem(bpKey) || '[]');
            if (bp.length) migrated.blueprints = bp;
        } catch(e) {}
        
        return migrated;
    }
    
    console.error(`Неизвестная версия сохранения: ${oldSave.version}. Попытка частичного восстановления.`);
    return {
        version: SAVE_VERSION,
        timestamp: Date.now(),
        last_game_change: Date.now(),
        inventory: oldSave.inventory || { coal: 0, ore: 0, chips: 0, plasma: 0, trash: 0 },
        upgrades: { mining: 0, defense: false, defense_level: 0, crit_level: 0, cooling_level: 0 },
        computational_power: oldSave.computational_power || 0,
        max_computational_power: oldSave.max_computational_power || 1000,
        nights_survived: oldSave.nights_survived || 0,
        total_mined: oldSave.total_mined || 0,
        neuro: { 
            evolution: 0, 
            consciousness: 0.05, 
            score: 0, 
            ai_mode: "Обычный" 
        },
        game_time: 24,
        is_day: true,
        coal_enabled: false,
        rebel_activity: 0,
        rebel_protection_nights: 0,
        rebel_protection_active: false,
        blueprints: [],
        fleet: [],
        defense_ship_id: null,
        fleet_log: [],
        prestige_level: 0,
        turbine_heat: 0,
        turbine_upgrade_level: 0,
        statistics: {},
        passive_rates: { coal: 0.004, trash: 0.008, ore: 0.003 },
        last_ai_coal_threshold: 0,
        current_night_type: "",
        attack_history: [],
        quests_progress: [],
        auto_clicking: false,
        planets: [],
        active_planet_missions: []
    };
}

// ИСПРАВЛЕНИЕ: основная функция сохранения с улучшенной логикой конфликта
export async function saveGameToCloud(gameInstance, force = false) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Не авторизован" };

        let rustState = null;
        try {
            const statsJson = gameInstance.get_statistics();
            if (statsJson) {
                rustState = JSON.parse(statsJson);
            }
        } catch(e) {}

        const blueprints = getBlueprints();
        const fleet = getFleet(); // ИСПРАВЛЕНИЕ 1: теперь читает из fleetModule
        
        const computationalPower = gameInstance.get_computational_power?.() ?? rustState?.computational_power ?? 0;
        const maxComputationalPower = gameInstance.get_max_computational_power?.() ?? rustState?.max_computational_power ?? 1000;
        
        let neuroConsciousness = rustState?.neuro_consciousness || 0;
        if (neuroConsciousness > 1.5) {
            neuroConsciousness = neuroConsciousness / 100.0;
        }
        neuroConsciousness = Math.min(1.0, Math.max(0.0, neuroConsciousness));
        
        let attackHistory = [];
        try {
            if (rustState?.attack_history) {
                attackHistory = rustState.attack_history.slice(-10);
            }
        } catch(e) {}
        
        let questsProgress = [];
        try {
            if (rustState?.quests) {
                questsProgress = rustState.quests.map(q => ({
                    id: q.id,
                    completed: q.completed
                }));
            }
        } catch(e) {}
        
        const rebelProtectionNights = rustState?.rebel_protection_nights ?? 0;
        const rebelProtectionActive = rustState?.rebel_protection_active ?? false;
        
        const statistics = {
            total_coal_mined:   rustState?.coal_mined   || rustState?.total_coal_mined   || 0,
            total_trash_mined:  rustState?.trash_mined  || rustState?.total_trash_mined  || 0,
            total_plasma_mined: rustState?.plasma_mined || rustState?.total_plasma_mined || 0,
            total_ore_mined:    rustState?.ore_mined    || rustState?.total_ore_mined    || 0,
            total_coal_burned:  rustState?.coal_burned  || rustState?.total_coal_burned  || 0,
            total_coal_stolen:  rustState?.coal_stolen  || rustState?.total_coal_stolen  || 0,
            rebel_attacks:      rustState?.rebel_attacks_count || 0,
            attacks_defended:   rustState?.attacks_defended || 0
        };
        
        const defenseShipId = window.fleetModule?.defenseShipId || null;
        const fleetLog = window.fleetModule?.fleetLog || [];
        
        let planets = [];
        let activePlanetMissions = [];
        try {
            if (rustState?.planets) planets = rustState.planets;
            if (rustState?.active_planet_missions) activePlanetMissions = rustState.active_planet_missions;
        } catch(e) {}
        
        const saveData = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            last_game_change: Date.now(),
            
            inventory: {
                coal: rustState?.coal_inventory || 0,
                ore: rustState?.ore_inventory || 0,
                chips: rustState?.chips_inventory || 0,
                plasma: rustState?.plasma_inventory || 0,
                trash: rustState?.trash_inventory || 0
            },
            
            upgrades: {
                mining: rustState?.mining_level || 0,
                defense: rustState?.defense_active || false,
                defense_level: rustState?.defense_level || 0,
                crit_level: rustState?.crit_level || 0,
                cooling_level: rustState?.cooling_level || 0
            },
            
            computational_power: computationalPower,
            max_computational_power: maxComputationalPower,
            nights_survived: rustState?.nights_survived || 0,
            total_mined: rustState?.total_mined || rustState?.total_clicks || 0,
            
            neuro: {
                evolution: rustState?.neuro_evolution || 0,
                consciousness: neuroConsciousness,
                score: rustState?.neuro_score || 0,
                ai_mode: rustState?.current_ai_mode || "Обычный"
            },
            
            game_time: rustState?.game_time || 24,
            is_day: rustState?.is_day !== undefined ? rustState.is_day : true,
            coal_enabled: rustState?.coal_enabled || false,
            rebel_activity: rustState?.rebel_activity || 0,
            rebel_protection_nights: rebelProtectionNights,
            rebel_protection_active: rebelProtectionActive,
            turbine_heat: rustState?.turbine_heat || 0,
            turbine_upgrade_level: rustState?.turbine_upgrade_level || 0,
            
            statistics: statistics,
            
            blueprints: blueprints,
            fleet: fleet,
            
            defense_ship_id: defenseShipId,
            fleet_log: fleetLog,
            
            passive_rates: getPassiveRates(),
            
            prestige_level: parseInt(localStorage.getItem('corebox_prestige_level')) || 0,
            
            last_ai_coal_threshold: rustState?.last_ai_coal_threshold || 0,
            
            current_night_type: rustState?.current_night_type || "",
            
            attack_history: attackHistory,
            
            quests_progress: questsProgress,
            
            auto_clicking: localStorage.getItem('corebox_autoclicking') === 'true',
            
            planets: planets,
            active_planet_missions: activePlanetMissions
        };
        
        localStorage.setItem('corebox_save_backup', JSON.stringify(saveData));
        
        // ИСПРАВЛЕНИЕ: улучшенная логика конфликта
        if (!force) {
            const existing = await getLatestCloudSave(user.id);
            if (existing) {
                const diff = existing.last_game_change - saveData.last_game_change;
                // Проверяем наличие новых кораблей в локальном флоте
                const hasNewShips = fleet.length > (existing.fleet?.length || 0);
                
                // Если в локальном флоте есть новые корабли, сохраняем даже если облако "новее"
                if (hasNewShips && diff > 0) {
                    console.log(`🛡️ Обнаружены новые корабли (${fleet.length} vs ${existing.fleet?.length || 0}), сохраняем несмотря на конфликт`);
                    // Не возвращаем ошибку, продолжаем сохранение
                } else if (existing && diff > 60000) { // увеличил допуск до 60 секунд
                    console.warn("Облачное сохранение новее, пропускаем", { diff });
                    return { 
                        success: false, 
                        error: "Конфликт: облако новее",
                        server_save: existing
                    };
                }
            }
        }
        
        const { error } = await supabase.from('game_saves').upsert({
            user_id: user.id,
            full_state: saveData,
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
        
        console.log("✅ Облачное сохранение успешно");
        return { success: true, timestamp: saveData.timestamp };
        
    } catch (error) {
        console.error("❌ Ошибка сохранения в облако:", error);
        return { success: false, error: error.message };
    }
}

export async function loadGameFromCloud(mergeWithLocal = true) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        
        const { data, error } = await supabase
            .from('game_saves')
            .select('full_state, updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
        
        if (error || !data?.full_state) {
            console.log("Нет облачного сохранения");
            return null;
        }
        
        let cloudSave = data.full_state;
        
        if (cloudSave.version !== SAVE_VERSION) {
            console.warn(`Версия сохранения не совпадает: ${cloudSave.version} vs ${SAVE_VERSION}`);
            const migrated = migrateSave(cloudSave);
            if (!migrated) {
                console.error('Миграция невозможна, используем пустое состояние');
                return null;
            }
            cloudSave = migrated;
        }
        
        if (cloudSave.neuro && cloudSave.neuro.consciousness > 1.5) {
            cloudSave.neuro.consciousness = cloudSave.neuro.consciousness / 100.0;
        }
        if (cloudSave.neuro && cloudSave.neuro.consciousness > 1.0) {
            cloudSave.neuro.consciousness = 1.0;
        }
        
        if (mergeWithLocal) {
            const localSave = getLocalSave();
            const CLOCK_TOLERANCE_MS = 60 * 1000;
            if (localSave && localSave.last_game_change > cloudSave.last_game_change + CLOCK_TOLERANCE_MS) {
                console.log("Локальное сохранение новее облачного, используем его");
                return localSave;
            }
        }
        
        if (cloudSave.blueprints) {
            restoreBlueprints(cloudSave.blueprints);
        }
        
        if (cloudSave.fleet && Array.isArray(cloudSave.fleet)) {
            restoreFleet(cloudSave.fleet);
            if (window.fleetModule) {
                window.fleetModule.ships = cloudSave.fleet.filter(s =>
                    s && typeof s.id === 'string' && typeof s.type === 'string'
                );
                window.fleetModule._loadDefenseShip();
            }
        }
        
        if (cloudSave.defense_ship_id && window.fleetModule) {
            const userId = window.currentUser?.id;
            const key = userId ? `corebox_defense_ship_${userId}` : 'corebox_defense_ship';
            localStorage.setItem(key, JSON.stringify(cloudSave.defense_ship_id));
        }
        
        if (cloudSave.fleet_log && window.fleetModule) {
            const userId = window.currentUser?.id;
            const key = `corebox_fleet_log_${userId || 'anon'}`;
            localStorage.setItem(key, JSON.stringify(cloudSave.fleet_log));
        }
        
        if (cloudSave.prestige_level) {
            localStorage.setItem('corebox_prestige_level', cloudSave.prestige_level.toString());
        }
        
        if (cloudSave.auto_clicking !== undefined) {
            localStorage.setItem('corebox_autoclicking', cloudSave.auto_clicking ? 'true' : 'false');
        }
        
        console.log(`✅ Загружено облачное сохранение от ${new Date(cloudSave.timestamp).toLocaleString()}`);
        return cloudSave;
        
    } catch (error) {
        console.error("❌ Ошибка загрузки из облака:", error);
        return null;
    }
}

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

export async function syncStatisticsToCloud(statistics) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
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