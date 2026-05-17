// multiplayer_combat.js
// Боевая мультиплеерная система: разведка → атака → грабёж
// Читает флот из fleetModule, ресурсы из Rust через game.get_statistics()

import { supabase } from './supabase.js';
import { fleetModule } from './fleet.js';

// ─── Конфиг кораблей ───────────────────────────────────────────────────────
// Время в минутах
const SHIP_CONFIG = {
    scout:  { travel_minutes: 5,  cost: { ore: 0,   chips: 0,  plasma: 0  }, label: 'Разведчик',  icon: '🔭' },
    combat: { travel_minutes: 8,  cost: { ore: 0,   chips: 0,  plasma: 0  }, label: 'Боевой',     icon: '⚔️' },
    cargo:  { travel_minutes: 6,  cost: { ore: 0,   chips: 0,  plasma: 0  }, label: 'Грузовой',   icon: '🚚' },
};

const LOOT_MIN = 0.10;  // 10% ресурсов жертвы
const LOOT_MAX = 0.50;  // 50% ресурсов жертвы

// ─── Отправить корабль ─────────────────────────────────────────────────────
export async function sendShip(attackerId, targetId, shipType) {
    const cfg = SHIP_CONFIG[shipType];
    if (!cfg) return { success: false, error: 'Неизвестный тип корабля' };

    // 1. Проверяем наличие свободного корабля в флоте
    const ship = fleetModule.getAvailableShip(shipType);
    if (!ship) {
        return {
            success: false,
            error: `Нет свободного ${cfg.icon} ${cfg.label} во флоте. Постройте его во вкладке КРАФТ.`
        };
    }

    // 2. Нельзя атаковать себя
    if (attackerId === targetId) {
        return { success: false, error: 'Нельзя атаковать собственную базу' };
    }

    // 3. Для грузового и боевого — нужна свежая разведка (не старше 30 мин)
    if (shipType !== 'scout') {
        const scout = await getLatestScoutData(attackerId, targetId);
        if (!scout) {
            return { success: false, error: 'Сначала проведите разведку базы' };
        }
        const age = Date.now() - new Date(scout.created_at).getTime();
        if (age > 30 * 60 * 1000) {
            return { success: false, error: 'Данные разведки устарели (>30 мин). Повторите разведку' };
        }
    }

    // 4. Кулдаун на боевые атаки
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

    // 5. Рассчитываем время полёта
    const now = new Date();
    const arrivesAt = new Date(now.getTime() + cfg.travel_minutes * 60_000);
    const returnsAt = new Date(arrivesAt.getTime() + cfg.travel_minutes * 60_000);

    // 6. Создаём миссию в Supabase
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
        })
        .select()
        .single();

    if (error) {
        console.error('Ошибка создания миссии:', error);
        return { success: false, error: 'Ошибка сервера. Попробуйте ещё раз' };
    }

    // 7. Помечаем корабль как занятый
    fleetModule.setShipMissionStatus(ship.id, true);

    // 8. Оповещаем жертву
    await pushNotification(targetId, 'incoming_ship', {
        message: `⚠️ К вашей планете летит неизвестный объект! Прибудет через ${cfg.travel_minutes} мин.`,
        payload: { arrives_at: arrivesAt.toISOString(), mission_id: mission.id }
    });

    return { success: true, mission, ship };
}

