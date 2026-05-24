// ========== space.js (space-module.js) (ИСПРАВЛЕННАЯ ВЕРСИЯ) ==========
// БАГ #8: исправлен прогресс полёта корабля (добавлен started_at)
// БАГ #26: исправлен closeOnOutside слушатель
// БАГ #27: исправлен renderFlightLines (очистка интервала перед созданием)
// БАГ #30: добавлена проверка scout.scout_data
// БАГ #39: get_active_planet_missions возвращает и "returning"

import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';

export const spaceModule = {
    game: null,
    currentUser: null,
    multiplayerInterval: null,
    planetsChannel: null,
    initialized: false,
    isTabActive: false,

    planets: [],
    otherPlayers: [],
    isResearching: false,
    
    _playerPositions: {},
    _currentPopup: null,
    _flightLineInterval: null,
    _missionCheckInterval: null,
    _presenceChannel: null,
    _multiplayerChannel: null,
    _starsGenerated: false,

    PLANET_TYPES: {
        'earth':   { icon: '🌍', name: 'Землеподобная',  color: '#4aff9d' },
        'volcanic':{ icon: '🌋', name: 'Вулканическая',  color: '#ff4a4a' },
        'ice':     { icon: '❄️', name: 'Ледяная',        color: '#4a9eff' },
        'gas':     { icon: '☁️', name: 'Газовая',        color: '#9d4aff' },
        'desert':  { icon: '🏜️', name: 'Пустынная',      color: '#ffaa44' },
        'ocean':   { icon: '🌊', name: 'Океаническая',   color: '#44aaff' },
    },

    PLANET_NAMES: ['Арктур', 'Сириус', 'Вега', 'Проксима', 'Антарес',
                   'Поллукс', 'Кастор', 'Альтаир', 'Денеб', 'Регул'],

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    init(gameInstance, user) {
        this.game = gameInstance;
        this.currentUser = user;
        this._playerPositions = {};

        if (user?.id) {
            this._playerPositions[user.id] = { x: 50, y: 50 };
        }

        this.loadPlanetsFromRust();
        
        if (!this._starsGenerated) {
            this.generateStars();
            this._starsGenerated = true;
        }
        
        this.setupMultiplayer();
        this.initialized = true;
        
        this.initMapZoom();
        this._startMissionCheckInterval();

        this._subscribeToEvents();

        console.log('🌌 Space модуль инициализирован');
    },

    _subscribeToEvents() {
        GameBus.on(EVENTS.SHIP_MISSION_END, ({ ship, resources }) => {
            this.loadPlanetsFromRust();
            this.renderFlightLines();
            this.renderPlanets();
        });
        
        GameBus.on(EVENTS.FLEET_UPDATED, () => {
            this.renderFlightLines();
        });
        
        GameBus.on(EVENTS.STATS_UPDATED, (stats) => {
            this.updateStatusBar(stats);
        });
    },

    _startMissionCheckInterval() {
        if (this._missionCheckInterval) clearInterval(this._missionCheckInterval);
        
        this._missionCheckInterval = setInterval(() => {
            if (!this.game) return;
            
            try {
                const missionsJson = this.game.get_active_planet_missions();
                const missions = JSON.parse(missionsJson);
                let needsRefresh = false;
                let needsFleetSave = false;
                
                const now = Date.now();
                
                for (const mission of missions) {
                    const remaining = mission.remaining_ms;
                    
                    if (remaining <= 0 && mission.status === 'flying') {
                        console.log(`✅ Завершение миссии ${mission.id} через Rust`);
                        
                        try {
                            if (typeof this.game.complete_planet_mission === 'function') {
                                const resultJson = this.game.complete_planet_mission(mission.id);
                                const result = JSON.parse(resultJson);
                                
                                if (result.resources) {
                                    const gained = Object.entries(result.resources)
                                        .filter(([,v]) => v > 0)
                                        .map(([k,v]) => `+${v} ${k}`)
                                        .join(', ');
                                    if (gained) {
                                        window.addToLog?.(`🪐 Миссия на ${mission.planet_name} завершена: ${gained}`, 'success');
                                        window.showNotif?.(`🪐 ${gained} с планеты!`, false);
                                    }
                                }
                            } else {
                                if (mission.coal_taken > 0) this.game.add_resource('coal', mission.coal_taken);
                                if (mission.plasma_taken > 0) this.game.add_resource('plasma', mission.plasma_taken);
                                if (mission.ore_taken > 0) this.game.add_resource('ore', mission.ore_taken);
                                window.addToLog?.(`📦 Миссия завершена: +${mission.coal_taken}🪨 +${mission.plasma_taken}⚡ +${mission.ore_taken}⛏️`, 'success');
                            }
                        } catch(e) {
                            console.warn('Ошибка завершения миссии:', e);
                        }
                        
                        if (window.fleetModule) {
                            const ship = window.fleetModule.ships.find(s => s.id === mission.ship_id);
                            if (ship && ship.onMission) {
                                ship.onMission = false;
                                ship.currentMissionId = null;
                                ship.targetPlanetId = null;
                                ship.missionReturnsAt = null;
                                ship.missionArrivesAt = null;
                                needsFleetSave = true;
                                needsRefresh = true;
                                console.log(`🆓 Корабль ${ship.name} освобождён (миссия завершена)`);
                            }
                        }
                        
                        this.loadPlanetsFromRust();
                        
                        if (window._refreshFleetWithMissions) {
                            window._refreshFleetWithMissions();
                        }
                    }
                }
                
                if (needsFleetSave && window.fleetModule) {
                    window.fleetModule.saveFleet();
                }
                
                if (needsRefresh && window.fleetModule?._renderFleetTab) {
                    window.fleetModule._renderFleetTab();
                }
                
                this.renderFlightLines();
                
            } catch(e) {
                console.warn('Ошибка в missionCheckInterval:', e);
            }
        }, 2000);
    },

    // ========== ЗУМИРОВАНИЕ КАРТЫ ==========
    initMapZoom() {
        const starMap = document.getElementById('space-star-map');
        const viewport = document.getElementById('space-map-viewport');
        if (!starMap || !viewport) return;

        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let lastX = 0, lastY = 0;
        let lastPinchDist = null;

        const MIN_SCALE = 0.5;
        const MAX_SCALE = 3.0;
        const ZOOM_STEP = 0.25;
        const MAP_WIDTH = 2000;
        const MAP_HEIGHT = 2000;

        const applyTransform = () => {
            viewport.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            viewport.style.transformOrigin = '0 0';
        };

        const clampTranslate = () => {
            const mapW = starMap.clientWidth;
            const mapH = starMap.clientHeight;
            const scaledW = mapW * scale;
            const scaledH = mapH * scale;
            const maxX = Math.max(0, scaledW - mapW);
            const maxY = Math.max(0, scaledH - mapH);
            translateX = Math.max(-maxX, Math.min(0, translateX));
            translateY = Math.max(-maxY, Math.min(0, translateY));
        };

        starMap.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = starMap.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
            if (newScale === scale) return;
            translateX = mouseX - (mouseX - translateX) * (newScale / scale);
            translateY = mouseY - (mouseY - translateY) * (newScale / scale);
            scale = newScale;
            clampTranslate();
            applyTransform();
        }, { passive: false });

        starMap.addEventListener('mousedown', (e) => {
            if (e.target.closest('.space-planet, .other-player-marker, #space-base-planet, button')) return;
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            starMap.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            translateX += e.clientX - lastX;
            translateY += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            clampTranslate();
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            isDragging = false;
            starMap.style.cursor = 'grab';
        });

        starMap.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                lastPinchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            } else if (e.touches.length === 1) {
                if (e.target.closest('.space-planet, .other-player-marker, #space-base-planet, button')) return;
                isDragging = true;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
            }
        }, { passive: true });

        starMap.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && lastPinchDist !== null) {
                e.preventDefault();
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const ratio = dist / lastPinchDist;
                const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * ratio));
                const rect = starMap.getBoundingClientRect();
                const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
                const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
                translateX = midX - (midX - translateX) * (newScale / scale);
                translateY = midY - (midY - translateY) * (newScale / scale);
                scale = newScale;
                lastPinchDist = dist;
                clampTranslate();
                applyTransform();
            } else if (e.touches.length === 1 && isDragging) {
                translateX += e.touches[0].clientX - lastX;
                translateY += e.touches[0].clientY - lastY;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
                clampTranslate();
                applyTransform();
            }
        }, { passive: false });

        starMap.addEventListener('touchend', () => {
            isDragging = false;
            lastPinchDist = null;
        });

        document.getElementById('map-zoom-in')?.addEventListener('click', () => {
            const rect = starMap.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;
            const newScale = Math.min(MAX_SCALE, scale + ZOOM_STEP);
            translateX = cx - (cx - translateX) * (newScale / scale);
            translateY = cy - (cy - translateY) * (newScale / scale);
            scale = newScale;
            clampTranslate();
            applyTransform();
        });
        document.getElementById('map-zoom-out')?.addEventListener('click', () => {
            const rect = starMap.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;
            const newScale = Math.max(MIN_SCALE, scale - ZOOM_STEP);
            translateX = cx - (cx - translateX) * (newScale / scale);
            translateY = cy - (cy - translateY) * (newScale / scale);
            scale = newScale;
            clampTranslate();
            applyTransform();
        });
        document.getElementById('map-zoom-reset')?.addEventListener('click', () => {
            scale = 1;
            const rect = starMap.getBoundingClientRect();
            translateX = rect.width / 2 - (MAP_WIDTH * scale) / 2;
            translateY = rect.height / 2 - (MAP_HEIGHT * scale) / 2;
            clampTranslate();
            applyTransform();
        });
    },

    onTabActivated() {
        if (!this.initialized) return;
        this.isTabActive = true;
        
        this.loadPlanetsFromRust();
        this.renderPlanets();
        this.renderPlayers();
        this.renderFlightLines();
        this.updateStatusBar();
        
        this.syncFromGame();
        
        this._reconnectMultiplayer();

        const researchBtn = document.getElementById('space-research-btn');
        if (researchBtn && !researchBtn._handlerSet) {
            researchBtn._handlerSet = true;
            researchBtn.onclick = () => this.startResearch();
        }
    },

    _reconnectMultiplayer() {
        if (!this.currentUser) return;
        if (this._multiplayerChannel) {
            this._multiplayerChannel.unsubscribe();
        }
        this._multiplayerChannel = supabase
            .channel(`space:${this.currentUser.id}`)
            .on('presence', { event: 'sync' }, () => {
                const state = this._multiplayerChannel.presenceState();
                this._onlinePlayerIds = Object.keys(state);
                this.renderPlayers();
                this.renderPlayersOnMap();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await this._multiplayerChannel.track({
                        user_id: this.currentUser.id,
                        online_at: new Date().toISOString(),
                        username: this.currentUser.user_metadata?.username || 'Игрок'
                    });
                }
            });
    },

    onTabDeactivated() {
        this.isTabActive = false;
        if (this._flightLineInterval) {
            clearInterval(this._flightLineInterval);
            this._flightLineInterval = null;
        }
        if (this._multiplayerChannel) {
            this._multiplayerChannel.unsubscribe();
            this._multiplayerChannel = null;
        }
        if (this.multiplayerInterval) {
            clearInterval(this.multiplayerInterval);
            this.multiplayerInterval = null;
        }
    },

    syncFromGame() {
        if (!this.game) return;
        try {
            const json = this.game.get_statistics();
            if (!json) return;
            const stats = JSON.parse(json);
            this._lastStats = stats;
            this.updateStatusBar(stats);
        } catch(e) {}
    },

    updateStatusBar(stats) {
        if (!stats && this.game) {
            try { stats = JSON.parse(this.game.get_statistics()); } catch(e) {}
        }
        if (!stats) return;

        const power   = this.game?.get_computational_power?.() ?? stats.computational_power ?? 0;
        const maxPwr  = this.game?.get_max_computational_power?.() ?? 1000;
        const isDay   = stats.is_day ?? true;
        const neuro   = stats.neuro_evolution ?? 0;

        let ships = [];
        try {
            if (window.fleetModule && window.fleetModule.ships.length > 0) {
                ships = window.fleetModule.ships;
            } else {
                const fleetKey = this.currentUser?.id 
                    ? `corebox_fleet_${this.currentUser.id}` 
                    : 'corebox_fleet';
                ships = JSON.parse(localStorage.getItem(fleetKey) ?? '[]');
            }
        } catch(e) {}

        const el = id => document.getElementById(id);
        if (el('space-power-current')) el('space-power-current').textContent = power;
        if (el('space-power-max'))     el('space-power-max').textContent = maxPwr;
        if (el('space-day-status'))    el('space-day-status').textContent = isDay ? '☀️ ДЕНЬ' : '🌙 НОЧЬ';
        if (el('space-neuro-level'))   el('space-neuro-level').textContent = neuro;
        if (el('space-ships-count'))   el('space-ships-count').textContent = ships.length;

        const btn = document.getElementById('space-research-btn');
        if (btn) {
            const canResearch = power >= 100 && !this.isResearching && this.planets.length < 3;
            btn.style.opacity = canResearch ? '1' : '0.5';
            btn.style.color   = canResearch ? '#4aff9d' : '#ff6a6a';
            btn.style.cursor  = canResearch ? 'pointer' : 'not-allowed';
            btn.title = canResearch
                ? 'Исследовать новую планету'
                : power < 100
                    ? `Нужно 100 мощности (сейчас ${power})`
                    : this.planets.length >= 3
                        ? 'Максимум 3 планеты исследовано'
                        : 'Уже исследуется...';
        }
    },

    loadPlanetsFromRust() {
        if (!this.game) return;
        try {
            const planetsJson = this.game.get_planets();
            this.planets = JSON.parse(planetsJson);
            this.renderPlanets();
            console.log(`🌍 Загружено ${this.planets.length} планет из Rust`);
        } catch(e) {
            console.warn('Ошибка загрузки планет из Rust:', e);
            this.planets = [];
        }
    },

    async startResearch() {
        if (this.isResearching) return;

        this.loadPlanetsFromRust();

        if (this.planets.length >= 3) {
            window.showNotif?.('🌌 Уже исследовано максимум 3 планеты', true);
            return;
        }

        const power = this.game?.get_computational_power?.() ?? 0;
        if (power < 100) {
            window.showNotif?.('Недостаточно мощности (нужно 100⚡)', true);
            return;
        }

        this.isResearching = true;
        const btn = document.getElementById('space-research-btn');
        if (btn) { btn.textContent = '⏳ ИССЛЕДОВАНИЕ...'; btn.disabled = true; }

        setTimeout(async () => {
            const resultJson = this.game.research_planet();
            const result = JSON.parse(resultJson);
            
            if (result.success) {
                this.planets.push(result.planet);
                this.renderPlanets();
                window.showNotif?.(`🪐 Открыта планета ${result.planet.name}!`, false);
                
                if (this.game && typeof this.game.save_current_state === 'function') {
                    this.game.save_current_state();
                }
                if (typeof window.cloudSaveNow === 'function') {
                    window.cloudSaveNow(true);
                }
                GameBus.emit(EVENTS.PLANET_ADDED, { planet: result.planet });
            } else {
                window.showNotif?.(`❌ ${result.error}`, true);
            }
            
            this.isResearching = false;
            if (btn) {
                btn.textContent = '🔍 ИССЛЕДОВАТЬ ПЛАНЕТУ (нужно 100⚡)';
                btn.disabled = false;
            }
            this.updateStatusBar();
        }, 1500);
    },

    renderPlanets() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.space-planet').forEach(el => el.remove());

        this.planets.forEach(planet => {
            const cfg = this.PLANET_TYPES[planet.planet_type] ?? this.PLANET_TYPES['earth'];
            const totalRemaining = (planet.resources_remaining?.coal || 0) + 
                                   (planet.resources_remaining?.plasma || 0) + 
                                   (planet.resources_remaining?.ore || 0);
            
            const el = document.createElement('div');
            el.className = 'space-planet';
            el.style.cssText = `
                position:absolute;left:${planet.x}%;top:${planet.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:5;
                ${totalRemaining === 0 ? 'opacity:0.6;filter:grayscale(0.5);' : ''}
            `;
            
            const activeMission = this._getActiveMissionForPlanet(planet.id);
            const missionProgressHtml = activeMission ? this._renderPlanetMissionProgress(activeMission) : '';
            
            el.innerHTML = `
                <span style="font-size:22px;">${cfg.icon}</span>
                <div style="font-size:9px;color:${cfg.color};margin-top:2px;">${this.escapeHtml(planet.name)}</div>
                ${missionProgressHtml}
                ${totalRemaining === 0 ? '<div style="font-size:7px;color:#f88;">ИСЧЕРПАНА</div>' : ''}
            `;
            el.onclick = () => this.showPlanetInfo(planet);
            layer.appendChild(el);
        });
    },

    _getActiveMissionForPlanet(planetId) {
        try {
            const missionsJson = this.game.get_active_planet_missions();
            const missions = JSON.parse(missionsJson);
            return missions.find(m => m.planet_id === planetId && m.status === 'flying');
        } catch(e) {
            return null;
        }
    },

    _renderPlanetMissionProgress(mission) {
        // БАГ #8: правильный расчёт прогресса с started_at
        const startedAt = mission.started_at || (mission.arrives_at - (mission.returns_at - mission.arrives_at));
        const totalDuration = mission.arrives_at - startedAt;
        const now = Date.now();
        const elapsed = now - startedAt;
        const progress = Math.min(1.0, Math.max(0, elapsed / totalDuration));
        const pct = progress * 100;
        return `
            <div class="planet-mission-bar" style="width:50px;height:3px;background:rgba(0,0,0,0.5);border-radius:2px;overflow:hidden;margin-top:2px;">
                <div class="planet-mission-fill" style="width:${pct}%;height:100%;background:#ffaa44;transition:width 0.3s;"></div>
            </div>
        `;
    },

    showPlanetInfo(planet) {
        const cfg = this.PLANET_TYPES[planet.planet_type] ?? {};
        const rem = planet.resources_remaining || planet.resources || {};
        const totalRem = (rem.coal || 0) + (rem.plasma || 0) + (rem.ore || 0);
        const isExhausted = totalRem === 0;

        if (this._currentPopup) { this._currentPopup.remove(); this._currentPopup = null; }

        let hasFreeCargo = false;
        try {
            if (window.fleetModule) {
                hasFreeCargo = window.fleetModule.ships.some(s => s.type === 'cargo' && !s.onMission && !s.onDefense);
            } else {
                const fleetKey = this.currentUser?.id ? `corebox_fleet_${this.currentUser.id}` : 'corebox_fleet';
                const fleet = JSON.parse(localStorage.getItem(fleetKey) || '[]');
                hasFreeCargo = fleet.some(s => s.type === 'cargo' && !s.onMission);
            }
        } catch(e) {}

        const popup = document.createElement('div');
        popup.className = 'player-popup';
        popup.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#0a0a0a;border:2px solid ${isExhausted ? '#f88' : (cfg.color || '#4aff9d')};
            border-radius:16px;padding:20px;z-index:10001;
            font-family:monospace;min-width:280px;max-width:90vw;
            box-shadow:0 0 30px rgba(74,255,157,0.2);
        `;
        popup.innerHTML = `
            <div style="font-size:28px;text-align:center;">${cfg.icon || '🪐'}</div>
            <div style="font-size:16px;font-weight:bold;color:${cfg.color};text-align:center;margin-bottom:8px;">
                ${this.escapeHtml(planet.name)} — ${cfg.name || planet.planet_type}
            </div>
            <div style="font-size:11px;margin-bottom:12px;background:rgba(255,255,255,0.05);padding:8px;border-radius:8px;">
                <div>🪨 Уголь: <b>${rem.coal || 0}</b></div>
                <div>⚡ Плазма: <b>${rem.plasma || 0}</b></div>
                <div>⛏️ Руда: <b>${rem.ore || 0}</b></div>
                ${isExhausted ? '<div style="color:#f88;margin-top:4px;">⚠️ Ресурсы исчерпаны</div>' : ''}
            </div>
            <button id="planet-btn-cargo" style="width:100%;padding:10px;background:rgba(255,170,0,0.15);
                border:1px solid rgba(255,170,0,0.4);border-radius:8px;color:#ffaa44;
                font-family:monospace;font-size:12px;cursor:pointer;margin-bottom:8px;
                ${isExhausted || !hasFreeCargo ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                ${isExhausted || !hasFreeCargo ? 'disabled' : ''}>
                📦 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ (100 ед.)${!hasFreeCargo && !isExhausted ? '<br><small style="font-size:9px;">Нет свободного корабля</small>' : ''}
            </button>
            <button id="planet-btn-close" style="width:100%;padding:8px;background:transparent;
                border:1px solid #555;border-radius:8px;color:#aaa;cursor:pointer;font-family:monospace;font-size:11px;">
                ✕ ЗАКРЫТЬ
            </button>
        `;

        document.body.appendChild(popup);
        this._currentPopup = popup;

        popup.querySelector('#planet-btn-cargo').onclick = async (e) => {
            e.stopPropagation();
            if (isExhausted) return;
            await this.sendShipToPlanet(planet, 'cargo');
            popup.remove(); this._currentPopup = null;
        };
        
        // БАГ #26: единая функция закрытия
        const closePopup = () => {
            popup.remove();
            this._currentPopup = null;
            document.removeEventListener('click', closeOnOutside);
            document.removeEventListener('keydown', onEsc);
        };
        
        popup.querySelector('#planet-btn-close').onclick = (e) => {
            e.stopPropagation();
            closePopup();
        };

        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) {
                closePopup();
            }
        };
        
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                closePopup();
            }
        };
        
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
        document.addEventListener('keydown', onEsc);
    },

    async sendShipToPlanet(planet, shipType) {
        if (!window.fleetModule || !window.fleetModule.ships) {
            window.showNotif?.('❌ Система флота не инициализирована', true);
            return;
        }
        
        const availableShip = window.fleetModule.ships.find(s => s.type === shipType && !s.onMission && !s.onDefense);
        if (!availableShip) {
            window.showNotif?.('❌ Нет свободного грузового корабля', true);
            return;
        }

        const resultJson = this.game.send_ship_to_planet(availableShip.id, planet.id);
        const result = JSON.parse(resultJson);
        
        if (result.success) {
            const ship = window.fleetModule.ships.find(s => s.id === availableShip.id);
            if (ship) {
                ship.onMission = true;
                ship.currentMissionId = result.mission.id;
                ship.targetPlanetId = planet.id;
                ship.missionReturnsAt = result.mission.returns_at;
                ship.missionArrivesAt = result.mission.arrives_at;
                ship.shipType = shipType;
            }
            
            window.fleetModule.saveFleet();
            this.loadPlanetsFromRust();
            
            if (window._refreshFleetWithMissions) {
                window._refreshFleetWithMissions();
            }
            
            GameBus.emit(EVENTS.SHIP_MISSION_START, { ship: availableShip, planet, mission: result.mission });
            
            window.showNotif?.(`🚀 Корабль отправлен к ${planet.name}! Забрано: 🪨${result.mission.coal} ⚡${result.mission.plasma} ⛏️${result.mission.ore}`, false);
        } else {
            window.showNotif?.(`❌ ${result.error}`, true);
        }
    },

    setShipMissionStatusFromRust(shipId, onMission, missionId, returnsAt) {
        try {
            const fleetKey = this.currentUser?.id ? `corebox_fleet_${this.currentUser.id}` : 'corebox_fleet';
            let fleet = JSON.parse(localStorage.getItem(fleetKey) || '[]');
            
            const ship = fleet.find(s => s.id === shipId);
            if (ship) {
                ship.onMission = onMission;
                ship.currentMissionId = missionId;
                if (returnsAt) ship.missionReturnsAt = returnsAt;
                if (!onMission) {
                    ship.targetPlanetId = null;
                    ship.currentMissionId = null;
                    GameBus.emit(EVENTS.SHIP_MISSION_END, { ship, missionId });
                }
                localStorage.setItem(fleetKey, JSON.stringify(fleet));
                
                if (window._refreshFleetWithMissions) window._refreshFleetWithMissions();
                
                this.loadPlanetsFromRust();
            }
        } catch(e) {
            console.warn('Ошибка обновления статуса корабля из Rust:', e);
        }
    },

    updateMissionTimers() {
        if (!this.game) return;
        try {
            const missionsJson = this.game.get_active_planet_missions();
            const missions = JSON.parse(missionsJson);
            let needsRefresh = false;
            let needsFleetSave = false;
            
            const now = Date.now();
            
            for (const mission of missions) {
                const remaining = mission.remaining_ms;
                
                if (remaining <= 0 && mission.status === 'flying') {
                    console.log(`✅ Планетарная миссия ${mission.id} завершена, освобождаем корабль`);
                    
                    const ship = window.fleetModule?.ships.find(s => s.id === mission.ship_id);
                    if (ship && ship.onMission) {
                        ship.onMission = false;
                        ship.currentMissionId = null;
                        ship.targetPlanetId = null;
                        ship.missionReturnsAt = null;
                        ship.missionArrivesAt = null;
                        needsFleetSave = true;
                        needsRefresh = true;
                        
                        console.log(`🆓 Корабль ${ship.name} освобождён (миссия завершена)`);
                        GameBus.emit(EVENTS.SHIP_MISSION_END, { ship, missionId: mission.id });
                    }
                    
                    this.loadPlanetsFromRust();
                    
                    if (window._refreshFleetWithMissions) {
                        window._refreshFleetWithMissions();
                    }
                } else if (remaining <= 30000 && remaining > 0 && mission.status === 'flying') {
                    if (!mission._warningShown) {
                        mission._warningShown = true;
                        const ship = window.fleetModule?.ships.find(s => s.id === mission.ship_id);
                        if (ship) {
                            window.showNotif?.(`⚠️ Корабль "${ship.name}" возвращается через ${Math.floor(remaining / 1000)} сек`, false);
                        }
                    }
                }
            }
            
            if (needsFleetSave && window.fleetModule) {
                window.fleetModule.saveFleet();
            }
            
            if (needsRefresh && window.fleetModule?._renderFleetTab) {
                window.fleetModule._renderFleetTab();
            }
            
            this.renderFlightLines();
        } catch(e) {
            console.warn('Ошибка обновления таймеров миссий:', e);
        }
    },

    _restorePlanetMissions() {
        if (!this.game || !window.fleetModule) return;
        try {
            const missionsJson = this.game.get_active_planet_missions();
            const missions = JSON.parse(missionsJson);
            let restored = 0;
            
            missions.forEach(mission => {
                const ship = window.fleetModule.ships.find(s => s.id === mission.ship_id);
                if (ship && mission.status === 'flying') {
                    ship.onMission = true;
                    ship.currentMissionId = mission.id;
                    ship.targetPlanetId = mission.planet_id;
                    ship.missionReturnsAt = mission.returns_at;
                    ship.missionArrivesAt = mission.arrives_at;
                    ship.shipType = 'cargo';
                    restored++;
                }
            });
            
            if (restored > 0) {
                window.fleetModule.saveFleet();
                window.fleetModule._renderFleetTab?.();
                console.log(`🪐 Восстановлено ${restored} планетарных миссий`);
            }
        } catch(e) {
            console.warn('Ошибка восстановления планетарных миссий:', e);
        }
    },

    generateStars() {
        const container = document.getElementById('space-stars-layer');
        if (!container) return;
        
        if (container.children.length > 0) return;
        
        container.innerHTML = '';
        const STAR_COUNT = 200;
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < STAR_COUNT; i++) {
            const star = document.createElement('div');
            
            const tier = Math.random();
            const size = tier > 0.95 ? (2 + Math.random() * 2)
                       : tier > 0.7  ? (1 + Math.random())
                       : (0.5 + Math.random() * 0.5);
            
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const opacity = 0.3 + Math.random() * 0.7;
            const duration = 2 + Math.random() * 4;
            const delay = Math.random() * 4;
            
            const hue = Math.random() < 0.3 ? `hsl(${200 + Math.random()*40}, 80%, 90%)` 
                      : Math.random() < 0.2 ? `hsl(${40 + Math.random()*20}, 60%, 90%)`
                      : '#ffffff';
            
            star.style.cssText = `
                position: absolute;
                left: ${x}%;
                top: ${y}%;
                width: ${size}px;
                height: ${size}px;
                background: ${hue};
                border-radius: 50%;
                opacity: ${opacity};
                box-shadow: 0 0 ${size * 2}px ${hue};
                animation: starTwinkle ${duration}s ${delay}s infinite alternate ease-in-out;
                pointer-events: none;
            `;
            fragment.appendChild(star);
        }
        container.appendChild(fragment);
        console.log('✨ Звёзды сгенерированы (кэшировано)');
    },

    setupMultiplayer() {
        this._forceLoadPlayers();
        
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        this.multiplayerInterval = setInterval(() => this.loadMultiplayerPlayers(), 30000);
        
        setInterval(() => this.updateMissionTimers(), 1000);
        
        setTimeout(() => this._restorePlanetMissions(), 2000);
    },

    async _forceLoadPlayers() {
        if (!this.currentUser) return;
        try {
            const { data: saves, error } = await supabase
                .from('game_saves')
                .select('user_id, coal, ore, chips, plasma, trash, total_mined, neuro_evolution, nights_survived, computational_power, last_seen')
                .order('total_mined', { ascending: false })
                .limit(50);

            if (error) throw error;

            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, username');

            const profileMap = {};
            (profiles ?? []).forEach(p => { profileMap[p.id] = p.username; });

            this.otherPlayers = (saves ?? [])
                .filter(s => s.user_id !== this.currentUser.id)
                .map(s => ({ ...s, username: profileMap[s.user_id] ?? 'Игрок' }));

            this.renderPlayers();
            this.renderPlayersOnMap();
            this.renderFlightLines();
        } catch(e) {
            console.warn('Ошибка первоначальной загрузки игроков:', e);
        }
    },

    async loadMultiplayerPlayers() {
        if (!this.currentUser) return;
        if (!this.isTabActive) return;
        
        try {
            const { data: saves, error } = await supabase
                .from('game_saves')
                .select('user_id, coal, ore, chips, plasma, trash, total_mined, neuro_evolution, nights_survived, computational_power, last_seen')
                .order('total_mined', { ascending: false })
                .limit(50);

            if (error) throw error;

            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, username');

            const profileMap = {};
            (profiles ?? []).forEach(p => { profileMap[p.id] = p.username; });

            this.otherPlayers = (saves ?? [])
                .filter(s => s.user_id !== this.currentUser.id)
                .map(s => ({ ...s, username: profileMap[s.user_id] ?? 'Игрок' }));

            this.renderPlayers();
            this.renderPlayersOnMap();
            this.renderFlightLines();
        } catch(e) {
            console.warn('Ошибка загрузки игроков:', e);
        }
    },

    isOnline(player) {
        if (!player.last_seen) return false;
        if (this._onlinePlayerIds && this._onlinePlayerIds.includes(player.user_id)) return true;
        return Date.now() - new Date(player.last_seen).getTime() < 5 * 60 * 1000;
    },

    renderPlayers() {
        const list = document.getElementById('space-players-list');
        if (!list) return;

        const online  = this.otherPlayers.filter(p => this.isOnline(p));
        const offline = this.otherPlayers.filter(p => !this.isOnline(p));

        const el = document.getElementById('space-online-count');
        if (el) el.textContent = `${online.length} онлайн`;

        if (!this.otherPlayers.length) {
            list.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:8px 0;">Нет других игроков</div>';
            return;
        }

        list.innerHTML = [...online, ...offline].slice(0, 30).map(p => `
            <div style="
                display:flex;align-items:center;gap:8px;padding:6px 0;
                border-bottom:1px solid rgba(255,255,255,0.05);
                cursor:pointer;
            " onclick="window.spaceModule?.showPlayerInfo('${this.escapeHtml(p.user_id)}')">
                <span style="font-size:14px;">${this.isOnline(p) ? '🟢' : '⚫'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${this.escapeHtml(p.username)}
                    </div>
                    <div style="font-size:10px;opacity:0.5;">
                        ⛏️ ${(p.total_mined||0).toLocaleString()} · 🧠 Ур.${p.neuro_evolution||0}
                    </div>
                </div>
            </div>
        `).join('');
        
        this.renderFlightLines();
    },

    renderPlayersOnMap() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;
        layer.querySelectorAll('.other-player-marker').forEach(el => el.remove());

        const getTimeAgo = (isoString) => {
            if (!isoString) return 'давно';
            const diff = Date.now() - new Date(isoString).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${mins} мин назад`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours} ч назад`;
            return `${Math.floor(hours / 24)} дн назад`;
        };

        this.otherPlayers.slice(0, 20).forEach((player, index) => {
            if (!this._playerPositions[player.user_id]) {
                const goldenAngle = 2.399963;
                const angle = index * goldenAngle;
                const r = 18 + (index % 5) * 8;
                this._playerPositions[player.user_id] = {
                    x: Math.max(8, Math.min(92, 50 + Math.cos(angle) * r)),
                    y: Math.max(8, Math.min(92, 50 + Math.sin(angle) * r))
                };
            }
            const { x, y } = this._playerPositions[player.user_id];
            
            const marker = document.createElement('div');
            marker.className = 'other-player-marker';
            marker.style.cssText = `
                position:absolute;left:${x}%;top:${y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:15;
            `;
            const isOnline = this.isOnline(player);
            
            marker.title = `${player.username || 'Игрок'}\n` +
                `🛡️ Защита: ${player.has_defense_ship ? `Да (ур. ${player.defense_ship_level})` : 'Нет'}\n` +
                `⏱️ Последний онлайн: ${getTimeAgo(player.last_seen)}`;
            
            marker.innerHTML = `
                <span style="font-size:18px;">🏰</span>
                <div style="font-size:8px;color:${isOnline ? '#4aff9d' : '#888'};margin-top:1px;">
                    ${this.escapeHtml(player.username?.slice(0,10) ?? 'Игрок')}
                </div>
            `;
            marker.onclick = () => this.showPlayerInfo(player.user_id);
            layer.appendChild(marker);
        });
        
        this.renderFlightLines();
    },

    // БАГ #8: исправлен прогресс полёта корабля
    renderFlightLines() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.flight-line, .flight-ship-icon').forEach(el => el.remove());

        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;

        let activeMissions = [];
        if (this.game) {
            try {
                const missionsJson = this.game.get_active_planet_missions();
                activeMissions = JSON.parse(missionsJson);
            } catch(e) {}
        }
        
        const now = Date.now();
        
        activeMissions.forEach(mission => {
            const targetPlanet = this.planets.find(p => p.id === mission.planet_id);
            if (!targetPlanet) return;
            
            const targetPos = { x: targetPlanet.x, y: targetPlanet.y };
            const dx = targetPos.x - myPos.x;
            const dy = targetPos.y - myPos.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const color = '#ffaa44';
            
            // БАГ #8: правильный расчёт прогресса
            const startedAt = mission.started_at || (mission.arrives_at - (mission.returns_at - mission.arrives_at));
            const totalDuration = mission.arrives_at - startedAt;
            const elapsed = now - startedAt;
            let progress = Math.min(1.0, Math.max(0, elapsed / totalDuration));
            
            // Если корабль уже должен был вернуться, фиксируем прогресс на 0.9
            if (now >= mission.returns_at) {
                progress = 0.9;
            }
            
            const shipPosX = myPos.x + dx * progress;
            const shipPosY = myPos.y + dy * progress;

            const line = document.createElement('div');
            line.className = 'flight-line';
            line.style.cssText = `
                position: absolute; left: ${myPos.x}%; top: ${myPos.y}%;
                width: ${length}%; height: 2px;
                background: linear-gradient(90deg, ${color}, transparent);
                transform-origin: 0 50%; transform: rotate(${angle}deg);
                opacity: 0.7; pointer-events: none; z-index: 2;
            `;
            
            const shipEl = document.createElement('div');
            shipEl.className = 'flight-ship-icon';
            shipEl.style.cssText = `position:absolute;left:${shipPosX}%;top:${shipPosY}%;transform:translate(-50%,-50%);font-size:14px;z-index:10;text-shadow:0 0 3px black;`;
            const isReturning = now > mission.arrives_at;
            shipEl.textContent = `📦${isReturning ? '←' : '→'}`;
            
            layer.appendChild(line);
            layer.appendChild(shipEl);
        });

        // БАГ #27: очистка интервала перед созданием нового
        if (activeMissions.length > 0 && !this._flightLineInterval && this.isTabActive) {
            if (this._flightLineInterval) {
                clearInterval(this._flightLineInterval);
                this._flightLineInterval = null;
            }
            this._flightLineInterval = setInterval(() => {
                if (this.isTabActive) {
                    this.renderFlightLines();
                } else {
                    clearInterval(this._flightLineInterval);
                    this._flightLineInterval = null;
                }
            }, 2000);
        } else if (activeMissions.length === 0 && this._flightLineInterval) {
            clearInterval(this._flightLineInterval);
            this._flightLineInterval = null;
        }
    },

    _getMyPlanetPosition() {
        if (this._playerPositions[this.currentUser?.id]) {
            return this._playerPositions[this.currentUser.id];
        }
        return { x: 50, y: 50 };
    },

    _getPlayerPosition(userId) {
        return this._playerPositions[userId] || null;
    },
    
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    },

    async showPlayerInfo(userId) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;

        const { getLatestScoutData, sendShip } = await import('./multiplayer_combat.js');
        
        const scout = await getLatestScoutData(this.currentUser.id, player.user_id);
        const scoutAge = scout ? Math.floor((Date.now() - new Date(scout.created_at).getTime()) / 60000) : null;
        const scoutFresh = scoutAge !== null && scoutAge < 30;
        const isOnline = this.isOnline(player);

        if (this._currentPopup) {
            this._currentPopup.remove();
            this._currentPopup = null;
        }

        const popup = document.createElement('div');
        popup.className = 'player-popup';
        popup.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#0a0a0a;border:2px solid ${isOnline ? '#4aff9d' : '#666'};
            border-radius:16px;padding:20px;z-index:10001;
            font-family:monospace;min-width:280px;max-width:90vw;
            box-shadow:0 0 30px rgba(0,255,0,0.2);
            backdrop-filter:blur(4px);
        `;

        // БАГ #30: проверка scout.scout_data
        const sd = scout?.scout_data || {};

        popup.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <span style="font-size:28px;">🏰</span>
                <div style="flex:1;">
                    <div style="font-size:16px;font-weight:bold;color:#4aff9d;">
                        ${this.escapeHtml(player.username)}
                    </div>
                    <div style="font-size:11px;color:${isOnline ? '#4aff9d' : '#888'};">
                        ${isOnline ? '🟢 Онлайн' : '⚫ Оффлайн · ' + this._formatLastSeen(player.last_seen)}
                    </div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:11px;background:rgba(255,255,255,0.03);padding:8px;border-radius:8px;">
                <div>⛏️ Добыто: <b>${(player.total_mined || 0).toLocaleString()}</b></div>
                <div>🧠 Нейро: <b>Ур.${player.neuro_evolution || 0}</b></div>
                <div>🌙 Ночей: <b>${player.nights_survived || 0}</b></div>
                <div>💻 Мощность: <b>${(player.computational_power || 0).toLocaleString()}</b></div>
            </div>

            ${scoutFresh ? `
            <div style="background:rgba(0,255,0,0.08);border:1px solid rgba(0,255,0,0.2);
                border-radius:10px;padding:10px;margin-bottom:12px;font-size:11px;">
                <div style="color:#4aff9d;margin-bottom:6px;">📊 РАЗВЕДДАННЫЕ (${scoutAge} мин назад)</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                    <div>⛏️ Руда: <b>${sd.ore ?? '?'}</b></div>
                    <div>🪨 Уголь: <b>${sd.coal ?? '?'}</b></div>
                    <div>🎛️ Чипы: <b>${sd.chips ?? '?'}</b></div>
                    <div>⚡ Плазма: <b>${sd.plasma ?? '?'}</b></div>
                    <div>🛡️ Защита: <b>${sd.has_defense ? 'АКТИВНА' : 'НЕТ'}</b></div>
                </div>
                ${sd._obscured ? '<div style="margin-top:6px;opacity:0.6;">⚠️ Часть данных скрыта системой защиты</div>' : ''}
            </div>
            ` : scout ? `
            <div style="background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.3);
                border-radius:8px;padding:8px;margin-bottom:12px;font-size:10px;text-align:center;">
                ⚠️ Данные разведки устарели (${scoutAge} мин)<br>
                Отправьте разведчика заново
            </div>
            ` : `
            <div style="background:rgba(100,100,100,0.1);border-radius:8px;padding:8px;margin-bottom:12px;font-size:10px;text-align:center;">
                🔍 Разведка не проводилась<br>
                Отправьте разведчика, чтобы узнать ресурсы
            </div>
            `}

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
                <button id="space-btn-scout" style="padding:10px;background:rgba(0,200,150,0.15);
                    border:1px solid rgba(0,200,150,0.4);border-radius:8px;
                    color:#4aff9d;cursor:pointer;font-family:monospace;font-size:12px;
                    font-weight:bold;transition:0.2s;">
                    🔭 ОТПРАВИТЬ РАЗВЕДЧИКА
                </button>
                <button id="space-btn-combat" style="padding:10px;background:rgba(255,50,50,0.15);
                    border:1px solid rgba(255,50,50,0.4);border-radius:8px;
                    color:#ff6a6a;cursor:pointer;font-family:monospace;font-size:12px;
                    font-weight:bold;transition:0.2s;
                    ${!scoutFresh ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                    ${!scoutFresh ? 'disabled' : ''}>
                    ⚔️ ОТПРАВИТЬ БОЕВОЙ КОРАБЛЬ${!scoutFresh ? ' (нужна разведка)' : ''}
                </button>
                <button id="space-btn-cargo" style="padding:10px;background:rgba(255,170,0,0.15);
                    border:1px solid rgba(255,170,0,0.4);border-radius:8px;
                    color:#ffaa44;cursor:pointer;font-family:monospace;font-size:12px;
                    font-weight:bold;transition:0.2s;
                    ${!scoutFresh ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                    ${!scoutFresh ? 'disabled' : ''}>
                    📦 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ${!scoutFresh ? ' (нужна разведка)' : ''}
                </button>
            </div>

            <button id="space-btn-close" style="padding:8px 16px;background:transparent;
                border:1px solid #555;border-radius:8px;color:#aaa;
                cursor:pointer;font-family:monospace;font-size:11px;width:100%;
                transition:0.2s;">
                ✕ ЗАКРЫТЬ
            </button>
        `;

        document.body.appendChild(popup);
        this._currentPopup = popup;

        const doSend = async (shipType) => {
            if (shipType !== 'scout' && !scoutFresh) return;
            
            const btn = popup.querySelector(`#space-btn-${shipType}`);
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ ОТПРАВКА...';
                btn.disabled = true;
                setTimeout(() => {
                    if (btn.parentElement) {
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                }, 2000);
            }

            const result = await sendShip(this.currentUser.id, player.user_id, shipType);
            popup.remove();
            this._currentPopup = null;
            
            if (window.showNotif) {
                window.showNotif(
                    result.success 
                        ? `✅ ${result.ship?.name || 'Корабль'} отправлен к ${player.username}!`
                        : `❌ ${result.error}`,
                    !result.success
                );
            }
        };

        popup.querySelector('#space-btn-scout').onclick = (e) => { e.stopPropagation(); doSend('scout'); };
        popup.querySelector('#space-btn-combat').onclick = (e) => { e.stopPropagation(); doSend('combat'); };
        popup.querySelector('#space-btn-cargo').onclick = (e) => { e.stopPropagation(); doSend('cargo'); };
        
        // БАГ #26: единая функция закрытия
        const closePopup = () => {
            popup.remove();
            this._currentPopup = null;
            document.removeEventListener('click', closeOnOutside);
            document.removeEventListener('keydown', onEsc);
        };
        
        popup.querySelector('#space-btn-close').onclick = (e) => { e.stopPropagation(); closePopup(); };
        
        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) {
                closePopup();
            }
        };
        
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                closePopup();
            }
        };
        
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
        document.addEventListener('keydown', onEsc);
    },

    _formatLastSeen(isoString) {
        if (!isoString) return 'давно';
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins} мин назад`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} ч назад`;
        return `${Math.floor(hours / 24)} дн назад`;
    },

    destroy() {
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        if (this.planetsChannel) supabase.removeChannel(this.planetsChannel);
        if (this._multiplayerChannel) {
            this._multiplayerChannel.unsubscribe();
            this._multiplayerChannel = null;
        }
        if (this._presenceChannel) {
            this._presenceChannel.unsubscribe();
            this._presenceChannel = null;
        }
        if (this._currentPopup) {
            this._currentPopup.remove();
            this._currentPopup = null;
        }
        if (this._flightLineInterval) {
            clearInterval(this._flightLineInterval);
            this._flightLineInterval = null;
        }
        if (this._missionCheckInterval) {
            clearInterval(this._missionCheckInterval);
            this._missionCheckInterval = null;
        }
    },

    escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]
        );
    },
};

window.spaceModule = spaceModule;
window.spaceModule.setShipMissionStatusFromRust = spaceModule.setShipMissionStatusFromRust.bind(spaceModule);
window.spaceModule.loadPlanetsFromRust = spaceModule.loadPlanetsFromRust.bind(spaceModule);