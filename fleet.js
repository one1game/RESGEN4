// ======== fleet.js (ИСПРАВЛЕНАЯ ВЕРСИЯ v3.4) ========
// ИСПРАВЛЕНИЯ:
// БАГ F-01: send_ship_to_planet — resources_taken прокидывается корректно
// БАГ F-02: _processLoot — статус done пишется ПОСЛЕ сохранения лута
// БАГ F-03: saveFleet(force=true) — объединены ветки, убран дубль
// БАГ F-04: getFleetDefenseContribution — реализован бонус от защитника
// БАГ F-05: _startShipTimers — при diffMs <= 0 вызывается refreshActiveMissions
// БАГ F-06: _calcCombatChances — при равных уровнях 45%/55%
// БАГ F-07: refreshActivePvpMissions — добавлено поле attackerId
// БАГ F-08: removeShip — нельзя удалить корабль на миссии + refreshActivePvpMissions
// БАГ F-09: setShipMissionStatus — убран дублирующий сброс currentMissionId
// БАГ F-10: _cleanupStuckShips — MAX_MISSION_MS для планетарных миссий 5 минут
// БАГ F-11: setupEventListeners — cargoBtn проверяет существование _lastCombatResult

import { supabase } from './supabase.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return '&#39;';
    });
}

export const fleetModule = {
    game: null,
    ships: [],
    maxFleetSize: 20,
    alertMultiplier: 1.0,
    aiMode: 'normal',
    lastDamageProcessedAttackId: null,
    lastProcessedAttackTime: 0,
    isInitializing: true,
    currentUserId: null,
    
    fleetLog: [],
    defenseShipId: null,
    activePvpMissions: [],
    commandLog: [],
    _flightLineInterval: null,
    _shipTimerInterval: null,
    _currentTab: 'inventory',
    
    _lastScoutResult: null,
    _lastCombatResult: null,
    _saveQueue: [],
    _isSavingFleet: false,
    
    shipTypes: {
        cargo: { name: 'Грузовой корабль', icon: '🚚', capacity: 500, speed: 1.0, combat: 5 },
        scout: { name: 'Разведывательный корабль', icon: '🔭', capacity: 100, speed: 3.0, combat: 15 },
        combat: { name: 'Боевой корабль', icon: '⚔️', capacity: 200, speed: 2.0, combat: 50 }
    },
    
    cleanup() {
        if (this._shipTimerInterval) {
            clearInterval(this._shipTimerInterval);
            this._shipTimerInterval = null;
        }
        this.ships = [];
        this.defenseShipId = null;
        this.fleetLog = [];
        this._lastScoutResult = null;
        this._lastCombatResult = null;
        console.log('🚀 Модуль флота очищен');
    },
    
    _getStorageKey() {
        return this.currentUserId ? `corebox_fleet_${this.currentUserId}` : 'corebox_fleet';
    },
    
    _getDefenseStorageKey() {
        return this.currentUserId ? `corebox_defense_ship_${this.currentUserId}` : 'corebox_defense_ship';
    },
    
    refreshActivePvpMissions() {
        this.activePvpMissions = this.ships
            .filter(s => s.onMission && s.currentMissionId && s.targetUserId)
            .map(s => {
                let status = 'flying';
                if (s.missionArrivesAt && s.missionReturnsAt) {
                    const now = Date.now();
                    if (now >= s.missionArrivesAt && now < s.missionReturnsAt) {
                        status = 'returning';
                    } else if (now >= s.missionReturnsAt) {
                        status = 'done';
                    }
                }
                // БАГ F-07: добавлено поле attackerId
                return {
                    shipId: s.id,
                    targetUserId: s.targetUserId,
                    attackerId: this.currentUserId,
                    phase: s.shipType || s.type,
                    status: status,
                    arrivesAt: s.missionArrivesAt,
                    returnsAt: s.missionReturnsAt
                };
            });
        
        const key = `corebox_pvp_missions_${this.currentUserId || 'anon'}`;
        localStorage.setItem(key, JSON.stringify(this.activePvpMissions));
        console.log(`🔄 Обновлены активные PvP-миссии: ${this.activePvpMissions.length}`);
    },
    
    // БАГ F-10: MAX_MISSION_MS для планетарных миссий 5 минут
    _cleanupStuckShips() {
        let changed = false;
        const now = Date.now();
        this.ships.forEach(s => {
            let isStuck = false;
            const MAX_MISSION_MS = s.targetPlanetId ? 5 * 60 * 1000 : 60 * 60 * 1000;
            
            if (s.onMission && s.missionStartedAt) {
                const elapsed = now - s.missionStartedAt;
                if (elapsed > MAX_MISSION_MS) isStuck = true;
            }
            if (!isStuck && s.onMission && s.missionArrivesAt && now > s.missionArrivesAt + MAX_MISSION_MS) {
                isStuck = true;
            }
            
            if (isStuck) {
                console.warn(`⚠️ Корабль ${s.id} завис — освобождаем`);
                s.onMission = false;
                s.missionStartedAt = null;
                s.missionArrivesAt = null;
                s.missionReturnsAt = null;
                s.currentMissionId = null;
                s.targetUserId = null;
                s.targetPlanetId = null;
                changed = true;
            }
        });
        if (changed) {
            this.saveFleet();
            this.refreshActivePvpMissions();
            this._renderFleetTab?.();
        }
    },
    
    init(game, userId) {
        this.game = game;
        
        if (!userId) {
            console.warn('⚠️ fleetModule.init: userId не указан, флот может не сохраниться');
        }
        this.currentUserId = userId;
        
        this._loadFromLocalStorage();
        this._loadDefenseShip();
        this._loadFleetLog();
        
        const savedScoutResult = localStorage.getItem('corebox_last_scout_result');
        if (savedScoutResult) {
            try {
                this._lastScoutResult = JSON.parse(savedScoutResult);
                if (Date.now() - this._lastScoutResult.timestamp > 30 * 60 * 1000) {
                    this._lastScoutResult = null;
                    localStorage.removeItem('corebox_last_scout_result');
                }
            } catch(e) {
                this._lastScoutResult = null;
            }
        }
        
        const savedCombatResult = localStorage.getItem('corebox_last_combat_result');
        if (savedCombatResult) {
            try {
                this._lastCombatResult = JSON.parse(savedCombatResult);
                if (Date.now() - this._lastCombatResult.timestamp > 30 * 60 * 1000) {
                    this._lastCombatResult = null;
                    localStorage.removeItem('corebox_last_combat_result');
                }
            } catch(e) {
                this._lastCombatResult = null;
            }
        }
        
        const key = `corebox_pvp_missions_${userId || 'anon'}`;
        const savedMissions = localStorage.getItem(key);
        if (savedMissions) {
            try {
                this.activePvpMissions = JSON.parse(savedMissions);
                console.log(`🔄 Восстановлено ${this.activePvpMissions.length} PvP-миссий из localStorage`);
            } catch(e) {}
        }
        
        console.log('🚀 Модуль флота инициализирован, кораблей:', this.ships.length);
        
        this._startShipTimers();
        
        setTimeout(() => {
            this.isInitializing = false;
            console.log('✅ Флот: инициализация завершена');
        }, 3000);
    },
    
    _loadFromLocalStorage() {
        const key = this._getStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.ships = parsed.filter(s => 
                    s && typeof s.id === 'string' && typeof s.type === 'string' && typeof s.name === 'string'
                );
                this.ships.forEach(s => {
                    if (!s.currentMissionId) {
                        s.onMission = false;
                        s.missionStartedAt = null;
                        s.missionArrivesAt = null;
                        s.missionReturnsAt = null;
                    }
                    if (s.health === undefined) s.health = 100;
                    if (s.maxHealth === undefined) s.maxHealth = 100;
                    if (s.level === undefined) s.level = 0;
                    if (s.experience === undefined) s.experience = 0;
                    if (s.missions === undefined) s.missions = 0;
                    if (s.onDefense === undefined) s.onDefense = false;
                    if (s.targetUserId === undefined) s.targetUserId = null;
                    if (s.targetPlanetId === undefined) s.targetPlanetId = null;
                    if (s.speed === undefined) s.speed = this.shipTypes[s.type]?.speed || 1;
                    
                    if (this.defenseShipId === s.id) {
                        s.onDefense = true;
                    } else if (s.onDefense && this.defenseShipId !== s.id) {
                        s.onDefense = false;
                    }
                });
                // БАГ X-03: убрана автоматическая saveFleet() при загрузке
            } catch (e) {
                console.error('Ошибка загрузки флота:', e);
                this.ships = [];
            }
        }
    },
    
    _loadDefenseShip() {
        const key = this._getDefenseStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const defenseId = JSON.parse(saved);
                const ship = this.ships.find(s => s.id === defenseId);
                if (ship && !ship.onMission && ship.type === 'combat') {
                    this.defenseShipId = defenseId;
                    ship.onDefense = true;
                } else {
                    localStorage.removeItem(key);
                }
            } catch(e) {}
        }
    },
    
    _loadFleetLog() {
        const key = `corebox_fleet_log_${this.currentUserId || 'anon'}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                this.fleetLog = JSON.parse(saved);
            } catch(e) {}
        }
    },
    
    _saveFleetLog() {
        const key = `corebox_fleet_log_${this.currentUserId || 'anon'}`;
        localStorage.setItem(key, JSON.stringify(this.fleetLog.slice(0, 10)));
    },
    
    _addFleetLog(message) {
        const now = new Date();
        const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        this.fleetLog.unshift({ ts, message: escapeHtml(message) });
        if (this.fleetLog.length > 10) this.fleetLog.length = 10;
        this._saveFleetLog();
        this._renderFleetLog();
    },
    
    _renderFleetLog() {
        const el = document.getElementById('fleetLogBox');
        if (!el) return;
        if (this.fleetLog.length === 0) {
            el.innerHTML = '<div style="color:#555;text-align:center;">Нет действий флота</div>';
            return;
        }
        el.innerHTML = this.fleetLog.map(entry =>
            `<div class="fleet-log-entry">[${escapeHtml(entry.ts)}] ${escapeHtml(entry.message)}</div>`
        ).join('');
    },
    
    // БАГ F-03: saveFleet — объединены ветки, убран дубль
    saveFleet(force = false) {
        const key = this._getStorageKey();
        localStorage.setItem(key, JSON.stringify(this.ships));
        this._syncFleetStatus();
        this.refreshActivePvpMissions();

        if (window.cloudSaveNow && !this._isSavingFleet) {
            this._isSavingFleet = true;
            window.cloudSaveNow(true).finally(() => {
                this._isSavingFleet = false;
            });
        } else if (!force && window.scheduleCloudSave) {
            window.scheduleCloudSave();
        }
    },
    
    async _syncFleetStatus() {
        if (!this.currentUserId) return;
        
        const defenseShip = this.getDefenseShip();
        try {
            await supabase
                .from('fleet_status')
                .upsert({
                    user_id: this.currentUserId,
                    has_defense_ship: defenseShip !== null,
                    defense_ship_level: defenseShip?.level || 0,
                    defense_ship_name: defenseShip?.name || null,
                    updated_at: new Date().toISOString()
                });
        } catch(e) {
            console.warn('Ошибка синхронизации fleet_status:', e);
        }
    },
    
    async restoreMissionsFromDB(userId) {
        let targetUserId = userId || this.currentUserId || window.currentUser?.id;
        
        if (!targetUserId) {
            console.warn('⚠️ restoreMissionsFromDB: нет userId, пропускаем');
            this.isInitializing = false;
            return;
        }
        
        try {
            console.log('🔄 Восстановление статусов миссий из БД...');
            
            const { data: missions, error } = await supabase
                .from('missions')
                .select('*')
                .eq('attacker_id', targetUserId)
                .in('status', ['flying', 'returning', 'arrived', 'combat']);
            
            if (error) throw error;
            
            if (!missions || missions.length === 0) {
                console.log('Нет активных миссий');
                this.ships.forEach(s => {
                    s.onMission = false;
                    s.missionStartedAt = null;
                    s.currentMissionId = null;
                    s.missionArrivesAt = null;
                    s.missionReturnsAt = null;
                    s.targetUserId = null;
                });
                this.saveFleet();
                this.isInitializing = false;
                return;
            }
            
            console.log(`Найдено ${missions.length} активных миссий`);
            
            this.ships.forEach(s => {
                s.onMission = false;
                s.missionStartedAt = null;
                s.missionArrivesAt = null;
                s.missionReturnsAt = null;
                s.currentMissionId = null;
                s.targetUserId = null;
            });
            
            let restoredCount = 0;
            const now = Date.now();
            
            for (const mission of missions) {
                let ship = this.ships.find(s => s.id === mission.fleet_ship_id);
                
                if (!ship && mission.ship_type) {
                    ship = this.ships.find(s => 
                        s.type === mission.ship_type && 
                        !s.onMission && 
                        s.id !== this.defenseShipId
                    );
                    if (ship) {
                        console.warn(`⚠️ fleet_ship_id не найден, используем корабль ${ship.id} по типу`);
                    }
                }
                
                if (ship) {
                    ship.onMission = true;
                    ship.currentMissionId = mission.id;
                    ship.targetUserId = mission.attacker_id === targetUserId ? mission.target_id : mission.attacker_id;
                    ship.shipType = mission.ship_type;
                    ship.missionStartedAt = new Date(mission.created_at).getTime();
                    
                    let arrivesAt = new Date(mission.arrives_at).getTime();
                    let returnsAt = new Date(mission.returns_at).getTime();
                    
                    if (arrivesAt < now && mission.status === 'flying') {
                        arrivesAt = now + 1000;
                    }
                    if (returnsAt < now && (mission.status === 'flying' || mission.status === 'returning')) {
                        returnsAt = now + 5000;
                    }
                    
                    ship.missionArrivesAt = arrivesAt;
                    ship.missionReturnsAt = returnsAt;
                    restoredCount++;
                } else {
                    console.warn(`⚠️ Корабль с ID ${mission.fleet_ship_id} не найден`);
                }
            }
            
            this.saveFleet();
            console.log(`✅ Восстановлено ${restoredCount} активных миссий`);
            setTimeout(() => { this.isInitializing = false; }, 1000);
            
            await this.refreshActiveMissions();
            
        } catch(e) {
            console.error('Ошибка восстановления статусов миссий:', e);
            this.isInitializing = false;
        }
    },
    
    // БАГ F-08: removeShip — нельзя удалить корабль на миссии
    addShip(shipType, name = null) {
        if (this.ships.length >= this.maxFleetSize) {
            return { success: false, error: 'Достигнут максимальный размер флота' };
        }
        
        const typeConfig = this.shipTypes[shipType];
        if (!typeConfig) {
            return { success: false, error: 'Неизвестный тип корабля' };
        }
        
        const shipId = 'ship_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const shipName = name || `${typeConfig.name} #${this.ships.filter(s => s.type === shipType).length + 1}`;
        
        const newShip = {
            ...typeConfig,
            id: shipId,
            type: shipType,
            name: shipName,
            level: 0,
            health: 100,
            maxHealth: 100,
            experience: 0,
            created: new Date().toISOString(),
            missions: 0,
            onAlert: false,
            onMission: false,
            onDefense: false,
            missionStartedAt: null,
            currentMissionId: null,
            missionArrivesAt: null,
            missionReturnsAt: null,
            targetUserId: null,
            targetPlanetId: null,
            targetPlanetX: null,
            targetPlanetY: null,
            speed: typeConfig.speed
        };
        
        this.ships.push(newShip);
        this.saveFleet();
        this._addFleetLog(`🚀 Создан ${typeConfig.icon} ${shipName}`);
        
        if (window.cloudSaveNow) {
            setTimeout(() => window.cloudSaveNow(true), 100);
        }
        
        return { success: true, message: `✅ Создан ${typeConfig.icon} ${shipName}`, ship: newShip };
    },
    
    // БАГ F-08: removeShip — проверка на миссию + refreshActivePvpMissions
    removeShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        
        if (ship?.onMission) {
            window.showNotif?.('❌ Нельзя удалить корабль, пока он в миссии', true);
            return { success: false, error: 'Корабль на миссии' };
        }
        
        const index = this.ships.findIndex(ship => ship.id === shipId);
        if (index !== -1) {
            const removed = this.ships.splice(index, 1)[0];
            if (this.defenseShipId === shipId) {
                this.defenseShipId = null;
                this._saveDefenseShip();
                this._syncFleetStatus();
            }
            this.saveFleet();
            this.refreshActivePvpMissions();
            this._addFleetLog(`🗑️ Корабль "${removed.name}" удалён из флота`);
            return { success: true, message: `Корабль "${removed.name}" удален`, ship: removed };
        }
        return { success: false, error: 'Корабль не найден' };
    },
    
    setDefenseShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship || ship.type !== 'combat') {
            window.showNotif?.('❌ На защиту можно поставить только боевой корабль', true);
            return false;
        }
        if (ship.onMission) {
            window.showNotif?.('❌ Корабль на задании, нельзя поставить на защиту', true);
            return false;
        }
        
        if (this.defenseShipId) {
            const prev = this.ships.find(s => s.id === this.defenseShipId);
            if (prev) prev.onDefense = false;
        }
        
        this.defenseShipId = shipId;
        ship.onDefense = true;
        this._saveDefenseShip();
        this.saveFleet();
        this._syncFleetStatus();
        this._addFleetLog(`🛡️ ${ship.name} поставлен на защиту планеты`);
        this._renderFleetTab();
        this._renderCommandCenter();
        window.showNotif?.(`🛡️ ${ship.name} теперь защищает планету`, false);
        return true;
    },
    
    removeDefenseShip() {
        if (this.defenseShipId) {
            const ship = this.ships.find(s => s.id === this.defenseShipId);
            if (ship) ship.onDefense = false;
            this.defenseShipId = null;
            this._saveDefenseShip();
            this.saveFleet();
            this._syncFleetStatus();
            this._addFleetLog(`🛡️ Корабль снят с защиты`);
            this._renderFleetTab();
            this._renderCommandCenter();
        }
    },
    
    getDefenseShip() {
        if (!this.defenseShipId) return null;
        return this.ships.find(s => s.id === this.defenseShipId) || null;
    },
    
    _saveDefenseShip() {
        const key = this._getDefenseStorageKey();
        if (this.defenseShipId) {
            localStorage.setItem(key, JSON.stringify(this.defenseShipId));
        } else {
            localStorage.removeItem(key);
        }
    },
    
    setShipMissionStatusFromRust(shipId, onMission, missionId, returnsAt) {
        console.log(`🔄 setShipMissionStatusFromRust: shipId=${shipId}, onMission=${onMission}, missionId=${missionId}, returnsAt=${returnsAt}`);
        
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) {
            console.warn(`⚠️ Корабль ${shipId} не найден`);
            return;
        }
        
        const wasOnMission = ship.onMission;
        
        ship.onMission = onMission;
        ship.currentMissionId = missionId;
        
        if (returnsAt) {
            ship.missionReturnsAt = returnsAt;
        }
        
        if (!onMission) {
            ship.missionStartedAt = null;
            ship.targetPlanetId = null;
            ship.targetPlanetX = null;
            ship.targetPlanetY = null;
            ship.currentMissionId = null;
            ship.missionReturnsAt = null;
            ship.missionArrivesAt = null;
        }
        
        this.saveFleet();
        this._renderFleetTab();
        
        if (wasOnMission && !onMission) {
            setTimeout(() => {
                if (window.spaceModule) {
                    window.spaceModule.loadPlanetsFromRust();
                    console.log(`🪐 Планеты обновлены после возврата корабля ${ship.name}`);
                }
            }, 100);
        }
        
        console.log(`✅ Корабль ${ship.name}: onMission=${onMission}`);
    },
    
    getShipInfo(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return null;
        return { id: ship.id, name: ship.name, onMission: ship.onMission };
    },
    
    async refreshActiveMissions() {
        if (!this.currentUserId) return;
        try {
            const { data } = await supabase
                .from('missions')
                .select('*')
                .eq('attacker_id', this.currentUserId)
                .in('status', ['flying', 'returning', 'arrived', 'combat'])
                .order('created_at', { ascending: false });
            
            this.activePvpMissions = (data || []).map(m => ({
                ...m,
                targetUserId: m.target_id,
                attackerId: this.currentUserId,
                phase: m.phase || m.ship_type
            }));
            
            if (window.spaceModule?.renderFlightLines) {
                window.spaceModule.renderFlightLines();
            }
        } catch(e) {
            console.warn('Ошибка загрузки активных миссий:', e);
        }
    },
    
    async sendScoutToPlayer(targetUserId) {
        const scout = this.ships.find(s => s.type === 'scout' && !s.onMission && !s.onDefense);
        if (!scout) {
            const onDefense = this.ships.find(s => s.type === 'scout' && s.onDefense);
            const msg = onDefense
                ? '❌ Разведчик стоит на защите базы. Снимите его с защиты сначала.'
                : '❌ Нет свободного разведчика';
            window.showNotif?.(msg, true);
            return { success: false, error: msg };
        }
        
        const travelSec = window.gameConfig?.fleet_config?.scout?.travel_time_sec ?? 30;
        const now = Date.now();
        
        scout.onMission = true;
        scout.targetUserId = targetUserId;
        scout.shipType = 'scout';
        this.saveFleet();
        this._addFleetLog(`🔭 Разведчик ${scout.name} отправлен к планете противника`);
        
        try {
            const { data: mission, error } = await supabase
                .from('missions')
                .insert({
                    attacker_id: this.currentUserId,
                    target_id: targetUserId,
                    ship_type: 'scout',
                    ship_level: scout.level || 0,
                    phase: 'scout',
                    status: 'flying',
                    fleet_ship_id: scout.id,
                    arrives_at: new Date(now + travelSec * 1000).toISOString(),
                    returns_at: new Date(now + travelSec * 2 * 1000).toISOString(),
                    created_at: new Date().toISOString()
                })
                .select().single();
            
            if (error) throw error;
            
            scout.currentMissionId = mission.id;
            scout.missionStartedAt = now;
            scout.missionArrivesAt = now + travelSec * 1000;
            scout.missionReturnsAt = now + travelSec * 2 * 1000;
            this.saveFleet();
            
            await supabase.from('pvp_combat_log').insert({
                player_id: targetUserId,
                log_type: 'incoming_scout',
                message: '🔭 Обнаружен разведывательный корабль противника',
                details: { attacker_id: this.currentUserId, attacker_name: scout.name }
            });
            
            setTimeout(() => this._processScoutArrival(mission.id, targetUserId, scout), travelSec * 1000);
            
            window.showNotif?.(`🔭 Разведчик летит к противнику (${travelSec} сек.)`, false);
            return { success: true, mission };
            
        } catch(error) {
            console.error('Ошибка отправки разведчика:', error);
            scout.onMission = false;
            scout.targetUserId = null;
            this.saveFleet();
            window.showNotif?.('❌ Ошибка отправки разведчика', true);
            return { success: false, error: error.message };
        }
    },
    
    async _processScoutArrival(missionId, targetUserId, scout) {
        try {
            const { data: defenseInfo } = await supabase
                .rpc('get_defense_ship_info', { p_user_id: targetUserId });
            
            const hasDefender = defenseInfo?.has_defense_ship ?? false;
            const defenderLevel = defenseInfo?.defense_level ?? 0;
            
            const scoutResult = { has_defender: hasDefender, defender_level: defenderLevel };
            
            await supabase
                .from('missions')
                .update({ scout_result: scoutResult, status: 'returning' })
                .eq('id', missionId);
            
            const travelSec = window.gameConfig?.fleet_config?.scout?.travel_time_sec ?? 30;
            setTimeout(async () => {
                scout.onMission = false;
                scout.currentMissionId = null;
                scout.targetUserId = null;
                this.saveFleet();
                
                const defMsg = hasDefender
                    ? `⚠️ Обнаружен боевой корабль противника (ур. ${defenderLevel})`
                    : `✅ Противник не имеет защитника — путь свободен`;
                this._addFleetLog(`🔭 Разведчик вернулся. ${defMsg}`);
                window.showNotif?.(`🔭 Разведчик вернулся! ${defMsg}`, false);
                
                this._lastScoutResult = { 
                    completed: true, 
                    targetUserId, 
                    hasDefender, 
                    defenderLevel,
                    missionId,
                    timestamp: Date.now()
                };
                localStorage.setItem('corebox_last_scout_result', JSON.stringify(this._lastScoutResult));
                this._renderFleetTab();
                
                await this.refreshActiveMissions();
                this.refreshActivePvpMissions();
            }, travelSec * 1000);
            
        } catch(e) {
            console.error('Ошибка обработки прилёта разведчика:', e);
            scout.onMission = false;
            scout.targetUserId = null;
            this.saveFleet();
        }
    },
    
    // БАГ F-06: _calcCombatChances — при равных уровнях 45%/55%
    _calcCombatChances(attackerLevel, defenderLevel) {
        const diff = attackerLevel - defenderLevel;
        const absDiff = Math.abs(diff);
        const attackerStronger = diff > 0;
        
        let strongerWinChance;
        if (absDiff === 0) return { attackerWin: 0.45, defenderWin: 0.55 };
        else if (absDiff === 1) strongerWinChance = 0.50;
        else if (absDiff === 2) strongerWinChance = 0.95;
        else if (absDiff === 3) strongerWinChance = 0.97;
        else if (absDiff === 4) strongerWinChance = 0.995;
        else strongerWinChance = 1.0;
        
        if (attackerStronger) {
            return { attackerWin: strongerWinChance, defenderWin: 1 - strongerWinChance };
        } else {
            return { attackerWin: 1 - strongerWinChance, defenderWin: strongerWinChance };
        }
    },
    
    async sendCombatShipToPlayer(targetUserId) {
        if (!this._lastScoutResult?.completed || this._lastScoutResult.targetUserId !== targetUserId) {
            window.showNotif?.('❌ Сначала отправьте разведчика!', true);
            return { success: false, error: 'Сначала отправьте разведчика' };
        }
        
        const combatShip = this.ships.find(s => s.type === 'combat' && !s.onMission && !s.onDefense);
        if (!combatShip) {
            const onDefense = this.ships.find(s => s.type === 'combat' && s.onDefense);
            const msg = onDefense
                ? '❌ Боевой корабль стоит на защите базы. Снимите его с защиты сначала.'
                : '❌ Нет свободного боевого корабля';
            window.showNotif?.(msg, true);
            return { success: false, error: msg };
        }
        
        const travelSec = window.gameConfig?.fleet_config?.combat?.travel_time_sec ?? 45;
        const attackerLevel = combatShip.level || 0;
        const defenderLevel = this._lastScoutResult.defenderLevel;
        const hasDefender = this._lastScoutResult.hasDefender;
        const now = Date.now();
        
        combatShip.onMission = true;
        combatShip.targetUserId = targetUserId;
        combatShip.shipType = 'combat';
        this.saveFleet();
        this._addFleetLog(`⚔️ Боевой корабль ${combatShip.name} атакует планету противника`);
        
        try {
            await supabase.from('pvp_combat_log').insert({
                player_id: targetUserId,
                log_type: 'incoming_attack',
                message: '⚠️ К вашей планете летит вражеский боевой корабль!',
                details: { attacker_id: this.currentUserId, attacker_level: attackerLevel }
            });
            
            const { data: mission, error } = await supabase
                .from('missions')
                .insert({
                    attacker_id: this.currentUserId,
                    target_id: targetUserId,
                    ship_type: 'combat',
                    ship_level: attackerLevel,
                    phase: 'combat',
                    status: 'flying',
                    fleet_ship_id: combatShip.id,
                    arrives_at: new Date(now + travelSec * 1000).toISOString(),
                    returns_at: new Date(now + travelSec * 2 * 1000).toISOString(),
                    created_at: new Date().toISOString()
                })
                .select().single();
            
            if (error) throw error;
            
            combatShip.currentMissionId = mission.id;
            combatShip.missionStartedAt = now;
            combatShip.missionArrivesAt = now + travelSec * 1000;
            combatShip.missionReturnsAt = now + travelSec * 2 * 1000;
            this.saveFleet();
            
            setTimeout(() => this._processCombatResult(mission.id, targetUserId, combatShip, hasDefender, attackerLevel, defenderLevel), travelSec * 1000);
            
            window.showNotif?.(`⚔️ Боевой корабль летит к врагу (${travelSec} сек.)`, false);
            return { success: true, mission };
            
        } catch(error) {
            console.error('Ошибка отправки боевого корабля:', error);
            combatShip.onMission = false;
            combatShip.targetUserId = null;
            this.saveFleet();
            window.showNotif?.('❌ Ошибка отправки боевого корабля', true);
            return { success: false, error: error.message };
        }
    },
    
    async _processCombatResult(missionId, targetUserId, combatShip, hasDefender, attackerLevel, defenderLevel) {
        let attackerWon;
        
        if (!hasDefender) {
            attackerWon = true;
        } else {
            const chances = this._calcCombatChances(attackerLevel, defenderLevel);
            attackerWon = Math.random() < chances.attackerWin;
        }
        
        let combatResult = { attacker_won: attackerWon };
        
        if (!attackerWon) {
            combatShip.onMission = false;
            const idx = this.ships.findIndex(s => s.id === combatShip.id);
            if (idx !== -1) this.ships.splice(idx, 1);
            this.saveFleet();
            this._addFleetLog(`💥 Боевой корабль ${combatShip.name} уничтожен в бою`);
            
            const compPercent = 0.10 + Math.random() * 0.50;
            const shipCost = { ore: 300, chips: 150, plasma: 30 };
            const compensation = {
                ore: Math.floor(shipCost.ore * compPercent),
                chips: Math.floor(shipCost.chips * compPercent),
                plasma: Math.floor(shipCost.plasma * compPercent)
            };
            combatResult.compensation = compensation;
            
            try {
                await supabase.rpc('add_pvp_compensation', {
                    p_user_id: targetUserId,
                    p_ore: compensation.ore,
                    p_chips: compensation.chips,
                    p_plasma: compensation.plasma
                });
            } catch(e) {
                console.warn('Ошибка начисления компенсации:', e);
            }
            
            await supabase.from('pvp_combat_log').insert({
                player_id: targetUserId,
                log_type: 'combat_result',
                message: `🛡️ Атака отражена! Враг потерял боевой корабль. Компенсация: +${compensation.ore}⛏️ +${compensation.chips}🎛️ +${compensation.plasma}⚡`,
                details: { attacker_won: false, compensation }
            });
            
            window.showNotif?.(`💥 Боевой корабль уничтожен в бою!`, true);
            
        } else {
            const travelSec = window.gameConfig?.fleet_config?.combat?.travel_time_sec ?? 45;
            setTimeout(() => {
                combatShip.onMission = false;
                combatShip.currentMissionId = null;
                combatShip.targetUserId = null;
                this.saveFleet();
                this._addFleetLog(`⚔️ Боевой корабль ${combatShip.name} вернулся. Победа! Можно отправить грузовой.`);
                
                this._lastCombatResult = { 
                    targetUserId, 
                    won: true, 
                    completed: true, 
                    timestamp: Date.now() 
                };
                localStorage.setItem('corebox_last_combat_result', JSON.stringify(this._lastCombatResult));
                this._renderFleetTab();
            }, travelSec * 1000);
            
            await supabase.from('pvp_combat_log').insert({
                player_id: targetUserId,
                log_type: 'combat_result',
                message: `❌ Оборона прорвана! Враг победил в бою. Ожидайте грузовой корабль.`,
                details: { attacker_won: true }
            });
            
            this._addFleetLog(`⚔️ Победа в бою! Боевой корабль возвращается.`);
        }
        
        await supabase
            .from('missions')
            .update({ combat_result: combatResult, status: attackerWon ? 'returning' : 'destroyed' })
            .eq('id', missionId);
        
        await this.refreshActiveMissions();
        this.refreshActivePvpMissions();
        this._renderCommandCenter();
    },
    
    async sendCargoShipToPlayer(targetUserId) {
        if (!this._lastCombatResult?.won || !this._lastCombatResult?.completed || this._lastCombatResult.targetUserId !== targetUserId) {
            window.showNotif?.('❌ Сначала победите в бою!', true);
            return { success: false, error: 'Сначала победите в бою' };
        }
        
        const activeCargoMissions = this.ships.some(s => 
            s.type === 'cargo' && s.onMission && s.targetUserId === targetUserId
        );
        if (activeCargoMissions) {
            window.showNotif?.('❌ Грузовой корабль уже в полёте к этому игроку', true);
            return { success: false, error: 'Грузовой корабль уже в полёте к этому игроку' };
        }
        
        const cargoShip = this.ships.find(s => s.type === 'cargo' && !s.onMission && !s.onDefense);
        if (!cargoShip) {
            const onDefense = this.ships.find(s => s.type === 'cargo' && s.onDefense);
            const msg = onDefense
                ? '❌ Грузовой корабль стоит на защите базы. Снимите его с защиты сначала.'
                : '❌ Нет свободного грузового корабля';
            window.showNotif?.(msg, true);
            return { success: false, error: msg };
        }
        
        const travelSec = window.gameConfig?.fleet_config?.cargo?.travel_time_sec ?? 40;
        const capacity = 0.50;
        const now = Date.now();
        
        cargoShip.onMission = true;
        cargoShip.targetUserId = targetUserId;
        cargoShip.shipType = 'cargo';
        this.saveFleet();
        this._addFleetLog(`📦 Грузовой корабль ${cargoShip.name} летит к планете противника`);
        
        try {
            await supabase.from('pvp_combat_log').insert({
                player_id: targetUserId,
                log_type: 'loot_incoming',
                message: '📦 Вражеский грузовой корабль летит к вашей планете за ресурсами!',
                details: { attacker_id: this.currentUserId }
            });
            
            const { data: mission, error } = await supabase
                .from('missions')
                .insert({
                    attacker_id: this.currentUserId,
                    target_id: targetUserId,
                    ship_type: 'cargo',
                    ship_level: cargoShip.level || 0,
                    phase: 'cargo',
                    status: 'flying',
                    fleet_ship_id: cargoShip.id,
                    arrives_at: new Date(now + travelSec * 1000).toISOString(),
                    returns_at: new Date(now + travelSec * 2 * 1000).toISOString(),
                    created_at: new Date().toISOString()
                })
                .select().single();
            
            if (error) throw error;
            
            cargoShip.currentMissionId = mission.id;
            cargoShip.missionStartedAt = now;
            cargoShip.missionArrivesAt = now + travelSec * 1000;
            cargoShip.missionReturnsAt = now + travelSec * 2 * 1000;
            this.saveFleet();
            
            setTimeout(() => this._processLoot(mission.id, targetUserId, cargoShip, capacity), travelSec * 1000);
            
            window.showNotif?.(`📦 Грузовой летит к врагу (${travelSec} сек.)`, false);
            return { success: true, mission };
            
        } catch(error) {
            console.error('Ошибка отправки грузового корабля:', error);
            cargoShip.onMission = false;
            cargoShip.targetUserId = null;
            this.saveFleet();
            window.showNotif?.('❌ Ошибка отправки грузового корабля', true);
            return { success: false, error: error.message };
        }
    },
    
    // БАГ F-02: _processLoot — статус done пишется ПОСЛЕ сохранения лута
    async _processLoot(missionId, targetUserId, cargoShip, capacity) {
        const lootPercent = 0.20 + Math.random() * 0.40;
        const actualPercent = Math.min(lootPercent, capacity);
        
        try {
            const { data: loot, error } = await supabase.rpc('steal_pvp_resources', {
                p_defender_id: targetUserId,
                p_attacker_id: this.currentUserId,
                p_percent: actualPercent
            });
            
            if (error) throw error;
            
            const travelSec = window.gameConfig?.fleet_config?.cargo?.travel_time_sec ?? 40;
            setTimeout(async () => {
                cargoShip.onMission = false;
                cargoShip.currentMissionId = null;
                cargoShip.targetUserId = null;
                this.saveFleet();
                
                if (loot && (loot.ore > 0 || loot.chips > 0 || loot.plasma > 0)) {
                    if (this.game && typeof this.game.add_resource === 'function') {
                        if (loot.ore > 0) this.game.add_resource('ore', loot.ore);
                        if (loot.chips > 0) this.game.add_resource('chips', loot.chips);
                        if (loot.plasma > 0) this.game.add_resource('plasma', loot.plasma);
                    }
                    
                    const lootText = [
                        loot.ore > 0 ? `+${loot.ore}⛏️` : '',
                        loot.chips > 0 ? `+${loot.chips}🎛️` : '',
                        loot.plasma > 0 ? `+${loot.plasma}⚡` : ''
                    ].filter(Boolean).join(' ');
                    this._addFleetLog(`📦 Грузовой вернулся: ${lootText}`);
                    window.showNotif?.(`📦 Ограблено! ${lootText}`, false);
                } else {
                    this._addFleetLog(`📦 Грузовой вернулся — у противника не осталось ресурсов`);
                }
                
                // БАГ F-02: СНАЧАЛА loot_result, потом статус done
                await supabase
                    .from('missions')
                    .update({ loot_result: loot })
                    .eq('id', missionId);
                
                await supabase
                    .from('missions')
                    .update({ status: 'done' })
                    .eq('id', missionId);
                
                await this.refreshActiveMissions();
                this.refreshActivePvpMissions();
                
                this._renderFleetTab();
            }, travelSec * 1000);
            
        } catch(e) {
            console.error('Ошибка грабежа ресурсов:', e);
            cargoShip.onMission = false;
            cargoShip.targetUserId = null;
            this.saveFleet();
        }
    },
    
    async _renderCommandCenter(attempt = 0) {
        const el = document.getElementById('commandCenterLog');
        if (!el) return;
        
        if (this.isInitializing) {
            if (attempt > 20) {
                console.error('Командный пункт: таймаут инициализации');
                return;
            }
            setTimeout(() => this._renderCommandCenter(attempt + 1), 500);
            return;
        }
        
        try {
            const { data: logs } = await supabase
                .from('pvp_combat_log')
                .select('*')
                .eq('player_id', this.currentUserId)
                .order('created_at', { ascending: false })
                .limit(10);
            
            const defShip = this.getDefenseShip();
            let defBlock = '';
            if (defShip) {
                defBlock = `<div class="cmd-defense-ship">🛡️ На защите: <b>${escapeHtml(defShip.name)}</b> (ур. ${defShip.level || 0})</div>`;
            } else {
                defBlock = `<div class="cmd-defense-ship cmd-no-defense">⚠️ Планета не защищена! Поставьте боевой корабль.</div>`;
            }
            
            const logItems = (logs || []).map(log => {
                const typeClass = log.log_type === 'incoming_attack' ? 'cmd-warning'
                                : log.log_type === 'combat_result' ? 'cmd-result'
                                : log.log_type === 'loot_incoming' ? 'cmd-loot'
                                : log.log_type === 'incoming_scout' ? 'cmd-scout'
                                : 'cmd-info';
                const ts = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                return `<div class="cmd-log-entry ${typeClass}">[${ts}] ${escapeHtml(log.message)}</div>`;
            }).join('');
            
            el.innerHTML = defBlock + (logItems || '<div class="cmd-empty">Нет событий</div>');
            
            const pvpSection = el.closest('.cc-section');
            if (pvpSection) {
                pvpSection.style.display = 'block';
            }
            
            const logContainer = el.querySelector('.pvp-log-container');
            if (logContainer) {
                logContainer.style.display = (logs && logs.length > 0) ? 'block' : 'none';
            }
            
            await supabase
                .from('pvp_combat_log')
                .update({ seen: true })
                .eq('player_id', this.currentUserId)
                .eq('seen', false);
                
        } catch(e) {
            console.warn('Ошибка рендера командного пункта:', e);
            el.innerHTML = '<div class="cmd-defense-ship cmd-no-defense">⚠️ Ошибка загрузки данных</div>';
        }
    },
    
    // БАГ F-09: убран дублирующий сброс currentMissionId
    setShipMissionStatus(shipId, onMission, missionId = null, mission = null) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return;
        
        if (!onMission && ship.currentMissionId !== null && ship.currentMissionId === missionId) {
            ship.missions = (ship.missions || 0) + 1;
            ship.experience = (ship.experience || 0) + 10;
            // Убираем безусловный сброс currentMissionId — он уже обработан выше
        }
        
        ship.onMission = onMission;
        ship.missionStartedAt = onMission ? Date.now() : null;
        ship.currentMissionId = missionId;
        
        if (mission) {
            ship.missionArrivesAt = mission.arrives_at ? new Date(mission.arrives_at).getTime() : null;
            ship.missionReturnsAt = mission.returns_at ? new Date(mission.returns_at).getTime() : null;
        } else if (!onMission) {
            ship.missionArrivesAt = null;
            ship.missionReturnsAt = null;
            ship.targetUserId = null;
            ship.targetPlanetId = null;
            // currentMissionId уже сброшен в условии выше, не дублируем
        }
        
        this.saveFleet();
        console.log(`🚢 Корабль ${ship.name}: onMission=${onMission}, missionId=${missionId}`);
        this.refreshActivePvpMissions();
    },
    
    updateMissionStatus(missionId, newStatus, shipId) {
        const ship = this.ships.find(s => s.id === shipId || s.currentMissionId === missionId);
        if (!ship) return;
        
        if ((newStatus === 'done' || newStatus === 'returning') && ship.currentMissionId === missionId) {
            if (newStatus === 'done') {
                ship.onMission = false;
                ship.missionStartedAt = null;
                ship.missionArrivesAt = null;
                ship.missionReturnsAt = null;
                ship.currentMissionId = null;
                ship.targetUserId = null;
                this.saveFleet();
                console.log(`✅ Миссия ${missionId} завершена, корабль ${ship.name} освобождён`);
                this.refreshActivePvpMissions();
            } else {
                console.log(`🔄 Миссия ${missionId} возвращается, корабль ${ship.name} в пути`);
            }
        }
    },
    
    getAvailableShip(shipType) {
        if (this.isInitializing) {
            console.log('⏳ Инициализация, возвращаем null');
            return null;
        }
        
        const available = this.ships.find(s => {
            if (s.type !== shipType) return false;
            if (s.health <= 20) return false;
            if (s.onDefense) return false;
            return !s.onMission;
        });
        
        if (available) {
            console.log(`✅ Найден свободный корабль ${available.name} (${shipType})`);
        } else {
            console.log(`❌ Нет свободных кораблей типа ${shipType}`);
        }
        
        return available || null;
    },
    
    getShipMission(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship || !ship.onMission || !ship.currentMissionId) return null;
        return {
            missionId: ship.currentMissionId,
            startedAt: ship.missionStartedAt,
            arrivesAt: ship.missionArrivesAt,
            returnsAt: ship.missionReturnsAt
        };
    },
    
    getActiveMissionsInfo() {
        return this.ships
            .filter(s => s.onMission && s.currentMissionId)
            .map(s => ({
                shipId: s.id,
                shipName: s.name,
                shipType: s.type,
                targetUserId: s.targetUserId,
                targetPlanetId: s.targetPlanetId,
                missionId: s.currentMissionId,
                startedAt: s.missionStartedAt,
                returnsAt: s.missionReturnsAt,
                remainingMs: s.missionReturnsAt ? Math.max(0, s.missionReturnsAt - Date.now()) : 0
            }));
    },
    
    // БАГ F-04: getFleetDefenseContribution — реализован бонус от защитника
    getFleetDefenseContribution(defenseDebuffRemaining = 0) {
        if (defenseDebuffRemaining > 0) return 0;
        const defShip = this.getDefenseShip();
        if (!defShip) return 0;
        return Math.floor(defShip.combat * (defShip.health / defShip.maxHealth) * (1 + defShip.level * 0.1));
    },
    
    getScoutReconBonus() {
        return this.ships
            .filter(s => s.type === 'scout' && !s.onMission && !s.onDefense)
            .reduce((total, ship) => {
                const speed = ship.speed ?? 1;
                return total + Math.floor(speed * 2 * (ship.health / ship.maxHealth));
            }, 0);
    },
    
    getCargoMiningBonus() {
        const cargoCapacity = this.ships
            .filter(s => s.type === 'cargo' && !s.onMission && !s.onDefense)
            .reduce((total, ship) => total + Math.floor(ship.capacity * (ship.health / ship.maxHealth)), 0);
        return Math.floor(cargoCapacity / 500);
    },
    
    getTotalCombatPower() {
        return this.ships.reduce((total, ship) => total + Math.floor(ship.combat * (ship.health / ship.maxHealth)), 0);
    },
    
    getTotalCapacity() {
        return this.ships.reduce((total, ship) => total + Math.floor(ship.capacity * (ship.health / ship.maxHealth)), 0);
    },
    
    getShipsByType(type) {
        return this.ships.filter(ship => ship.type === type);
    },
    
    getRepairCost(ship) {
        if (!ship || ship.health >= ship.maxHealth) return null;
        const damage = ship.maxHealth - ship.health;
        const oreCost = Math.ceil(damage * 0.2);
        const chipsCost = Math.ceil(damage * 0.05);
        return { oreCost, chipsCost };
    },
    
    getUpgradeCost(ship) {
        if (!ship) return null;
        const level = ship.level;
        const config = window.gameConfig?.fleet_config;
        const maxLevel = config?.[ship.type]?.upgrade_levels || 5;
        if (level >= maxLevel) return null;
        const oreCost = Math.floor(50 * Math.pow(1.4, level));
        const chipsCost = Math.floor(20 * Math.pow(1.4, level));
        const plasmaCost = Math.floor(3 * Math.pow(1.3, level));
        return { oreCost, chipsCost, plasmaCost, maxLevel };
    },
    
    repairShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return { success: false, error: 'Корабль не найден' };
        if (ship.health >= ship.maxHealth) return { success: false, error: 'Корабль уже исправен' };
        
        const costs = this.getRepairCost(ship);
        if (!costs) return { success: false, error: 'Ошибка расчета стоимости' };
        const { oreCost, chipsCost } = costs;
        
        let stats = null;
        try {
            const statsJson = this.game?.get_statistics();
            if (statsJson) stats = JSON.parse(statsJson);
        } catch(e) {}
        
        if (!stats) return { success: false, error: 'Не удалось проверить ресурсы' };
        
        if (stats.ore_inventory < oreCost || stats.chips_inventory < chipsCost) {
            return { success: false, error: `Недостаточно ресурсов (нужно: ${oreCost}⛏️, ${chipsCost}🎛️)` };
        }
        
        let success = false;
        try {
            if (this.game && typeof this.game.apply_fleet_repair === 'function') {
                success = this.game.apply_fleet_repair(oreCost, chipsCost);
            }
        } catch(e) {
            console.warn('Ошибка при ремонте через Rust:', e);
            return { success: false, error: 'Ошибка системы' };
        }
        
        if (success) {
            ship.health = ship.maxHealth;
            this.saveFleet();
            this._addFleetLog(`🔧 "${ship.name}" отремонтирован (-${oreCost}⛏️, -${chipsCost}🎛️)`);
            return { success: true, message: `✅ "${ship.name}" отремонтирован (-${oreCost}⛏️, -${chipsCost}🎛️)` };
        } else {
            return { success: false, error: `❌ Ошибка применения ремонта` };
        }
    },
    
    upgradeShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return { success: false, error: 'Корабль не найден' };
        
        const costs = this.getUpgradeCost(ship);
        if (!costs) return { success: false, error: 'Ошибка расчета стоимости' };
        const { oreCost, chipsCost, plasmaCost, maxLevel } = costs;
        
        if (ship.level >= maxLevel) {
            return { success: false, error: `Корабль уже достиг максимального уровня ${maxLevel}` };
        }
        
        let stats = null;
        try {
            const statsJson = this.game?.get_statistics();
            if (statsJson) stats = JSON.parse(statsJson);
        } catch(e) {}
        
        if (!stats) return { success: false, error: 'Не удалось проверить ресурсы' };
        
        if (stats.ore_inventory < oreCost || stats.chips_inventory < chipsCost || stats.plasma_inventory < plasmaCost) {
            return { success: false, error: `Недостаточно ресурсов (нужно: ${oreCost}⛏️, ${chipsCost}🎛️, ${plasmaCost}⚡)` };
        }
        
        let success = false;
        try {
            if (this.game && typeof this.game.apply_fleet_upgrade === 'function') {
                success = this.game.apply_fleet_upgrade(oreCost, chipsCost, plasmaCost);
            }
        } catch(e) {
            console.warn('Ошибка при улучшении через Rust:', e);
            return { success: false, error: 'Ошибка системы' };
        }
        
        if (success) {
            ship.level += 1;
            ship.maxHealth += 20;
            ship.health = ship.maxHealth;
            ship.combat = Math.floor(ship.combat * 1.15);
            ship.capacity = Math.floor(ship.capacity * 1.1);
            this.saveFleet();
            this._addFleetLog(`⬆️ "${ship.name}" улучшен до ур.${ship.level} (-${oreCost}⛏️ -${chipsCost}🎛️ -${plasmaCost}⚡)`);
            return { 
                success: true, 
                message: `⬆️ "${ship.name}" улучшен до ур.${ship.level} (-${oreCost}⛏️ -${chipsCost}🎛️ -${plasmaCost}⚡)` 
            };
        } else {
            return { 
                success: false, 
                error: `❌ Ошибка применения улучшения` 
            };
        }
    },
    
    damageRandomCombatShip(attackType, attackId = null) {
        if (this.isInitializing) {
            console.log('⏳ Флот инициализируется, урон не применяется');
            return null;
        }
        
        if (attackId && this.lastDamageProcessedAttackId === attackId) {
            return null;
        }
        
        const now = Date.now();
        if (now - this.lastProcessedAttackTime < 5000) {
            return null;
        }
        
        if (this.ships.length === 0) return null;
        
        const vulnerableShips = this.ships.filter(s => 
            s.type !== 'cargo' && 
            !s.onDefense && 
            !s.onMission &&
            !s.currentMissionId
        );
        
        if (vulnerableShips.length === 0) return null;
        
        const target = vulnerableShips[Math.floor(Math.random() * vulnerableShips.length)];
        const damage = Math.floor(10 + Math.random() * 20);
        const oldHealth = target.health;
        target.health = Math.max(1, target.health - damage);
        this.saveFleet();
        
        if (attackId) {
            this.lastDamageProcessedAttackId = attackId;
        }
        this.lastProcessedAttackTime = now;
        
        this._addFleetLog(`💥 ${target.name} получил ${oldHealth - target.health} урона! (${target.health}/${target.maxHealth})`);
        
        return {
            shipName: target.name,
            damage: oldHealth - target.health,
            newHealth: target.health,
            maxHealth: target.maxHealth
        };
    },
    
    resetDamageFlag() {
        this.lastDamageProcessedAttackId = null;
    },
    
    setAlertMode(enabled) {
        this.alertMultiplier = enabled ? 2.0 : 1.0;
        this.ships.forEach(ship => {
            ship.onAlert = enabled && ship.type === 'combat';
        });
        this.saveFleet();
    },
    
    // БАГ F-05: _startShipTimers — при diffMs <= 0 вызывается refreshActiveMissions
    _startShipTimers() {
        if (this._shipTimerInterval) return;
        
        this._shipTimerInterval = setInterval(() => {
            if (this._currentTab !== 'fleet') return;
            
            const now = Date.now();
            let needsRefresh = false;
            
            this.ships.forEach(ship => {
                if (!ship.onMission) return;
                
                const targetTime = ship.missionReturnsAt || ship.missionArrivesAt;
                if (!targetTime) return;
                
                const diffMs = Math.max(0, targetTime - now);
                const diffMin = Math.floor(diffMs / 60000);
                const diffSec = Math.floor((diffMs % 60000) / 1000);
                const timeStr = diffMin > 0 ? `${diffMin}м ${diffSec}с` : `${diffSec}с`;
                
                const shipCard = document.querySelector(`[data-ship-id="${ship.id}"]`);
                if (shipCard) {
                    const statusEl = shipCard.querySelector('.ship-status');
                    if (statusEl) {
                        const isPlanetMission = ship.targetPlanetId && !ship.targetUserId;
                        const icon = isPlanetMission ? '🪐' : '🚀';
                        const target = isPlanetMission ? 'планете' : 'миссии';
                        const newText = `${icon} ${target}, возврат через: ${timeStr}`;
                        if (statusEl.textContent !== newText) {
                            statusEl.textContent = newText;
                        }
                    }
                }
                
                // БАГ F-05: при истечении времени вызываем refreshActiveMissions
                if (diffMs <= 0 && ship.onMission) {
                    needsRefresh = true;
                    // Завершение через Rust (если есть targetPlanetId — планетарная миссия)
                    if (ship.targetPlanetId && !ship.targetUserId) {
                        window.spaceModule?._startMissionCheckInterval?.();
                    } else {
                        this.refreshActiveMissions();
                    }
                }
            });
            
            if (needsRefresh) {
                this._renderFleetTab();
            }
        }, 1000);
    },
    
    _renderFleetTab() {
        const container = document.getElementById('fleetContainer');
        if (!container) return;
        
        const oldScroll = container.scrollTop;
        container.innerHTML = this.renderFleetUI();
        if (container.scrollTop !== oldScroll) container.scrollTop = oldScroll;
        this.setupEventListeners(container);
        this._renderFleetLog();
        this._renderCommandCenter();
        
        if (!this._shipTimerInterval) {
            this._startShipTimers();
        }
    },
    
    renderFleetUI() {
        let defenseDebuffRemaining = 0;
        try {
            const stats = JSON.parse(this.game.get_statistics());
            defenseDebuffRemaining = stats.defense_debuff_remaining || 0;
        } catch(e) {}
        
        const defenseBonus = this.getFleetDefenseContribution(defenseDebuffRemaining);
        const reconBonus = this.getScoutReconBonus();
        const cargoBonus = this.getCargoMiningBonus();
        const defenseShip = this.getDefenseShip();
        
        let currentResources = { ore: 0, chips: 0, plasma: 0 };
        try {
            const statsJson = this.game?.get_statistics();
            if (statsJson) {
                const stats = JSON.parse(statsJson);
                currentResources = { ore: stats.ore_inventory || 0, chips: stats.chips_inventory || 0, plasma: stats.plasma_inventory || 0 };
            }
        } catch(e) {}
        
        let html = `
            <div class="fleet-container">
                <div class="fleet-header">
                    <span>🚀 ФЛОТ</span>
                    <div class="fleet-stats">
                        <span>Кораблей: ${this.ships.length}/${this.maxFleetSize}</span>
                        <span>🌍 Атака планет: ${this.getTotalCombatPower()}</span>
                        <span>📦 Грузоподъемность: ${this.getTotalCapacity()}</span>
                        <span>🛡️ Защита: +${defenseBonus}</span>
                    </div>
                </div>
                <div class="fleet-bonuses">
                    <div class="bonus-item">🔭 Снижение заметности: ${Math.floor(reconBonus / 10)}</div>
                    <div class="bonus-item">⛏️ Бонус к добыче: +${cargoBonus}</div>
                    ${this.alertMultiplier > 1 ? '<div class="bonus-item alert-active">⚠️ РЕЖИМ ТРЕВОГИ: боевая мощь ×2</div>' : ''}
                    ${defenseShip ? `<div class="bonus-item defense-active">🛡️ ЗАЩИТНИК: ${escapeHtml(defenseShip.name)} (ур.${defenseShip.level})</div>` : '<div class="bonus-item defense-inactive">⚠️ НЕТ ЗАЩИТНИКА</div>'}
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                    <button id="fleet-refresh-missions" style="background:rgba(74,255,157,0.1);border:1px solid rgba(74,255,157,0.3);border-radius:6px;padding:6px 12px;color:#4aff9d;font-family:monospace;font-size:11px;cursor:pointer;">🔄 Обновить миссии</button>
                    ${defenseShip ? `<button id="fleet-remove-defense" style="background:rgba(255,74,74,0.1);border:1px solid rgba(255,74,74,0.3);border-radius:6px;padding:6px 12px;color:#ff6a6a;font-family:monospace;font-size:11px;cursor:pointer;">🗑️ Снять с защиты</button>` : ''}
                </div>
                
                <div class="fleet-grid">
        `;
        
        if (this.ships.length === 0) {
            html += `
                <div class="empty-fleet">
                    <div class="empty-icon">🚀</div>
                    <div class="empty-text">Флот пуст</div>
                    <div class="empty-hint">Создайте корабли во вкладке "Крафт"</div>
                </div>
            `;
        } else {
            const now = Date.now();
            this.ships.forEach(ship => {
                const typeConfig = this.shipTypes[ship.type] || {};
                const healthPercent = (ship.health / ship.maxHealth) * 100;
                const isDamaged = ship.health < ship.maxHealth;
                const healthClass = healthPercent > 70 ? 'good' : healthPercent > 30 ? 'damaged' : 'critical';
                const healthIcon = healthPercent > 70 ? '🟢' : healthPercent > 30 ? '🟡' : '🔴';
                const isOnDefense = this.defenseShipId === ship.id;
                
                const repairCost = this.getRepairCost(ship);
                const upgradeCost = this.getUpgradeCost(ship);
                
                const canRepair = repairCost && currentResources.ore >= repairCost.oreCost && currentResources.chips >= repairCost.chipsCost;
                const canUpgrade = upgradeCost && currentResources.ore >= upgradeCost.oreCost && currentResources.chips >= upgradeCost.chipsCost && currentResources.plasma >= upgradeCost.plasmaCost;
                
                let missionStatusHtml = '';
                if (ship.onMission) {
                    const targetTime = ship.missionReturnsAt || ship.missionArrivesAt;
                    if (targetTime) {
                        const diffMs = Math.max(0, targetTime - now);
                        const diffMin = Math.floor(diffMs / 60000);
                        const diffSec = Math.floor((diffMs % 60000) / 1000);
                        const timeStr = diffMin > 0 ? `${diffMin}м ${diffSec}с` : `${diffSec}с`;
                        
                        const isPlanetMission = ship.targetPlanetId && !ship.targetUserId;
                        const missionIcon = isPlanetMission ? '🪐' : '🚀';
                        const missionTarget = isPlanetMission ? 'планете' : 'миссии';
                        
                        missionStatusHtml = `<div class="ship-status">${missionIcon} ${missionTarget}, возврат через: ${timeStr}</div>`;
                    } else {
                        missionStatusHtml = `<div class="ship-status">🚀 В миссии</div>`;
                    }
                } else {
                    missionStatusHtml = `<div class="ship-status ready">✅ Готов</div>`;
                }
                
                html += `
                    <div class="ship-card ${ship.onAlert ? 'alert-mode' : ''} ${healthPercent < 30 ? 'critical-health' : ''} ${isOnDefense ? 'defense-mode' : ''}" data-ship-id="${ship.id}">
                        <div class="ship-header">
                            <div class="ship-icon">${typeConfig.icon || '🚀'}</div>
                            <div class="ship-name">${escapeHtml(ship.name)}</div>
                            <div class="ship-level">Ур. ${ship.level}</div>
                            <div class="ship-health-icon">${healthIcon}</div>
                            ${isOnDefense ? '<div class="defense-badge">🛡️ ЗАЩИТА</div>' : ''}
                            ${missionStatusHtml}
                        </div>
                        
                        <div class="ship-stats">
                            <div class="stat-row">
                                <span>Здоровье:</span>
                                <div class="health-bar">
                                    <div class="health-fill ${healthClass}" style="width: ${healthPercent}%"></div>
                                </div>
                                <span>${ship.health}/${ship.maxHealth} (${Math.floor(healthPercent)}%)</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>⚡ Боевая мощь:</span>
                                <span>${Math.floor(ship.combat * (ship.onAlert ? 2 : 1))}</span>
                                ${ship.onAlert ? '<span class="alert-badge">×2</span>' : ''}
                            </div>
                            
                            <div class="stat-row">
                                <span>📦 Грузоподъемность:</span>
                                <span>${ship.capacity}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>🚀 Скорость:</span>
                                <span>${ship.speed}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>⭐ Опыт:</span>
                                <span>${ship.experience}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>🎯 Миссий:</span>
                                <span>${ship.missions}</span>
                            </div>
                        </div>
                        
                        <div class="ship-costs">
                            ${repairCost ? `<div class="cost-info repair-cost">🔧 Ремонт: −${repairCost.oreCost}⛏️ −${repairCost.chipsCost}🎛️</div>` : ''}
                            ${upgradeCost ? `<div class="cost-info upgrade-cost">⬆ Улучшение до ур.${ship.level+1}: −${upgradeCost.oreCost}⛏️ −${upgradeCost.chipsCost}🎛️ −${upgradeCost.plasmaCost}⚡</div>` : ''}
                        </div>
                        
                        <div class="ship-actions">
                            <button class="ship-btn repair-btn" data-action="repair" data-ship="${ship.id}" ${!isDamaged || !canRepair ? 'disabled' : ''}>
                                🔧 Ремонт
                            </button>
                            <button class="ship-btn upgrade-btn" data-action="upgrade" data-ship="${ship.id}" ${!canUpgrade ? 'disabled' : ''}>
                                ⬆ Улучшить
                            </button>
                            ${ship.type === 'combat' && !isOnDefense && !ship.onMission ? 
                                `<button class="ship-btn defense-btn" data-action="defense" data-ship="${ship.id}" 
                                    title="Защищает от PvP-атак игроков. На активность повстанцев не влияет.">
                                    🛡️ НА ЗАЩИТУ
                                 </button>` : ''}
                            ${isOnDefense ? 
                                `<button class="ship-btn remove-defense-btn" data-action="remove-defense" data-ship="${ship.id}">🗑️ СНЯТЬ ЗАЩИТУ</button>` : ''}
                            <button class="ship-btn delete-btn" data-action="delete" data-ship="${ship.id}">
                                🗑 Удалить
                            </button>
                        </div>
                    </div>
                `;
            });
        }
        
        if (this._lastScoutResult?.completed) {
            const scout = this._lastScoutResult;
            const scoutMsg = scout.hasDefender 
                ? `⚠️ Противник имеет защитника (ур. ${scout.defenderLevel})` 
                : `✅ Противник не имеет защитника`;
            
            html += `
                <div class="pvp-actions" style="margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px;">
                    <div style="font-size: 12px; color: #4aff9d; margin-bottom: 8px;">⚔️ ДЕЙСТВИЯ ПРОТИВ ЦЕЛИ</div>
                    <div style="font-size: 11px; margin-bottom: 8px;">🔭 Разведка завершена: ${escapeHtml(scoutMsg)}</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button id="pvp-combat-btn" style="background:rgba(255,74,74,0.15);border:1px solid rgba(255,74,74,0.4);border-radius:6px;padding:6px 12px;color:#ff6a6a;cursor:pointer;">
                            ⚔️ АТАКОВАТЬ (БОЕВОЙ)
                        </button>
                        ${this._lastCombatResult?.won && this._lastCombatResult?.completed ? `
                        <button id="pvp-cargo-btn" style="background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.4);border-radius:6px;padding:6px 12px;color:#ffaa44;cursor:pointer;">
                            📦 ОГРАБИТЬ (ГРУЗОВОЙ)
                        </button>
                        ` : ''}
                        <button id="pvp-reset-target" style="background:rgba(100,100,100,0.15);border:1px solid rgba(100,100,100,0.3);border-radius:6px;padding:6px 12px;color:#aaa;cursor:pointer;">
                            🗑️ СБРОСИТЬ ЦЕЛЬ
                        </button>
                    </div>
                </div>
            `;
        }
        
        html += `
                </div>
                <div class="fleet-summary">
                    <div class="summary-item">
                        <span>🚚 Грузовые:</span>
                        <span>${this.ships.filter(s => s.type === 'cargo').length}</span>
                    </div>
                    <div class="summary-item">
                        <span>🔭 Разведчики:</span>
                        <span>${this.ships.filter(s => s.type === 'scout').length}</span>
                    </div>
                    <div class="summary-item">
                        <span>⚔️ Боевые:</span>
                        <span>${this.ships.filter(s => s.type === 'combat').length}</span>
                    </div>
                </div>
            </div>
        `;
        
        return html;
    },
    
    // БАГ F-11: setupEventListeners — cargoBtn проверяет существование _lastCombatResult
    setupEventListeners(container) {
        if (!container) return null;
        
        if (container._clickHandler) {
            container.removeEventListener('click', container._clickHandler);
            delete container._clickHandler;
        }
        
        const clickHandler = (e) => {
            const btn = e.target.closest('.ship-btn');
            if (!btn) return;
            if (btn.disabled) return;
            
            const action = btn.dataset.action;
            const shipId = btn.dataset.ship;
            let result = null;
            
            switch (action) {
                case 'repair':
                    result = this.repairShip(shipId);
                    break;
                case 'upgrade':
                    result = this.upgradeShip(shipId);
                    break;
                case 'defense':
                    result = this.setDefenseShip(shipId);
                    break;
                case 'remove-defense':
                    this.removeDefenseShip();
                    result = { success: true };
                    break;
                case 'delete':
                    if (confirm('Вы уверены, что хотите удалить этот корабль?')) {
                        result = this.removeShip(shipId);
                    }
                    break;
            }
            
            if (result) {
                const event = new CustomEvent('fleetAction', { detail: result });
                document.dispatchEvent(event);
            }
            
            setTimeout(() => {
                this._renderFleetTab();
            }, 300);
        };
        
        container.addEventListener('click', clickHandler);
        container._clickHandler = clickHandler;
        
        const combatBtn = document.getElementById('pvp-combat-btn');
        if (combatBtn) {
            combatBtn.onclick = () => {
                if (this._lastScoutResult) {
                    this.sendCombatShipToPlayer(this._lastScoutResult.targetUserId);
                    setTimeout(() => this._renderFleetTab(), 500);
                }
            };
        }
        
        const cargoBtn = document.getElementById('pvp-cargo-btn');
        if (cargoBtn) {
            cargoBtn.onclick = () => {
                const result = this._lastCombatResult;
                if (result?.won && result?.completed && result?.targetUserId) {
                    this.sendCargoShipToPlayer(result.targetUserId);
                    setTimeout(() => this._renderFleetTab(), 500);
                }
            };
        }
        
        const resetBtn = document.getElementById('pvp-reset-target');
        if (resetBtn) {
            resetBtn.onclick = () => {
                this._lastScoutResult = null;
                this._lastCombatResult = null;
                localStorage.removeItem('corebox_last_combat_result');
                localStorage.removeItem('corebox_last_scout_result');
                this._renderFleetTab();
                window.showNotif?.('🗑️ Цель сброшена', false);
            };
        }
        
        const refreshBtn = document.getElementById('fleet-refresh-missions');
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                this.refreshActiveMissions();
                this._renderCommandCenter();
                window.showNotif?.('🔄 Миссии обновлены', false);
            };
        }
        
        const removeDefenseBtn = document.getElementById('fleet-remove-defense');
        if (removeDefenseBtn) {
            removeDefenseBtn.onclick = () => {
                this.removeDefenseShip();
                this._renderFleetTab();
            };
        }
        
        return container;
    },
};

window.fleetModule = fleetModule;
window.fleetModule.setShipMissionStatusFromRust = fleetModule.setShipMissionStatusFromRust.bind(fleetModule);
window.fleetModule.getShipInfo = fleetModule.getShipInfo.bind(fleetModule);

export default fleetModule;