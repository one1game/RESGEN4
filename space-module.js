
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
    _flightLineDebounce: null,
    _missionCheckInterval: null,
    _missionTimerInterval: null,
    _presenceChannel: null,
    _multiplayerChannel: null,
    _starsGenerated: false,
    _needsPlayerReload: false,
    _onlinePlayerIds: [],
    
    // Нейтральные станции
    neutralStations: [],
    
    // Статические данные для тултипа
    _tooltipElement: null,
    _tooltipTimeout: null,

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
        this.loadNeutralStations();
        
        if (!this._starsGenerated) {
            this.generateStars();
            this._starsGenerated = true;
        }
        
        this.setupMultiplayer();
        this.setupPresence();
        this.initialized = true;
        
        this.initMapZoom();
        this._startMissionCheckInterval();
        this.setupTooltip();

        this._subscribeToEvents();

        console.log('🌌 Space модуль инициализирован');
    },

    loadNeutralStations() {
        // Загрузка станций из конфига или создание дефолтных
        try {
            const saved = localStorage.getItem('corebox_neutral_stations');
            if (saved) {
                this.neutralStations = JSON.parse(saved);
            } else {
                this.neutralStations = [
                    { id: 'st1', name: 'Станция Альфа', x: 25, y: 75, bonus_type: 'mining_boost', cost_trash: 50, cooldown_until: 0, icon: '🛸' },
                    { id: 'st2', name: 'Станция Бета', x: 75, y: 25, bonus_type: 'defense_boost', cost_trash: 80, cooldown_until: 0, icon: '🛸' },
                    { id: 'st3', name: 'Станция Гамма', x: 80, y: 80, bonus_type: 'power_boost', cost_trash: 100, cooldown_until: 0, icon: '🛸' }
                ];
                localStorage.setItem('corebox_neutral_stations', JSON.stringify(this.neutralStations));
            }
        } catch(e) {
            console.warn('Ошибка загрузки станций:', e);
        }
    },

    saveNeutralStations() {
        try {
            localStorage.setItem('corebox_neutral_stations', JSON.stringify(this.neutralStations));
        } catch(e) {}
    },

    setupTooltip() {
        let tooltip = document.getElementById('space-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'space-tooltip';
            tooltip.className = 'space-tooltip';
            tooltip.style.cssText = `
                position: fixed;
                background: #0a0a0a;
                border: 1px solid rgba(74,255,157,0.27);
                border-radius: 8px;
                padding: 8px;
                font-size: 10px;
                font-family: monospace;
                z-index: 9999;
                pointer-events: none;
                max-width: 180px;
                backdrop-filter: blur(4px);
                display: none;
                transition: opacity 0.15s;
            `;
            document.body.appendChild(tooltip);
        }
        this._tooltipElement = tooltip;
    },

    showTooltip(content, x, y) {
        if (!this._tooltipElement) return;
        this._tooltipElement.innerHTML = content;
        this._tooltipElement.style.display = 'block';
        this._tooltipElement.style.left = (x + 15) + 'px';
        this._tooltipElement.style.top = (y + 15) + 'px';
        this._tooltipElement.style.opacity = '1';
    },

    hideTooltip() {
        if (!this._tooltipElement) return;
        this._tooltipElement.style.display = 'none';
    },

    scheduleTooltipHide() {
        if (this._tooltipTimeout) clearTimeout(this._tooltipTimeout);
        this._tooltipTimeout = setTimeout(() => this.hideTooltip(), 100);
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
            if (e.target.closest('.space-planet, .space-station, .other-player-marker, #space-base-planet, button')) return;
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
                if (e.target.closest('.space-planet, .space-station, .other-player-marker, #space-base-planet, button')) return;
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

    // ВИЗУАЛ КАРТА-V2: генерация звёзд с параллаксом
    generateStars() {
        const container = document.getElementById('space-stars-layer');
        if (!container) return;
        
        if (container.children.length > 0) return;
        
        container.innerHTML = '';
        
        // Создаём три слоя для параллакса
        const layers = [
            { count: 150, sizeBase: 0.8, sizeVar: 0.5, opacityBase: 0.3, speed: 0.3, className: 'stars-layer-slow' },
            { count: 100, sizeBase: 1.2, sizeVar: 0.8, opacityBase: 0.5, speed: 0.6, className: 'stars-layer-medium' },
            { count: 50,  sizeBase: 2,   sizeVar: 1.5, opacityBase: 0.8, speed: 1.0, className: 'stars-layer-fast' }
        ];
        
        const margin = 0.15;
        const totalWidth = 1 + margin * 2;
        
        layers.forEach((layer, idx) => {
            const layerDiv = document.createElement('div');
            layerDiv.className = layer.className;
            layerDiv.style.cssText = `
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            `;
            
            for (let i = 0; i < layer.count; i++) {
                const star = document.createElement('div');
                const x = -margin * 100 + Math.random() * totalWidth * 100;
                const y = -margin * 100 + Math.random() * totalWidth * 100;
                const size = layer.sizeBase + Math.random() * layer.sizeVar;
                const opacity = layer.opacityBase * (0.5 + Math.random() * 0.5);
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
                    animation: starTwinkle ${2 + Math.random() * 4}s ${Math.random() * 4}s infinite alternate ease-in-out;
                `;
                layerDiv.appendChild(star);
            }
            container.appendChild(layerDiv);
        });
        
        // ВИЗУАЛ КАРТА-V2: параллакс при движении мыши
        const starMap = document.getElementById('space-star-map');
        if (starMap) {
            starMap.addEventListener('mousemove', (e) => {
                const rect = starMap.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                
                const slowLayer = container.querySelector('.stars-layer-slow');
                const mediumLayer = container.querySelector('.stars-layer-medium');
                const fastLayer = container.querySelector('.stars-layer-fast');
                
                if (slowLayer) slowLayer.style.transform = `translate(${x * 5}px, ${y * 5}px)`;
                if (mediumLayer) mediumLayer.style.transform = `translate(${x * 12}px, ${y * 12}px)`;
                if (fastLayer) fastLayer.style.transform = `translate(${x * 25}px, ${y * 25}px)`;
            });
        }
        
        console.log('✨ Звёзды сгенерированы с параллаксом');
    },

    // БАГ КАРТА-1: детерминированная позиция игрока на основе ID
    _getPlayerPosition(userId) {
        if (!this._playerPositions[userId]) {
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = ((hash << 5) - hash) + userId.charCodeAt(i);
                hash |= 0;
            }
            const goldenAngle = 2.399963;
            const angle = Math.abs(hash % 100) * goldenAngle;
            const r = 15 + (Math.abs(hash % 5)) * 9;
            this._playerPositions[userId] = {
                x: Math.max(8, Math.min(92, 50 + Math.cos(angle) * r)),
                y: Math.max(8, Math.min(92, 50 + Math.sin(angle) * r))
            };
        }
        return this._playerPositions[userId];
    },

    onTabActivated() {
        if (!this.initialized) return;
        this.isTabActive = true;
        
        this.loadPlanetsFromRust();
        this.renderPlanets();
        this.renderPlayers();
        this.renderFlightLines();
        this.renderMinimap();
        this.updateStatusBar();
        
        this.syncFromGame();
        
        this._reconnectMultiplayer();
        
        if (this._needsPlayerReload) {
            this._needsPlayerReload = false;
            this._forceLoadPlayers();
        }

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
        if (this._missionTimerInterval) {
            clearInterval(this._missionTimerInterval);
            this._missionTimerInterval = null;
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
                result.planet.discovered_at = Date.now();
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

    // ВИЗУАЛ КАРТА-V7: анимация открытия планеты
    renderPlanets() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.space-planet').forEach(el => el.remove());

        // БАГ КАРТА-2: выносим загрузку миссий за пределы цикла
        let activeMissions = [];
        try {
            activeMissions = JSON.parse(this.game.get_active_planet_missions());
        } catch(e) {}

        this.planets.forEach(planet => {
            const cfg = this.PLANET_TYPES[planet.planet_type] ?? this.PLANET_TYPES['earth'];
            const totalRemaining = (planet.resources_remaining?.coal || 0) + 
                                   (planet.resources_remaining?.plasma || 0) + 
                                   (planet.resources_remaining?.ore || 0);
            const isExhausted = totalRemaining === 0;
            
            // ВИЗУАЛ КАРТА-V7: анимация новой планеты
            const isNew = planet.discovered_at && (Date.now() - planet.discovered_at < 3000);
            const newClass = isNew ? 'planet-new' : '';
            
            const activeMission = activeMissions.find(m => m.planet_id === planet.id && m.status === 'flying');
            const missionProgressHtml = activeMission ? this._renderPlanetMissionProgress(activeMission) : '';
            
            const el = document.createElement('div');
            el.className = `space-planet ${newClass}`;
            el.style.cssText = `
                position:absolute;left:${planet.x}%;top:${planet.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:5;
                ${isExhausted ? 'opacity:0.6;filter:grayscale(0.5);' : ''}
            `;
            
            el.innerHTML = `
                <span style="font-size:22px;">${cfg.icon}</span>
                <div style="font-size:9px;color:${cfg.color};margin-top:2px;">${this.escapeHtml(planet.name)}</div>
                ${missionProgressHtml}
                ${isExhausted ? '<div style="font-size:7px;color:#f88;">ИСЧЕРПАНА</div>' : ''}
            `;
            el.onclick = () => this.showPlanetInfo(planet);
            layer.appendChild(el);
        });
        
        this.renderStations();
        this.renderMinimap();
    },

    renderStations() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;
        
        layer.querySelectorAll('.space-station').forEach(el => el.remove());
        
        const now = Date.now();
        this.neutralStations.forEach(station => {
            const isOnCooldown = station.cooldown_until > now;
            
            const el = document.createElement('div');
            el.className = 'space-station';
            el.style.cssText = `
                position:absolute;left:${station.x}%;top:${station.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:6;
                ${isOnCooldown ? 'opacity:0.5;filter:grayscale(0.3);' : ''}
            `;
            
            el.innerHTML = `
                <span style="font-size:24px;">${station.icon}</span>
                <div style="font-size:8px;color:#ffaa44;margin-top:2px;">${this.escapeHtml(station.name)}</div>
                ${isOnCooldown ? '<div style="font-size:7px;color:#888;">ОСТЫВАЕТ</div>' : ''}
            `;
            el.onclick = () => this.showStationInfo(station);
            layer.appendChild(el);
        });
    },

    showStationInfo(station) {
        if (this._currentPopup) { this._currentPopup.remove(); this._currentPopup = null; }
        
        const now = Date.now();
        const isOnCooldown = station.cooldown_until > now;
        let bonusText = '';
        switch(station.bonus_type) {
            case 'mining_boost': bonusText = '⚡ Ускорение добычи на 1 цикл'; break;
            case 'defense_boost': bonusText = '🛡️ Временная защита на 2 ночи'; break;
            case 'power_boost': bonusText = '💻 +50 вычислительной мощности'; break;
            default: bonusText = '📦 Редкий бонус';
        }
        
        const popup = document.createElement('div');
        popup.className = 'station-popup';
        popup.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#0a0a0a;border:2px solid #ffaa44;
            border-radius:16px;padding:20px;z-index:10001;
            font-family:monospace;min-width:260px;max-width:90vw;
            box-shadow:0 0 30px rgba(255,170,68,0.2);
        `;
        
        popup.innerHTML = `
            <div style="font-size:28px;text-align:center;">${station.icon}</div>
            <div style="font-size:16px;font-weight:bold;color:#ffaa44;text-align:center;margin-bottom:8px;">
                ${this.escapeHtml(station.name)}
            </div>
            <div style="font-size:11px;margin-bottom:12px;background:rgba(255,255,255,0.05);padding:8px;border-radius:8px;">
                <div>🎁 Бонус: ${bonusText}</div>
                <div>♻️ Стоимость: ${station.cost_trash} мусора</div>
                ${isOnCooldown ? `<div style="color:#f88;margin-top:8px;">⏱️ Кулдаун: ${Math.ceil((station.cooldown_until - now) / 60000)} мин</div>` : ''}
            </div>
            ${!isOnCooldown ? `
            <button id="station-btn-trade" style="width:100%;padding:10px;background:rgba(255,170,0,0.15);
                border:1px solid rgba(255,170,0,0.4);border-radius:8px;color:#ffaa44;
                font-family:monospace;font-size:12px;cursor:pointer;margin-bottom:8px;">
                📦 ОТПРАВИТЬ КОРАБЛЬ ЗА БОНУСОМ
            </button>
            ` : ''}
            <button id="station-btn-close" style="width:100%;padding:8px;background:transparent;
                border:1px solid #555;border-radius:8px;color:#aaa;cursor:pointer;font-family:monospace;font-size:11px;">
                ✕ ЗАКРЫТЬ
            </button>
        `;
        
        document.body.appendChild(popup);
        this._currentPopup = popup;
        
        const closePopup = () => {
            popup.remove();
            this._currentPopup = null;
            document.removeEventListener('click', closeOnOutside);
            document.removeEventListener('keydown', onEsc);
        };
        
        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) closePopup();
        };
        const onEsc = (e) => {
            if (e.key === 'Escape') closePopup();
        };
        
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
        document.addEventListener('keydown', onEsc);
        
        popup.querySelector('#station-btn-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closePopup();
        });
        
        if (!isOnCooldown) {
            popup.querySelector('#station-btn-trade')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.tradeWithStation(station);
                closePopup();
            });
        }
    },

    async tradeWithStation(station) {
        let stats = null;
        try { 
            const j = this.game.get_statistics(); 
            if (j) stats = JSON.parse(j); 
        } catch(e) {}
        
        const trashCount = stats?.trash_inventory || 0;
        
        if (trashCount < station.cost_trash) {
            window.showNotif?.(`❌ Недостаточно мусора (нужно ${station.cost_trash})`, true);
            return;
        }
        
        const cargoShip = window.fleetModule?.ships.find(s => s.type === 'cargo' && !s.onMission && !s.onDefense);
        if (!cargoShip) {
            window.showNotif?.('❌ Нет свободного грузового корабля', true);
            return;
        }
        
        this.game.subtract_resource('trash', station.cost_trash);
        
        switch(station.bonus_type) {
            case 'mining_boost':
                if (typeof this.game.set_temporary_mining_bonus === 'function') {
                    this.game.set_temporary_mining_bonus(50);
                }
                window.addToLog?.(`🎁 Станция ${station.name}: +50% к добыче на 1 цикл!`, 'success');
                break;
            case 'defense_boost':
                if (typeof this.game.add_temporary_defense === 'function') {
                    this.game.add_temporary_defense(2);
                }
                window.addToLog?.(`🎁 Станция ${station.name}: временная защита на 2 ночи!`, 'success');
                break;
            case 'power_boost':
                this.game.add_power(50);
                window.addToLog?.(`🎁 Станция ${station.name}: +50 вычислительной мощности!`, 'success');
                break;
        }
        
        station.cooldown_until = Date.now() + 5 * 60 * 1000; // 5 минут кулдаун
        this.saveNeutralStations();
        this.renderStations();
        
        window.showNotif?.(`✅ Бонус от ${station.name} активирован!`, false);
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

    // БАГ КАРТА-5: исчерпанная планета показывает информационный блок
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
        
        // БАГ КАРТА-5: для исчерпанных планет — информационный блок вместо кнопки
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
            ${isExhausted ? 
                `<div style="text-align:center;padding:10px;color:#f88;border:1px solid #f882;border-radius:8px;font-size:11px;margin-bottom:8px;">
                    ⚠️ Планета полностью исчерпана.<br>Ресурсы не могут быть добыты.
                </div>` :
                `<button id="planet-btn-cargo" style="width:100%;padding:10px;background:rgba(255,170,0,0.15);
                    border:1px solid rgba(255,170,0,0.4);border-radius:8px;color:#ffaa44;
                    font-family:monospace;font-size:12px;cursor:pointer;margin-bottom:8px;
                    ${!hasFreeCargo ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                    ${!hasFreeCargo ? 'disabled' : ''}>
                    📦 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ (100 ед.)${!hasFreeCargo && !isExhausted ? '<br><small style="font-size:9px;">Нет свободного корабля</small>' : ''}
                </button>`
            }
            <button id="planet-btn-close" style="width:100%;padding:8px;background:transparent;
                border:1px solid #555;border-radius:8px;color:#aaa;cursor:pointer;font-family:monospace;font-size:11px;">
                ✕ ЗАКРЫТЬ
            </button>
        `;

        document.body.appendChild(popup);
        this._currentPopup = popup;

        if (!isExhausted) {
            popup.querySelector('#planet-btn-cargo')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.sendShipToPlanet(planet, 'cargo');
                popup.remove(); this._currentPopup = null;
            });
        }
        
        const closePopup = () => {
            popup.remove();
            this._currentPopup = null;
            document.removeEventListener('click', closeOnOutside);
            document.removeEventListener('keydown', onEsc);
        };
        
        popup.querySelector('#planet-btn-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closePopup();
        });

        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) closePopup();
        };
        const onEsc = (e) => {
            if (e.key === 'Escape') closePopup();
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

    // БАГ #49: setupMultiplayer с сохранением дескриптора интервала
    setupMultiplayer() {
        this._forceLoadPlayers();
        
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        this.multiplayerInterval = setInterval(() => this.loadMultiplayerPlayers(), 30000);
        
        if (this._missionTimerInterval) clearInterval(this._missionTimerInterval);
        this._missionTimerInterval = setInterval(() => this.updateMissionTimers(), 1000);
        
        setTimeout(() => this._restorePlanetMissions(), 2000);
    },

    // БАГ КАРТА-4: Supabase Presence для онлайна
    setupPresence() {
        if (!this.currentUser) return;
        
        if (this._presenceChannel) {
            this._presenceChannel.unsubscribe();
        }
        
        this._presenceChannel = supabase.channel('online_players', {
            config: { presence: { key: this.currentUser.id } }
        });
        
        this._presenceChannel
            .on('presence', { event: 'sync' }, () => {
                const state = this._presenceChannel.presenceState();
                this._onlinePlayerIds = Object.keys(state);
                this.renderPlayers();
                this.renderPlayersOnMap();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await this._presenceChannel.track({
                        userId: this.currentUser.id,
                        username: this.currentUser.user_metadata?.username || 'Игрок',
                        online_at: new Date().toISOString()
                    });
                }
            });
    },

    // БАГ КАРТА-6: _forceLoadPlayers проверяет isTabActive
    async _forceLoadPlayers() {
        if (!this.currentUser) return;
        if (!this.isTabActive) {
            this._needsPlayerReload = true;
            return;
        }
        
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

            // БАГ КАРТА-1: очищаем позиции для удалённых игроков
            const currentIds = new Set(this.otherPlayers.map(p => p.user_id));
            for (const id in this._playerPositions) {
                if (id !== this.currentUser?.id && !currentIds.has(id)) {
                    delete this._playerPositions[id];
                }
            }

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

            const currentIds = new Set(this.otherPlayers.map(p => p.user_id));
            for (const id in this._playerPositions) {
                if (id !== this.currentUser?.id && !currentIds.has(id)) {
                    delete this._playerPositions[id];
                }
            }

            this.renderPlayers();
            this.renderPlayersOnMap();
            this.renderFlightLines();
        } catch(e) {
            console.warn('Ошибка загрузки игроков:', e);
        }
    },

    isOnline(player) {
        if (this._onlinePlayerIds && this._onlinePlayerIds.includes(player.user_id)) return true;
        if (!player.last_seen) return false;
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
            " onmouseenter="window.spaceModule?.showPlayerTooltip('${this.escapeHtml(p.user_id)}', event)"
              onmouseleave="window.spaceModule?.scheduleTooltipHide()"
              onclick="window.spaceModule?.showPlayerInfo('${this.escapeHtml(p.user_id)}')">
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

    // ВИЗУАЛ КАРТА-V4: кастомный тултип
    showPlayerTooltip(userId, event) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;
        
        const isOnline = this.isOnline(player);
        const lastSeenText = player.last_seen ? this._formatLastSeen(player.last_seen) : 'неизвестно';
        
        const tooltipContent = `
            <div class="tooltip-inner">
                <div class="tooltip-name" style="color:${isOnline ? '#4aff9d' : '#888'}">🏰 ${this.escapeHtml(player.username)}</div>
                <div>🧠 Нейро: Ур.${player.neuro_evolution || 0} | ⛏️ ${(player.total_mined || 0).toLocaleString()} добыто</div>
                <div>🛡️ Защитник: ${player.has_defense_ship ? `Да (ур.${player.defense_ship_level})` : 'Нет'}</div>
                <div>⏱️ ${isOnline ? '🟢 Онлайн' : `⚫ Оффлайн · ${lastSeenText}`}</div>
            </div>
        `;
        
        this.showTooltip(tooltipContent, event.clientX, event.clientY);
    },

    // ВИЗУАЛ КАРТА-V3: иконки игроков по уровню нейро
    getPlayerIcon(neuroEvolution) {
        const evo = neuroEvolution || 0;
        if (evo >= 10) return { icon: '👁️', size: 24, color: '#ff44ff', glow: true };
        if (evo >= 8) return  { icon: '🗼', size: 22, color: '#ff6a6a', glow: false };
        if (evo >= 6) return  { icon: '🏯', size: 20, color: '#ffaa44', glow: false };
        if (evo >= 4) return  { icon: '🏛️', size: 18, color: '#4aff9d', glow: false };
        if (evo >= 2) return  { icon: '🏠', size: 16, color: '#aaa',    glow: false };
        return                { icon: '🏚️', size: 14, color: '#888',    glow: false };
    },

    // ВИЗУАЛ КАРТА-V5: зоны влияния
    renderInfluenceZone() {
        const svg = document.getElementById('space-flight-svg');
        if (!svg) return;
        
        const existing = svg.querySelector('.influence-zone');
        if (existing) existing.remove();
        
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;
        
        const neuroLevel = this._lastStats?.neuro_evolution || 0;
        const radius = 8 + neuroLevel * 1.5;
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.classList.add('influence-zone');
        circle.setAttribute('cx', `${myPos.x}%`);
        circle.setAttribute('cy', `${myPos.y}%`);
        circle.setAttribute('r', `${radius}%`);
        circle.setAttribute('fill', 'rgba(74,255,157,0.04)');
        circle.setAttribute('stroke', 'rgba(74,255,157,0.15)');
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('stroke-dasharray', '6 3');
        
        svg.insertBefore(circle, svg.firstChild);
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

        const myPos = this._getMyPlanetPosition();
        
        this.otherPlayers.slice(0, 20).forEach((player) => {
            const pos = this._getPlayerPosition(player.user_id);
            
            const isOnline = this.isOnline(player);
            const { icon, size, color, glow } = this.getPlayerIcon(player.neuro_evolution);
            const glowStyle = glow ? 'filter: drop-shadow(0 0 6px #ff44ff); animation: glow-pulse 2s infinite;' : '';
            
            // Проверка на нахождение в зоне влияния
            let isInInfluence = false;
            if (myPos && pos) {
                const dx = pos.x - myPos.x;
                const dy = pos.y - myPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const neuroLevel = this._lastStats?.neuro_evolution || 0;
                const influenceRadius = 8 + neuroLevel * 1.5;
                isInInfluence = distance < influenceRadius;
            }
            
            const threatClass = isInInfluence ? 'threat-in-range' : '';
            
            const marker = document.createElement('div');
            marker.className = `other-player-marker ${threatClass}`;
            marker.style.cssText = `
                position:absolute;left:${pos.x}%;top:${pos.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:15;
            `;
            
            marker.innerHTML = `
                <span style="font-size:${size}px;${glowStyle}">${icon}</span>
                <div style="font-size:8px;color:${color};margin-top:1px;">
                    ${this.escapeHtml(player.username?.slice(0,10) ?? 'Игрок')}
                </div>
            `;
            
            marker.onmouseenter = (e) => {
                this.showPlayerTooltip(player.user_id, e);
            };
            marker.onmouseleave = () => {
                this.scheduleTooltipHide();
            };
            marker.onclick = () => this.showPlayerInfo(player.user_id);
            layer.appendChild(marker);
        });
        
        this.renderInfluenceZone();
        this.renderFlightLines();
    },

    // ВИЗУАЛ КАРТА-V1: живые SVG линии полёта + КАРТА G-2: сигнатуры угроз
    renderFlightLines() {
        const svg = document.getElementById('space-flight-svg');
        if (!svg) return;

        svg.innerHTML = '';

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
        
        // Исходящие миссии (оранжевые)
        activeMissions.forEach(mission => {
            const targetPlanet = this.planets.find(p => p.id === mission.planet_id);
            if (!targetPlanet) return;
            
            const targetPos = { x: targetPlanet.x, y: targetPlanet.y };
            const dx = targetPos.x - myPos.x;
            const dy = targetPos.y - myPos.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            
            const startedAt = mission.started_at || (mission.arrives_at - (mission.returns_at - mission.arrives_at));
            const totalDuration = mission.arrives_at - startedAt;
            const elapsed = now - startedAt;
            let progress = Math.min(1.0, Math.max(0, elapsed / totalDuration));
            
            if (now >= mission.returns_at) {
                progress = 0.9;
            }
            
            const shipPosX = myPos.x + dx * progress;
            const shipPosY = myPos.y + dy * progress;
            
            // Линия
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${myPos.x}%`);
            line.setAttribute('y1', `${myPos.y}%`);
            line.setAttribute('x2', `${targetPos.x}%`);
            line.setAttribute('y2', `${targetPos.y}%`);
            line.setAttribute('stroke', '#ffaa44');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-dasharray', '4 4');
            line.setAttribute('opacity', '0.6');
            svg.appendChild(line);
            
            // Корабль (точка)
            const shipPoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            shipPoint.setAttribute('r', '3');
            shipPoint.setAttribute('fill', '#ffaa44');
            shipPoint.setAttribute('cx', `${shipPosX}%`);
            shipPoint.setAttribute('cy', `${shipPosY}%`);
            svg.appendChild(shipPoint);
        });
        
        // КАРТА G-2: Входящие PvP-миссии (красные, сигнатуры угроз)
        if (this.currentUser && window.fleetModule) {
            const incomingMissions = window.fleetModule.activePvpMissions || [];
            
            incomingMissions.forEach(mission => {
                if (mission.targetUserId !== this.currentUser.id) return;
                if (mission.status !== 'flying') return;
                
                const attackerPos = this._getPlayerPosition(mission.targetUserId || mission.attackerId);
                if (!attackerPos) return;
                
                const dx = attackerPos.x - myPos.x;
                const dy = attackerPos.y - myPos.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                
                let progress = 0;
                if (mission.arrivesAt) {
                    const total = mission.arrivesAt - mission.startedAt;
                    const elapsed = now - mission.startedAt;
                    progress = Math.min(0.95, Math.max(0, elapsed / total));
                }
                
                const shipPosX = attackerPos.x + (myPos.x - attackerPos.x) * progress;
                const shipPosY = attackerPos.y + (myPos.y - attackerPos.y) * progress;
                const remainingMs = mission.arrivesAt - now;
                const isUrgent = remainingMs < 60000;
                
                // Красная линия угрозы
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', `${attackerPos.x}%`);
                line.setAttribute('y1', `${attackerPos.y}%`);
                line.setAttribute('x2', `${myPos.x}%`);
                line.setAttribute('y2', `${myPos.y}%`);
                line.setAttribute('stroke', isUrgent ? '#ff4444' : '#ff6666');
                line.setAttribute('stroke-width', isUrgent ? '2' : '1.5');
                line.setAttribute('stroke-dasharray', isUrgent ? '2 2' : '6 4');
                line.setAttribute('opacity', isUrgent ? '0.9' : '0.6');
                svg.appendChild(line);
                
                // Пульсирующий маркер угрозы
                const threatMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                threatMarker.setAttribute('r', isUrgent ? '6' : '4');
                threatMarker.setAttribute('fill', '#ff4444');
                threatMarker.setAttribute('cx', `${shipPosX}%`);
                threatMarker.setAttribute('cy', `${shipPosY}%`);
                if (isUrgent) {
                    threatMarker.setAttribute('class', 'threat-pulse');
                }
                svg.appendChild(threatMarker);
            });
        }
        
        this.renderInfluenceZone();
    },

    _getMyPlanetPosition() {
        if (this._playerPositions[this.currentUser?.id]) {
            return this._playerPositions[this.currentUser.id];
        }
        return { x: 50, y: 50 };
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
        const repScore = player.reputation_score || 0;
        const repColor = repScore >= 0 ? '#4aff9d' : '#ff6a6a';
        const repSign = repScore >= 0 ? '+' : '';

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
                    <div style="font-size:10px;color:${repColor};">🤝 Репутация: ${repSign}${repScore}</div>
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
            
            if (result.success && shipType !== 'scout') {
                // После атаки обновляем репутацию
                const newRep = repScore - 2;
                await this.updateReputation(player.user_id, newRep);
            }
        };

        popup.querySelector('#space-btn-scout').onclick = (e) => { e.stopPropagation(); doSend('scout'); };
        popup.querySelector('#space-btn-combat').onclick = (e) => { e.stopPropagation(); doSend('combat'); };
        popup.querySelector('#space-btn-cargo').onclick = (e) => { e.stopPropagation(); doSend('cargo'); };
        
        const closePopup = () => {
            popup.remove();
            this._currentPopup = null;
            document.removeEventListener('click', closeOnOutside);
            document.removeEventListener('keydown', onEsc);
        };
        
        popup.querySelector('#space-btn-close').onclick = (e) => { e.stopPropagation(); closePopup(); };
        
        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) closePopup();
        };
        const onEsc = (e) => {
            if (e.key === 'Escape') closePopup();
        };
        
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
        document.addEventListener('keydown', onEsc);
    },

    async updateReputation(userId, newScore) {
        try {
            await supabase
                .from('player_reputation')
                .upsert({
                    user_id: this.currentUser.id,
                    target_id: userId,
                    score: Math.max(-5, Math.min(5, newScore)),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,target_id' });
            
            const player = this.otherPlayers.find(p => p.user_id === userId);
            if (player) player.reputation_score = newScore;
        } catch(e) {
            console.warn('Ошибка обновления репутации:', e);
        }
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

    // ВИЗУАЛ КАРТА-V6: мини-карта
    renderMinimap() {
        const canvas = document.getElementById('space-minimap');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 80, 80);
        
        // Фон
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, 80, 80);
        
        // Звёзды
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let i = 0; i < 30; i++) {
            ctx.fillRect(Math.random()*80, Math.random()*80, 1, 1);
        }
        
        // Планеты
        this.planets.forEach(p => {
            ctx.fillStyle = '#ffaa44';
            ctx.beginPath();
            ctx.arc(p.x * 0.8, p.y * 0.8, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Нейтральные станции
        this.neutralStations.forEach(s => {
            ctx.fillStyle = '#ffaa44';
            ctx.beginPath();
            ctx.rect(s.x * 0.8 - 1, s.y * 0.8 - 1, 2, 2);
            ctx.fill();
        });
        
        // Игроки
        this.otherPlayers.forEach(p => {
            const pos = this._getPlayerPosition(p.user_id);
            if (!pos) return;
            ctx.fillStyle = this.isOnline(p) ? '#4aff9d' : '#555';
            ctx.beginPath();
            ctx.arc(pos.x * 0.8, pos.y * 0.8, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Моя база
        const myPos = this._getMyPlanetPosition();
        if (myPos) {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(myPos.x * 0.8, myPos.y * 0.8, 3, 0, Math.PI * 2);
            ctx.fill();
            
            // Рамка вокруг базы
            ctx.strokeStyle = '#4aff9d';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(myPos.x * 0.8, myPos.y * 0.8, 4, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        // Активные линии полёта на мини-карте
        let activeMissions = [];
        try {
            const missionsJson = this.game.get_active_planet_missions();
            activeMissions = JSON.parse(missionsJson);
        } catch(e) {}
        
        activeMissions.forEach(mission => {
            const targetPlanet = this.planets.find(p => p.id === mission.planet_id);
            if (!targetPlanet || !myPos) return;
            
            ctx.beginPath();
            ctx.moveTo(myPos.x * 0.8, myPos.y * 0.8);
            ctx.lineTo(targetPlanet.x * 0.8, targetPlanet.y * 0.8);
            ctx.strokeStyle = 'rgba(255,170,68,0.4)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });
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
        if (this._flightLineDebounce) {
            clearTimeout(this._flightLineDebounce);
            this._flightLineDebounce = null;
        }
        if (this._missionCheckInterval) {
            clearInterval(this._missionCheckInterval);
            this._missionCheckInterval = null;
        }
        if (this._missionTimerInterval) {
            clearInterval(this._missionTimerInterval);
            this._missionTimerInterval = null;
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