// ─── Обработка прибытия (вызывается polling-ом в game.js) ─────────────────
export async function processArrivedMissions(currentUserId) {
    const now = new Date().toISOString();

    // Входящие миссии, которые долетели до цели
    const { data: arrived } = await supabase
        .from('missions')
        .select('*')
        .eq('target_id', currentUserId)
        .eq('status', 'flying')
        .lte('arrives_at', now);

    for (const mission of arrived ?? []) {
        if (mission.ship_type === 'scout')  await _processScout(mission);
        if (mission.ship_type === 'combat') await _processCombat(mission);
        if (mission.ship_type === 'cargo')  await _processCargo(mission);
    }

    // Исходящие миссии, которые возвращаются домой
    const { data: returning } = await supabase
        .from('missions')
        .select('*')
        .eq('attacker_id', currentUserId)
        .in('status', ['returning', 'arrived'])
        .lte('returns_at', now);

    for (const mission of returning ?? []) {
        // Освобождаем корабль во флоте
        if (mission.fleet_ship_id) {
            fleetModule.setShipMissionStatus(mission.fleet_ship_id, false);
        }
        
        await supabase.from('missions').update({ status: 'done' }).eq('id', mission.id);

        // Если грузовой — добавляем лут в инвентарь
        if (mission.ship_type === 'cargo' && mission.loot && window.game) {
            _applyLootToGame(mission.loot);
            await pushNotification(mission.attacker_id, 'cargo_returned', {
                message: `📦 Грузовой вернулся! Добавлено: ${_formatLoot(mission.loot)}`,
                payload: { loot: mission.loot }
            });
        }

        if (mission.ship_type === 'scout' && mission.scout_data) {
            await pushNotification(mission.attacker_id, 'scout_report', {
                message: `🔭 Разведчик вернулся с данными!`,
                payload: { scout_data: mission.scout_data, mission_id: mission.id }
            });
        }

        if (mission.ship_type === 'combat') {
            const stolenText = mission.loot ? _formatLoot(mission.loot) : 'ничего';
            await pushNotification(mission.attacker_id, 'attack_result', {
                message: `⚔️ Боевой корабль вернулся. Ресурсы разграблены: ${stolenText}`,
                payload: { loot: mission.loot, mission_id: mission.id }
            });
        }
    }
}

// ─── Внутренние обработчики прибытия ──────────────────────────────────────
async function _processScout(mission) {
    // Читаем данные цели из game_saves
    const { data: targetSave } = await supabase
        .from('game_saves')
        .select('ore, coal, chips, plasma, trash, full_state')
        .eq('user_id', mission.target_id)
        .single();

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
    };

    // Если у цели защита — часть данных скрываем
    if (hasDefense) {
        scoutData.chips  = Math.floor(scoutData.chips  * (0.5 + Math.random() * 0.5));
        scoutData.plasma = Math.floor(scoutData.plasma * (0.5 + Math.random() * 0.5));
        scoutData._obscured = true;
    }

    await supabase.from('missions').update({
        status:     'returning',
        scout_data: scoutData,
    }).eq('id', mission.id);

    await pushNotification(mission.target_id, 'scout_passed', {
        message: `👁 Неизвестный объект пролетел мимо вашей планеты.`,
        payload: {}
    });
}

async function _processCombat(mission) {
    const { data: targetSave } = await supabase
        .from('game_saves')
        .select('ore, coal, chips, plasma, trash, full_state')
        .eq('user_id', mission.target_id)
        .single();

    if (!targetSave) {
        await supabase.from('missions').update({ status: 'returning' }).eq('id', mission.id);
        return;
    }

    const fs = targetSave.full_state ?? {};
    const hasDefense = fs.upgrades?.defense ?? false;

    let pct = LOOT_MIN + Math.random() * (LOOT_MAX - LOOT_MIN);
    if (hasDefense) pct *= 0.5;

    const inventory = {
        ore:   targetSave.ore   ?? 0,
        coal:  targetSave.coal  ?? 0,
        chips: targetSave.chips ?? 0,
        plasma: targetSave.plasma ?? 0,
        trash:  targetSave.trash ?? 0,
    };
    const loot = _calcLoot(inventory, pct);

    // Обновляем ресурсы жертвы
    const newInventory = {};
    for (const [res, val] of Object.entries(inventory)) {
        newInventory[res] = Math.max(0, val - (loot[res] ?? 0));
    }

    await supabase.from('game_saves').update({
        ore:   newInventory.ore,
        coal:  newInventory.coal,
        chips: newInventory.chips,
        plasma: newInventory.plasma,
        trash:  newInventory.trash,
        full_state: { ...fs, inventory: newInventory },
        updated_at: new Date().toISOString(),
    }).eq('user_id', mission.target_id);

    await supabase.from('missions').update({
        status: 'returning',
        loot:   loot,
    }).eq('id', mission.id);

    await supabase.from('battle_log').insert({
        attacker_id:      mission.attacker_id,
        defender_id:      mission.target_id,
        ship_type:        'combat',
        outcome:          hasDefense ? 'partial' : 'success',
        resources_stolen: loot,
    });

    await pushNotification(mission.target_id, 'under_attack', {
        message: `💥 Ваша планета атакована неизвестным противником! Потери: ${_formatLoot(loot)}`,
        payload: { stolen: loot, had_defense: hasDefense }
    });
}

