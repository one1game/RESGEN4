import { supabase } from './supabase.js';
import { normalizeNeuroConsciousness } from './utils.js';

const SAVE_VERSION = 3;
const CONFLICT_RESOLUTION_STRATEGY = 'server_wins';

function getSpiralCoordinate(n) {
    if (n === 0) return { x: 2500, y: 2500 };
    const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2);
    const t = 2 * k + 1;
    const m = t * t;
    const t_minus = t - 1;
    let x = 0, y = 0;

    if (n >= m - t_minus) {
        x = k - (m - n);
        y = -k;
    } else if (n >= m - 2 * t_minus) {
        x = -k;
        y = -k + (m - t_minus - n);
    } else if (n >= m - 3 * t_minus) {
        x = -k + (m - 2 * t_minus - n);
        y = k;
    } else {
        x = k;
        y = k - (m - 3 * t_minus - n);
    }

    return {
        x: Math.round(2500 + x * 100),
        y: Math.round(2500 + y * 100)
    };
}

export async function ensureMapPosition(userId) {
    try {

        const { data: existing } = await supabase
            .from('game_saves')
            .select('map_x, map_y')
            .eq('user_id', userId)
            .maybeSingle();

        if (existing?.map_x != null && existing?.map_y != null) {
            return { x: existing.map_x, y: existing.map_y };
        }

        const { data: rpcResult, error } = await supabase
            .rpc('assign_spiral_position', { p_user_id: userId });

        if (error) throw error;

        if (rpcResult.reused) {
            return { x: rpcResult.x, y: rpcResult.y };
        }

        const coords = getSpiralCoordinate(rpcResult.index);

        await supabase.from('game_saves').upsert({
            user_id: userId,
            map_x: coords.x,
            map_y: coords.y
        }, { onConflict: 'user_id' });

        await supabase.from('profiles')
            .update({ map_x: coords.x, map_y: coords.y })
            .eq('id', userId);

        console.log(`✅ Новая позиция по спирали: [${coords.x}, ${coords.y}] (индекс: ${rpcResult.index})`);
        return coords;
    } catch (e) {
        console.warn('ensureMapPosition fallback:', e);
        return { x: 2500, y: 2500 };
    }
}

function getBlueprintsStorageKey() {
    const userId = window.currentUser?.id;
    return userId ? `corebox_ship_blueprints_${userId}` : 'corebox_ship_blueprints';
}

function getFleetStorageKey() {
    const userId = window.currentUser?.id;
    return userId ? `corebox_fleet_${userId}` : 'corebox_fleet';
}

export async function applyPendingLoot() {
    const pending = JSON.parse(localStorage.getItem('corebox_pending_loot') || '{}');
    if (Object.keys(pending).length === 0) return;
    if (!window.game) return;

    for (const [res, amt] of Object.entries(pending)) {
        if (amt > 0 && typeof window.game.add_resource === 'function') {
            window.game.add_resource(res, amt);
        }
    }

    if (window.addToLog) {
        window.addToLog(`📦 Восстановлен лут: ${Object.entries(pending).map(([r,a])=>`${a} ${r}`).join(', ')}`);
    }
    localStorage.removeItem('corebox_pending_loot');
}

function getFleet() {
    if (window.fleetModule && window.fleetModule.ships && window.fleetModule.ships.length > 0) {
        return window.fleetModule.ships.filter(s =>
            s && typeof s.id === 'string' && typeof s.type === 'string'
        );
    }

    try {
        const key = getFleetStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            const parsed = JSON.parse(saved);
            const validShips = parsed.filter(s =>
                s && typeof s.id === 'string' && typeof s.type === 'string'
            );
            return validShips;
        }
    } catch(e) {
        console.warn('Ошибка загрузки флота из localStorage:', e);
    }
    return [];
}

function restoreFleet(fleet) {
    if (fleet && Array.isArray(fleet)) {
        const validFleet = fleet.filter(s =>
            s && typeof s.id === 'string' && typeof s.type === 'string'
        );
        const key = getFleetStorageKey();
        localStorage.setItem(key, JSON.stringify(validFleet));
        if (window.fleetModule) {
            window.fleetModule.ships = validFleet;
            if (window.fleetModule._renderFleetTab) {
                window.fleetModule._renderFleetTab();
            }
        }
        console.log(`📦 restoreFleet: восстановлено ${validFleet.length} кораблей`);
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

        if (window.designModule) {
            window.designModule.loadBlueprintsFromCloud(normalized);
        }
    }
}

