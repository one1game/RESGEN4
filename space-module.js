// ========== space-module.js (ИСПРАВЛЕНА - БАГИ #3, #4, #5, #7) ==========

import { supabase } from './supabase.js';

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
    _flightLineInterval: null, // БАГ #7: интервал для анимации линий

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

        // ========== БАГ #4: зафиксировать позицию текущего игрока ==========
        if (user?.id) {
            this._playerPositions[user.id] = { x: 50, y: 50 };
        }

        this.loadPlanets().then(() => this.renderPlanets());
        this.generateStars();
        this.setupMultiplayer();
        this.initialized = true;

        console.log('🌌 Space module инициализирован');
    },

    onTabActivated() {
        if (!this.initialized) return;
        this.isTabActive = true;
        this.syncFromGame();
        this.renderPlanets();
        this.renderPlayers();
        this.renderFlightLines();  // ЛИНИИ ПОЛЁТА
        this.updateStatusBar();
        window.dispatchEvent(new CustomEvent('updateLastSeen'));
    },

    onTabDeactivated() {
        this.isTabActive = false;
        // БАГ #7: очищаем интервал анимации при уходе с вкладки
        if (this._flightLineInterval) {
            clearInterval(this._flightLineInterval);
            this._flightLineInterval = null;
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
            const fleetKey = this.currentUser?.id 
                ? `corebox_fleet_${this.currentUser.id}` 
                : 'corebox_fleet';
            ships = JSON.parse(localStorage.getItem(fleetKey) ?? '[]');
        } catch(e) {}

        const el = id => document.getElementById(id);
        if (el('space-power-current')) el('space-power-current').textContent = power;
        if (el('space-power-max'))     el('space-power-max').textContent = maxPwr;
        if (el('space-day-status'))    el('space-day-status').textContent = isDay ? '☀️ ДЕНЬ' : '🌙 НОЧЬ';
        if (el('space-neuro-level'))   el('space-neuro-level').textContent = neuro;
        if (el('space-ships-count'))   el('space-ships-count').textContent = ships.length;

        const btn = document.getElementById('space-research-btn');
        if (btn) {
            btn.style.opacity = power >= 100 ? '1' : '0.5';
            btn.style.color   = power >= 100 ? '#4aff9d' : '#ff6a6a';
        }
    },

    // ========== СИСТЕМА ПЛАНЕТ ==========
    
    async loadPlanets() {
        try {
            const { data, error } = await supabase
                .from('planets')
                .select('*')
                .order('discovered_at', { ascending: true });
            if (error) throw error;
            this.planets = data || [];
            console.log(`🌍 Загружено ${this.planets.length} планет из БД`);
        } catch(e) {
            console.warn('Ошибка загрузки планет:', e);
            this.planets = [];
        }
    },

    savePlanets() {
        // Планеты теперь в Supabase, localStorage не используем
    },

    async startResearch() {
        if (this.isResearching) return;

        await this.loadPlanets();

        if (this.planets.length >= 3) {
            window.showNotif?.('🌌 Уже исследовано максимум 3 планеты. Отправьте корабль — вывезите ресурсы!', true);
            return;
        }

        const power = this.game?.get_computational_power?.() ?? 0;
        if (power < 100) {
            window.showNotif?.('Недостаточно мощности (нужно 100⚡)', true);
            return;
        }

        this.game.subtract_power(100);
        this.isResearching = true;
        const btn = document.getElementById('space-research-btn');
        if (btn) { btn.textContent = '⏳ ИССЛЕДОВАНИЕ...'; btn.disabled = true; }

        setTimeout(async () => {
            await this.addPlanet();
            this.isResearching = false;
            if (btn) {
                btn.textContent = '🔍 ИССЛЕДОВАТЬ ПЛАНЕТУ (нужно 100⚡)';
                btn.disabled = false;
            }
            this.updateStatusBar();
        }, 1500);
    },

    async addPlanet() {
        if (this.planets.length >= 3) {
            window.showNotif?.('🌌 Карта заполнена (максимум 3 планеты)', true);
            return;
        }

        const types = Object.keys(this.PLANET_TYPES);
        const type  = types[Math.floor(Math.random() * types.length)];
        const cfg   = this.PLANET_TYPES[type];
        const name  = this.PLANET_NAMES[Math.floor(Math.random() * this.PLANET_NAMES.length)];

        const angle = Math.random() * Math.PI * 2;
        const r     = 15 + Math.random() * 25;
        const x     = 50 + Math.cos(angle) * r;
        const y     = 50 + Math.sin(angle) * r;

        const totalResources = 300 + Math.floor(Math.random() * 300);
        const coalPart   = Math.floor(Math.random() * totalResources * 0.5);
        const plasmaPart = Math.floor(Math.random() * (totalResources - coalPart) * 0.6);
        const orePart    = totalResources - coalPart - plasmaPart;

        const resources = { coal: coalPart, plasma: plasmaPart, ore: orePart };

        try {
            const { data, error } = await supabase
                .from('planets')
                .insert({
                    name, type, x, y,
                    discovered_by: this.currentUser.id,
                    resources: { ...resources },
                    resources_remaining: { ...resources }
                })
                .select()
                .single();

            if (error) throw error;

            this.planets.push(data);
            this.renderPlanets();
            window.showNotif?.(`🪐 Открыта планета ${name} (${cfg.name})! Ресурсы: 🪨${coalPart} ⚡${plasmaPart} ⛏️${orePart}`, false);
        } catch(e) {
            console.error('Ошибка сохранения планеты:', e);
            window.showNotif?.('❌ Ошибка исследования', true);
        }
    },

    renderPlanets() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.space-planet').forEach(el => el.remove());

        this.planets.forEach(planet => {
            const cfg = this.PLANET_TYPES[planet.type] ?? this.PLANET_TYPES['earth'];
            const el = document.createElement('div');
            el.className = 'space-planet';
            el.style.cssText = `
                position:absolute;left:${planet.x}%;top:${planet.y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:5;
            `;
            el.innerHTML = `
                <span style="font-size:22px;">${cfg.icon}</span>
                <div style="font-size:9px;color:${cfg.color};margin-top:2px;">${planet.name}</div>
            `;
            el.onclick = () => this.showPlanetInfo(planet);
            layer.appendChild(el);
        });
    },

    showPlanetInfo(planet) {
        const cfg = this.PLANET_TYPES[planet.type] ?? {};
        const rem = planet.resources_remaining || planet.resources || {};
        const totalRem = (rem.coal||0) + (rem.plasma||0) + (rem.ore||0);

        if (this._currentPopup) { this._currentPopup.remove(); this._currentPopup = null; }

        const popup = document.createElement('div');
        popup.className = 'player-popup';
        popup.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#0a0a0a;border:2px solid ${cfg.color || '#4aff9d'};
            border-radius:16px;padding:20px;z-index:10001;
            font-family:monospace;min-width:280px;max-width:90vw;
            box-shadow:0 0 30px rgba(74,255,157,0.2);
        `;
        popup.innerHTML = `
            <div style="font-size:28px;text-align:center;">${cfg.icon || '🪐'}</div>
            <div style="font-size:16px;font-weight:bold;color:${cfg.color};text-align:center;margin-bottom:8px;">
                ${this.escapeHtml(planet.name)} — ${cfg.name || planet.type}
            </div>
            <div style="font-size:11px;margin-bottom:12px;background:rgba(255,255,255,0.05);padding:8px;border-radius:8px;">
                <div>🪨 Уголь: <b>${rem.coal||0}</b></div>
                <div>⚡ Плазма: <b>${rem.plasma||0}</b></div>
                <div>⛏️ Руда: <b>${rem.ore||0}</b></div>
                ${totalRem === 0 ? '<div style="color:#f88;margin-top:4px;">⚠️ Ресурсы исчерпаны</div>' : ''}
            </div>
            <button id="planet-btn-cargo" style="width:100%;padding:10px;background:rgba(255,170,0,0.15);
                border:1px solid rgba(255,170,0,0.4);border-radius:8px;color:#ffaa44;
                font-family:monospace;font-size:12px;cursor:pointer;margin-bottom:8px;
                ${totalRem === 0 ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                ${totalRem === 0 ? 'disabled' : ''}>
                📦 ОТПРАВИТЬ ГРУЗОВОЙ КОРАБЛЬ (100 ед.)
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
            if (totalRem === 0) return;
            await this.sendShipToPlanet(planet, 'cargo');
            popup.remove(); this._currentPopup = null;
        };
        popup.querySelector('#planet-btn-close').onclick = (e) => {
            e.stopPropagation(); popup.remove(); this._currentPopup = null;
        };

        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) { popup.remove(); this._currentPopup = null; document.removeEventListener('click', closeOnOutside); }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
    },

    async sendShipToPlanet(planet, shipType) {
        let fleet = [];
        try {
            const fleetKey = this.currentUser?.id ? `corebox_fleet_${this.currentUser.id}` : 'corebox_fleet';
            fleet = JSON.parse(localStorage.getItem(fleetKey) || '[]');
        } catch(e) {}

        const availableShip = fleet.find(s => s.type === shipType && !s.onMission);
        if (!availableShip) {
            window.showNotif?.('❌ Нет свободного грузового корабля', true);
            return;
        }

        const cargoCapacity = 100;
        const travelTimeSec = 60 + Math.floor(Math.random() * 60);
        const now = new Date();
        const arrivesAt  = new Date(now.getTime() + travelTimeSec * 1000);
        const returnsAt  = new Date(arrivesAt.getTime() + travelTimeSec * 1000);

        try {
            const { data: mission, error } = await supabase
                .from('planet_missions')
                .insert({
                    planet_id: planet.id,
                    user_id: this.currentUser.id,
                    ship_type: shipType,
                    cargo_capacity: cargoCapacity,
                    arrives_at: arrivesAt.toISOString(),
                    returns_at: returnsAt.toISOString(),
                    status: 'flying'
                })
                .select()
                .single();

            if (error) throw error;

            availableShip.onMission = true;
            availableShip.missionId = mission.id;
            const fleetKey = this.currentUser?.id ? `corebox_fleet_${this.currentUser.id}` : 'corebox_fleet';
            localStorage.setItem(fleetKey, JSON.stringify(fleet));

            window.showNotif?.(`🚀 Грузовой корабль летит к ${planet.name}! Прибытие через ${travelTimeSec} сек.`, false);
            if (window.addToLog) window.addToLog(`📦 Грузовой отправлен к планете ${planet.name} (ёмкость: ${cargoCapacity})`);

            setTimeout(() => this._processPlanetMissionArrival(mission.id, planet, availableShip), travelTimeSec * 1000 + 500);

        } catch(e) {
            console.error('Ошибка отправки корабля к планете:', e);
            window.showNotif?.('❌ Ошибка отправки корабля', true);
        }
    },

    async _processPlanetMissionArrival(missionId, planet, ship) {
        try {
            const { data: loot, error } = await supabase.rpc('claim_planet_resources', {
                p_planet_id: planet.id,
                p_capacity: ship.cargoCapacity || 100
            });

            if (error) {
                console.error('RPC ошибка:', error);
                const { data: freshPlanet } = await supabase
                    .from('planets')
                    .select('resources_remaining')
                    .eq('id', planet.id)
                    .single();

                const rem = freshPlanet?.resources_remaining || { coal: 0, plasma: 0, ore: 0 };
                let capacity = ship.cargoCapacity || 100;
                let lootManual = {};
                
                for (const res of ['coal', 'plasma', 'ore']) {
                    if ((rem[res]||0) > 0 && capacity > 0) {
                        const take = Math.min(rem[res], capacity);
                        lootManual[res] = take;
                        capacity -= take;
                    }
                }

                const newRem = {
                    coal:   Math.max(0, (rem.coal||0)   - (lootManual.coal||0)),
                    plasma: Math.max(0, (rem.plasma||0) - (lootManual.plasma||0)),
                    ore:    Math.max(0, (rem.ore||0)    - (lootManual.ore||0)),
                };

                await supabase
                    .from('planets')
                    .update({ resources_remaining: newRem })
                    .eq('id', planet.id);

                if ((newRem.coal + newRem.plasma + newRem.ore) === 0) {
                    await supabase.from('planets').delete().eq('id', planet.id);
                    if (window.addToLog) window.addToLog(`🪐 Планета ${planet.name} полностью исчерпана и исчезла с карты`);
                }

                if (Object.keys(lootManual).length > 0) {
                    for (const [res, amt] of Object.entries(lootManual)) {
                        if (amt > 0 && window.game) window.game.add_resource(res, amt);
                    }
                    const lootText = Object.entries(lootManual)
                        .filter(([,a]) => a > 0)
                        .map(([r,a]) => `+${a} ${r}`)
                        .join(', ');
                    if (window.addToLog) window.addToLog(`📦 Грузовой вернулся с планеты ${planet.name}: ${lootText}`);
                }
            } else {
                if (loot && Object.keys(loot).length > 0) {
                    for (const [res, amt] of Object.entries(loot)) {
                        if (amt > 0 && window.game) window.game.add_resource(res, amt);
                    }
                    const lootText = Object.entries(loot)
                        .filter(([,a]) => a > 0)
                        .map(([r,a]) => `+${a} ${r}`)
                        .join(', ');
                    if (window.addToLog) window.addToLog(`📦 Грузовой вернулся с планеты ${planet.name}: ${lootText}`);
                } else {
                    if (window.addToLog) window.addToLog(`📦 Грузовой прибыл к планете ${planet.name} — ресурсы уже вывезены`);
                }
            }

            await supabase
                .from('planet_missions')
                .update({ status: 'done', completed_at: new Date().toISOString() })
                .eq('id', missionId);

            try {
                const fleetKey = this.currentUser?.id ? `corebox_fleet_${this.currentUser.id}` : 'corebox_fleet';
                const fleet = JSON.parse(localStorage.getItem(fleetKey) || '[]');
                const s = fleet.find(x => x.id === ship.id);
                if (s) { s.onMission = false; s.missionId = null; }
                localStorage.setItem(fleetKey, JSON.stringify(fleet));
            } catch(e) {}

            await this.loadPlanets();
            this.renderPlanets();

        } catch(e) {
            console.error('Ошибка обработки прилёта к планете:', e);
        }
    },

    generateStars() {
        const layer = document.getElementById('space-stars-layer');
        if (!layer) return;
        layer.innerHTML = '';
        for (let i = 0; i < 80; i++) {
            const star = document.createElement('div');
            const size = Math.random() * 2 + 0.5;
            star.style.cssText = `
                position:absolute;
                left:${Math.random()*100}%;top:${Math.random()*100}%;
                width:${size}px;height:${size}px;
                background:#fff;border-radius:50%;
                opacity:${0.3 + Math.random()*0.7};
            `;
            layer.appendChild(star);
        }
    },

    // ========== МУЛЬТИПЛЕЕР ==========
    
    setupMultiplayer() {
        this._forceLoadPlayers();
        
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        this.multiplayerInterval = setInterval(() => this.loadMultiplayerPlayers(), 30000);
        
        if (this.planetsChannel) supabase.removeChannel(this.planetsChannel);
        this.planetsChannel = supabase
            .channel('planets-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'planets' }, () => {
                this.loadPlanets().then(() => this.renderPlanets());
            })
            .subscribe();
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
            // ========== БАГ #5: добавляем вызов renderFlightLines ==========
            this.renderFlightLines();
        } catch(e) {
            console.warn('Ошибка первоначальной загрузки игроков:', e);
        }
    },

    async loadMultiplayerPlayers() {
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
            console.warn('Ошибка загрузки игроков:', e);
        }
    },

    isOnline(player) {
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

        list.innerHTML = [...online, ...offline].slice(0, 10).map(p => `
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

        this.otherPlayers.slice(0, 15).forEach((player, i) => {
            if (!this._playerPositions[player.user_id]) {
                const hash = this._hashString(player.user_id);
                const angle = (hash % 360) * Math.PI / 180;
                const r = 30 + (hash % 20);
                this._playerPositions[player.user_id] = {
                    x: 50 + Math.cos(angle) * r,
                    y: 50 + Math.sin(angle) * r
                };
            }
            const { x, y } = this._playerPositions[player.user_id];
            
            const el = document.createElement('div');
            el.className = 'other-player-marker';
            el.style.cssText = `
                position:absolute;left:${x}%;top:${y}%;
                transform:translate(-50%,-50%);text-align:center;cursor:pointer;
                z-index:15;
            `;
            const isOnline = this.isOnline(player);
            el.innerHTML = `
                <span style="font-size:18px;">🏰</span>
                <div style="font-size:8px;color:${isOnline ? '#4aff9d' : '#888'};margin-top:1px;">
                    ${this.escapeHtml(player.username?.slice(0,10) ?? 'Игрок')}
                </div>
            `;
            el.onclick = () => this.showPlayerInfo(player.user_id);
            layer.appendChild(el);
        });
        
        this.renderFlightLines();
    },
    
    // ========== ЛИНИИ ПОЛЁТА (БАГ #3 И БАГ #7) ==========
    
    renderFlightLines() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;

        layer.querySelectorAll('.flight-line, .flight-ship-icon').forEach(el => el.remove());

        const myPos = this._getMyPlanetPosition();
        if (!myPos) return;

        // ========== БАГ #3: получаем актуальные миссии через fleetModule ==========
        if (window.fleetModule?.refreshActivePvpMissions) {
            window.fleetModule.refreshActivePvpMissions();
        }
        const missions = window.fleetModule?.activePvpMissions || [];

        missions.forEach(mission => {
            const targetPos = this._getPlayerPosition(mission.targetUserId);
            if (!targetPos) return;

            const dx = targetPos.x - myPos.x;
            const dy = targetPos.y - myPos.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;

            const color = mission.phase === 'scout'  ? '#4a9eff'
                        : mission.phase === 'combat' ? '#ff4a4a'
                        : '#ffaa44';

            const line = document.createElement('div');
            line.className = 'flight-line';
            line.style.cssText = `
                position: absolute;
                left: ${myPos.x}%;
                top: ${myPos.y}%;
                width: ${length}%;
                height: 2px;
                background: linear-gradient(90deg, ${color}, transparent);
                transform-origin: 0 50%;
                transform: rotate(${angle}deg);
                opacity: 0.7;
                pointer-events: none;
                z-index: 2;
            `;

            const shipIcon = mission.phase === 'scout'  ? '🔭'
                           : mission.phase === 'combat' ? '⚔️'
                           : '📦';
            
            const progress = mission.status === 'flying' ? '→' : '←';
            
            let shipPosX = myPos.x + dx * 0.5;
            let shipPosY = myPos.y + dy * 0.5;
            
            if (mission.status === 'returning') {
                shipPosX = targetPos.x + dx * 0.25;
                shipPosY = targetPos.y + dy * 0.25;
            } else if (mission.status === 'arrived') {
                shipPosX = targetPos.x;
                shipPosY = targetPos.y;
            }
            
            const shipEl = document.createElement('div');
            shipEl.className = 'flight-ship-icon';
            shipEl.style.cssText = `
                position: absolute;
                left: ${shipPosX}%;
                top: ${shipPosY}%;
                transform: translate(-50%, -50%);
                font-size: 14px;
                z-index: 10;
                text-shadow: 0 0 3px black;
            `;
            shipEl.textContent = `${shipIcon}${progress}`;

            layer.appendChild(line);
            layer.appendChild(shipEl);
        });

        // ========== БАГ #7: запускаем интервал анимации если есть миссии ==========
        if (missions.length > 0 && !this._flightLineInterval && this.isTabActive) {
            this._flightLineInterval = setInterval(() => {
                if (this.isTabActive) {
                    this.renderFlightLines();
                } else {
                    clearInterval(this._flightLineInterval);
                    this._flightLineInterval = null;
                }
            }, 2000);
        } else if (missions.length === 0 && this._flightLineInterval) {
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
                    <div>⛏️ Руда: <b>${scout.scout_data.ore}</b></div>
                    <div>🪨 Уголь: <b>${scout.scout_data.coal}</b></div>
                    <div>🎛️ Чипы: <b>${scout.scout_data.chips}</b></div>
                    <div>⚡ Плазма: <b>${scout.scout_data.plasma}</b></div>
                    <div>🛡️ Защита: <b>${scout.scout_data.has_defense ? 'АКТИВНА' : 'НЕТ'}</b></div>
                </div>
                ${scout.scout_data._obscured ? '<div style="margin-top:6px;opacity:0.6;">⚠️ Часть данных скрыта системой защиты</div>' : ''}
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
        popup.querySelector('#space-btn-close').onclick = (e) => { e.stopPropagation(); popup.remove(); this._currentPopup = null; };
        
        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) {
                popup.remove();
                this._currentPopup = null;
                document.removeEventListener('click', closeOnOutside);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);

        const onEsc = (e) => {
            if (e.key === 'Escape') {
                popup.remove();
                this._currentPopup = null;
                document.removeEventListener('keydown', onEsc);
            }
        };
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
        if (this._currentPopup) {
            this._currentPopup.remove();
            this._currentPopup = null;
        }
        // БАГ #7: очищаем интервал анимации при уничтожении модуля
        if (this._flightLineInterval) {
            clearInterval(this._flightLineInterval);
            this._flightLineInterval = null;
        }
    },

    escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]
        );
    },
};

window.spaceModule = spaceModule;