async function _processCargo(mission) {
    const { data: combatMission } = await supabase
        .from('missions')
        .select('loot')
        .eq('attacker_id', mission.attacker_id)
        .eq('target_id',   mission.target_id)
        .eq('ship_type',   'combat')
        .in('status',      ['returning','done'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const loot = combatMission?.loot ?? {};

    await supabase.from('missions').update({
        status: 'returning',
        loot:   loot,
    }).eq('id', mission.id);

    if (Object.keys(loot).length > 0) {
        await pushNotification(mission.target_id, 'looted', {
            message: `📦 Грузовой корабль противника похитил ваши ресурсы: ${_formatLoot(loot)}`,
            payload: { stolen: loot }
        });
    }
}

// ─── Применить лут к игре ─────────────────────────────────────────────────
function _applyLootToGame(loot) {
    if (!window.game) return;
    try {
        // Используем существующий метод add_resource
        for (const [res, amt] of Object.entries(loot)) {
            window.game.add_resource(res, amt);
        }
        console.log("✅ Лут применён:", loot);
    } catch(e) {
        console.warn("Не удалось применить лут через add_resource, пробуем pending", e);
        // Запасной вариант через localStorage
        const pending = JSON.parse(localStorage.getItem('corebox_pending_loot') || '{}');
        for (const [res, amt] of Object.entries(loot)) {
            pending[res] = (pending[res] || 0) + amt;
        }
        localStorage.setItem('corebox_pending_loot', JSON.stringify(pending));
    }
}

// ─── Получить данные последней разведки ───────────────────────────────────
export async function getLatestScoutData(attackerId, targetId) {
    const { data } = await supabase
        .from('missions')
        .select('scout_data, created_at')
        .eq('attacker_id', attackerId)
        .eq('target_id',   targetId)
        .eq('ship_type',   'scout')
        .in('status',      ['returning','done'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    return data ?? null;
}

// ─── Список игроков для атаки ─────────────────────────────────────────────
export async function getTargetPlayers(currentUserId) {
    const { data: saves } = await supabase
        .from('game_saves')
        .select('user_id, ore, coal, chips, plasma, total_mined, neuro_evolution, last_seen')
        .neq('user_id', currentUserId)
        .order('total_mined', { ascending: false })
        .limit(50);

    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username');

    const profileMap = {};
    (profiles ?? []).forEach(p => { profileMap[p.id] = p.username; });

    return (saves ?? []).map(s => ({
        ...s,
        username: profileMap[s.user_id] ?? 'Игрок',
        isOnline: s.last_seen
            ? Date.now() - new Date(s.last_seen).getTime() < 5 * 60 * 1000
            : false,
    }));
}

// ─── Активные миссии игрока ────────────────────────────────────────────────
export async function getActiveMissions(playerId) {
    const { data } = await supabase
        .from('missions')
        .select('*')
        .or(`attacker_id.eq.${playerId},target_id.eq.${playerId}`)
        .in('status', ['flying','returning','arrived'])
        .order('arrives_at');
    return data ?? [];
}

// ─── Оповещения ───────────────────────────────────────────────────────────
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

// Realtime-подписка на оповещения
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

// ─── Вспомогательные ──────────────────────────────────────────────────────
function _calcLoot(inventory, pct) {
    const result = {};
    const resources = ['ore','coal','chips','plasma', 'trash'];
    for (const res of resources) {
        const amt = Math.floor((inventory[res] ?? 0) * pct);
        if (amt > 0) result[res] = amt;
    }
    return result;
}

function _formatLoot(loot) {
    if (!loot || !Object.keys(loot).length) return 'ничего';
    const icons = { ore:'⛏️', coal:'🪨', chips:'🎛️', plasma:'⚡', trash:'♻️' };
    return Object.entries(loot)
        .map(([r, a]) => `${icons[r] ?? '📦'}${a} ${r}`)
        .join(', ');
}

async function pushNotification(playerId, type, { message, payload }) {
    try {
        await supabase.from('notifications').insert({ 
            player_id: playerId, 
            type, 
            message, 
            payload: payload || {} 
        });
    } catch(e) {
        console.warn('Ошибка отправки уведомления:', e);
    }
}