function getPassiveRates() {
    try {
        const cfg = localStorage.getItem('corebox_config_cache');
        if (cfg) {
            const pc = JSON.parse(cfg)?.mining_config?.passive_chances;
            if (pc) {
                return { coal: pc.coal ?? 0.010, trash: pc.trash ?? 0.008, ore: pc.ore ?? 0.006 };
            }
        }
    } catch(e) {}
    return { coal: 0.010, trash: 0.008, ore: 0.006 };
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

function migrateSave(oldSave, userId) {
    if (oldSave.version === SAVE_VERSION) {
        return oldSave;
    }

    const MIGRATION_KEY = 'corebox_migration_v3_done';
    const migrationDone = localStorage.getItem(MIGRATION_KEY) === 'true';

    if (migrationDone) {
        console.log('Миграция уже выполнена ранее');
        return oldSave;
    }

    if (oldSave.version === 2) {
        console.log('Миграция сохранения версии 2 -> 3');
        let consciousness = oldSave.neuro?.consciousness || 0.05;
        consciousness = normalizeNeuroConsciousness(consciousness);

        const migrated = {
            version: 3,
            timestamp: oldSave.timestamp || Date.now(),
            _savedAt: oldSave._savedAt || oldSave.timestamp || Date.now(),
            last_game_change: Date.now(),
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
            game_time: oldSave.game_time ?? 24,
            is_day: oldSave.is_day !== undefined ? oldSave.is_day : true,
            coal_enabled: oldSave.coal_enabled || false,
            rebel_activity: oldSave.rebel_activity || 0,
            rebel_protection_nights: oldSave.rebel_protection_nights || 0,
            rebel_protection_active: oldSave.rebel_protection_active || false,
            blueprints: oldSave.blueprints || [],
            fleet: oldSave.fleet || [],
            defense_ship_id: oldSave.defense_ship_id || null,
            fleet_log: oldSave.fleet_log || [],

            turbine_heat: oldSave.turbine_heat || 0,
            turbine_upgrade_level: oldSave.turbine_upgrade_level || 0,
            statistics: oldSave.statistics || {},
            passive_rates: oldSave.passive_rates || { coal: 0.010, trash: 0.008, ore: 0.006 },
            last_ai_coal_threshold: oldSave.last_ai_coal_threshold || 0,
            current_night_type: oldSave.current_night_type || "",
            attack_history: oldSave.attack_history || [],
            quests_progress: oldSave.quests_progress || [],
            auto_clicking: oldSave.auto_clicking || false,
            planets: oldSave.planets || [],
            active_planet_missions: oldSave.active_planet_missions || [],
            chips_unlocked: oldSave.chips_unlocked ?? false,
            plasma_unlocked: oldSave.plasma_unlocked ?? false,
            map_x: oldSave.map_x ?? null,
            map_y: oldSave.map_y ?? null,
        };

        try {
            const legacyBpKey = 'corebox_ship_blueprints';
            const legacyBp = localStorage.getItem(legacyBpKey);
            if (legacyBp) {
                const bp = JSON.parse(legacyBp);
                if (bp.length) migrated.blueprints = bp;
                const userBpKey = userId ? `corebox_ship_blueprints_${userId}` : 'corebox_ship_blueprints';
                localStorage.setItem(userBpKey, JSON.stringify(bp));
                console.log(`🔄 Миграция: чертежи сохранены в ${userBpKey}`);
                localStorage.removeItem(legacyBpKey);
            }
        } catch(e) {
            console.warn('Ошибка миграции чертежей:', e);
        }

        try {
            const legacyFleetKey = 'corebox_fleet';
            const legacyFleet = localStorage.getItem(legacyFleetKey);
            if (legacyFleet) {
                const fleet = JSON.parse(legacyFleet);
                if (fleet.length) migrated.fleet = fleet;
                const userFleetKey = userId ? `corebox_fleet_${userId}` : 'corebox_fleet';
                localStorage.setItem(userFleetKey, JSON.stringify(fleet));
                console.log(`🔄 Миграция: флот сохранён в ${userFleetKey}`);
                localStorage.removeItem(legacyFleetKey);
            }
        } catch(e) {
            console.warn('Ошибка миграции флота:', e);
        }

        localStorage.setItem(MIGRATION_KEY, 'true');
        return migrated;
    }

    if (oldSave.version === 1) {
        console.log('Миграция сохранения версии 1 -> 3');
        let consciousness = oldSave.neuro_consciousness || 0.05;
        consciousness = normalizeNeuroConsciousness(consciousness);

        const migrated = {
            version: 3,
            timestamp: Date.now(),
            _savedAt: Date.now(),
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
            game_time: oldSave.game_time ?? 24,
            is_day: oldSave.is_day !== undefined ? oldSave.is_day : true,
            coal_enabled: oldSave.coal_enabled || false,
            rebel_activity: 0,
            rebel_protection_nights: 0,
            rebel_protection_active: false,
            blueprints: [],
            fleet: [],
            defense_ship_id: null,
            fleet_log: [],

            turbine_heat: 0,
            turbine_upgrade_level: 0,
            statistics: {},
            passive_rates: { coal: 0.010, trash: 0.008, ore: 0.006 },
            last_ai_coal_threshold: 0,
            current_night_type: "",
            attack_history: [],
            quests_progress: [],
            auto_clicking: false,
            planets: [],
            active_planet_missions: [],
            chips_unlocked: false,
            plasma_unlocked: false,
            map_x: null,
            map_y: null,
        };

        try {
            const legacyBpKey = 'corebox_ship_blueprints';
            const legacyBp = localStorage.getItem(legacyBpKey);
            if (legacyBp) {
                const bp = JSON.parse(legacyBp);
                if (bp.length) migrated.blueprints = bp;
                const userBpKey = userId ? `corebox_ship_blueprints_${userId}` : 'corebox_ship_blueprints';
                localStorage.setItem(userBpKey, JSON.stringify(bp));
                localStorage.removeItem(legacyBpKey);
            }
        } catch(e) {}

        try {
            const legacyFleetKey = 'corebox_fleet';
            const legacyFleet = localStorage.getItem(legacyFleetKey);
            if (legacyFleet) {
                const fleet = JSON.parse(legacyFleet);
                if (fleet.length) migrated.fleet = fleet;
                const userFleetKey = userId ? `corebox_fleet_${userId}` : 'corebox_fleet';
                localStorage.setItem(userFleetKey, JSON.stringify(fleet));
                localStorage.removeItem(legacyFleetKey);
            }
        } catch(e) {}

        localStorage.setItem(MIGRATION_KEY, 'true');
        return migrated;
    }

    console.warn(`⚠️ Неизвестная версия сохранения: ${oldSave.version}, возвращаем как есть`);
    return oldSave;
}

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
        const fleet = getFleet();

        const computationalPower = gameInstance.get_computational_power?.() ?? rustState?.computational_power ?? 0;
        const maxComputationalPower = gameInstance.get_max_computational_power?.() ?? rustState?.max_computational_power ?? 1000;

        let neuroConsciousness = rustState?.neuro_consciousness || 0;
        neuroConsciousness = normalizeNeuroConsciousness(neuroConsciousness);

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
            total_coal_mined:   rustState?.coal_mined   ?? rustState?.total_coal_mined   ?? 0,
            total_trash_mined:  rustState?.trash_mined  ?? rustState?.total_trash_mined  ?? 0,
            total_plasma_mined: rustState?.plasma_mined ?? rustState?.total_plasma_mined ?? 0,
            total_ore_mined:    rustState?.ore_mined    ?? rustState?.total_ore_mined    ?? 0,
            total_coal_burned:  rustState?.coal_burned  ?? rustState?.total_coal_burned  ?? 0,
            total_coal_stolen:  rustState?.coal_stolen  ?? rustState?.total_coal_stolen  ?? 0,
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

        const now = Date.now();

        const saveData = {
            version: SAVE_VERSION,
            timestamp: now,
            _savedAt: now,
            last_game_change: now,

            inventory: {
                coal: rustState?.coal_inventory ?? 0,
                ore: rustState?.ore_inventory ?? 0,
                chips: rustState?.chips_inventory ?? 0,
                plasma: rustState?.plasma_inventory ?? 0,
                trash: rustState?.trash_inventory ?? 0
            },

            upgrades: {
                mining: rustState?.mining_level ?? 0,
                defense: rustState?.defense_active ?? false,
                defense_level: rustState?.defense_level ?? 0,
                crit_level: rustState?.crit_level ?? 0,
                cooling_level: rustState?.cooling_level ?? 0
            },

            computational_power: computationalPower,
            max_computational_power: maxComputationalPower,
            nights_survived: rustState?.nights_survived ?? 0,
            total_mined: rustState?.total_mined ?? rustState?.total_clicks ?? 0,

            neuro: {
                evolution: rustState?.neuro_evolution ?? 0,
                consciousness: neuroConsciousness,
                score: rustState?.neuro_score ?? 0,
                ai_mode: rustState?.current_ai_mode ?? "Обычный"
            },

            game_time: rustState?.game_time ?? 24,
            is_day: rustState?.is_day !== undefined ? rustState.is_day : true,
            coal_enabled: rustState?.coal_enabled ?? false,
            rebel_activity: rustState?.rebel_activity ?? 0,
            rebel_protection_nights: rebelProtectionNights,
            rebel_protection_active: rebelProtectionActive,
            turbine_heat: rustState?.turbine_heat ?? 0,
            turbine_upgrade_level: rustState?.turbine_upgrade_level ?? 0,

            statistics: statistics,

            blueprints: blueprints,
            fleet: fleet,

            defense_ship_id: defenseShipId,
            fleet_log: fleetLog,

            passive_rates: getPassiveRates(),

            last_ai_coal_threshold: rustState?.last_ai_coal_threshold ?? 0,

            current_night_type: rustState?.current_night_type ?? "",

            attack_history: attackHistory,

            quests_progress: questsProgress,

            auto_clicking: localStorage.getItem('corebox_autoclicking') === 'true',

            planets: planets,
            active_planet_missions: activePlanetMissions,

            chips_unlocked: rustState?.chips_unlocked ?? false,
            plasma_unlocked: rustState?.plasma_unlocked ?? false,

            map_x: rustState?.map_x ?? window.spaceModule?._myMapPos?.x ?? null,
            map_y: rustState?.map_y ?? window.spaceModule?._myMapPos?.y ?? null,
        };

        localStorage.setItem('corebox_save_backup', JSON.stringify(saveData));

        const cargoUnlocked = saveData.blueprints?.find(b => b.id === 'cargo')?.unlocked || false;
        const scoutUnlocked = saveData.blueprints?.find(b => b.id === 'scout')?.unlocked || false;
        const combatUnlocked = saveData.blueprints?.find(b => b.id === 'combat')?.unlocked || false;

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
            map_x: saveData.map_x,
            map_y: saveData.map_y,
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
            const migrated = migrateSave(cloudSave, user.id);
            if (!migrated) {
                console.error('Миграция невозможна, используем пустое состояние');
                return null;
            }
            cloudSave = migrated;
        }

        if (cloudSave.neuro && cloudSave.neuro.consciousness > 1.5) {
            cloudSave.neuro.consciousness = normalizeNeuroConsciousness(cloudSave.neuro.consciousness);
        }
        if (cloudSave.neuro) {
            cloudSave.neuro.consciousness = Math.min(1.0, Math.max(0.0, cloudSave.neuro.consciousness));
        }

        if (cloudSave.is_day === true) {
            cloudSave.trade_blocked = false;
        }

        if (mergeWithLocal) {
            const localSave = getLocalSave();
            const CLOCK_TOLERANCE_MS = 60 * 1000;
            const localTimestamp = localSave?.timestamp || localSave?._savedAt || 0;
            const cloudTimestamp = cloudSave.timestamp || cloudSave._savedAt || 0;

            if (localSave && localTimestamp > cloudTimestamp + CLOCK_TOLERANCE_MS) {
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
            window.fleetModule.defenseShipId = cloudSave.defense_ship_id;
            const ship = window.fleetModule.ships.find(s => s.id === cloudSave.defense_ship_id);
            if (ship) ship.onDefense = true;
        }

        if (cloudSave.fleet_log && cloudSave.fleet_log.length > 0 && window.fleetModule) {
            const userId = window.currentUser?.id;
            const key = `corebox_fleet_log_${userId || 'anon'}`;
            const localSaved = localStorage.getItem(key);
            if (localSaved === null) {
                localStorage.setItem(key, JSON.stringify(cloudSave.fleet_log));
                window.fleetModule.fleetLog = cloudSave.fleet_log;
            }
        }

        if (cloudSave.auto_clicking !== undefined) {
            localStorage.setItem('corebox_autoclicking', cloudSave.auto_clicking ? 'true' : 'false');
        }

        const universalSave = {
            inventory: cloudSave.inventory,
            computational_power: cloudSave.computational_power,
            max_computational_power: cloudSave.max_computational_power,
            neuro_evolution: cloudSave.neuro?.evolution,
            chips_unlocked: cloudSave.chips_unlocked,
            plasma_unlocked: cloudSave.plasma_unlocked,
            timestamp: Date.now()
        };
        localStorage.setItem('corebox_save_universal', JSON.stringify(universalSave));

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