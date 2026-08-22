import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';
import { escapeHtml, normalizeTimestamp, debounce, memoize } from './utils.js';

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

    scannerCycleDuration: 1000,

    _playerPositions: {},
    _currentPopup: null,
    _closeOnOutsideHandler: null,
    _onEscHandler: null,
    _flightLineInterval: null,
    _flightLineDebounce: null,
    _missionCheckInterval: null,
    _missionTimerInterval: null,
    _presenceChannel: null,
    _multiplayerChannel: null,
    _starsGenerated: false,
    _needsPlayerReload: false,
    _onlinePlayerIds: [],
    _prevOnlineIds: [],

    _cachedIncomingMissions: [],
    _incomingMissionInterval: null,

    _processingMissions: new Set(),
    _warningedMissionIds: new Set(),

    neutralStations: [],

    _tooltipElement: null,
    _tooltipTimeout: null,

    _minimapStars: null,

    _gameBusUnsubscribers: [],

    _canvas: null,
    _ctx: null,
    _canvasW: 0,
    _canvasH: 0,
    _animFrameId: null,

    _renderDirty: false,
    _staticDirty: true,
    _staticCanvas: null,
    _staticCtx: null,
    _adaptiveLoadTimeout: null,
    _hasMissionsLastCheck: 0,
    _hasMissionsCache: false,

    _maxPlayersOnMap: 2000,
    _visiblePlayers: [],

    _mapSize: 5000,
    _myMapPos: null,
    _mapPosLoaded: false,

    _cameraX: 0,
    _cameraY: 0,
    _zoom: 1.0,

    _isDragging: false,
    _dragStartX: 0,
    _dragStartY: 0,
    _dragStartCameraX: 0,
    _dragStartCameraY: 0,

    _animationTime: 0,

    _gridSize: 500,
    _gridOpacity: 0.25,

    _lastStats: { neuro_evolution: 0, neuro_consciousness: 0 },

    _mouseMoveHandler: null,
    _mouseUpHandler: null,
    _resizeHandler: null,

    _mapCenteredOnce: false,

    _scannerGradientCache: null,
    _profileCache: {},
    _flightPopupInterval: null,
    _starsCanvas: null,
    _starsResizeObserver: null,
    _resizeObserver: null,

    PLANET_TYPES: {
        'earth':    { name: 'ЗЕМЛЯ' },
        'volcanic': { name: 'ВУЛКАНИЧЕСКАЯ' },
        'ice':      { name: 'ЛЕДЯНАЯ' },
        'gas':      { name: 'ГАЗОВЫЙ ГИГАНТ' },
        'desert':   { name: 'ПУСТЫНЯ' },
        'ocean':    { name: 'ОКЕАНИЧЕСКАЯ' },
    },

    PLANET_NAMES: ['АРКТУР', 'СИРИУС', 'ВЕГА', 'ПРОКСИМА', 'АНТАРЕС',
                   'ПОЛЛЮКС', 'КАСТОР', 'АЛЬТАИР', 'ДЕНЕБ', 'РЕГУЛ'],

    init(gameInstance, user) {
        if (this.initialized || this._missionCheckInterval || this._incomingMissionInterval) {
            this.destroy();
        }
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }

        this.game = gameInstance;
        this.currentUser = user;
        this._playerPositions = {};

        this.loadPlanetsFromRust();
        this.loadNeutralStations();

        this._initStarsCanvas();

        this.setupMultiplayer();

        this.initialized = true;

        this.initMapControls();
        this._startMissionCheckInterval();
        this.setupTooltip();

        this._subscribeToEvents();

        this._initCanvas();
        this._startRenderLoop();

        console.log('SPACE MODULE INITIALIZED [v10.0]');
    },

    destroy() {
        if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
        if (this._missionCheckInterval) clearInterval(this._missionCheckInterval);
        if (this._missionTimerInterval) clearInterval(this._missionTimerInterval);
        if (this._incomingMissionInterval) clearInterval(this._incomingMissionInterval);
        if (this._flightLineInterval) clearInterval(this._flightLineInterval);
        if (this._flightPopupInterval) clearInterval(this._flightPopupInterval);
        if (this._adaptiveLoadTimeout) clearTimeout(this._adaptiveLoadTimeout);
        if (this._flightLineDebounce) clearTimeout(this._flightLineDebounce);
        if (this._tooltipTimeout) clearTimeout(this._tooltipTimeout);

        for (const unsubscribe of this._gameBusUnsubscribers || []) {
            try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) {}
        }
        this._gameBusUnsubscribers = [];

        for (const channel of [this._multiplayerChannel, this._presenceChannel, this.planetsChannel]) {
            if (channel) {
                try { supabase.removeChannel(channel); } catch (e) {}
            }
        }
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this._starsResizeObserver) this._starsResizeObserver.disconnect();

        this._animFrameId = null;
        this._missionCheckInterval = null;
        this._missionTimerInterval = null;
        this._incomingMissionInterval = null;
        this._flightLineInterval = null;
        this._flightPopupInterval = null;
        this._adaptiveLoadTimeout = null;
        this._resizeObserver = null;
        this._starsResizeObserver = null;
        this._processingMissions.clear();
        this._warningedMissionIds.clear();
        this._multiplayerChannel = null;
        this._presenceChannel = null;
        this.planetsChannel = null;
        this.isTabActive = false;
        this.initialized = false;
    },

    _getDefaultStations() {
        return [
            { id: 'st1', name: 'АЛЬФА', x: 2200, y: 2200, bonus_type: 'mining_boost', cost_trash: 50, cooldown_until: 0 },
            { id: 'st2', name: 'БЕТА', x: 2800, y: 2200, bonus_type: 'defense_boost', cost_trash: 80, cooldown_until: 0 },
            { id: 'st3', name: 'ГАММА', x: 2500, y: 2800, bonus_type: 'power_boost', cost_trash: 100, cooldown_until: 0 }
        ];
    },

    loadNeutralStations() {
        try {
            const saved = localStorage.getItem('corebox_neutral_stations');
            const defaultStations = this._getDefaultStations();

            if (!saved) {
                this.neutralStations = defaultStations;
                this.saveNeutralStations();
                return;
            }

            const parsed = JSON.parse(saved);

            const isValid = parsed.version >= 5 &&
                Array.isArray(parsed.data) &&
                parsed.data.length > 0 &&
                parsed.data.every(s =>
                    typeof s.x === 'number' &&
                    typeof s.y === 'number' &&
                    s.x >= 0 && s.x <= 5000 &&
                    s.y >= 0 && s.y <= 5000
                );

            if (isValid) {
                this.neutralStations = parsed.data;
            } else {
                console.log('Stations data outdated, resetting');
                this.neutralStations = defaultStations;
                this.saveNeutralStations();
            }
        } catch(e) {
            console.warn('STATIONS LOAD ERROR:', e);
            this.neutralStations = this._getDefaultStations();
            this.saveNeutralStations();
        }
    },

    saveNeutralStations() {
        try {
            const toSave = {
                version: 5,
                data: this.neutralStations,
                saved_at: Date.now()
            };
            localStorage.setItem('corebox_neutral_stations', JSON.stringify(toSave));
        } catch(e) {
            console.warn('Failed to save stations:', e);
        }
    },

    _initStarsCanvas() {
        const container = document.getElementById('space-stars-layer');
        if (!container) return;

        container.innerHTML = '';

        const starsCanvas = document.createElement('canvas');
        starsCanvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;

        const resizeStars = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;

            starsCanvas.width = w;
            starsCanvas.height = h;

            const ctx = starsCanvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);

            const layers = [
                { count: 400, sizeRange: [0.3, 0.5], opacityRange: [0.1, 0.25] },
                { count: 200, sizeRange: [0.5, 0.8], opacityRange: [0.2, 0.4] },
                { count: 80, sizeRange: [0.8, 1.2], opacityRange: [0.3, 0.6] }
            ];

            let seed = 12345;
            const seededRandom = () => {
                seed = (seed * 9301 + 49297) % 233280;
                return seed / 233280;
            };

            for (const layer of layers) {
                for (let i = 0; i < layer.count; i++) {
                    const x = seededRandom() * w;
                    const y = seededRandom() * h;
                    const size = layer.sizeRange[0] +
                        seededRandom() * (layer.sizeRange[1] - layer.sizeRange[0]);
                    const opacity = layer.opacityRange[0] +
                        seededRandom() * (layer.opacityRange[1] - layer.opacityRange[0]);

                    ctx.beginPath();
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                    ctx.fill();
                }
            }
        };

        container.appendChild(starsCanvas);
        this._starsCanvas = starsCanvas;
        this._resizeStars = resizeStars;

        resizeStars();

        if (window.ResizeObserver) {
            if (this._starsResizeObserver) this._starsResizeObserver.disconnect();
            this._starsResizeObserver = new ResizeObserver(() => resizeStars());
            this._starsResizeObserver.observe(container);
        }

        this._starsGenerated = true;
        console.log('✅ STARS GENERATED ON CANVAS');
    },

    _generateDeterministicFallback() {
        const userId = this.currentUser?.id || 'anonymous';
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = ((hash << 5) - hash) + userId.charCodeAt(i);
            hash |= 0;
        }
        return {
            x: 1500 + (Math.abs(hash) % 2000),
            y: 1500 + (Math.abs(hash >> 8) % 2000)
        };
    },

    async _loadPositionFromCloudAsync() {
        if (!this.currentUser) return;
        try {
            const { data } = await supabase
                .from('game_saves')
                .select('map_x, map_y')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (data?.map_x != null && data?.map_y != null) {
                this._myMapPos = { x: data.map_x, y: data.map_y };
                this._mapPosLoaded = true;
                this._playerPositions[this.currentUser.id] = this._myMapPos;
                this._markDirty();

                if (!this._mapCenteredOnce) {
                    this._centerOnPlayer();
                    this._mapCenteredOnce = true;
                }
            }
        } catch (e) {
            console.warn('Failed to load position from cloud:', e);
        }
    },

    _getMyPlanetPosition() {
        if (this._myMapPos && this._mapPosLoaded) {
            return this._myMapPos;
        }

        if (this.currentUser?.id && this._playerPositions[this.currentUser.id]) {
    const cached = this._playerPositions[this.currentUser.id];

    if (cached.x != null && cached.y != null &&
        !(cached.x === 2500 && cached.y === 2500 && !this._mapPosLoaded)) {
        this._myMapPos = cached;
        this._mapPosLoaded = true;
        return cached;
    }
}

        if (this.game) {
            try {
                const stats = JSON.parse(this.game.get_statistics());
                if (stats.map_x != null && stats.map_y != null) {
                    this._myMapPos = { x: stats.map_x, y: stats.map_y };
                    this._mapPosLoaded = true;
                    this._playerPositions[this.currentUser?.id] = this._myMapPos;
                    return this._myMapPos;
                }
            } catch (e) {}
        }

        this._loadPositionFromCloudAsync();

        const fallback = this._generateDeterministicFallback();
        this._myMapPos = fallback;
        return fallback;
    },

    setMyPosition(x, y) {
        if (x == null || y == null || isNaN(x) || isNaN(y)) {
            console.warn('Invalid position:', x, y);
            return;
        }

        const wasLoaded = this._mapPosLoaded;

        this._myMapPos = {
            x: Math.min(5000, Math.max(0, Number(x))),
            y: Math.min(5000, Math.max(0, Number(y)))
        };
        this._mapPosLoaded = true;

        if (this.currentUser?.id) {
            this._playerPositions[this.currentUser.id] = {
                x: this._myMapPos.x,
                y: this._myMapPos.y
            };
        } else {
            console.warn('setMyPosition called without currentUser');
        }

        if (!wasLoaded && !this._mapCenteredOnce) {
            this._centerOnPlayer();
            this._mapCenteredOnce = true;
        }

        this._markDirty();
    },

    _centerOnPlayer() {
        const myPos = this._getMyPlanetPosition();
        this._centerOnPoint(myPos.x, myPos.y);
    },

    _centerOnPoint(worldX, worldY) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
        if (this._canvasW === 0 || this._canvasH === 0) return;

        const screenX = (worldX / this._mapSize) * this._canvasW * this._zoom;
        const screenY = (worldY / this._mapSize) * this._canvasH * this._zoom;

        this._cameraX = this._canvasW / 2 - screenX;
        this._cameraY = this._canvasH / 2 - screenY;

        this._clampCamera();
        this._markDirty();
    },

    _getClickRadius() {
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        // ✅ Уменьшили базу, увеличили бонус за зум
        const baseRadius = isMobile ? 22 : 16;
        const zoomBonus = this._zoom * 6;
        return baseRadius + zoomBonus;
    },

    _hitTestPoint(cx, cy, px, py, radius) {
        const dx = cx - px;
        const dy = cy - py;
        return (dx * dx + dy * dy) <= (radius * radius);
    },

    _renderMissionLine(ctx, from, to, shipX, shipY, color, isUrgent) {
        ctx.save();
        ctx.setLineDash(isUrgent ? [1, 2] : [3, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = isUrgent ? `${color}aa` : `${color}66`;
        ctx.lineWidth = isUrgent ? 1 : 0.7;
        ctx.stroke();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(shipX, shipY, isUrgent ? 3 : 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (isUrgent) {
            ctx.beginPath();
            ctx.arc(shipX, shipY, 5, 0, Math.PI * 2);
            ctx.strokeStyle = `${color}88`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    _drawFlightLines(ctx) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;
        const now = Date.now();

        let activeMissions = [];
        try {
            activeMissions = JSON.parse(this.game?.get_active_planet_missions?.() ?? '[]');
        } catch {}

        const cfg = window.gameConfig?.fleet_config;
        const TRAVEL_SEC = {
            scout: cfg?.scout?.travel_time_sec ?? 30,
            combat: cfg?.combat?.travel_time_sec ?? 45,
            cargo: cfg?.cargo?.travel_time_sec ?? 40
        };

        for (const mission of activeMissions) {
            const arrivesAt = normalizeTimestamp(mission.arrives_at);
            const returnsAt = normalizeTimestamp(mission.returns_at);
            const startedAt = normalizeTimestamp(mission.started_at);

            if (!arrivesAt || !returnsAt) continue;
            if (now > returnsAt + 5000) continue;

            const planet = this.planets.find(p => p.id === mission.planet_id);
            if (!planet) continue;

            const from = this._worldToScreen(myPos.x, myPos.y);
            const to = this._worldToScreen(planet.x, planet.y);

            const shipType = mission.ship_type || 'cargo';
            const travelMs = (mission.travel_sec || TRAVEL_SEC[shipType] || 360) * 1000;
            const effectiveStartedAt = startedAt || (arrivesAt - travelMs);
            const totalDuration = arrivesAt - effectiveStartedAt;

            if (totalDuration <= 0) continue;

            const progress = Math.min(1, Math.max(0,
                (now - effectiveStartedAt) / totalDuration
            ));

            const shipX = from.x + (to.x - from.x) * progress;
            const shipY = from.y + (to.y - from.y) * progress;

            this._renderMissionLine(ctx, from, to, shipX, shipY, '#fa0', false);
        }

        this._renderIncomingMissions(ctx, now);
        this._renderOutgoingPvpMissions(ctx, now);
    },

    _renderIncomingMissions(ctx, now) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;

        const incomingMissions = this._cachedIncomingMissions || [];
        for (const mission of incomingMissions) {
            if (mission.target_id !== this.currentUser?.id) continue;
            if (mission.status !== 'flying') continue;

            const arrivesAt = normalizeTimestamp(mission.arrives_at);
            if (!arrivesAt || now > arrivesAt + 5000) continue;

            const attackerPos = this._getPlayerPosition(mission.attacker_id);
            if (!attackerPos) continue;

            const from = this._worldToScreen(attackerPos.x, attackerPos.y);
            const to = this._worldToScreen(myPos.x, myPos.y);

            const startedAt = normalizeTimestamp(mission.created_at) || (arrivesAt - 300000);
            const total = arrivesAt - startedAt;
            if (total <= 0) continue;

            const progress = Math.min(0.95, Math.max(0, (now - startedAt) / total));
            const shipX = from.x + (to.x - from.x) * progress;
            const shipY = from.y + (to.y - from.y) * progress;
            const isUrgent = (arrivesAt - now) < 60000;

            this._renderMissionLine(ctx, from, to, shipX, shipY, '#f44', isUrgent);
        }
    },

    _renderOutgoingPvpMissions(ctx, now) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;

        const outgoingShips = window.fleetModule?.ships?.filter(
            s => s.onMission && s.targetUserId && !s.targetPlanetId
        ) ?? [];

        const COLOR = { scout: '#44aaff', combat: '#ff4444', cargo: '#ffcc33' };

        for (const ship of outgoingShips) {
            if (now > (ship.missionReturnsAt || 0) + 5000) continue;

            const targetPos = this._getPlayerPosition(ship.targetUserId);
            if (!targetPos) continue;

            const from = this._worldToScreen(myPos.x, myPos.y);
            const to = this._worldToScreen(targetPos.x, targetPos.y);

            const arrivesAt = normalizeTimestamp(ship.missionArrivesAt) || 0;
            const startedAt = normalizeTimestamp(ship.missionStartedAt) || (arrivesAt - 60000);
            const totalOut = arrivesAt - startedAt;
            const isReturning = now >= arrivesAt;

            let progress, lineFrom, lineTo;

            if (!isReturning && totalOut > 0) {
                progress = Math.min(1, Math.max(0, (now - startedAt) / totalOut));
                lineFrom = from;
                lineTo = to;
            } else if (isReturning) {
                const returnsAt = normalizeTimestamp(ship.missionReturnsAt) || (arrivesAt + 300000);
                const totalBack = returnsAt - arrivesAt;
                if (totalBack <= 0) continue;
                progress = Math.min(1, Math.max(0, (now - arrivesAt) / totalBack));
                lineFrom = to;
                lineTo = from;
            } else {
                continue;
            }

            const shipX = lineFrom.x + (lineTo.x - lineFrom.x) * progress;
            const shipY = lineFrom.y + (lineTo.y - lineFrom.y) * progress;
            const color = COLOR[ship.type] || '#aaa';

            this._renderMissionLine(ctx, from, to, shipX, shipY, color, false);
        }
    },

    // ✅ Публичный метод для принудительной перерисовки линий полётов
    renderFlightLines() {
        if (!this._ctx) return;
        const now = Date.now();
        this._drawFlightLines(this._ctx);
        this._renderOutgoingPvpMissions(this._ctx, now);
    },

    async tradeWithStation(station) {
        let stats = null;
        try {
            const j = this.game.get_statistics();
            if (j) stats = JSON.parse(j);
        } catch(e) {}

        const trashCount = stats?.trash_inventory || 0;
        if (trashCount < station.cost_trash) {
            window.showNotif?.(`НУЖНО ${station.cost_trash} МУСОРА`, true);
            return;
        }

        const cargoShip = window.fleetModule?.ships.find(
            s => s.type === 'cargo' && !s.onMission && !s.onDefense
        );
        if (!cargoShip) {
            window.showNotif?.('НЕТ СВОБОДНОГО ГРУЗОВОГО КОРАБЛЯ', true);
            return;
        }

        const bonusMethods = {
            'mining_boost': {
                method: 'set_temporary_mining_bonus',
                value: 50,
                log: 'БОНУС ДОБЫЧИ +50% на 2 минуты'
            },
            'defense_boost': {
                method: 'set_temporary_defense_bonus',
                value: 40,
                log: 'ЗАЩИТНЫЙ ЩИТ +40% на 2 минуты'
            },
            'power_boost': {
                method: 'add_power',
                value: 50,
                log: '+50 ЭНЕРГИИ'
            }
        };

        const bonus = bonusMethods[station.bonus_type];
        if (!bonus) {
            window.showNotif?.('НЕИЗВЕСТНЫЙ ТИП БОНУСА', true);
            return;
        }

        if (typeof this.game[bonus.method] === 'function') {
            this.game[bonus.method](bonus.value);
            window.addToLog?.(`${station.name}: ${bonus.log}`, 'success');
        } else {
            window.showNotif?.('СИСТЕМА БОНУСОВ НЕДОСТУПНА', true);
            return;
        }

        this.game.subtract_resource('trash', station.cost_trash);
        station.cooldown_until = Date.now() + 5 * 60 * 1000;
        this.saveNeutralStations();
        this._markDirty();
        window.showNotif?.(`БОНУС АКТИВИРОВАН`, false);
    },

    async sendShipToPlanet(planet, shipType) {
        if (!window.fleetModule?.ships) {
            window.showNotif?.('ОШИБКА ФЛОТА', true);
            return;
        }

        const availableShip = window.fleetModule.ships.find(
            s => s.type === shipType && !s.onMission && !s.onDefense
        );

        if (!availableShip) {
            window.showNotif?.('НЕТ СВОБОДНОГО КОРАБЛЯ', true);
            return;
        }

        const shipData = {
            id: String(availableShip.id),
            name: String(availableShip.name || 'Корабль'),
            type: String(['cargo', 'scout', 'combat'].includes(availableShip.type)
                ? availableShip.type : 'cargo'),
            capacity: Number(availableShip.capacity) || 100,
            level: Number(availableShip.level) || 0
        };

        try {
            const resultJson = this.game.send_ship_to_planet(
                JSON.stringify(shipData),
                String(planet.id)
            );
            const result = JSON.parse(resultJson);

            if (result.success) {
                this._applyMissionResult(availableShip, planet, result.mission, shipType);
                window.showNotif?.(`КОРАБЛЬ ОТПРАВЛЕН НА ${planet.name}`, false);
                if (window.fleetModule?._addFleetLog) {
                    window.fleetModule._addFleetLog(
                        `🚀 ${availableShip.name} отправлен на планету ${planet.name}`
                    );
                }
            } else {
                window.showNotif?.(`ОШИБКА: ${result.error}`, true);
            }
        } catch (e) {
            console.error('sendShipToPlanet error:', e);
            window.showNotif?.('СИСТЕМНАЯ ОШИБКА ОТПРАВКИ', true);
        }
    },

    _applyMissionResult(ship, planet, mission, shipType) {
        const fleetShip = window.fleetModule.ships.find(s => s.id === ship.id);
        if (!fleetShip) return;

        fleetShip.onMission = true;
        fleetShip.currentMissionId = mission.id;
        fleetShip.targetPlanetId = planet.id;
        fleetShip.shipType = shipType;
        fleetShip.missionReturnsAt = normalizeTimestamp(mission.returns_at);
        fleetShip.missionArrivesAt = normalizeTimestamp(mission.arrives_at);
        fleetShip.missionStartedAt = normalizeTimestamp(mission.started_at) || Date.now();

        window.fleetModule.saveFleet();
        this.loadPlanetsFromRust();

        if (window._refreshFleetWithMissions) {
            window._refreshFleetWithMissions();
        }

        GameBus.emit(EVENTS.SHIP_MISSION_START, {
            ship: fleetShip,
            planet,
            mission
        });
        if (window.fleetModule?._addFleetLog) {
            window.fleetModule._addFleetLog(
                `✅ ${fleetShip.name} завершил миссию на ${planet.name}`
            );
        }
    },

    async startResearch() {
        if (this.isResearching) return;
        this.loadPlanetsFromRust();

        if (this.planets.length >= 3) {
            window.showNotif?.('МАКСИМУМ ПЛАНЕТ ДОСТИГНУТ', true);
            return;
        }

        const power = this.game?.get_computational_power?.() ?? 0;
        if (power < 100) {
            window.showNotif?.('НЕДОСТАТОЧНО ЭНЕРГИИ (НУЖНО 100)', true);
            return;
        }

        this.isResearching = true;
        const btn = document.getElementById('space-research-btn');
        if (btn) {
            btn.textContent = '⟡ ИССЛЕДОВАНИЕ...';
            btn.disabled = true;
        }

        setTimeout(async () => {
            try {
                const resultJson = this.game.research_planet();
                const result = JSON.parse(resultJson);

                if (result.success) {
                    result.planet.discovered_at = Date.now();
                    result.planet.x = Math.min(5000, Math.max(0, result.planet.x || 0));
                    result.planet.y = Math.min(5000, Math.max(0, result.planet.y || 0));
                    this.planets.push(result.planet);
                    this._markDirty();

                    window.showNotif?.(`ПЛАНЕТА ОБНАРУЖЕНА: ${result.planet.name}`, false);

                    if (this.game?.save_current_state) {
                        this.game.save_current_state();
                    }

                    if (typeof window.scheduleCloudSave === 'function') {
                        window.scheduleCloudSave();
                    } else if (typeof window.cloudSaveNow === 'function') {
                        window.cloudSaveNow(true).catch(e =>
                            console.warn('Cloud save failed:', e)
                        );
                    }

                    GameBus.emit(EVENTS.PLANET_ADDED, { planet: result.planet });
                } else {
                    window.showNotif?.(`ОШИБКА: ${result.error}`, true);
                }
            } catch (e) {
                console.error('Research error:', e);
                window.showNotif?.('ОШИБКА ИССЛЕДОВАНИЯ', true);
            } finally {
                this.isResearching = false;
                if (btn) {
                    btn.textContent = '⟡ ИССЛЕДОВАТЬ ПЛАНЕТУ (100 ЭНЕРГИИ)';
                    btn.disabled = false;
                }
                this.updateStatusBar();
            }
        }, 1500);
    },

    renderPlayers() {
        const list = document.getElementById('space-players-list');
        if (!list) return;

        const online = this.otherPlayers.filter(p => this.isOnline(p));
        const offline = this.otherPlayers.filter(p => !this.isOnline(p));

        const el = document.getElementById('space-online-count');
        if (el) el.textContent = `${online.length} В СЕТИ`;

        if (!this.otherPlayers.length) {
            list.innerHTML = '<div style="opacity:0.4;font-size:11px;padding:8px 0;color:#888;">НЕТ КОНТАКТОВ</div>';
            return;
        }

        const MAX_OFFLINE = 50;
        const displayList = [
            ...online,
            ...offline.slice(0, MAX_OFFLINE)
        ];

        const totalOffline = offline.length;
        const hiddenCount = Math.max(0, totalOffline - MAX_OFFLINE);

        list.innerHTML = displayList.map(p => this._renderPlayerRow(p)).join('');

        if (hiddenCount > 0) {
            list.innerHTML += `
                <div style="padding:8px;text-align:center;color:#666;font-size:10px;border-top:1px solid rgba(255,255,255,0.05);">
                    +${hiddenCount} игроков не в сети (скрыто)
                </div>
            `;
        }

        list.onclick = (e) => {
            const row = e.target.closest('[data-player-id]');
            if (!row) return;
            this.showPlayerInfo(row.dataset.playerId);
        };

        list.onmouseover = (e) => {
            const row = e.target.closest('[data-player-id]');
            if (row) {
                this.showPlayerTooltip(row.dataset.playerId, e);
            }
        };
        list.onmouseout = () => this.scheduleTooltipHide();

        this._markDirty();
    },

    _renderPlayerRow(p) {
        const color = this._getPlayerColor(p.user_id);
        const colorStr = `hsl(${color.hue}, ${color.sat}%, ${color.light}%)`;
        const isOnline = this.isOnline(p);

        return `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;"
                data-player-id="${escapeHtml(p.user_id)}">
                <div style="width:10px;height:10px;border-radius:50%;background:${colorStr};flex-shrink:0;
                           ${isOnline ? 'box-shadow:0 0 6px ' + colorStr : ''}"></div>
                <div style="flex:1; min-width: 0;">
                    <div style="font-size:12px;font-weight:bold;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${escapeHtml(p.username).toUpperCase()}
                    </div>
                    <div style="font-size:11px;color:#aaa;margin-top:2px;">
                        ⛏️ ${(p.total_mined||0).toLocaleString()} | 🧠 Ур.${p.neuro_evolution||0}
                    </div>
                </div>
                <span style="font-size:12px;color:${isOnline ? '#4aff9d' : '#666'};">
                    ${isOnline ? '●' : '○'}
                </span>
            </div>
        `;
    },

    _drawPlayers(ctx, scannerY) {
    const myPos = this._getMyPlanetPosition();
    const time = Date.now();

    const candidates = this.otherPlayers
        .map(p => {
            const stored = this._playerPositions[p.user_id];
            const rawX = Number(p.map_x);
            const rawY = Number(p.map_y);
            const pos = stored || (Number.isFinite(rawX) && Number.isFinite(rawY)
                ? { x: rawX, y: rawY }
                : null);
            if (!pos) return null;
            const dx = pos.x - myPos.x;
            const dy = pos.y - myPos.y;
            return { ...p, pos, dist: Math.sqrt(dx * dx + dy * dy) };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.dist !== b.dist) return a.dist - b.dist;
            return a.user_id.localeCompare(b.user_id);
        });

    const visibleCandidates = [];
    for (const player of candidates) {
        const screen = this._worldToScreen(player.pos.x, player.pos.y);
        if (screen.x < -100 || screen.x > this._canvasW + 100 ||
            screen.y < -100 || screen.y > this._canvasH + 100) continue;
        visibleCandidates.push(player);
    }

    // При большом онлайне не рисуем тысячи перекрывающихся сфер.
    // Игроки сохраняются в `otherPlayers` для списка, а canvas группирует
    // близкие точки; представитель кластера остаётся PvP-кликабельным.
    const MAX_RENDERED_PLAYERS = 280;
    const PLAYER_CLUSTER_PX = 22;
    const renderEntries = [];
    if (visibleCandidates.length <= MAX_RENDERED_PLAYERS) {
        renderEntries.push(...visibleCandidates.map(player => ({ player, count: 1 })));
    } else {
        const clusters = new Map();
        for (const player of visibleCandidates) {
            const screen = this._worldToScreen(player.pos.x, player.pos.y);
            const key = `${Math.floor(screen.x / PLAYER_CLUSTER_PX)}:${Math.floor(screen.y / PLAYER_CLUSTER_PX)}`;
            const cluster = clusters.get(key);
            if (cluster) {
                cluster.count++;
            } else {
                clusters.set(key, { player, count: 1 });
            }
        }
        renderEntries.push(...clusters.values());
    }

    this._visiblePlayers = renderEntries.map(entry => entry.player);

    const baseRadius = 1.2 * this._zoom;

    for (const { player, count } of renderEntries) {
        const screen = this._worldToScreen(player.pos.x, player.pos.y);
        const color = this._getPlayerColor(player.user_id);
        const isOnline = this.isOnline(player);

        if (baseRadius < 2.5) {
            // Мелкие точки — рисуем просто кружком со свечением
            ctx.save();
            // Свечение для видимости
            ctx.shadowBlur = 6;
            ctx.shadowColor = isOnline
                ? `hsl(${color.hue}, ${color.sat}%, 60%)`
                : `hsl(${color.hue}, ${color.sat - 15}%, 40%)`;

            ctx.beginPath();
            ctx.arc(screen.x, screen.y, baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = isOnline
                ? `hsl(${color.hue}, ${color.sat}%, ${color.light + 10}%)`
                : `hsl(${color.hue}, ${color.sat - 15}%, ${color.light - 10}%)`;
            ctx.fill();
            ctx.restore();
        } else {
            const isImportant = player.neuro_evolution >= 5;
            this._drawTechSphere(ctx, screen.x, screen.y, baseRadius, color, time, {
                isActive: isOnline || isImportant,
                isOnline,
                scannerY
            });
        }
    }
},

    _drawTechSphere(ctx, x, y, radius, color, time, options = {}) {
        const { hue, sat, light } = color;
        const { isActive = false, isExhausted = false, isOnline = false, scannerY } = options;
        const pulse = Math.sin(time * 0.002) * 3;
        const currentLight = Math.max(15, Math.min(85, light + pulse + (isActive ? 4 : 0)));
        const mainColor = `hsl(${hue}, ${sat}%, ${currentLight}%)`;
        const borderColor = `hsl(${hue}, ${sat + 10}%, ${currentLight + 5}%)`;
        const darkColor = `hsl(${hue}, ${sat}%, ${currentLight - 8}%)`;

        if (isExhausted) ctx.globalAlpha = 0.4;

        if (isOnline) {
            const glowRadius = radius * 2.5;
            const glowGrad = ctx.createRadialGradient(x, y, radius * 0.8, x, y, glowRadius);
            glowGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${currentLight + 15}%, 0.3)`);
            glowGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${currentLight + 15}%, 0)`);
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fillStyle = glowGrad;
            ctx.fill();
        }

        if (!isOnline && isActive) {
            const glowRadius = radius * 1.8;
            const glowGrad = ctx.createRadialGradient(x, y, radius * 0.8, x, y, glowRadius);
            glowGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${currentLight + 10}%, 0.15)`);
            glowGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${currentLight + 10}%, 0)`);
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fillStyle = glowGrad;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(
            x - radius * 0.3, y - radius * 0.3, radius * 0.1,
            x, y, radius
        );
        grad.addColorStop(0, borderColor);
        grad.addColorStop(0.5, mainColor);
        grad.addColorStop(1, darkColor);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsl(${hue}, ${sat + 5}%, ${currentLight + 5}%)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if (isOnline) {
            const ringAlpha = 0.3 + Math.sin(time * 0.003) * 0.15;
            ctx.beginPath();
            ctx.arc(x, y, radius + 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${currentLight + 10}%, ${ringAlpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue}, ${sat + 20}%, ${currentLight + 15}%)`;
        ctx.fill();

        if (scannerY != null && !isNaN(scannerY) && Math.abs(y - scannerY) < radius + 2) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x - radius - 3, y);
            ctx.lineTo(x + radius + 3, y);
            ctx.strokeStyle = 'rgba(0, 255, 150, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = 1;
    },

    _getScannerGradient(ctx, scannerY) {
        const cacheKey = `${this._canvasW}_${this._canvasH}_${Math.floor(scannerY / 10)}`;

        if (this._scannerGradientCache?.key === cacheKey) {
            return this._scannerGradientCache.gradient;
        }

        const gradient = ctx.createLinearGradient(0, scannerY - 80, 0, scannerY);
        gradient.addColorStop(0, 'rgba(0, 255, 100, 0)');
        gradient.addColorStop(1, 'rgba(0, 255, 100, 0.025)');

        this._scannerGradientCache = { key: cacheKey, gradient };
        return gradient;
    },

    _drawScannerLine(ctx, scannerY) {
        if (this._canvasW === 0 || this._canvasH === 0 || scannerY === undefined) return;

        ctx.save();
        ctx.fillStyle = this._getScannerGradient(ctx, scannerY);
        ctx.fillRect(0, scannerY - 80, this._canvasW, 80);

        ctx.beginPath();
        ctx.moveTo(0, scannerY);
        ctx.lineTo(this._canvasW, scannerY);
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.08)';
        ctx.beginPath();
        ctx.moveTo(0, scannerY);
        ctx.lineTo(this._canvasW, scannerY);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.restore();
    },

    _resizeCanvas() {
        const starMap = document.getElementById('space-star-map');
        if (!starMap || !this._canvas) return;

        const w = starMap.clientWidth;
        const h = starMap.clientHeight;
        if (w === this._canvasW && h === this._canvasH) return;

        const oldW = this._canvasW || w;
        const oldH = this._canvasH || h;

        this._canvas.width = w;
        this._canvas.height = h;
        this._canvasW = w;
        this._canvasH = h;

        if (this._staticCanvas) {
            this._staticCanvas.width = w;
            this._staticCanvas.height = h;
            this._staticDirty = true;
        }

        if (oldW > 0 && oldH > 0) {
            const worldCenterX = (oldW / 2 - this._cameraX) / (oldW * this._zoom);
            const worldCenterY = (oldH / 2 - this._cameraY) / (oldH * this._zoom);

            this._cameraX = w / 2 - worldCenterX * w * this._zoom;
            this._cameraY = h / 2 - worldCenterY * h * this._zoom;
        }

        this._clampCamera();
        this._markDirty();
    },

    _drawInfluenceZone(ctx) {
        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;

        const center = this._worldToScreen(myPos.x, myPos.y);
        const neuroLevel = this._lastStats?.neuro_evolution ?? 0;

        const radiusUnits = Math.min(500, 150 + neuroLevel * 30);
        const radiusPx = (radiusUnits / this._mapSize) * this._canvasW * this._zoom;

        const grad = ctx.createRadialGradient(
            center.x, center.y, 0,
            center.x, center.y, radiusPx
        );
        grad.addColorStop(0, 'rgba(0,170,136,0.02)');
        grad.addColorStop(0.7, 'rgba(0,170,136,0.01)');
        grad.addColorStop(1, 'rgba(0,170,136,0)');

        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,170,136,0.12)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
    },

    _drawGrid(ctx) {
        const gridSizePx = this._gridSize / this._mapSize * this._canvasW * this._zoom;
        if (gridSizePx < 4) return;

        ctx.save();
        ctx.strokeStyle = `rgba(0, 255, 100, ${this._gridOpacity})`;
        ctx.lineWidth = 0.5;

        for (let x = 0; x <= this._mapSize; x += this._gridSize) {
            const screenX = (x / this._mapSize) * this._canvasW * this._zoom + this._cameraX;
            if (screenX >= -10 && screenX <= this._canvasW + 10) {
                ctx.beginPath();
                ctx.moveTo(screenX, 0);
                ctx.lineTo(screenX, this._canvasH);
                ctx.stroke();
            }
        }

        for (let y = 0; y <= this._mapSize; y += this._gridSize) {
            const screenY = (y / this._mapSize) * this._canvasH * this._zoom + this._cameraY;
            if (screenY >= -10 && screenY <= this._canvasH + 10) {
                ctx.beginPath();
                ctx.moveTo(0, screenY);
                ctx.lineTo(this._canvasW, screenY);
                ctx.stroke();
            }
        }

        if (gridSizePx >= 25) {
            ctx.font = '8px monospace';
            ctx.fillStyle = `rgba(0, 255, 100, 0.7)`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            for (let x = 0; x <= this._mapSize; x += this._gridSize) {
                const screenX = (x / this._mapSize) * this._canvasW * this._zoom + this._cameraX + 2;
                if (screenX >= 0 && screenX <= this._canvasW - 30) {
                    ctx.fillText(`${Math.round(x)}`, screenX, 2);
                }
            }
            for (let y = 0; y <= this._mapSize; y += this._gridSize) {
                const screenY = (y / this._mapSize) * this._canvasH * this._zoom + this._cameraY + 2;
                if (screenY >= 0 && screenY <= this._canvasH - 10) {
                    ctx.fillText(`${Math.round(y)}`, 2, screenY);
                }
            }
        }

        ctx.restore();
    },

    _isPlanetExhausted(planet) {
        const total = (planet.resources_remaining?.coal || 0) +
                      (planet.resources_remaining?.plasma || 0) +
                      (planet.resources_remaining?.ore || 0);
        return total === 0;
    },

    _drawPlanets(ctx, scannerY) {
        const time = Date.now();
        let activeMissions = [];
        try { activeMissions = JSON.parse(this.game.get_active_planet_missions()); } catch(e) {}

        this.planets.forEach(planet => {
            const isExhausted = this._isPlanetExhausted(planet);
            const activeMission = activeMissions.find(m => m.planet_id === planet.id && m.status === 'flying');
            const color = this._getEntityColor(planet.id);
            // ✅ Линейный масштаб: zoom=1.0 → 1x, zoom=3.0 → 3x
            const size = (isExhausted ? 1.2 : 1.8) * this._zoom;

            const screen = this._worldToScreen(planet.x, planet.y);
            if (screen.x < -50 || screen.x > this._canvasW + 50 || screen.y < -50 || screen.y > this._canvasH + 50) return;

            this._drawTechSphere(ctx, screen.x, screen.y, size, color, time, {
                isActive: !!activeMission,
                isExhausted,
                scannerY
            });
        });
    },

    loadPlanetsFromRust() {
        if (!this.game) return;

        try {
            const planetsJson = this.game.get_planets();
            if (!planetsJson || planetsJson === 'null') {
                console.warn('Empty planets JSON, keeping existing');
                return;
            }

            let planets = JSON.parse(planetsJson);

            if (!Array.isArray(planets)) {
                console.warn('Invalid planets format, keeping existing');
                return;
            }

            this.planets = planets.map(planet => ({
                ...planet,
                x: Math.min(5000, Math.max(0, planet.x || 0)),
                y: Math.min(5000, Math.max(0, planet.y || 0))
            }));

            this._markDirty();
            console.log(`ПЛАНЕТ ЗАГРУЖЕНО: ${this.planets.length}`);
        } catch(e) {
            console.warn('PLANETS LOAD ERROR (keeping existing):', e);
        }
    },

    showPlanetInfo(planet) {
        const cfg = this.PLANET_TYPES[planet.planet_type] ?? {};
        const rem = planet.resources_remaining || planet.resources || {};
        const totalRem = (rem.coal || 0) + (rem.plasma || 0) + (rem.ore || 0);
        const isExhausted = totalRem === 0;
        const planetColor = this._getEntityColor(planet.id);
        const colorStr = `hsl(${planetColor.hue}, ${planetColor.sat}%, ${planetColor.light}%)`;
        const activeMission = this._getActiveMissionForPlanet(planet.id);

        const discoveredAt = planet.discovered_at
            ? new Date(planet.discovered_at).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })
            : 'неизвестно';

        let hasFreeCargo = false;
        try {
            if (window.fleetModule) {
                hasFreeCargo = window.fleetModule.ships.some(s => s.type === 'cargo' && !s.onMission && !s.onDefense);
            }
        } catch(e) {}

        const popup = this._showPopup(`
            <div style="font-size:14px;color:${colorStr};text-align:center;margin-bottom:10px;font-weight:bold;">🪐 ${planet.name.toUpperCase()}</div>
            <div style="font-size:13px;margin-bottom:10px;color:#d0d0d0;line-height:1.6;">
                <div>🪨 УГОЛЬ: ${rem.coal || 0}</div>
                <div>⚡ ПЛАЗМА: ${rem.plasma || 0}</div>
                <div>⛏️ РУДА: ${rem.ore || 0}</div>
                <div>🌍 ТИП: ${cfg.name || planet.planet_type}</div>
                <div>📅 ОБНАРУЖЕНА: ${discoveredAt}</div>
                ${isExhausted ? '<div>⚠️ СТАТУС: ИСТОЩЕНА</div>' : ''}
                ${activeMission ? '<div>🚀 КОРАБЛЬ В ПУТИ</div>' : ''}
            </div>
            ${!isExhausted ? `<button id="planet-btn-cargo" style="width:100%;padding:8px;background:rgba(255,170,0,0.1);border:1px solid #fa0;color:#fa0;border-radius:4px;cursor:pointer;margin-bottom:6px;font-size:12px;${!hasFreeCargo ? 'opacity:0.4;cursor:not-allowed;' : ''}" ${!hasFreeCargo ? 'disabled' : ''}>🚀 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ</button>` : '<div style="text-align:center;padding:6px;border:1px solid #ff6644;border-radius:4px;font-size:12px;color:#ff6644;">ИСТОЩЕНА</div>'}
            <button id="planet-btn-close" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #555;color:#aaa;border-radius:4px;cursor:pointer;font-size:12px;">ЗАКРЫТЬ</button>
        `, {
            borderColor: colorStr,
            minWidth: 240,
            className: 'player-popup'
        });

        if (!isExhausted) {
            popup.querySelector('#planet-btn-cargo')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.sendShipToPlanet(planet, 'cargo');
                this._closeCurrentPopup();
            });
        }

        popup.querySelector('#planet-btn-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeCurrentPopup();
        });
    },

    showBaseInfo() {
        if (this._currentPopup) {
            this._closeCurrentPopup();
        }

        let stats = null;
        try {
            const j = this.game.get_statistics();
            if (j) stats = JSON.parse(j);
        } catch(e) {}

        const myPos = this._getMyPlanetPosition();
        const color = this._getEntityColor(this.currentUser?.id || 'player_base');
        const colorStr = `hsl(${color.hue}, ${color.sat}%, ${color.light}%)`;

        const popup = this._showPopup(`
            <div style="font-size:14px;color:${colorStr};text-align:center;margin-bottom:10px;font-weight:bold;">🏠 БАЗА</div>
            <div style="font-size:11px;color:#888;text-align:center;margin-bottom:8px;">
                📍 КООРДИНАТЫ: [${Math.round(myPos.x)}, ${Math.round(myPos.y)}]
            </div>
            <div style="font-size:13px;margin-bottom:10px;color:#d0d0d0;line-height:1.6;">
                <div>⛏️ РУДА: ${stats?.ore_inventory || 0}</div>
                <div>🪨 УГОЛЬ: ${stats?.coal_inventory || 0}</div>
                <div>💾 ЧИПЫ: ${stats?.chips_inventory || 0}</div>
                <div>⚡ ПЛАЗМА: ${stats?.plasma_inventory || 0}</div>
                <div>♻️ МУСОР: ${stats?.trash_inventory || 0}</div>
                <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;">⚡ ЭНЕРГИЯ: ${stats?.computational_power || 0}/${stats?.max_computational_power || 1000}</div>
                <div>🧠 НЕЙРО: УР${stats?.neuro_evolution || 0}</div>
            </div>
            <button id="base-btn-close" style="width:100%;padding:8px;background:rgba(74,255,157,0.1);border:1px solid ${colorStr};color:${colorStr};border-radius:4px;cursor:pointer;font-size:12px;">ЗАКРЫТЬ</button>
        `, {
            borderColor: colorStr,
            minWidth: 240,
            className: 'player-popup'
        });

        popup.querySelector('#base-btn-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeCurrentPopup();
        });
    },

    _showPopup(content, options = {}) {
        this._closeCurrentPopup();

        const popup = document.createElement('div');
        popup.className = options.className || 'player-popup';
        popup.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#1a1a1a;
            border:2px solid ${options.borderColor || '#4aff9d'};
            border-radius:8px;
            padding:16px;
            z-index:10001;
            font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-width:${options.minWidth || 240}px;
            max-width:90vw;
            max-height:85vh;
            overflow-y:auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.8);
        `;
        popup.innerHTML = content;

        document.body.appendChild(popup);
        this._currentPopup = popup;

        const closePopup = () => this._closeCurrentPopup();

        this._closeOnOutsideHandler = (e) => {
            if (!this._currentPopup) return;
            if (!this._currentPopup.contains(e.target)) {
                closePopup();
            }
        };

        this._onEscHandler = (e) => {
            if (e.key === 'Escape' && this._currentPopup) {
                closePopup();
            }
        };

        requestAnimationFrame(() => {
            document.addEventListener('click', this._closeOnOutsideHandler, true);
            document.addEventListener('keydown', this._onEscHandler);
        });

        return popup;
    },

    _closeCurrentPopup() {
        if (!this._currentPopup) return;

        if (this._closeOnOutsideHandler) {
            document.removeEventListener('click', this._closeOnOutsideHandler, true);
            this._closeOnOutsideHandler = null;
        }
        if (this._onEscHandler) {
            document.removeEventListener('keydown', this._onEscHandler);
            this._onEscHandler = null;
        }

        if (this._flightPopupInterval) {
            clearInterval(this._flightPopupInterval);
            this._flightPopupInterval = null;
        }

        this._currentPopup.remove();
        this._currentPopup = null;
    },

    setupTooltip() {
        let tooltip = document.getElementById('space-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'space-tooltip';
            tooltip.className = 'space-tooltip';
            tooltip.style.cssText = `
                position: fixed;
                background: rgba(0,0,0,0.92);
                border: 1px solid #4aff9d;
                border-radius: 4px;
                padding: 8px 12px;
                font-size: 12px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                z-index: 9999;
                pointer-events: auto;
                max-width: 280px;
                display: none;
                color: #ffffff;
                letter-spacing: 0.3px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                transition: opacity 0.15s ease;
            `;
            document.body.appendChild(tooltip);

            tooltip.addEventListener('mouseenter', () => {
                if (this._tooltipTimeout) {
                    clearTimeout(this._tooltipTimeout);
                    this._tooltipTimeout = null;
                }
            });
            tooltip.addEventListener('mouseleave', () => {
                this.scheduleTooltipHide();
            });
        }
        this._tooltipElement = tooltip;
    },

    _subscribeToEvents() {
        this._gameBusUnsubscribers.push(
            GameBus.on(EVENTS.PLANET_ADDED, () => {
                this.loadPlanetsFromRust();
                this._markDirty();
            }),
            GameBus.on(EVENTS.SHIP_MISSION_START, () => {
                this._markDirty();
            }),
            GameBus.on(EVENTS.SHIP_MISSION_END, () => {
                this._markDirty();
            }),
            GameBus.on(EVENTS.FLEET_UPDATED, () => {
                this._markDirty();
            }),
            GameBus.on(EVENTS.CLOUD_LOAD_DONE, () => {
                this._loadPositionFromCloudAsync();
                this._markDirty();
            })
        );
    },

    showTooltip(content, x, y) {
        if (!this._tooltipElement) return;

        this._tooltipElement.innerHTML = content;
        this._tooltipElement.style.display = 'block';
        this._tooltipElement.style.visibility = 'hidden';
        this._tooltipElement.style.left = '0px';
        this._tooltipElement.style.top = '0px';

        requestAnimationFrame(() => {
            const rect = this._tooltipElement.getBoundingClientRect();
            const padding = 12;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            let left = x + padding;
            let top = y + padding;

            if (left + rect.width > screenWidth - padding) {
                left = x - rect.width - padding;
            }
            if (left < padding) {
                left = padding;
            }

            if (top + rect.height > screenHeight - padding) {
                top = y - rect.height - padding;
            }
            if (top < padding) {
                top = padding;
            }

            this._tooltipElement.style.left = `${left}px`;
            this._tooltipElement.style.top = `${top}px`;
            this._tooltipElement.style.visibility = 'visible';
        });
    },

    hideTooltip() {
        if (!this._tooltipElement) return;
        this._tooltipElement.style.display = 'none';
        this._tooltipElement.style.visibility = 'hidden';
    },

    scheduleTooltipHide() {
        if (this._tooltipTimeout) clearTimeout(this._tooltipTimeout);
        this._tooltipTimeout = setTimeout(() => {
            this.hideTooltip();
            this._tooltipTimeout = null;
        }, 300);
    },

    showActiveFlightsPopup(activeShips) {
        const popup = this._showPopup('', {
            className: 'flight-popup',
            minWidth: 280,
            borderColor: '#4aff9d'
        });

        const updateContent = () => {
            const now = Date.now();
            const currentActive = window.fleetModule?.ships?.filter(s => s.onMission) || [];

            if (currentActive.length === 0) {
                this._closeCurrentPopup();
                return;
            }

            const listHtml = currentActive.map(ship => {
                const arrivesAt = normalizeTimestamp(ship.missionArrivesAt);
                const returnsAt = normalizeTimestamp(ship.missionReturnsAt);
                let status = "В пути";
                let timeLeft = "???";

                if (now < arrivesAt) {
                    const rem = Math.ceil((arrivesAt - now) / 1000);
                    status = "📤 Летит к цели";
                    timeLeft = `${Math.floor(rem / 60)}м ${rem % 60}с`;
                } else if (now < returnsAt) {
                    const rem = Math.ceil((returnsAt - now) / 1000);
                    status = "📥 Возвращается";
                    timeLeft = `${Math.floor(rem / 60)}м ${rem % 60}с`;
                } else {
                    status = "✅ Завершает";
                    timeLeft = "0с";
                }

                const shipIcon = ship.type === 'cargo' ? '📦' :
                                ship.type === 'combat' ? '⚔️' : '🔭';

                return `
                    <div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 12px;">
                        <div style="color: #4aff9d; font-weight: bold;">
                            ${shipIcon} ${ship.name} (${ship.type})
                        </div>
                        <div style="color: #ccc; margin-top: 2px;">
                            ${status} | ${timeLeft}
                        </div>
                    </div>
                `;
            }).join('');

            popup.innerHTML = `
                <div style="font-size: 14px; color: #4aff9d; text-align: center; margin-bottom: 12px; font-weight: bold;">
                    🚀 АКТИВНЫЕ МИССИИ (${currentActive.length})
                </div>
                <div style="max-height: 300px; overflow-y: auto;">${listHtml}</div>
                <button id="flight-popup-close" style="width: 100%; margin-top: 12px; padding: 8px; background: rgba(74,255,157,0.1); border: 1px solid #4aff9d; color: #4aff9d; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    ЗАКРЫТЬ
                </button>
            `;

            popup.querySelector('#flight-popup-close').onclick = (e) => {
                e.stopPropagation();
                this._closeCurrentPopup();
            };
        };

        updateContent();

        this._flightPopupInterval = setInterval(() => {
            if (!this._currentPopup || this._currentPopup !== popup) {
                clearInterval(this._flightPopupInterval);
                this._flightPopupInterval = null;
                return;
            }
            updateContent();
        }, 1000);
    },

    _handleCanvasClick(e) {
        const starMap = document.getElementById('space-star-map');
        const rect = starMap.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Уменьшенный радиус для более точного клика
        const CLICK_RADIUS = this._getClickRadius();

        const myPos = this._getMyPlanetPosition();
        const myScreen = this._worldToScreen(myPos.x, myPos.y);

        // ✅ СНАЧАЛА БАЗА (своя)
        if (this._hitTestPoint(cx, cy, myScreen.x, myScreen.y, CLICK_RADIUS)) {
            this.showBaseInfo();
            return;
        }
        // Потом игроки
        const clickedPlayer = this._hitTestPlayer(cx, cy);
        if (clickedPlayer) {
            this.showPlayerInfo(clickedPlayer.user_id);
            return;
        }

        // Потом планеты
        for (const planet of this.planets) {
            const isExhausted = this._isPlanetExhausted(planet);
            const screen = this._worldToScreen(planet.x, planet.y);
            if (this._hitTestPoint(cx, cy, screen.x, screen.y, CLICK_RADIUS)) {
                if (isExhausted) {
                    window.showNotif?.('🪐 ПЛАНЕТА ИСТОЩЕНА', true);
                } else {
                    this.showPlanetInfo(planet);
                }
                return;
            }
        }

        // Потом станции
        for (const station of this.neutralStations) {
            const screen = this._worldToScreen(station.x, station.y);
            if (this._hitTestPoint(cx, cy, screen.x, screen.y, CLICK_RADIUS)) {
                this.showStationInfo(station);
                return;
            }
        }
    },

    _handleCanvasHover(e) {
        const starMap = document.getElementById('space-star-map');
        const rect = starMap.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const CLICK_RADIUS = this._getClickRadius();

        for (const planet of this.planets) {
            const screen = this._worldToScreen(planet.x, planet.y);
            if (this._hitTestPoint(cx, cy, screen.x, screen.y, CLICK_RADIUS)) {
                starMap.style.cursor = 'pointer';
                const rem = planet.resources_remaining || {};
                this.showTooltip(`🪐 ${planet.name}\n⛏️ УГОЛЬ: ${rem.coal || 0}\n⚡ ПЛАЗМА: ${rem.plasma || 0}\n⛏️ РУДА: ${rem.ore || 0}`, e.clientX, e.clientY);
                return;
            }
        }

        for (const station of this.neutralStations) {
            const screen = this._worldToScreen(station.x, station.y);
            if (this._hitTestPoint(cx, cy, screen.x, screen.y, CLICK_RADIUS)) {
                starMap.style.cursor = 'pointer';
                let bonusText = '';
                switch(station.bonus_type) {
                    case 'mining_boost': bonusText = 'ДОБЫЧА+50%'; break;
                    case 'defense_boost': bonusText = 'ЗАЩИТА+2N'; break;
                    case 'power_boost': bonusText = 'ЭНЕРГИЯ+50'; break;
                }
                this.showTooltip(`🛸 ${station.name}\n💎 ${bonusText}\n♻️ ЦЕНА: ${station.cost_trash}`, e.clientX, e.clientY);
                return;
            }
        }

        const myPos = this._getMyPlanetPosition();
        const myScreen = this._worldToScreen(myPos.x, myPos.y);
        if (this._hitTestPoint(cx, cy, myScreen.x, myScreen.y, CLICK_RADIUS)) {
            starMap.style.cursor = 'pointer';
            let stats = null;
            try {
                const j = this.game.get_statistics();
                if (j) stats = JSON.parse(j);
            } catch(e) {}
            this.showTooltip(`🏠 БАЗА\n⚡ ЭНЕРГИЯ: ${stats?.computational_power || 0}/${stats?.max_computational_power || 1000}\n🧠 УРОВЕНЬ: ${stats?.neuro_evolution || 0}`, e.clientX, e.clientY);
            return;
        }

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
        if (!this._visiblePlayers || this._visiblePlayers.length === 0) return null;

        // ✅ Используем тот же радиус, что и для остальных объектов
        const HIT_RADIUS = this._getClickRadius();

        // Собираем всех в радиусе + считаем дистанцию
        const candidates = [];
        for (const player of this._visiblePlayers) {
            const screen = this._worldToScreen(player.pos.x, player.pos.y);
            const dx = cx - screen.x;
            const dy = cy - screen.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= HIT_RADIUS) {
                candidates.push({ player, dist });
            }
        }

        if (candidates.length === 0) return null;

        // ✅ Возвращаем БЛИЖАЙШЕГО к курсору/пальцу
        candidates.sort((a, b) => a.dist - b.dist);
        return candidates[0].player;
    },

    async _fetchAllPlayersFallback() {
        if (!this.currentUser) return;
        console.log('🔄 Загружаем ВСЕХ игроков из БД...');

        try {

            const { data, error } = await supabase
                .from('game_saves')
                .select('user_id, map_x, map_y, total_mined, neuro_evolution, nights_survived, computational_power, last_seen')
                .neq('user_id', this.currentUser.id)
                .not('map_x', 'is', null)
                .not('map_y', 'is', null)
                .order('total_mined', { ascending: false })
                .limit(2000);

            if (error) {
                console.warn('❌ Ошибка загрузки игроков:', error);
                return;
            }

            if (!data || data.length === 0) {
                console.log('ℹ️ В базе нет других игроков с координатами');
                this.otherPlayers = [];
                this.renderPlayers();
                return;
            }

            console.log(`📥 Загружено ${data.length} игроков из БД`);

            const ids = data.map(s => s.user_id).filter(Boolean);
            let profileMap = this._profileCache || {};
            const uncachedIds = ids.filter(id => !profileMap[id]);

            if (uncachedIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, username')
                    .in('id', uncachedIds);
                (profiles ?? []).forEach(p => {
                    profileMap[p.id] = p.username;
                });
                this._profileCache = profileMap;
            }

            this.otherPlayers = data.map(s => ({
                ...s,
                username: profileMap[s.user_id] ?? 'НЕИЗВЕСТНЫЙ',
                map_x: Number(s.map_x),
                map_y: Number(s.map_y)
            }));

            let validCount = 0;
            for (const player of this.otherPlayers) {
                if (player.map_x != null && player.map_y != null &&
                    Number.isFinite(Number(player.map_x)) && Number.isFinite(Number(player.map_y))) {
                    this._playerPositions[player.user_id] = {
                        x: Number(player.map_x),
                        y: Number(player.map_y),
                    };
                    validCount++;
                }
            }

            console.log(`✅ Итог: ${this.otherPlayers.length} игроков загружено (валидных: ${validCount})`);
            this.renderPlayers();
            this._markDirty();

        } catch (e) {
            console.error('❌ Критическая ошибка загрузки игроков:', e);
        }
    },

    async _fetchAndApplyPlayers() {
        return this._fetchAllPlayersFallback();
    },

    initMapControls() {
        const starMap = document.getElementById('space-star-map');
        if (!starMap) return;

        const ZOOM_STEP = 0.1;
        const MIN_ZOOM = 1.0;
        const MAX_ZOOM = 3.0;

        this._mapCenteredOnce = false;

        this._centerOnPlayer = () => {
            const myPos = this._getMyPlanetPosition();
            this._centerOnPoint(myPos.x, myPos.y);
        };

        this._resizeHandler = () => {
            this._markDirty();
        };
        window.addEventListener('resize', this._resizeHandler);

        starMap.addEventListener('wheel', (e) => {
            const rect = starMap.getBoundingClientRect();
            const isOverMap = e.clientX >= rect.left && e.clientX <= rect.right &&
                              e.clientY >= rect.top && e.clientY <= rect.bottom;

            if (!isOverMap) return;

            e.preventDefault();
            e.stopPropagation();

            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const worldBeforeX = (mouseX - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldBeforeY = (mouseY - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            const oldZoom = this._zoom;
            const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
            this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoom + delta));

            if (oldZoom === this._zoom) return;

            const worldAfterX = (mouseX - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldAfterY = (mouseY - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            this._cameraX += (worldAfterX - worldBeforeX) / this._mapSize * this._canvasW * this._zoom;
            this._cameraY += (worldAfterY - worldBeforeY) / this._mapSize * this._canvasH * this._zoom;

            this._clampCamera();
            this._markDirty();
            this.updateStatusBar(this._lastStats);
        }, { passive: false });

        this._mouseMoveHandler = (e) => {
            if (!this._isDragging) return;
            const dx = e.clientX - this._dragStartX;
            const dy = e.clientY - this._dragStartY;
            this._cameraX = this._dragStartCameraX + dx;
            this._cameraY = this._dragStartCameraY + dy;
            this._clampCamera();
            this._markDirty();
        };

        this._mouseUpHandler = () => {
            this._isDragging = false;
            starMap.style.cursor = 'grab';
        };

        starMap.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            this._isDragging = true;
            this._dragStartX = e.clientX;
            this._dragStartY = e.clientY;
            this._dragStartCameraX = this._cameraX;
            this._dragStartCameraY = this._cameraY;
            starMap.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', this._mouseMoveHandler);
        window.addEventListener('mouseup', this._mouseUpHandler);

        document.getElementById('map-zoom-in')?.addEventListener('click', () => {
            const rect = starMap.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;

            const worldBeforeX = (cx - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldBeforeY = (cy - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            const oldZoom = this._zoom;
            this._zoom = Math.min(MAX_ZOOM, this._zoom + ZOOM_STEP);

            if (oldZoom === this._zoom) return;

            const worldAfterX = (cx - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldAfterY = (cy - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            this._cameraX += (worldAfterX - worldBeforeX) / this._mapSize * this._canvasW * this._zoom;
            this._cameraY += (worldAfterY - worldBeforeY) / this._mapSize * this._canvasH * this._zoom;

            this._clampCamera();
            this._markDirty();
            this.updateStatusBar(this._lastStats);
        });

        document.getElementById('map-zoom-out')?.addEventListener('click', () => {
            const rect = starMap.getBoundingClientRect();
            const cx = rect.width / 2, cy = rect.height / 2;

            const worldBeforeX = (cx - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldBeforeY = (cy - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            const oldZoom = this._zoom;
            this._zoom = Math.max(MIN_ZOOM, this._zoom - ZOOM_STEP);

            if (oldZoom === this._zoom) return;

            const worldAfterX = (cx - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
            const worldAfterY = (cy - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;

            this._cameraX += (worldAfterX - worldBeforeX) / this._mapSize * this._canvasW * this._zoom;
            this._cameraY += (worldAfterY - worldBeforeY) / this._mapSize * this._canvasH * this._zoom;

            this._clampCamera();
            this._markDirty();
            this.updateStatusBar(this._lastStats);
        });

        document.getElementById('map-zoom-reset')?.addEventListener('click', () => {
            this._zoom = 1.0;
            this._centerOnPlayer();
            this._markDirty();
            this.updateStatusBar(this._lastStats);
        });

        // Touch события для мобильных
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        if (isMobile) {
            let touchStartX = 0, touchStartY = 0;
            let touchStartTime = 0;
            let touchMoved = false;
            let initialPinchDistance = 0;
            let initialPinchZoom = 1.0;
            let pinchCenterX = 0, pinchCenterY = 0;

            const getTouchDistance = (t1, t2) => {
                const dx = t1.clientX - t2.clientX;
                const dy = t1.clientY - t2.clientY;
                return Math.sqrt(dx * dx + dy * dy);
            };

            starMap.addEventListener('touchstart', (e) => {
                if (e.target.closest('button')) return;

                if (e.touches.length === 1) {
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                    touchStartTime = Date.now();
                    touchMoved = false;

                    // ✅ КРИТИЧНО: инициализируем drag-переменные
                    this._isDragging = true;
                    this._dragStartX = touchStartX;
                    this._dragStartY = touchStartY;
                    this._dragStartCameraX = this._cameraX;
                    this._dragStartCameraY = this._cameraY;
                } else if (e.touches.length === 2) {
                    // ✅ Pinch-to-zoom
                    e.preventDefault();
                    this._isDragging = false;
                    initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1]);
                    initialPinchZoom = this._zoom;
                    const rect = starMap.getBoundingClientRect();
                    pinchCenterX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
                    pinchCenterY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
                }
            }, { passive: false });

            starMap.addEventListener('touchmove', (e) => {
                if (e.target.closest('button')) return;

                if (e.touches.length === 1 && this._isDragging) {
                    const touch = e.touches[0];
                    const dx = touch.clientX - this._dragStartX;
                    const dy = touch.clientY - this._dragStartY;

                    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchMoved = true;

                    this._cameraX = this._dragStartCameraX + dx;
                    this._cameraY = this._dragStartCameraY + dy;
                    this._clampCamera();
                    this._markDirty();
                    e.preventDefault();
                } else if (e.touches.length === 2) {
                    // ✅ Pinch-to-zoom обработка
                    e.preventDefault();
                    const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
                    const scale = currentDistance / initialPinchDistance;
                    const newZoom = Math.max(1.0, Math.min(3.0, initialPinchZoom * scale));

                    if (newZoom !== this._zoom) {
                        const worldBeforeX = (pinchCenterX - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
                        const worldBeforeY = (pinchCenterY - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;
                        this._zoom = newZoom;
                        const worldAfterX = (pinchCenterX - this._cameraX) / (this._canvasW * this._zoom) * this._mapSize;
                        const worldAfterY = (pinchCenterY - this._cameraY) / (this._canvasH * this._zoom) * this._mapSize;
                        this._cameraX += (worldAfterX - worldBeforeX) / this._mapSize * this._canvasW * this._zoom;
                        this._cameraY += (worldAfterY - worldBeforeY) / this._mapSize * this._canvasH * this._zoom;
                        this._clampCamera();
                        this._markDirty();
                        this.updateStatusBar(this._lastStats);
                    }
                }
            }, { passive: false });

            starMap.addEventListener('touchend', (e) => {
                if (e.touches.length === 0) {
                    // ✅ Tap только если палец не двигался
                    if (!touchMoved && e.changedTouches.length === 1) {
                        const elapsed = Date.now() - touchStartTime;
                        if (elapsed < 300) {
                            const touch = e.changedTouches[0];
                            const fakeEvent = {
                                clientX: touch.clientX,
                                clientY: touch.clientY
                            };
                            this._handleCanvasClick(fakeEvent);
                        }
                    }
                    this._isDragging = false;
                    touchMoved = false;
                }
            }, { passive: true });

            starMap.addEventListener('touchcancel', () => {
                this._isDragging = false;
                touchMoved = false;
            }, { passive: true });
        }

        this._clampCamera();
        setTimeout(() => {
            if (!this._mapCenteredOnce) {
                this._centerOnPlayer();
                this._mapCenteredOnce = true;
            }
        }, 100);
    },

    _getPlayerColor(userId) {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = userId.charCodeAt(i) + ((hash << 5) - hash);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        return { hue, sat: 65, light: 50 };
    },

    _getEntityColor(id) {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        return { hue, sat: 60, light: 45 };
    },

    _worldToScreen(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            console.warn('Invalid coords:', x, y);
            return { x: 0, y: 0 };
        }
        return {
            x: (x / this._mapSize) * this._canvasW * this._zoom + this._cameraX,
            y: (y / this._mapSize) * this._canvasH * this._zoom + this._cameraY
        };
    },

    _screenToWorld(screenX, screenY) {
        return {
            x: ((screenX - this._cameraX) / (this._canvasW * this._zoom)) * this._mapSize,
            y: ((screenY - this._cameraY) / (this._canvasH * this._zoom)) * this._mapSize
        };
    },

    _clampCamera() {
        if (this._canvasW === 0 || this._canvasH === 0) return;

        const MIN_ZOOM = 1.0;
        const MAX_ZOOM = 3.0;

        this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoom));

        const maxX = Math.max(0, this._canvasW * this._zoom - this._canvasW);
        const maxY = Math.max(0, this._canvasH * this._zoom - this._canvasH);

        this._cameraX = Math.min(0, Math.max(-maxX, this._cameraX));
        this._cameraY = Math.min(0, Math.max(-maxY, this._cameraY));

        return { maxX, maxY, MIN_ZOOM, MAX_ZOOM };
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
        const x = 300 + (Math.abs(hash) % 4400);
        const y = 300 + (Math.abs(hash2) % 4400);

        return { x, y };
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

    isOnline(player) {
        if (this._onlinePlayerIds && this._onlinePlayerIds.includes(player.user_id)) return true;
        if (!player.last_seen) return false;
        return Date.now() - new Date(player.last_seen).getTime() < 5 * 60 * 1000;
    },

    showPlayerTooltip(userId, event) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;

        const isOnline = this.isOnline(player);
        const lastSeenText = player.last_seen ? this._formatLastSeen(player.last_seen) : 'НЕИЗВЕСТНО';
        const color = this._getPlayerColor(userId);
        const colorStr = `hsl(${color.hue}, ${color.sat}%, ${color.light}%)`;

        this.showTooltip(`
            <div style="font-weight:bold;color:${colorStr};">${player.username.toUpperCase()}</div>
            <div style="font-size:11px;color:#ddd;margin-top:4px;">НЕЙРО: ${player.neuro_evolution||0} | ДОБЫЧА: ${(player.total_mined||0).toLocaleString()}</div>
            <div style="font-size:11px;color:${isOnline ? '#4aff9d' : '#888'};">${isOnline ? '🟢 В СЕТИ' : `⚫ НЕ В СЕТИ (${lastSeenText})`}</div>
        `, event.clientX, event.clientY);
    },

    _formatLastSeen(isoString) {
        if (!isoString) return 'ДАВНО';
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}М`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}Ч`;
        return `${Math.floor(hours / 24)}Д`;
    },

    _renderPlayerBase(ctx, scannerY) {
        const myPos = this._getMyPlanetPosition();
        const screen = this._worldToScreen(myPos.x, myPos.y);
        const color = this._getEntityColor(this.currentUser?.id || 'player_base');
        const size = 2.0 * this._zoom;  // ✅ База чуть крупнее
        const time = Date.now();
        this._drawTechSphere(ctx, screen.x, screen.y, size, color, time, { isActive: true, scannerY });
    },

    _drawStations(ctx, scannerY) {
        const time = Date.now();
        const now = Date.now();

        this.neutralStations.forEach(station => {
            const isOnCooldown = station.cooldown_until > now;
            const color = this._getEntityColor(station.id);
            const size = (isOnCooldown ? 1.0 : 1.6) * this._zoom;
            const screen = this._worldToScreen(station.x, station.y);
            if (screen.x < -50 || screen.x > this._canvasW + 50 || screen.y < -50 || screen.y > this._canvasH + 50) return;

            this._drawTechSphere(ctx, screen.x, screen.y, size, color, time, { isActive: !isOnCooldown, scannerY });
        });
    },

    showStationInfo(station) {
        const now = Date.now();
        const isOnCooldown = station.cooldown_until > now;
        const stationColor = this._getEntityColor(station.id);
        const colorStr = `hsl(${stationColor.hue}, ${stationColor.sat}%, ${stationColor.light}%)`;

        let bonusText = '';
        switch(station.bonus_type) {
            case 'mining_boost': bonusText = 'ДОБЫЧА+50%'; break;
            case 'defense_boost': bonusText = 'ЗАЩИТА+2N'; break;
            case 'power_boost': bonusText = 'ЭНЕРГИЯ+50'; break;
            default: bonusText = 'РЕДКИЙ';
        }

        const remaining = station.cooldown_until - now;
        const cooldownDisplay = remaining < 60000
            ? `${Math.ceil(remaining / 1000)}С`
            : `${Math.ceil(remaining / 60000)}М`;

        const popup = this._showPopup(`
            <div style="font-size:13px;color:${colorStr};text-align:center;margin-bottom:8px;font-weight:bold;">🛸 ${station.name.toUpperCase()}</div>
            <div style="font-size:12px;margin-bottom:10px;color:#d0d0d0;line-height:1.6;">
                <div>💎 БОНУС: ${bonusText}</div>
                <div>♻️ ЦЕНА: ${station.cost_trash} МУСОРА</div>
                ${isOnCooldown ? `<div>⏳ ПЕРЕЗАРЯДКА: ${cooldownDisplay}</div>` : '<div>✅ СТАТУС: АКТИВНА</div>'}
            </div>
            ${!isOnCooldown ? `<button id="station-btn-trade" style="width:100%;padding:8px;background:rgba(74,255,157,0.1);border:1px solid ${colorStr};color:${colorStr};border-radius:4px;cursor:pointer;margin-bottom:6px;font-size:12px;">🚀 ОТПРАВИТЬ КОРАБЛЬ</button>` : ''}
            <button id="station-btn-close" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #555;color:#aaa;border-radius:4px;cursor:pointer;font-size:12px;">ЗАКРЫТЬ</button>
        `, {
            borderColor: colorStr,
            minWidth: 220,
            className: 'station-popup'
        });

        popup.querySelector('#station-btn-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeCurrentPopup();
        });

        if (!isOnCooldown) {
            popup.querySelector('#station-btn-trade')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.tradeWithStation(station);
                this._closeCurrentPopup();
            });
        }
    },

    async showPlayerInfo(userId) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;

        const { getLatestScoutData, sendShip } = await import('./multiplayer_combat.js');

        const scout = await getLatestScoutData(this.currentUser.id, player.user_id);
        let scoutAge = null;
        let scoutFresh = false;

        if (scout?.created_at) {
            const createdTime = new Date(scout.created_at).getTime();
            if (!isNaN(createdTime)) {
                scoutAge = Math.floor((Date.now() - createdTime) / 60000);
                scoutFresh = scoutAge >= 0 && scoutAge < 30;
            }
        }

        const isOnline = this.isOnline(player);
        const repScore = player.reputation_score || 0;
        const repSign = repScore >= 0 ? '+' : '';
        const playerColor = this._getPlayerColor(userId);
        const colorStr = `hsl(${playerColor.hue}, ${playerColor.sat}%, ${playerColor.light}%)`;

        let lastCombat = window.fleetModule?._lastCombatResult;
        if (!lastCombat) {
            try {
                const saved = localStorage.getItem('corebox_last_combat_result');
                if (saved) {
                    lastCombat = JSON.parse(saved);
                }
            } catch(e) {}
        }

        const canSendCargo = lastCombat?.won &&
            lastCombat?.targetUserId === player.user_id &&
            (Date.now() - (lastCombat.timestamp || 0)) < 30 * 60 * 1000;

        const sd = scout?.scout_data || {};

        const popup = this._showPopup(`
            <div style="font-size:14px;color:${colorStr};text-align:center;margin-bottom:8px;font-weight:bold;">[ ${player.username.toUpperCase()} ]</div>
            <div style="font-size:13px;margin-bottom:10px;color:#d0d0d0;line-height:1.6;">
                <div>🧠 НЕЙРО: УР${player.neuro_evolution||0} | ⛏️ ДОБЫЧА: ${(player.total_mined||0).toLocaleString()}</div>
                <div>🌙 НОЧЕЙ: ${player.nights_survived||0} | ⚡ ЭНЕРГИЯ: ${(player.computational_power||0).toLocaleString()}</div>
                <div>⭐ РЕП: ${repSign}${repScore} | ${isOnline ? '🟢 В СЕТИ' : '⚫ НЕ В СЕТИ'}</div>
            </div>
            ${scoutFresh ? `
                <div style="background:rgba(0,170,136,0.08);border:1px solid rgba(0,170,136,0.2);padding:8px;margin-bottom:10px;border-radius:4px;font-size:12px;color:#d0d0d0;">
                    <div style="color:#4aff9d;">📡 РАЗВЕДДАННЫЕ (${scoutAge}МИН)</div>
                    <div>⛏️ РУДА:${sd.ore??'?'} 🪨 УГОЛЬ:${sd.coal??'?'} 💾 ЧИПЫ:${sd.chips??'?'} ⚡ ПЛАЗМА:${sd.plasma??'?'}</div>
                    <div>🛡️ ЗАЩИТА:${sd.has_defense?'ВКЛ':'ВЫКЛ'} ${sd._obscured ? '🔒 СКРЫТЫ' : ''}</div>
                </div>
            ` : `<div style="background:rgba(100,100,100,0.05);padding:6px;margin-bottom:10px;border-radius:4px;font-size:12px;text-align:center;color:#888;">🔭 НЕТ РАЗВЕДДАННЫХ</div>`}
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
                <button id="space-btn-scout" style="padding:8px;background:rgba(74,170,255,0.1);border:1px solid #4a9eff;color:#4a9eff;border-radius:4px;cursor:pointer;font-size:12px;">🔭 РАЗВЕДКА</button>
                <button id="space-btn-combat" style="padding:8px;background:rgba(255,74,74,0.1);border:1px solid #ff4444;color:#ff4444;border-radius:4px;cursor:pointer;font-size:12px;${!scoutFresh ? 'opacity:0.4;cursor:not-allowed;' : ''}" ${!scoutFresh ? 'disabled' : ''}>⚔️ АТАКА</button>
                <button id="space-btn-cargo" style="padding:8px;background:rgba(255,170,0,0.1);border:1px solid #fa0;color:#fa0;border-radius:4px;cursor:pointer;font-size:12px;${!canSendCargo ? 'opacity:0.4;cursor:not-allowed;' : ''}" ${!canSendCargo ? 'disabled' : ''}>📦 ГРУЗ</button>
            </div>
            <button id="space-btn-close" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #555;color:#aaa;border-radius:4px;cursor:pointer;font-size:12px;">ЗАКРЫТЬ</button>
        `, {
            borderColor: isOnline ? '#4aff9d' : '#666',
            minWidth: 260,
            className: 'player-popup'
        });

        const doSend = async (shipType) => {
            if (shipType !== 'scout' && !scoutFresh) return;
            if (shipType === 'cargo' && !canSendCargo) return;

            const btn = popup.querySelector(`#space-btn-${shipType}`);
            if (btn) {
                btn.innerHTML = '⏳ ОТПРАВКА...';
                btn.disabled = true;
            }

            const result = await sendShip(this.currentUser.id, player.user_id, shipType);
            this._closeCurrentPopup();

            if (window.showNotif) {
                window.showNotif(
                    result.success ? `🚀 КОРАБЛЬ ОТПРАВЛЕН К ${player.username}` : `❌ ОШИБКА: ${result.error}`,
                    !result.success
                );
            }

            if (result.success && shipType !== 'scout') {
                await this.updateReputation(player.user_id, (player.reputation_score || 0) - 2);
            }
        };

        popup.querySelector('#space-btn-scout').onclick = () => doSend('scout');
        popup.querySelector('#space-btn-combat').onclick = () => doSend('combat');
        popup.querySelector('#space-btn-cargo').onclick = () => doSend('cargo');
        popup.querySelector('#space-btn-close').onclick = () => this._closeCurrentPopup();
    },

    async updateReputation(userId, newScore) {
        if (isNaN(newScore) || !this.currentUser) return;

        const clampedScore = Math.max(-5, Math.min(5, newScore));

        try {
            const { error } = await supabase
                .from('player_reputation')
                .upsert({
                    user_id: this.currentUser.id,
                    target_id: userId,
                    score: clampedScore,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id,target_id',
                    ignoreDuplicates: false
                });

            if (error) {
                const { data: existing } = await supabase
                    .from('player_reputation')
                    .select('id')
                    .eq('user_id', this.currentUser.id)
                    .eq('target_id', userId)
                    .maybeSingle();

                if (existing) {
                    await supabase
                        .from('player_reputation')
                        .update({
                            score: clampedScore,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', existing.id);
                } else {
                    await supabase
                        .from('player_reputation')
                        .insert({
                            user_id: this.currentUser.id,
                            target_id: userId,
                            score: clampedScore,
                            updated_at: new Date().toISOString()
                        });
                }
            }

            const player = this.otherPlayers.find(p => p.user_id === userId);
            if (player) player.reputation_score = clampedScore;
        } catch(e) {
            console.warn('REP UPDATE ERROR:', e);
        }
    },

    updateStatusBar(stats) {
        if (!stats && this.game) {
            try { stats = JSON.parse(this.game.get_statistics()); } catch(e) {}
        }
        if (!stats) return;

        const power   = this.game?.get_computational_power?.() ?? stats.computational_power ?? 0;
        const maxPwr  = this.game?.get_max_computational_power?.() ?? 1000;

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
        if (el('space-ships-count'))   el('space-ships-count').textContent = ships.length;

        const activeShips = window.fleetModule?.ships?.filter(s => s.onMission) || [];
        const flightStatusEl = document.getElementById('space-flight-status');

        if (flightStatusEl) {
            if (activeShips.length === 0) {
                flightStatusEl.textContent = "🚀 Нет активных полетов";
                flightStatusEl.style.cursor = "default";
                flightStatusEl.onclick = null;
            } else {
                flightStatusEl.textContent = `🚀 Активных полетов: ${activeShips.length} (нажми для деталей)`;
                flightStatusEl.style.cursor = "pointer";
                flightStatusEl.style.textDecoration = "underline";
                flightStatusEl.onclick = () => {
                    this.showActiveFlightsPopup(activeShips);
                };
            }
        }

        const btn = document.getElementById('space-research-btn');
        if (btn) {
            const canResearch = power >= 100 && !this.isResearching && this.planets.length < 3;
            btn.style.opacity = canResearch ? '1' : '0.5';
            btn.style.color   = canResearch ? '#0a8' : '#666';
            btn.style.cursor  = canResearch ? 'pointer' : 'not-allowed';
            btn.style.border = canResearch ? '1px solid #0a8' : '1px solid #333';
            btn.title = canResearch
                ? 'ИССЛЕДОВАТЬ НОВУЮ ПЛАНЕТУ'
                : power < 100
                    ? `НУЖНО 100 ЭНЕРГИИ (${power})`
                    : this.planets.length >= 3
                        ? 'МАКСИМУМ 3 ПЛАНЕТЫ'
                        : 'ИССЛЕДОВАНИЕ...';
        }

        const myPos = this._getMyPlanetPosition();
        const coordEl = document.getElementById('space-coordinates');
        if (coordEl) {
            const zoomPercent = Math.round(this._zoom * 100);
            const hint = this._zoom < 1.3 ? ' • используйте зум для выбора' : '';
            coordEl.innerHTML = `🗺️ 5000×5000 📍 ${Math.round(myPos.x)} ${Math.round(myPos.y)} 🔍 ${zoomPercent}%${hint}`;
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

    onTabActivated() {
        if (!this.initialized) return;
        this.isTabActive = true;

        if (!this._mapCenteredOnce) {
            setTimeout(() => {
                this._centerOnPlayer();
                this._mapCenteredOnce = true;
            }, 100);
        }

        this.loadPlanetsFromRust();
        this.updateStatusBar();
        this.syncFromGame();
        this._reconnectMultiplayer();
        this._startRenderLoop();

        if (this.currentUser) {
            setTimeout(() => {
                console.log('🔄 Загрузка игроков при активации вкладки...');
                this._fetchAllPlayersFallback().then(() => {
                    console.log(`✅ Игроков загружено: ${this.otherPlayers.length}`);
                    this.renderPlayers();
                    this._markDirty();
                }).catch(e => {
                    console.warn('Ошибка загрузки игроков:', e);
                });
            }, 150);
        }

        this._needsPlayerReload = false;

        const researchBtn = document.getElementById('space-research-btn');
        if (researchBtn && !researchBtn._handlerSet) {
            researchBtn._handlerSet = true;
            researchBtn.onclick = () => this.startResearch();
        }

        this._markDirty();
    },

    onTabDeactivated() {
        this.isTabActive = false;
        this._closeCurrentPopup();

        const intervalsToClear = [
            '_flightLineInterval',
            '_missionCheckInterval',
            '_missionTimerInterval',
            '_incomingMissionInterval'
        ];

        intervalsToClear.forEach(key => {
            if (this[key]) {
                clearInterval(this[key]);
                this[key] = null;
            }
        });

        const timeoutsToClear = [
            '_adaptiveLoadTimeout',
            '_fleetReadyTimeout',
            '_flightLineDebounce',
            '_tooltipTimeout'
        ];

        timeoutsToClear.forEach(key => {
            if (this[key]) {
                clearTimeout(this[key]);
                this[key] = null;
            }
        });

        if (this._multiplayerChannel) {
            this._multiplayerChannel.unsubscribe();
            this._multiplayerChannel = null;
        }

        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }

        if (this._flightPopupInterval) {
            clearInterval(this._flightPopupInterval);
            this._flightPopupInterval = null;
        }
    },

    _initCanvas() {
        const starMap = document.getElementById('space-star-map');
        const canvas = document.getElementById('space-main-canvas');
        if (!canvas || !starMap) return;

        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');

        this._staticCanvas = document.createElement('canvas');
        this._staticCtx = this._staticCanvas.getContext('2d');
        this._staticDirty = true;

        this._resizeCanvas();

        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
            this._resizeObserver.observe(starMap);
        }

        canvas.style.pointerEvents = 'none';

        starMap.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            this._handleCanvasClick(e);
        }, true);

        starMap.addEventListener('mousemove', (e) => {
            if (e.target.closest('button')) {
                this.hideTooltip();
                return;
            }
            this._handleCanvasHover(e);
        });

        starMap.addEventListener('mouseleave', () => this.hideTooltip());
    },

    _startRenderLoop() {
        if (this._animFrameId) return;

        const loop = () => {
            if (!this.isTabActive) {
                this._animFrameId = null;
                return;
            }
            this._animationTime = Date.now();
            this._renderFrame();
            this._renderDirty = false;
            this._animFrameId = requestAnimationFrame(loop);
        };

        this._animFrameId = requestAnimationFrame(loop);
    },

    _renderFrame() {
        if (!this._ctx || !this._canvasW) return;
        const ctx = this._ctx;

        ctx.clearRect(0, 0, this._canvasW, this._canvasH);

        if (this._staticDirty) {
            this._renderStaticLayer();
            this._staticDirty = false;
        }

        if (this._staticCanvas) {
            ctx.drawImage(this._staticCanvas, 0, 0);
        }

        this._renderAnimatedLayer();
    },

    _renderStaticLayer() {
        const ctx = this._staticCtx;
        if (!ctx || !this._staticCanvas) return;

        ctx.clearRect(0, 0, this._staticCanvas.width, this._staticCanvas.height);
        this._drawGrid(ctx);
        this._drawInfluenceZone(ctx);
    },

    _renderAnimatedLayer() {
        const ctx = this._ctx;
        const time = Date.now();
        const progress = (time % this.scannerCycleDuration) / this.scannerCycleDuration;
        const scannerY = progress * this._canvasH;

        this._drawScannerLine(ctx, scannerY);
        this._drawFlightLines(ctx);
        this._drawPlanets(ctx, scannerY);
        this._drawStations(ctx, scannerY);
        this._drawPlayers(ctx, scannerY);
        this._renderPlayerBase(ctx, scannerY);
    },

    _markDirty() {
        this._renderDirty = true;
        this._staticDirty = true;
    },

    setupMultiplayer() {
        const adaptiveLoad = () => {
            if (!this.isTabActive) {
                this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, 30000);
                return;
            }
            this.loadMultiplayerPlayers().then(() => {
                const hasOnline = this.otherPlayers.some(p => this.isOnline(p));
                this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, hasOnline ? 15000 : 60000);
            });
        };
        this._adaptiveLoadTimeout = setTimeout(adaptiveLoad, 5000);

        this._needsPlayerReload = true;

        if (this._incomingMissionInterval) clearInterval(this._incomingMissionInterval);
        this._incomingMissionInterval = setInterval(() => this._refreshIncomingMissions(), 5000);

        if (this._missionTimerInterval) clearInterval(this._missionTimerInterval);
        this._missionTimerInterval = setInterval(() => this.updateMissionTimers(), 1000);

        const checkReady = () => {
            if (!this.isTabActive && !this.currentUser) return;
            if (window.fleetModule && !window.fleetModule.isInitializing) {
                this._restorePlanetMissions();
                this._fleetReadyTimeout = null;
            } else {
                this._fleetReadyTimeout = setTimeout(checkReady, 500);
            }
        };
        this._fleetReadyTimeout = setTimeout(checkReady, 500);
    },

    _reconnectMultiplayer() {
        if (!this.currentUser) return;
        if (this._multiplayerChannel) {
            supabase.removeChannel(this._multiplayerChannel);
            this._multiplayerChannel = null;
        }

        const shardKey = this.currentUser.id.charAt(0);
        this._multiplayerChannel = supabase.channel('space_presence_global_v2');

        this._multiplayerChannel
            .on('presence', { event: 'sync' }, () => {
                const state = this._multiplayerChannel.presenceState();
                const presences = Object.values(state).flat();
                this._onlinePlayerIds = presences.map(p => p.user_id).filter(Boolean);
                // ✅ Обновляем позиции игроков из presence
                presences.forEach(p => {
                    if (p.user_id && p.map_x != null && p.map_y != null) {
                        this._playerPositions[p.user_id] = { x: p.map_x, y: p.map_y };
                    }
                });
                this.renderPlayers();
                this._markDirty();
            })
            .on('presence', { event: 'join' }, ({ newPresences }) => {
                console.log(`🟢 Игроки вошли: ${newPresences.length}`);
                // ✅ Обновляем позиции вошедших игроков
                newPresences.forEach(p => {
                    if (p.user_id && p.map_x != null && p.map_y != null) {
                        this._playerPositions[p.user_id] = { x: p.map_x, y: p.map_y };
                    }
                });
                this.renderPlayers();
                this._markDirty();
            })
            .on('presence', { event: 'leave' }, ({ leftPresences }) => {
                console.log(`🔴 Игроки вышли: ${leftPresences.length}`);
                this.renderPlayers();
                this._markDirty();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    const myPos = this._getMyPlanetPosition();
                    await this._multiplayerChannel.track({
                        user_id: this.currentUser.id,
                        online_at: new Date().toISOString(),
                        username: this.currentUser.user_metadata?.username || 'ИГРОК',
                        map_x: myPos?.x || 2500,
                        map_y: myPos?.y || 2500
                    });
                    console.log('✅ Multiplayer Presence подписан');
                }
            });
    },

    async _forceLoadPlayers() {
        if (!this.currentUser || !this.isTabActive) {
            this._needsPlayerReload = !this.isTabActive;
            return;
        }
        try {
            await this._fetchAndApplyPlayers();
        } catch(e) {
            console.warn('PLAYER LOAD ERROR:', e);
        }
    },

    async loadMultiplayerPlayers() {
        if (!this.currentUser) return;
        if (!this.isTabActive) return;

        try {
            await this._fetchAndApplyPlayers();
        } catch(e) {
            console.warn('PLAYER LOAD ERROR:', e);
        }
    },

    async _refreshIncomingMissions() {
        if (!this.currentUser) return;
        try {
            const { getActiveMissions } = await import('./multiplayer_combat.js');
            const all = await getActiveMissions(this.currentUser.id);
            const newIncoming = (all || []).filter(m =>
                m.target_id === this.currentUser.id &&
                m.status === 'flying' &&
                m.ship_type !== 'scout'
            );
            
            // ✅ Логируем НОВЫХ вражеских кораблей в журнал флота
            const oldIds = new Set((this._cachedIncomingMissions || []).map(m => m.id));
            for (const m of newIncoming) {
                if (!oldIds.has(m.id)) {
                    const icons = { scout: '🔭', combat: '⚔️', cargo: '📦' };
                    const icon = icons[m.ship_type] || '🚀';
                    const typeNames = { scout: 'Разведчик', combat: 'Боевой', cargo: 'Грузовой' };
                    const typeName = typeNames[m.ship_type] || m.ship_type;
                    window.fleetModule?._addFleetLog?.(
                        `⚠️ ВРАЖЕСКИЙ ${icon} ${typeName} летит к базе!`
                    );
                }
            }
            
            this._cachedIncomingMissions = newIncoming;
        } catch(e) {
            console.warn('REFRESH INCOMING MISSIONS ERROR:', e);
        }
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
                const activeIds = new Set(missions.map(m => m.id));

                this._processingMissions.forEach(id => {
                    if (!activeIds.has(id)) this._processingMissions.delete(id);
                });

                for (const mission of missions) {
                    const remaining = mission.remaining_ms;

                    if (remaining <= 0 && mission.status === 'flying' && !this._processingMissions.has(mission.id)) {
                        this._processingMissions.add(mission.id);

                        try {
                            if (typeof this.game.complete_planet_mission === 'function') {
                                const resultJson = this.game.complete_planet_mission(mission.id);
                                const result = JSON.parse(resultJson);

                                if (result.resources) {
                                    const gained = Object.entries(result.resources)
                                        .filter(([,v]) => v > 0)
                                        .map(([k,v]) => `+${v} ${this._getResourceName(k)}`)
                                        .join(', ');
                                    if (gained) {
                                        window.addToLog?.(`МИССИЯ ЗАВЕРШЕНА: ${gained}`, 'success');
                                        window.showNotif?.(`+${gained}`, false);
                                    }
                                }
                            }
                        } catch(e) {
                            console.warn('MISSION COMPLETE ERROR:', e);
                        }

                        if (window.fleetModule) {
                            const ship = window.fleetModule.ships.find(s => s.id === mission.ship_id);
                            if (ship && ship.onMission) {
                                ship.onMission = false;
                                ship.currentMissionId = null;
                                ship.targetPlanetId = null;
                                ship.missionReturnsAt = null;
                                ship.missionArrivesAt = null;
                                ship.missionStartedAt = null;
                                needsFleetSave = true;
                                needsRefresh = true;
                            }
                        }

                        this.loadPlanetsFromRust();

                        if (window._refreshFleetWithMissions) {
                            window._refreshFleetWithMissions();
                        }

                        this._markDirty();
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
                console.warn('MISSION CHECK ERROR:', e);
            }
        }, 2000);
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
                    ship.missionReturnsAt = normalizeTimestamp(mission.returns_at);
                    ship.missionArrivesAt = normalizeTimestamp(mission.arrives_at);
                    ship.shipType = mission.ship_type || 'cargo';
                    restored++;
                }
            });

            if (restored > 0) {
                window.fleetModule.saveFleet();
                window.fleetModule._renderFleetTab?.();
                console.log(`ВОССТАНОВЛЕНО МИССИЙ: ${restored}`);
            }
        } catch(e) {
            console.warn('MISSION RESTORE ERROR:', e);
        }
    },

    updateMissionTimers() {
        if (!this.game) return;
        try {
            const missionsJson = this.game.get_active_planet_missions();
            const missions = JSON.parse(missionsJson);

            const now = Date.now();

            let changed = false;
            const activeIds = new Set(missions.map(m => m.id));
            for (const id of this._warningedMissionIds) {
                if (!activeIds.has(id)) this._warningedMissionIds.delete(id);
            }

            for (const mission of missions) {
                if (mission.remaining_ms <= 30000 && mission.remaining_ms > 0 && mission.status === 'flying') {
                    if (!this._warningedMissionIds.has(mission.id)) {
                        this._warningedMissionIds.add(mission.id);
                        changed = true;
                        const ship = window.fleetModule?.ships.find(s => s.id === mission.ship_id);
                        if (ship) {
                            window.showNotif?.(`КОРАБЛЬ ВОЗВРАЩАЕТСЯ ЧЕРЕЗ ${Math.floor(mission.remaining_ms / 1000)}С`, false);
                        }
                    }
                }
            }

            if (changed) this._markDirty();
        } catch(e) {
            console.warn('TIMER ERROR:', e);
        }
    },

    _getResourceName(key) {
        const names = {
            'coal': '🪨 УГОЛЬ',
            'ore': '⛏️ РУДА',
            'plasma': '⚡ ПЛАЗМА',
            'chips': '💾 ЧИПЫ',
            'trash': '♻️ МУСОР'
        };
        return names[key] || key;
    },

    destroy() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }

        if (this._ctx && this._canvas) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
        if (this._staticCtx && this._staticCanvas) {
            this._staticCtx.clearRect(0, 0, this._staticCanvas.width, this._staticCanvas.height);
            this._staticCanvas.width = 0;
            this._staticCanvas.height = 0;
            this._staticCanvas = null;
            this._staticCtx = null;
        }

        this._canvas = null;
        this._ctx = null;
        this._canvasW = 0;
        this._canvasH = 0;

        this._cachedIncomingMissions = [];
        this._onlinePlayerIds = [];
        this._prevOnlineIds = [];
        this._playerPositions = {};
        this._processingMissions.clear();
        this._scannerGradientCache = null;
        this._profileCache = {};

        if (this._tooltipElement) {
            this._tooltipElement.remove();
            this._tooltipElement = null;
        }

        if (this._tooltipTimeout) {
            clearTimeout(this._tooltipTimeout);
            this._tooltipTimeout = null;
        }

        if (this._starsCanvas) {
            this._starsCanvas.remove();
            this._starsCanvas = null;
        }
        if (this._starsResizeObserver) {
            this._starsResizeObserver.disconnect();
            this._starsResizeObserver = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._resizeStars) {
            this._resizeStars = null;
        }

        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        if (this.planetsChannel) supabase.removeChannel(this.planetsChannel);
        if (this._multiplayerChannel) {
            supabase.removeChannel(this._multiplayerChannel);
            this._multiplayerChannel = null;
        }
        if (this._presenceChannel) {
            this._presenceChannel.unsubscribe();
            this._presenceChannel = null;
        }
        if (this._currentPopup) {
            this._closeCurrentPopup();
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
        if (this._incomingMissionInterval) {
            clearInterval(this._incomingMissionInterval);
            this._incomingMissionInterval = null;
        }
        if (this._mouseMoveHandler) {
            window.removeEventListener('mousemove', this._mouseMoveHandler);
            this._mouseMoveHandler = null;
        }
        if (this._mouseUpHandler) {
            window.removeEventListener('mouseup', this._mouseUpHandler);
            this._mouseUpHandler = null;
        }
        if (this._flightPopupInterval) {
            clearInterval(this._flightPopupInterval);
            this._flightPopupInterval = null;
        }
        this._gameBusUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this._gameBusUnsubscribers = [];
        this.initialized = false;
    }
};

export default spaceModule;

if (typeof window !== 'undefined') {
    window.spaceModule = new Proxy(spaceModule, {
        get(target, prop) {
            if (prop === 'setShipMissionStatusFromRust' || prop === 'loadPlanetsFromRust') {
                if (typeof target[prop] === 'function') {
                    return target[prop].bind(target);
                }
            }
            return target[prop];
        }
    });
}