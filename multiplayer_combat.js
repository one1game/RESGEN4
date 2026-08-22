import { supabase } from './supabase.js';
import { fleetModule } from './fleet.js';

let isProcessingMissions = false;
const _processedMissions = new Set();
const _processingLock = new Map();

let _lastProcessTime = 0;
let _lastProcessHash = '';
let _isProcessingQueue = false;
const _missionProcessQueue = [];

setInterval(() => {
    if (_processedMissions.size > 1000) {
        _processedMissions.clear();
    }
}, 30 * 60 * 1000);

function getShipTravelSeconds(shipType) {
    const cfg = window.gameConfig?.fleet_config;
    const defaults = { scout: 30, combat: 45, cargo: 40 };
    return cfg?.[shipType]?.travel_time_sec ?? defaults[shipType] ?? 60;
}

const SHIP_ICONS = { scout: '🔭', combat: '⚔️', cargo: '🚚' };
const SHIP_LABELS = { scout: 'Разведчик', combat: 'Боевой', cargo: 'Грузовой' };

export async function sendShip(attackerId, targetId, shipType) {
    const icon = SHIP_ICONS[shipType] || '🚀';
    const label = SHIP_LABELS[shipType] || shipType;
    if (!SHIP_ICONS[shipType]) return { success: false, error: 'Неизвестный тип корабля' };

    if (attackerId === targetId) {
        return { success: false, error: 'Нельзя атаковать собственную базу' };
    }

    const { data: targetExists, error: targetError } = await supabase
        .from('game_saves')
        .select('user_id')
        .eq('user_id', targetId)
        .maybeSingle();

    if (targetError || !targetExists) {
        return { success: false, error: 'Цель не найдена или недоступна' };
    }

    const ship = fleetModule.getAvailableShip(shipType);
    if (!ship) {
        return {
            success: false,
            error: `Нет свободного ${icon} ${label} во флоте. Постройте его во вкладке КРАФТ.`
        };
    }

    if (shipType !== 'scout') {
        const scout = await getLatestScoutData(attackerId, targetId);
        if (!scout) {
            return { success: false, error: 'Сначала проведите разведку базы' };
        }
        const age = Date.now() - new Date(scout.scouted_at || scout.created_at).getTime();
        if (age > 30 * 60 * 1000) {
            return { success: false, error: 'Данные разведки устарели (>30 мин). Повторите разведку' };
        }
    }

    if (shipType === 'combat') {
        const { data: recent } = await supabase
            .from('missions')
            .select('created_at')
            .eq('attacker_id', attackerId)
            .eq('target_id', targetId)
            .eq('ship_type', 'combat')
            .gte('created_at', new Date(Date.now() - 20 * 60 * 1000).toISOString())
            .limit(1);
        if (recent && recent.length > 0) {
            return { success: false, error: 'Повторная атака доступна только через 20 минут' };
        }
    }

    if (shipType === 'cargo') {
        const { data: activeCargo } = await supabase
            .from('missions')
            .select('id')
            .eq('attacker_id', attackerId)
            .eq('target_id', targetId)
            .eq('ship_type', 'cargo')
            .in('status', ['flying', 'returning', 'arrived'])
            .limit(1);
        if (activeCargo && activeCargo.length > 0) {
            return { success: false, error: 'Грузовой корабль уже в полёте к этому игроку' };
        }
    }

    const now = Date.now();
    const travelTimeMs = getShipTravelSeconds(shipType) * 1000;
    const arrivesAt = new Date(now + travelTimeMs);
    const returnsAt = new Date(now + travelTimeMs * 2);

    console.log(`🚀 Отправка ${shipType}: сейчас=${new Date(now).toISOString()}, прибытие=${arrivesAt.toISOString()}, возврат=${returnsAt.toISOString()}`);

    let combatMissionId = null;
    if (shipType === 'cargo') {
        const { data: latestCombat } = await supabase
            .from('missions')
            .select('id')
            .eq('attacker_id', attackerId)
            .eq('target_id', targetId)
            .eq('ship_type', 'combat')
            .in('status', ['returning', 'done'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        combatMissionId = latestCombat?.id || null;
    }

    const flightMinutes = getShipTravelSeconds(shipType) / 60;

    const { data: mission, error } = await supabase
        .from('missions')
        .insert({
            attacker_id:  attackerId,
            target_id:    targetId,
            ship_type:    shipType,
            status:       'flying',
            fleet_ship_id: ship.id,
            arrives_at:   arrivesAt.toISOString(),
            returns_at:   returnsAt.toISOString(),
            created_at:   new Date(now).toISOString(),
            combat_mission_id: combatMissionId,
        })
        .select()
        .single();

    if (error) {
        console.error('Ошибка создания миссии:', error);
        return { success: false, error: 'Ошибка сервера. Попробуйте ещё раз' };
    }

    fleetModule.setShipMissionStatus(ship.id, true, mission.id, mission, targetId, null);

    if (window.fleetModule) {
        window.fleetModule._addFleetLog(
            `🚀 ${icon} ${ship.name} отправлен (прибытие: ${new Date(arrivesAt).toLocaleTimeString()})`
        );
    }

    await pushNotification(attackerId, 'mission_sent', {
        message: `🚀 Миссия отправлена (${icon} ${label}), прибытие через ${Math.round(flightMinutes)} мин`,
        payload: { mission_id: mission.id, ship_type: shipType, arrives_at: arrivesAt.toISOString() }
    });

    await pushNotification(targetId, 'incoming_ship', {
        message: `⚠️ К вашей планете летит ${icon} ${label}! Прибудет через ${Math.floor(getShipTravelSeconds(shipType) / 60)} мин.`,
        payload: { arrives_at: arrivesAt.toISOString(), mission_id: mission.id, ship_type: shipType }
    });

    return { success: true, mission, ship };
}

export async function processArrivedMissions(currentUserId) {
    if (isProcessingMissions) {
        console.log("⏭️ processArrivedMissions уже выполняется, пропускаем");
        return;
    }

    const now = Date.now();
    if (now - _lastProcessTime < 5000) {
        console.log("⏭️ Слишком частый вызов processArrivedMissions, пропускаем");
        return;
    }

    isProcessingMissions = true;
    const nowDate = new Date();

    try {
        console.log(`🔄 processArrivedMissions вызван в ${nowDate.toISOString()}`);

        const { data: arrived, error: err1 } = await supabase
            .from('missions')
            .update({ status: 'processing' })
            .eq('target_id', currentUserId)
            .eq('status', 'flying')
            .lte('arrives_at', nowDate.toISOString())
            .select()
            .limit(10);

        if (err1) console.error('Ошибка запроса arrived:', err1);

        console.log(`📥 Найдено входящих миссий для обработки: ${arrived?.length || 0}`);

        for (const mission of arrived ?? []) {
            const lockTime = _processingLock.get(mission.id);
            if (lockTime && Date.now() - lockTime < 60000) {
                console.log(`⏭️ Миссия ${mission.id} уже обрабатывается, пропускаем`);
                continue;
            }
            _processingLock.set(mission.id, Date.now());

            if (_processedMissions.has(mission.id)) {
                console.log(`⏭️ Миссия ${mission.id} уже обработана, пропускаем`);
                continue;
            }

            _processedMissions.add(mission.id);

            console.log(`📦 Обработка входящей миссии ${mission.id}, тип=${mission.ship_type}`);

            try {
                if (mission.ship_type === 'scout')  await _processScout(mission);
                if (mission.ship_type === 'combat') await _processCombat(mission);
                if (mission.ship_type === 'cargo')  await _processCargo(mission);
            } catch (e) {
                console.error(`Mission ${mission.id} failed:`, e);
                await supabase.from('missions')
                    .update({ status: 'flying' })
                    .eq('id', mission.id);
                continue;
            }

            setTimeout(() => _processedMissions.delete(mission.id), 3600000);
            setTimeout(() => _processingLock.delete(mission.id), 60000);
        }

        const { data: returning, error: err2 } = await supabase
            .from('missions')
            .select('*')
            .eq('attacker_id', currentUserId)
            .in('status', ['returning', 'arrived'])
            .lte('returns_at', nowDate.toISOString());

        if (err2) console.error('Ошибка запроса returning:', err2);

        console.log(`📤 Найдено возвращающихся миссий: ${returning?.length || 0}`);

        for (const mission of returning ?? []) {
            if (_processedMissions.has(mission.id)) {
                console.log(`⏭️ Миссия ${mission.id} уже обработана, пропускаем`);
                continue;
            }

            _processedMissions.add(mission.id);

            console.log(`🏁 Завершение миссии ${mission.id}, статус=${mission.status}`);

            const { error: updateError } = await supabase
                .from('missions')
                .update({
                    status: 'done',
                    completed_at: nowDate.toISOString()
                })
                .eq('id', mission.id)
                .in('status', ['returning', 'arrived']);

            if (updateError) {
                console.warn(`Ошибка обновления статуса миссии ${mission.id}:`, updateError);
                _processedMissions.delete(mission.id);
                continue;
            }

            if (mission.fleet_ship_id && fleetModule) {
                const ship = fleetModule.ships.find(s => s.id === mission.fleet_ship_id);
                if (ship && ship.onMission) {
                    ship.onMission = false;
                    ship.currentMissionId = null;
                    ship.targetUserId = null;
                    ship.targetPlanetId = null;
                    ship.missionStartedAt = null;
                    ship.missionArrivesAt = null;
                    ship.missionReturnsAt = null;
                    fleetModule.saveFleet();
                    console.log(`🆓 Корабль ${ship.name} освобождён (миссия ${mission.id} завершена)`);

                    if (window.GameBus && window.GAME_EVENTS) {
                        window.GameBus.emit(window.GAME_EVENTS.SHIP_MISSION_END, {
                            ship: ship,
                            missionId: mission.id
                        });
                    }

                    if (window.spaceModule && typeof window.spaceModule._markDirty === 'function') {
                        window.spaceModule._markDirty();
                    }
                } else {
                    fleetModule.setShipMissionStatus(mission.fleet_ship_id, false);
                }
            }

            if (mission.ship_type === 'cargo' && mission.loot_result && Object.keys(mission.loot_result).length > 0) {
                const loot = mission.loot_result;
                if (window.game && typeof window.game.add_resource === 'function') {
                    if (loot.ore > 0) window.game.add_resource('ore', loot.ore);
                    if (loot.chips > 0) window.game.add_resource('chips', loot.chips);
                    if (loot.plasma > 0) window.game.add_resource('plasma', loot.plasma);
                    console.log(`📦 Начислены ресурсы: ore=${loot.ore}, chips=${loot.chips}, plasma=${loot.plasma}`);
                }
            }

            if (mission.ship_type === 'combat' && mission.loot && Object.keys(mission.loot).length > 0) {
                if (window.fleetModule) {
                    window.fleetModule._lastCombatResult = {
                        won: true,
                        targetUserId: mission.target_id,
                        loot: mission.loot,
                        timestamp: Date.now()
                    };
                    try {
                        const resultKey = typeof window.fleetModule._getResultStorageKey === 'function'
                            ? window.fleetModule._getResultStorageKey('combat')
                            : `corebox_last_combat_result_${mission.attacker_id || 'anon'}`;
                        localStorage.setItem(resultKey, JSON.stringify(window.fleetModule._lastCombatResult));
                        const winsKey = `corebox_pvp_wins_${window.currentUser?.id || mission.attacker_id || 'anon'}`;
                        const wins = Math.max(0, Number(localStorage.getItem(winsKey) || 0)) + 1;
                        localStorage.setItem(winsKey, String(wins));
                    } catch(e) {}
                    console.log(`⚔️ _lastCombatResult установлен для боевого корабля, target=${mission.target_id}`);
                }
            }

            if (typeof window.showNotif === 'function') {
                const icon = SHIP_ICONS[mission.ship_type];
                const label = SHIP_LABELS[mission.ship_type];
                window.showNotif(`✅ ${icon || '🚀'} ${label || 'Корабль'} вернулся!`, false);
            }

            if (mission.ship_type === 'cargo' && mission.loot_result) {
                const lootText = _formatLoot(mission.loot_result);
                if (lootText !== 'ничего') {
                    await pushNotification(mission.attacker_id, 'cargo_returned', {
                        message: `📦 Грузовой вернулся! Добавлено: ${lootText}`,
                        payload: { loot: mission.loot_result }
                    });
                }
            }

            if (mission.ship_type === 'scout' && mission.scout_data) {
                await pushNotification(mission.attacker_id, 'scout_report', {
                    message: `🔭 Разведчик вернулся с данными!`,
                    payload: { scout_data: mission.scout_data, mission_id: mission.id }
                });
            }

            if (mission.ship_type === 'combat' && mission.loot) {
                await pushNotification(mission.attacker_id, 'attack_result', {
                    message: `⚔️ Боевой корабль вернулся. Добыча: ${_formatLoot(mission.loot)}`,
                    payload: { loot: mission.loot, mission_id: mission.id }
                });
            }

            setTimeout(() => _processedMissions.delete(mission.id), 3600000);
        }

        if (window.fleetModule && typeof window._refreshFleetWithMissions === 'function') {
            await window._refreshFleetWithMissions();
        }

    } catch(e) {
        console.error('Ошибка в processArrivedMissions:', e);
    } finally {
        isProcessingMissions = false;
        _lastProcessTime = Date.now();
    }
}

async function _processScout(mission) {
    const { data: targetSave } = await supabase
        .from('game_saves')
        .select('ore, coal, chips, plasma, trash, full_state')
        .eq('user_id', mission.target_id)
        .maybeSingle();

    const fs = targetSave?.full_state ?? {};
    const hasDefense = fs.upgrades?.defense ?? false;

    const scoutData = {
        ore:          targetSave?.ore   ?? 0,
        coal:         targetSave?.coal  ?? 0,
        chips:        targetSave?.chips ?? 0,
        plasma:       targetSave?.plasma ?? 0,
        trash:        targetSave?.trash ?? 0,
        has_defense:  hasDefense,
        scouted_at:   new Date().toISOString(),
        data_freshness: targetSave?.updated_at || new Date().toISOString(),
    };

    if (hasDefense) {
        scoutData.chips  = Math.floor(scoutData.chips  * (0.5 + Math.random() * 0.5));
        scoutData.plasma = Math.floor(scoutData.plasma * (0.5 + Math.random() * 0.5));
        scoutData._obscured = true;
    }

    const { error } = await supabase
        .from('missions')
        .update({
            status: 'returning',
            scout_data: scoutData,
        })
        .eq('id', mission.id)
        .eq('status', 'processing');

    if (error) {
        throw error;
    }

    await pushNotification(mission.target_id, 'scout_passed', {
        message: `👁 Разведчик пролетел мимо вашей планеты.`,
        payload: {}
    });
}

async function _processCombat(mission) {
    try {
        const { data: result, error } = await supabase.rpc('atomic_pvp_steal', {
            p_attacker_id: mission.attacker_id,
            p_defender_id: mission.target_id,
            p_percent: 0.10 + Math.random() * 0.40
        });

        if (error) throw error;
        if (!result) {
            throw new Error('atomic_pvp_steal вернул пустой результат');
        }

        const loot = result.loot || {};

        const { error: statusError } = await supabase.from('missions').update({
            status: 'returning',
            loot: loot
        }).eq('id', mission.id).eq('status', 'processing');
        if (statusError) throw statusError;

        await pushNotification(mission.target_id, 'under_attack', {
            message: `💥 Ваша планета атакована! Потери: ${_formatLoot(loot)}`,
            payload: { stolen: loot }
        });

        await _invalidateVictimCache(mission.target_id);

    } catch(e) {
        console.error('Combat error:', e);
        // Важно пробросить ошибку в processArrivedMissions(),
        // чтобы его общий rollback вернул миссию из processing в flying.
        throw e;
    }
}

async function _invalidateVictimCache(victimId) {
    try {
        await supabase.from('game_saves').update({
            last_state_change: new Date().toISOString()
        }).eq('user_id', victimId);
    } catch(e) {}
}

async function _processCargo(mission) {
    let loot = {};

    if (mission.combat_mission_id) {
        const { data: combatMission } = await supabase
            .from('missions')
            .select('loot')
            .eq('id', mission.combat_mission_id)
            .maybeSingle();
        loot = combatMission?.loot ?? {};
    } else {
        const { data: combatMission } = await supabase
            .from('missions')
            .select('loot, returns_at, id')
            .eq('attacker_id', mission.attacker_id)
            .eq('target_id', mission.target_id)
            .eq('ship_type', 'combat')
            .in('status', ['returning', 'done'])
            .order('returns_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (combatMission && combatMission.returns_at) {
            const combatEnd = new Date(combatMission.returns_at).getTime();
            const cargoStart = new Date(mission.created_at).getTime();
            if (cargoStart - combatEnd > -120000 && cargoStart - combatEnd < 300000) {
                loot = combatMission.loot ?? {};
            }
        }
    }

    const { error } = await supabase
        .from('missions')
        .update({
            status: 'returning',
            loot_result: loot,
        })
        .eq('id', mission.id)
        .eq('status', 'processing');

    if (error) {
        throw error;
    }
}

function _calcLoot(inventory, pct) {
    const result = {};
    const resources = ['ore', 'coal', 'chips', 'plasma', 'trash'];
    for (const res of resources) {
        const amt = Math.floor((inventory[res] ?? 0) * pct);
        if (amt > 0) result[res] = amt;
    }
    return result;
}

function _formatLoot(loot) {
    if (!loot || Object.keys(loot).length === 0) return 'ничего';
    const icons = { ore:'⛏️', coal:'🪨', chips:'🎛️', plasma:'⚡', trash:'♻️' };
    return Object.entries(loot)
        .map(([r, a]) => `${icons[r] ?? '📦'}${a} ${r}`)
        .join(', ');
}

async function pushNotification(playerId, type, { message, payload }) {
    try {
        const { error } = await supabase.from('notifications').insert({
            player_id: playerId,
            type,
            message,
            payload: payload || {},
            created_at: new Date().toISOString(),
            is_read: false
        });
        if (error && error.code !== '23505') throw error;
    } catch(e) {
        if (e.code !== '23505') {
            console.warn(`Ошибка уведомления [${type}]:`, e.message);
        }
    }
}

export async function getLatestScoutData(attackerId, targetId) {
    const { data } = await supabase
        .from('missions')
        .select('scout_data, created_at')
        .eq('attacker_id', attackerId)
        .eq('target_id', targetId)
        .eq('ship_type', 'scout')
        .in('status', ['returning', 'done'])
        .not('scout_data', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!data?.scout_data) return null;

    return {
        scout_data: data.scout_data,
        created_at: data.created_at,
        scouted_at: data.scout_data?.scouted_at || data.created_at
    };
}

export async function getTargetPlayers(currentUserId) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: saves, error } = await supabase
        .from('game_saves')
        .select('user_id, ore, coal, chips, plasma, total_mined, neuro_evolution, nights_survived, computational_power, last_seen')
        .neq('user_id', currentUserId)
        .gte('last_seen', sevenDaysAgo)
        .order('total_mined', { ascending: false })
        .limit(50);

    if (error) throw error;

    const targetIds = (saves ?? []).map(s => s.user_id).filter(Boolean);
    let profiles = [];
    if (targetIds.length > 0) {
        const { data, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username')
            .in('id', targetIds);
        if (profilesError) throw profilesError;
        profiles = data ?? [];
    }

    const profileMap = {};
    (profiles ?? []).forEach(p => { profileMap[p.id] = p.username; });

    const { data: fleetStatuses } = await supabase
        .from('fleet_status')
        .select('user_id, has_defense_ship, defense_ship_level')
        .in('user_id', (saves ?? []).map(s => s.user_id));

    const fleetMap = {};
    (fleetStatuses ?? []).forEach(fs => {
        fleetMap[fs.user_id] = {
            has_defense_ship: fs.has_defense_ship,
            defense_ship_level: fs.defense_ship_level || 0
        };
    });

    return (saves ?? []).map(s => ({
        ...s,
        username: profileMap[s.user_id] ?? 'Игрок',
        isOnline: s.last_seen
            ? Date.now() - new Date(s.last_seen).getTime() < 5 * 60 * 1000
            : false,
        has_defense_ship: fleetMap[s.user_id]?.has_defense_ship || false,
        defense_ship_level: fleetMap[s.user_id]?.defense_ship_level || 0
    }));
}

export async function getActiveMissions(playerId) {
    if (!playerId) {
        console.warn('getActiveMissions: playerId не указан');
        return [];
    }

    const { data } = await supabase
        .from('missions')
        .select('*')
        .or(`attacker_id.eq.${playerId},target_id.eq.${playerId}`)
        .in('status', ['flying', 'returning', 'arrived'])
        .order('arrives_at');

    return data ?? [];
}

export async function getUnreadNotifications(playerId) {
    const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('player_id', playerId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(30);
    return data ?? [];
}

export async function markAllNotificationsRead(playerId) {
    await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('player_id', playerId)
        .eq('is_read', false);
}

export function subscribeToNotifications(playerId, onNew) {
    return supabase
        .channel(`notif:${playerId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `player_id=eq.${playerId}`,
        }, payload => onNew(payload.new))
        .subscribe();
}