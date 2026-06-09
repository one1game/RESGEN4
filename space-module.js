// space-module.js - ИСПРАВЛЕНАЯ ВЕРСИЯ (станции и планеты)
import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';
import { escapeHtml } from './utils.js';

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
    
    neutralStations: [],
    
    _tooltipElement: null,
    _tooltipTimeout: null,
    
    _minimapStars: null,
    
    _gameBusUnsubscribers: [],

    // ========== CANVAS ENGINE ==========
    _canvas: null,
    _ctx: null,
    _canvasW: 0,
    _canvasH: 0,
    _animFrameId: null,
    _isRendering: false,

    // Spatial hash
    _spatialGrid: {},
    _CELL_SIZE: 50,

    // Emoji cache
    _emojiCache: {},
    _EMOJI_SIZES: [14, 16, 18, 20, 22, 24],

    // Throttle / dirty flags
    _renderDirty: false,
    _lastMinimapRender: 0,
    _lastFetchTime: 0,
    _adaptiveLoadTimeout: null,
    _hasMissionsLastCheck: 0,
    _hasMissionsCache: false,

    // Старые поля для совместимости
    _renderThrottleTimer: null,
    _lastRenderTime: 0,
    _renderInterval: 100,
    _maxPlayersOnMap: 60,
    _lastPlayersHash: '',
    _viewportBounds: { x1: 0, x2: 100, y1: 0, y2: 100 },
    _visiblePlayers: [],
    
    // НОВЫЕ ПОЛЯ ДЛЯ РЕАЛЬНЫХ КООРДИНАТ
    _mapSize: 1000,
    _myMapPos: null,
    _mapPosLoaded: false,
    _viewportMapBounds: { x1: 0, y1: 0, x2: 1000, y2: 1000 },
    _clusterMode: false,
    _isDragging: false,

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

    setMyPosition(x, y) {
        this._myMapPos = { x, y };
        this._mapPosLoaded = true;
        this._playerPositions[this.currentUser?.id] = { x, y };
        this._markDirty();
    },

    init(gameInstance, user) {
        this.game = gameInstance;
        this.currentUser = user;
        this._playerPositions = {};

        if (user?.id) {
            this._playerPositions[user.id] = { x: 500, y: 500 };
        }

        this.loadPlanetsFromRust();
        this.loadNeutralStations();
        
        this._minimapStars = Array.from({length: 30}, () => ({
            x: Math.random() * 100,
            y: Math.random() * 100
        }));
        
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
        
        this._initCanvas();
        this._startRenderLoop();

        console.log('🌌 Space модуль инициализирован');
    },

    // ========== ИСПРАВЛЕНА: станции в процентах (0-100) ==========
    loadNeutralStations() {
        try {
            const saved = localStorage.getItem('corebox_neutral_stations');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.version === 2 && parsed.data) {
                    this.neutralStations = parsed.data;
                } else if (Array.isArray(parsed) && !parsed.version) {
                    this.neutralStations = parsed;
                    this.saveNeutralStations();
                } else {
                    this.neutralStations = parsed;
                    this.saveNeutralStations();
                }
            } else {
                // ИСПРАВЛЕНО: координаты станций в процентах (0-100)
                this.neutralStations = [
                    { id: 'st1', name: 'Станция Альфа', x: 25, y: 75, bonus_type: 'mining_boost', cost_trash: 50, cooldown_until: 0, icon: '🛸' },
                    { id: 'st2', name: 'Станция Бета', x: 75, y: 25, bonus_type: 'defense_boost', cost_trash: 80, cooldown_until: 0, icon: '🛸' },
                    { id: 'st3', name: 'Станция Гамма', x: 80, y: 80, bonus_type: 'power_boost', cost_trash: 100, cooldown_until: 0, icon: '🛸' }
                ];
                this.saveNeutralStations();
            }
        } catch(e) {
            console.warn('Ошибка загрузки станций:', e);
        }
    },

    saveNeutralStations() {
        try {
            const toSave = {
                version: 2,
                data: this.neutralStations
            };
            localStorage.setItem('corebox_neutral_stations', JSON.stringify(toSave));
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
        const unsub1 = GameBus.on(EVENTS.SHIP_MISSION_END, ({ ship, missionId }) => {
            this.loadPlanetsFromRust();
            this._markDirty();
            this.renderPlanets();
        });
        
        const unsub2 = GameBus.on(EVENTS.FLEET_UPDATED, () => {
            this._markDirty();
        });
        
        const unsub3 = GameBus.on(EVENTS.STATS_UPDATED, (stats) => {
            this.updateStatusBar(stats);
        });
        
        this._gameBusUnsubscribers = [unsub1, unsub2, unsub3];
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
                    
                    if (remaining <= 0 && mission.status === 'flying' && !mission._processing) {
                        mission._processing = true;
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
                
                this._markDirty();
                this._hasMissionsLastCheck = 0;
                
            } catch(e) {
                console.warn('Ошибка в missionCheckInterval:', e);
            }
        }, 2000);
    },

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
            this._scale = scale;
            this._translateX = translateX;
            this._translateY = translateY;
            this._markDirty();
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
            this._isDragging = true;
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
            this._isDragging = false;
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
                this._isDragging = true;
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
            this._isDragging = false;
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

    generateStars() {
        const container = document.getElementById('space-stars-layer');
        if (!container) return;
        
        if (container.children.length > 0) return;
        
        container.innerHTML = '';
        
        const layers = [
            { count: 150, sizeBase: 0.8, sizeVar: 0.5, opacityBase: 0.3, speed: 0.3, className: 'stars-layer-slow' },
            { count: 100, sizeBase: 1.2, sizeVar: 0.8, opacityBase: 0.5, speed: 0.6, className: 'stars-layer-medium' },
            { count: 50,  sizeBase: 2,   sizeVar: 1.5, opacityBase: 0.8, speed: 1.0, className: 'stars-layer-fast' }
        ];
        
        const margin = 0.15;
        const totalWidth = 1 + margin * 2;
        
        layers.forEach((layer) => {
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

    _getPlayerPosition(userId) {
        if (this._playerPositions[userId]) {
            return this._playerPositions[userId];
        }
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = ((hash << 5) - hash) + userId.charCodeAt(i);
            hash |= 0;
        }
        let hash2 = hash ^ (hash >>> 16);
        hash2 = Math.imul(hash2, 0x45d9f3b);
        hash2 ^= (hash2 >>> 16);
        const x = 100 + (Math.abs(hash) % 800);
        const y = 100 + (Math.abs(hash2) % 800);
        this._playerPositions[userId] = { x, y };
        return this._playerPositions[userId];
    },

    onTabActivated() {
        if (!this.initialized) return;
        this.isTabActive = true;
        
        this.loadPlanetsFromRust();
        this.renderPlanets();
        this.renderPlayers();
        this.renderMinimap();
        this.updateStatusBar();
        
        this.syncFromGame();
        
        this._reconnectMultiplayer();
        this._startRenderLoop();
        
        if (this._needsPlayerReload) {
            this._needsPlayerReload = false;
            this._forceLoadPlayers();
        }

        const researchBtn = document.getElementById('space-research-btn');
        if (researchBtn && !researchBtn._handlerSet) {
            researchBtn._handlerSet = true;
            researchBtn.onclick = () => this.startResearch();
        }
        
        this._markDirty();
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
        if (this._adaptiveLoadTimeout) {
            clearTimeout(this._adaptiveLoadTimeout);
            this._adaptiveLoadTimeout = null;
        }
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
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

    renderPlanets() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.space-planet').forEach(el => el.remove());

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
            
            const isNew = planet.discovered_at && (Date.now() - planet.discovered_at < 3000);
            const newClass = isNew ? 'planet-new' : '';
            
            const activeMission = activeMissions.find(m => m.planet_id === planet.id && m.status === 'flying');
            const missionProgressHtml = activeMission ? this._renderPlanetMissionProgress(activeMission) : '';
            
            const el = document.createElement('div');
            el.className = `space-planet ${newClass}`;
            // Планеты в процентах (0-100) — правильно
            el.style.cssText = `
                position:absolute;left:${planet.x}%;top:${planet.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:5;
                ${isExhausted ? 'opacity:0.6;filter:grayscale(0.5);' : ''}
            `;
            
            el.innerHTML = `
                <span style="font-size:22px;">${cfg.icon}</span>
                <div style="font-size:9px;color:${cfg.color};margin-top:2px;">${escapeHtml(planet.name)}</div>
                ${missionProgressHtml}
                ${isExhausted ? '<div style="font-size:7px;color:#f88;">ИСЧЕРПАНА</div>' : ''}
            `;
            el.onclick = () => this.showPlanetInfo(planet);
            layer.appendChild(el);
        });
        
        this.renderStations();
        this.renderMinimap();
    },

    // ========== ИСПРАВЛЕНА: станции в процентах ==========
    renderStations() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;
        
        layer.querySelectorAll('.space-station').forEach(el => el.remove());
        
        const now = Date.now();
        this.neutralStations.forEach(station => {
            const isOnCooldown = station.cooldown_until > now;
            
            const el = document.createElement('div');
            el.className = 'space-station';
            // ИСПРАВЛЕНО: station.x и station.y уже в процентах (0-100)
            el.style.cssText = `
                position:absolute;left:${station.x}%;top:${station.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:6;
                ${isOnCooldown ? 'opacity:0.5;filter:grayscale(0.3);' : ''}
            `;
            
            el.innerHTML = `
                <span style="font-size:24px;">${station.icon}</span>
                <div style="font-size:8px;color:#ffaa44;margin-top:2px;">${escapeHtml(station.name)}</div>
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
        
        const remaining = station.cooldown_until - now;
        const cooldownDisplay = remaining < 60000 
            ? `${Math.ceil(remaining / 1000)} сек` 
            : `${Math.ceil(remaining / 60000)} мин`;
        
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
                ${escapeHtml(station.name)}
            </div>
            <div style="font-size:11px;margin-bottom:12px;background:rgba(255,255,255,0.05);padding:8px;border-radius:8px;">
                <div>🎁 Бонус: ${bonusText}</div>
                <div>♻️ Стоимость: ${station.cost_trash} мусора</div>
                ${isOnCooldown ? `<div style="color:#f88;margin-top:8px;">⏱️ Кулдаун: ${cooldownDisplay}</div>` : ''}
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
        
        let bonusApplied = true;
        
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
            default:
                window.showNotif?.('❌ Неизвестный тип бонуса', true);
                bonusApplied = false;
        }
        
        if (bonusApplied) {
            this.game.subtract_resource('trash', station.cost_trash);
            station.cooldown_until = Date.now() + 5 * 60 * 1000;
            this.saveNeutralStations();
            this.renderStations();
            window.showNotif?.(`✅ Бонус от ${station.name} активирован!`, false);
        }
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
                ${escapeHtml(planet.name)} — ${cfg.name || planet.planet_type}
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
                ship.missionReturnsAt = typeof result.mission.returns_at === 'string'
                    ? new Date(result.mission.returns_at).getTime()
                    : result.mission.returns_at;
                ship.missionArrivesAt = typeof result.mission.arrives_at === 'string'
                    ? new Date(result.mission.arrives_at).getTime()
                    : result.mission.arrives_at;
                ship.shipType = shipType;
            }
            
            window.fleetModule.saveFleet();
            this.loadPlanetsFromRust();
            
            if (window._refreshFleetWithMissions) {
                window._refreshFleetWithMissions();
            }
            
            GameBus.emit(EVENTS.SHIP_MISSION_START, { ship: availableShip, planet, mission: result.mission });
            
            const taken = result.mission.resources_taken || {
                coal: result.mission.coal ?? 0,
                plasma: result.mission.plasma ?? 0,
                ore: result.mission.ore ?? 0
            };
            window.showNotif?.(`🚀 Корабль отправлен к ${planet.name}! Забрано: 🪨${taken.coal || 0} ⚡${taken.plasma || 0} ⛏️${taken.ore || 0}`, false);
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
            
            const now = Date.now();
            
            for (const mission of missions) {
                if (mission.remaining_ms <= 30000 && mission.remaining_ms > 0 && mission.status === 'flying') {
                    if (!mission._warningShown) {
                        mission._warningShown = true;
                        const ship = window.fleetModule?.ships.find(s => s.id === mission.ship_id);
                        if (ship) {
                            window.showNotif?.(`⚠️ Корабль "${ship.name}" возвращается через ${Math.floor(mission.remaining_ms / 1000)} сек`, false);
                        }
                    }
                }
            }
            
            this._markDirty();
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
                    ship.shipType = mission.ship_type || 'cargo';
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

    setupMultiplayer() {
        this._forceLoadPlayers();
        
        const adaptiveLoad = () => {
            if (!this.isTabActive) {
                this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, 60000);
                return;
            }
            this.loadMultiplayerPlayers().then(() => {
                const hasOnline = this.otherPlayers.some(p => this.isOnline(p));
                this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, hasOnline ? 15000 : 60000);
            });
        };
        this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, 5000);
        
        if (this._missionTimerInterval) clearInterval(this._missionTimerInterval);
        this._missionTimerInterval = setInterval(() => this.updateMissionTimers(), 1000);
        
        setTimeout(() => {
            const checkReady = () => {
                if (window.fleetModule && !window.fleetModule.isInitializing) {
                    this._restorePlanetMissions();
                } else {
                    setTimeout(checkReady, 500);
                }
            };
            checkReady();
        }, 500);
    },

    setupPresence() {
        if (!this.currentUser) return;
        this._reconnectMultiplayer();
    },

    async _fetchAndApplyPlayers() {
        if (!this.currentUser) return;

        const bounds = this._viewportMapBounds;
        const qx1 = Math.max(0,    bounds.x1 - 200);
        const qy1 = Math.max(0,    bounds.y1 - 200);
        const qx2 = Math.min(1000, bounds.x2 + 200);
        const qy2 = Math.min(1000, bounds.y2 + 200);

        const [viewportResult, topResult] = await Promise.all([
            supabase.rpc('get_players_in_viewport', {
                p_x1: qx1, p_y1: qy1,
                p_x2: qx2, p_y2: qy2,
                p_exclude_user: this.currentUser.id,
                p_limit: 150
            }),
            supabase
                .from('game_saves')
                .select('user_id, map_x, map_y, total_mined, neuro_evolution, nights_survived, computational_power, last_seen')
                .neq('user_id', this.currentUser.id)
                .not('map_x', 'is', null)
                .order('total_mined', { ascending: false })
                .limit(50),
        ]);

        const merged = new Map();
        [...(viewportResult.data ?? []), ...(topResult.data ?? [])].forEach(s => {
            if (s.map_x != null && s.user_id) merged.set(s.user_id, s);
        });

        if (merged.size === 0) return;

        const ids = Array.from(merged.keys());
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username')
            .in('id', ids);

        const profileMap = {};
        (profiles ?? []).forEach(p => { profileMap[p.id] = p.username; });

        this.otherPlayers = ids.map(id => {
            const s = merged.get(id);
            return { ...s, username: profileMap[id] ?? 'Игрок' };
        });

        for (const player of this.otherPlayers) {
            if (player.map_x != null && player.map_y != null) {
                this._playerPositions[player.user_id] = {
                    x: player.map_x,
                    y: player.map_y,
                };
            }
        }

        const currentIds = new Set(ids);
        for (const id in this._playerPositions) {
            if (id !== this.currentUser?.id && !currentIds.has(id)) {
                delete this._playerPositions[id];
            }
        }

        this._rebuildSpatialGrid();
        this.renderPlayers();
        this._markDirty();
    },

    async _forceLoadPlayers() {
        if (!this.currentUser || !this.isTabActive) {
            this._needsPlayerReload = !this.isTabActive;
            return;
        }
        try {
            await this._fetchAndApplyPlayers();
        } catch(e) {
            console.warn('Ошибка первоначальной загрузки игроков:', e);
        }
    },

    async loadMultiplayerPlayers() {
        if (!this.currentUser) return;
        if (!this.isTabActive) return;
        
        try {
            await this._fetchAndApplyPlayers();
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
            " data-player-id="${escapeHtml(p.user_id)}" data-player-username="${escapeHtml(p.username)}">
                <span style="font-size:14px;">${this.isOnline(p) ? '🟢' : '⚫'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${escapeHtml(p.username)}
                    </div>
                    <div style="font-size:10px;opacity:0.5;">
                        ⛏️ ${(p.total_mined||0).toLocaleString()} · 🧠 Ур.${p.neuro_evolution||0}
                    </div>
                </div>
            </div>
        `).join('');
        
        list.querySelectorAll('[data-player-id]').forEach(el => {
            const playerId = el.dataset.playerId;
            const fresh = el.cloneNode(true);
            el.parentNode.replaceChild(fresh, el);
            fresh.addEventListener('mouseenter', (e) => this.showPlayerTooltip(playerId, e));
            fresh.addEventListener('mouseleave', () => this.scheduleTooltipHide());
            fresh.addEventListener('click', () => this.showPlayerInfo(playerId));
        });
        
        this._markDirty();
    },

    showPlayerTooltip(userId, event) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;
        
        const isOnline = this.isOnline(player);
        const lastSeenText = player.last_seen ? this._formatLastSeen(player.last_seen) : 'неизвестно';
        
        const tooltipContent = `
            <div class="tooltip-inner">
                <div class="tooltip-name" style="color:${isOnline ? '#4aff9d' : '#888'}">🏰 ${escapeHtml(player.username)}</div>
                <div>🧠 Нейро: Ур.${player.neuro_evolution || 0} | ⛏️ ${(player.total_mined || 0).toLocaleString()} добыто</div>
                <div>🛡️ Защитник: ${player.has_defense_ship ? `Да (ур.${player.defense_ship_level})` : 'Нет'}</div>
                <div>⏱️ ${isOnline ? '🟢 Онлайн' : `⚫ Оффлайн · ${lastSeenText}`}</div>
            </div>
        `;
        
        this.showTooltip(tooltipContent, event.clientX, event.clientY);
    },

    getPlayerIcon(neuroEvolution) {
        const evo = neuroEvolution || 0;
        if (evo >= 10) return { icon: '👁️', size: 24, color: '#ff44ff', glow: true };
        if (evo >= 8) return  { icon: '🗼', size: 22, color: '#ff6a6a', glow: false };
        if (evo >= 6) return  { icon: '🏯', size: 20, color: '#ffaa44', glow: false };
        if (evo >= 4) return  { icon: '🏛️', size: 18, color: '#4aff9d', glow: false };
        if (evo >= 2) return  { icon: '🏠', size: 16, color: '#aaa',    glow: false };
        return                { icon: '🏚️', size: 14, color: '#888',    glow: false };
    },

    _initCanvas() {
        const starMap = document.getElementById('space-star-map');
        const canvas = document.getElementById('space-main-canvas');
        if (!canvas || !starMap) return;

        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._resizeCanvas();

        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
            this._resizeObserver.observe(starMap);
        }

        canvas.style.pointerEvents = 'none';
        
        starMap.addEventListener('click', (e) => {
            if (e.target.closest('.space-planet, .space-station, #space-base-planet, button')) return;
            this._handleCanvasClick(e);
        }, true);
        
        starMap.addEventListener('mousemove', (e) => {
            if (e.target.closest('.space-planet, .space-station, #space-base-planet, button')) {
                this.hideTooltip();
                return;
            }
            this._handleCanvasHover(e);
        });
        
        starMap.addEventListener('mouseleave', () => this.hideTooltip());
    },

    _resizeCanvas() {
        const starMap = document.getElementById('space-star-map');
        if (!starMap || !this._canvas) return;
        const w = starMap.clientWidth;
        const h = starMap.clientHeight;
        if (w === this._canvasW && h === this._canvasH) return;
        this._canvas.width = w;
        this._canvas.height = h;
        this._canvasW = w;
        this._canvasH = h;
        this._emojiCache = {};
    },

    _startRenderLoop() {
        if (this._animFrameId) return;
        const loop = () => {
            this._animFrameId = requestAnimationFrame(loop);
            if (!this.isTabActive) return;
            if (!this._renderDirty && !this._hasMissions()) return;
            this._renderFrame();
        };
        this._animFrameId = requestAnimationFrame(loop);
    },

    _hasMissions() {
        const now = Date.now();
        if (now - (this._hasMissionsLastCheck || 0) < 2000) {
            return this._hasMissionsCache ?? false;
        }
        this._hasMissionsLastCheck = now;
        try {
            const missions = JSON.parse(this.game?.get_active_planet_missions?.() ?? '[]');
            this._hasMissionsCache = missions.some(m => m.status === 'flying');
        } catch {
            this._hasMissionsCache = false;
        }
        return this._hasMissionsCache;
    },

    _markDirty() {
        this._renderDirty = true;
    },

    _renderFrame() {
        this._renderDirty = false;
        if (!this._ctx || !this._canvasW) return;

        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._canvasW, this._canvasH);

        this._updateViewportBounds();
        this._drawInfluenceZone(ctx);
        this._drawFlightLines(ctx);
        
        const scale = this._scale || 1;
        this._clusterMode = scale < 0.8 && this.otherPlayers.length > 30;
        
        if (this._clusterMode) {
            this._drawPlayerClusters(ctx);
            this._drawEdgeClusters(ctx, this._canvasW, this._canvasH);
        } else {
            this._drawPlayers(ctx);
        }

        const now = Date.now();
        if (now - this._lastMinimapRender > 500) {
            this._lastMinimapRender = now;
            this.renderMinimap();
        }
    },

    _updateViewportBounds() {
        if (!this._canvasW) return;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;
        const w = this._canvasW;
        const h = this._canvasH;

        this._viewportBounds = {
            x1: (-tx / scale / w) * 100 - 20,
            x2: ((-tx + w) / scale / w) * 100 + 20,
            y1: (-ty / scale / h) * 100 - 20,
            y2: ((-ty + h) / scale / h) * 100 + 20,
        };

        this._viewportMapBounds = {
            x1: (-tx / scale / w) * this._mapSize,
            y1: (-ty / scale / h) * this._mapSize,
            x2: ((-tx + w) / scale / w) * this._mapSize,
            y2: ((-ty + h) / scale / h) * this._mapSize,
        };
    },

    _getEmojiImage(emoji, size) {
        const key = `${emoji}_${size}`;
        if (this._emojiCache[key]) return this._emojiCache[key];

        const offscreen = document.createElement('canvas');
        offscreen.width = size * 2;
        offscreen.height = size * 2;
        const octx = offscreen.getContext('2d');
        octx.font = `${size}px serif`;
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText(emoji, size, size);
        this._emojiCache[key] = offscreen;
        return offscreen;
    },

    _rebuildSpatialGrid() {
        this._spatialGrid = {};
        for (const player of this.otherPlayers) {
            const pos = this._getPlayerPosition(player.user_id);
            if (!pos) continue;
            const cx = Math.floor(pos.x / this._CELL_SIZE);
            const cy = Math.floor(pos.y / this._CELL_SIZE);
            const key = `${cx}_${cy}`;
            if (!this._spatialGrid[key]) this._spatialGrid[key] = [];
            this._spatialGrid[key].push(player.user_id);
        }
    },

    _getPlayersInViewport() {
        const b = this._viewportMapBounds;
        const cx1 = Math.floor(b.x1 / this._CELL_SIZE) - 1;
        const cx2 = Math.floor(b.x2 / this._CELL_SIZE) + 1;
        const cy1 = Math.floor(b.y1 / this._CELL_SIZE) - 1;
        const cy2 = Math.floor(b.y2 / this._CELL_SIZE) + 1;
        const ids = new Set();
        for (let cx = cx1; cx <= cx2; cx++) {
            for (let cy = cy1; cy <= cy2; cy++) {
                const cell = this._spatialGrid[`${cx}_${cy}`];
                if (cell) cell.forEach(id => ids.add(id));
            }
        }
        return ids;
    },

    _drawPlayers(ctx) {
        const w = this._canvasW;
        const h = this._canvasH;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;
        const myPos = this._getMyPlanetPosition();
        const neuroLevel = this._lastStats?.neuro_evolution || 0;
        const influenceRadiusUnits = 50 + neuroLevel * 15;
        
        const toScreen = (xU, yU) => ({
            x: (xU / this._mapSize) * w * scale + tx,
            y: (yU / this._mapSize) * h * scale + ty,
        });

        const visibleIds = this._getPlayersInViewport();

        const candidates = this.otherPlayers
            .filter(p => visibleIds.has(p.user_id))
            .map(p => {
                const pos = this._getPlayerPosition(p.user_id);
                if (!pos) return null;
                const dx = pos.x - myPos.x;
                const dy = pos.y - myPos.y;
                return { ...p, pos, dist: Math.sqrt(dx*dx + dy*dy) };
            })
            .filter(Boolean)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, this._maxPlayersOnMap);

        this._visiblePlayers = candidates;

        for (const player of candidates) {
            const screen = toScreen(player.pos.x, player.pos.y);
            const { icon, size, color, glow } = this.getPlayerIcon(player.neuro_evolution);
            const isOnline = this.isOnline(player);

            if (glow) {
                ctx.save();
                ctx.shadowColor = '#ff44ff';
                ctx.shadowBlur = 12;
            }

            const img = this._getEmojiImage(icon, size);
            ctx.drawImage(img, screen.x - size, screen.y - size, size * 2, size * 2);

            if (glow) ctx.restore();

            ctx.font = `bold 9px monospace`;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const name = (player.username || '?').slice(0, 8);
            ctx.fillText(name, screen.x, screen.y + size + 2);

            if (isOnline) {
                ctx.beginPath();
                ctx.arc(screen.x, screen.y - size - 3, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#4aff9d';
                ctx.fill();
            }

            if (player.dist < influenceRadiusUnits) {
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, size + 4, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255,170,68,${0.5 + 0.5 * Math.sin(Date.now() / 400)})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    },

    _drawPlayerClusters(ctx) {
        const w = this._canvasW;
        const h = this._canvasH;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;

        const SECTOR = 200;
        const grid = {};

        for (const player of this.otherPlayers) {
            const pos = this._getPlayerPosition(player.user_id);
            if (!pos) continue;
            const sx = Math.floor(pos.x / SECTOR);
            const sy = Math.floor(pos.y / SECTOR);
            const key = `${sx}_${sy}`;
            if (!grid[key]) {
                grid[key] = {
                    count: 0,
                    online: 0,
                    cx: (sx + 0.5) * SECTOR,
                    cy: (sy + 0.5) * SECTOR,
                };
            }
            grid[key].count++;
            if (this.isOnline(player)) grid[key].online++;
        }

        for (const sector of Object.values(grid)) {
            const px = (sector.cx / this._mapSize) * w * scale + tx;
            const py = (sector.cy / this._mapSize) * h * scale + ty;

            if (px < -60 || px > w + 60 || py < -60 || py > h + 60) continue;

            const radius = Math.min(45, 16 + Math.sqrt(sector.count) * 3);

            if (sector.online > 0) {
                const pulse = radius + 4 * Math.abs(Math.sin(Date.now() / 800));
                ctx.beginPath();
                ctx.arc(px, py, pulse, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(74,255,157,0.15)`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fillStyle = sector.online > 0
                ? `rgba(74,255,157,0.1)`
                : 'rgba(80,80,80,0.1)';
            ctx.fill();
            ctx.strokeStyle = sector.online > 0
                ? `rgba(74,255,157,${Math.min(0.7, 0.25 + sector.online * 0.02)})`
                : 'rgba(100,100,100,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            const label = sector.count >= 1000
                ? `${(sector.count / 1000).toFixed(1)}k`
                : String(sector.count);
            ctx.font = `bold ${Math.min(15, 10 + Math.floor(label.length))}px monospace`;
            ctx.fillStyle = sector.online > 0 ? '#4aff9d' : '#666';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, py - 4);

            if (sector.online > 0) {
                ctx.font = '8px monospace';
                ctx.fillStyle = 'rgba(74,255,157,0.7)';
                ctx.fillText(`● ${sector.online}`, px, py + 8);
            }
        }

        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('приблизьте для просмотра игроков', w / 2, h - 6);
    },

    _drawEdgeClusters(ctx, w, h) {
        const b = this._viewportMapBounds;
        let top = 0, bottom = 0, left = 0, right = 0;
        for (const p of this.otherPlayers) {
            const pos = this._getPlayerPosition(p.user_id);
            if (!pos) continue;
            if (pos.x < b.x1) left++;
            else if (pos.x > b.x2) right++;
            if (pos.y < b.y1) top++;
            else if (pos.y > b.y2) bottom++;
        }

        const drawBadge = (x, y, count, arrow) => {
            if (count === 0) return;
            ctx.save();
            ctx.fillStyle = 'rgba(74,255,157,0.12)';
            ctx.strokeStyle = 'rgba(74,255,157,0.5)';
            ctx.lineWidth = 1;
            const r = 16;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#4aff9d';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${arrow}${count}`, x, y);
            ctx.restore();
        };

        const pad = 22;
        drawBadge(pad, h / 2, left, '◀');
        drawBadge(w - pad, h / 2, right, '▶');
        drawBadge(w / 2, pad, top, '▲');
        drawBadge(w / 2, h - pad, bottom, '▼');
    },

    _drawFlightLines(ctx) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;
        const w = this._canvasW;
        const h = this._canvasH;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;

        const toScreen = (xU, yU) => ({
            x: (xU / this._mapSize) * w * scale + tx,
            y: (yU / this._mapSize) * h * scale + ty,
        });

        const now = Date.now();
        let activeMissions = [];
        try {
            activeMissions = JSON.parse(this.game?.get_active_planet_missions?.() ?? '[]');
        } catch {}

        for (const mission of activeMissions) {
            const planet = this.planets.find(p => p.id === mission.planet_id);
            if (!planet) continue;

            const from = toScreen(myPos.x, myPos.y);
            const to = toScreen(planet.x * 10, planet.y * 10);

            const startedAt = mission.started_at || (mission.arrives_at - (mission.returns_at - mission.arrives_at));
            const progress = Math.min(1, Math.max(0, (now - startedAt) / (mission.arrives_at - startedAt)));
            const shipX = from.x + (to.x - from.x) * progress;
            const shipY = from.y + (to.y - from.y) * progress;

            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = 'rgba(255,170,68,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();

            ctx.beginPath();
            ctx.arc(shipX, shipY, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffaa44';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(shipX, shipY, 7, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,170,68,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        const incomingMissions = window.fleetModule?.activePvpMissions || [];
        for (const mission of incomingMissions) {
            if (mission.targetUserId !== this.currentUser?.id) continue;
            if (mission.status !== 'flying') continue;
            const attackerPos = this._getPlayerPosition(mission.attackerId);
            if (!attackerPos) continue;

            const from = toScreen(attackerPos.x, attackerPos.y);
            const to = toScreen(myPos.x, myPos.y);
            const total = mission.arrivesAt - mission.startedAt;
            const progress = Math.min(0.95, Math.max(0, (now - mission.startedAt) / total));
            const shipX = from.x + (to.x - from.x) * progress;
            const shipY = from.y + (to.y - from.y) * progress;
            const isUrgent = (mission.arrivesAt - now) < 60000;

            ctx.save();
            ctx.setLineDash(isUrgent ? [3, 3] : [6, 4]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = isUrgent ? 'rgba(255,68,68,0.9)' : 'rgba(255,100,100,0.6)';
            ctx.lineWidth = isUrgent ? 2 : 1.5;
            ctx.stroke();
            ctx.restore();

            const pulse = isUrgent ? 4 + 3 * Math.abs(Math.sin(now / 200)) : 5;
            ctx.beginPath();
            ctx.arc(shipX, shipY, pulse, 0, Math.PI * 2);
            ctx.fillStyle = '#ff4444';
            ctx.fill();
        }
    },

    _drawInfluenceZone(ctx) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;
        const w = this._canvasW;
        const h = this._canvasH;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;

        const cx = (myPos.x / this._mapSize) * w * scale + tx;
        const cy = (myPos.y / this._mapSize) * h * scale + ty;
        const neuroLevel = this._lastStats?.neuro_evolution || 0;
        const radiusUnits = 50 + neuroLevel * 15;
        const radiusPx = (radiusUnits / this._mapSize) * w * scale;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
        grad.addColorStop(0, 'rgba(74,255,157,0.06)');
        grad.addColorStop(1, 'rgba(74,255,157,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.save();
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(74,255,157,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    },

    _handleCanvasClick(e) {
        const starMap = document.getElementById('space-star-map');
        const rect = starMap.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const player = this._hitTestPlayer(cx, cy);
        if (player) {
            this.showPlayerInfo(player.user_id);
        }
    },

    _handleCanvasHover(e) {
        const starMap = document.getElementById('space-star-map');
        const rect = starMap.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const player = this._hitTestPlayer(cx, cy);
        if (player) {
            starMap.style.cursor = 'pointer';
            this.showPlayerTooltip(player.user_id, e);
        } else {
            starMap.style.cursor = this._isDragging ? 'grabbing' : 'grab';
            this.scheduleTooltipHide();
        }
    },

    _hitTestPlayer(cx, cy) {
        if (!this._visiblePlayers) return null;
        const w = this._canvasW;
        const h = this._canvasH;
        const scale = this._scale || 1;
        const tx = this._translateX || 0;
        const ty = this._translateY || 0;
        const HIT_RADIUS = 25;

        for (const player of this._visiblePlayers) {
            const px = (player.pos.x / this._mapSize) * w * scale + tx;
            const py = (player.pos.y / this._mapSize) * h * scale + ty;
            const dx = cx - px;
            const dy = cy - py;
            if (dx*dx + dy*dy < HIT_RADIUS * HIT_RADIUS) return player;
        }
        return null;
    },

    _getMyPlanetPosition() {
        if (this._myMapPos) return this._myMapPos;
        if (this._playerPositions[this.currentUser?.id]) {
            return this._playerPositions[this.currentUser.id];
        }
        return { x: 500, y: 500 };
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

        const canSendCargo = scoutFresh && 
            window.fleetModule?._lastCombatResult?.won && 
            window.fleetModule?._lastCombatResult?.targetUserId === player.user_id;

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
                        ${escapeHtml(player.username)}
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
                    ${!canSendCargo ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                    ${!canSendCargo ? 'disabled' : ''}>
                    📦 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ${!canSendCargo ? (scoutFresh ? ' (нужна победа в бою)' : ' (нужна разведка)') : ''}
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
            if (shipType === 'cargo' && !canSendCargo) return;
            
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
                const repScoreCurrent = player.reputation_score ?? 0;
                const newRep = repScoreCurrent - 2;
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
        if (isNaN(newScore)) {
            console.warn('updateReputation: newScore is NaN, пропускаем');
            return;
        }
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
            if (window.addToLog) window.addToLog('⚠️ Ошибка синхронизации репутации', 'warning');
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

    renderMinimap() {
        const canvas = document.getElementById('space-minimap');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = 100, H = 100;
        const scale = W / this._mapSize;

        ctx.clearRect(0, 0, W, H);
        
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, W, H);
        
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        this._minimapStars.forEach(s => {
            ctx.fillRect(s.x, s.y, 1, 1);
        });
        
        // Планеты: координаты в % (0-100)
        this.planets.forEach(p => {
            ctx.fillStyle = '#ffaa44';
            ctx.beginPath();
            ctx.arc(p.x * scale * 10, p.y * scale * 10, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Станции: координаты в % (0-100)
        this.neutralStations.forEach(s => {
            ctx.fillStyle = '#4aff9d';
            ctx.fillRect(s.x * scale * 10 - 1, s.y * scale * 10 - 1, 2, 2);
        });
        
        // Другие игроки: координаты в 0-1000
        this.otherPlayers.forEach(p => {
            const pos = this._getPlayerPosition(p.user_id);
            if (!pos) return;
            ctx.fillStyle = this.isOnline(p) ? '#4aff9d' : '#333';
            ctx.beginPath();
            ctx.arc(pos.x * scale, pos.y * scale, 1.5, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Я
        const myPos = this._getMyPlanetPosition();
        if (myPos) {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(myPos.x * scale, myPos.y * scale, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#4aff9d';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(myPos.x * scale, myPos.y * scale, 5, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        // Viewport рамка
        const vb = this._viewportMapBounds;
        ctx.strokeStyle = 'rgba(74,255,157,0.4)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(
            vb.x1 * scale, vb.y1 * scale,
            (vb.x2 - vb.x1) * scale,
            (vb.y2 - vb.y1) * scale
        );
        
        // Линии активных миссий
        let activeMissions = [];
        try { activeMissions = JSON.parse(this.game?.get_active_planet_missions?.() ?? '[]'); } catch {}
        activeMissions.forEach(mission => {
            const planet = this.planets.find(p => p.id === mission.planet_id);
            if (!planet || !myPos) return;
            ctx.beginPath();
            ctx.moveTo(myPos.x * scale, myPos.y * scale);
            ctx.lineTo(planet.x * scale * 10, planet.y * scale * 10);
            ctx.strokeStyle = 'rgba(255,170,68,0.4)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });
    },

    _moveToZone(zone) {
        console.log(`_moveToZone(${zone}) — зоны не используются`);
    },

    _reconnectMultiplayer() {
        if (!this.currentUser) return;
        if (this._multiplayerChannel) this._multiplayerChannel.unsubscribe();

        const shardKey = this.currentUser.id.charAt(0);
        this._multiplayerChannel = supabase.channel(`space_shard_${shardKey}`);

        this._multiplayerChannel
            .on('presence', { event: 'sync' }, () => {
                const state = this._multiplayerChannel.presenceState();
                this._onlinePlayerIds = Object.values(state).flat()
                    .map(p => p.user_id).filter(Boolean);
                this.renderPlayers();
                this._markDirty();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await this._multiplayerChannel.track({
                        user_id: this.currentUser.id,
                        online_at: new Date().toISOString(),
                        username: this.currentUser.user_metadata?.username || 'Игрок',
                    });
                }
            });
    },

    destroy() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
        if (this._adaptiveLoadTimeout) {
            clearTimeout(this._adaptiveLoadTimeout);
            this._adaptiveLoadTimeout = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this._emojiCache = {};
        
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
        this._gameBusUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this._gameBusUnsubscribers = [];
    }
};

window.spaceModule = spaceModule;
window.spaceModule.setShipMissionStatusFromRust = spaceModule.setShipMissionStatusFromRust.bind(spaceModule);
window.spaceModule.loadPlanetsFromRust = spaceModule.loadPlanetsFromRust.bind(spaceModule);

export default spaceModule;