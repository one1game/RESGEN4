// space-module.js
// Космическая карта — читает данные напрямую из WASM и Supabase
// С мультиплеерной боевой системой

import { supabase } from './supabase.js';

export const spaceModule = {
    game: null,
    currentUser: null,
    multiplayerInterval: null,
    lastSeenInterval: null,
    initialized: false,

    planets: [],
    otherPlayers: [],
    isResearching: false,

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

    // ── Инициализация ────────────────────────────────
    init(gameInstance, user) {
        this.game = gameInstance;
        this.currentUser = user;

        this.loadPlanets();
        this.generateStars();
        this.renderPlanets();
        this.setupMultiplayer();
        this.startLastSeenUpdater();
        this.initialized = true;

        console.log('🌌 Space module инициализирован');
    },

    // Вызывается при переключении на вкладку "КАРТА"
    onTabActivated() {
        if (!this.initialized) return;
        this.syncFromGame();
        this.renderPlanets();
        this.renderPlayers();
        this.updateStatusBar();
    },

    // ── Читаем данные из WASM напрямую ───────────────
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
        try { ships = JSON.parse(localStorage.getItem('corebox_fleet') ?? '[]'); } catch(e) {}

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

    // ── Планеты ──────────────────────────────────────
    loadPlanets() {
        try {
            const saved = localStorage.getItem('corebox_planets');
            if (saved) this.planets = JSON.parse(saved);
        } catch(e) { this.planets = []; }
    },

    savePlanets() {
        try { localStorage.setItem('corebox_planets', JSON.stringify(this.planets)); } catch(e) {}
    },

    startResearch() {
        if (this.isResearching) return;

        const power = this.game?.get_computational_power?.() ?? 0;
        if (power < 100) {
            window.showNotif?.('Недостаточно мощности (нужно 100⚡)', true);
            return;
        }

        this.isResearching = true;
        const btn = document.getElementById('space-research-btn');
        if (btn) { btn.textContent = '⏳ ИССЛЕДОВАНИЕ...'; btn.disabled = true; }

        setTimeout(() => {
            this.addPlanet();
            this.isResearching = false;
            if (btn) {
                btn.textContent = '🔍 ИССЛЕДОВАТЬ ПЛАНЕТУ (нужно 100⚡)';
                btn.disabled = false;
            }
        }, 1500);
    },

    addPlanet() {
        const types = Object.keys(this.PLANET_TYPES);
        const type  = types[Math.floor(Math.random() * types.length)];
        const cfg   = this.PLANET_TYPES[type];
        const name  = this.PLANET_NAMES[Math.floor(Math.random() * this.PLANET_NAMES.length)];

        const angle = Math.random() * Math.PI * 2;
        const r     = 15 + Math.random() * 25;
        const x     = 50 + Math.cos(angle) * r;
        const y     = 50 + Math.sin(angle) * r;

        const planet = { id: Date.now(), type, name, x, y, discovered: new Date().toISOString() };
        this.planets.push(planet);
        this.savePlanets();
        this.renderPlanets();

        window.showNotif?.(`🪐 Открыта планета ${name} (${cfg.name})!`, false);
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
        window.showNotif?.(`🪐 ${planet.name}\nТип: ${cfg.name ?? planet.type}`, false);
    },

    // ── Звёзды ────────────────────────────────────────
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

    // ── Мультиплеер ───────────────────────────────────
    setupMultiplayer() {
        this.loadMultiplayerPlayers();
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        this.multiplayerInterval = setInterval(() => this.loadMultiplayerPlayers(), 60000);
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
    },

    renderPlayersOnMap() {
        const layer = document.getElementById('space-objects-layer');
        if (!layer) return;
        layer.querySelectorAll('.other-player-marker').forEach(el => el.remove());

        this.otherPlayers.slice(0, 15).forEach((player, i) => {
            const angle = (i / Math.max(this.otherPlayers.length, 1)) * Math.PI * 2;
            const r = 30 + Math.random() * 15;
            const x = 50 + Math.cos(angle) * r;
            const y = 50 + Math.sin(angle) * r;

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
    },

    // ── ПОЛНОЦЕННОЕ ОКНО ИГРОКА С КНОПКАМИ АТАКИ ──
    async showPlayerInfo(userId) {
        const player = this.otherPlayers.find(p => p.user_id === userId);
        if (!player) return;

        // Динамически импортируем мультиплеерные функции
        const { getLatestScoutData, sendShip } = await import('./multiplayer_combat.js');
        
        const scout = await getLatestScoutData(this.currentUser.id, player.user_id);
        const scoutAge = scout ? Math.floor((Date.now() - new Date(scout.created_at).getTime()) / 60000) : null;
        const scoutFresh = scoutAge !== null && scoutAge < 30;
        const isOnline = this.isOnline(player);

        // Закрываем предыдущий попап если есть
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

        // Обработчики кнопок
        const doSend = async (shipType) => {
            if (shipType !== 'scout' && !scoutFresh) return;
            
            // Добавляем визуальный фидбек
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
        
        // Закрытие по клику вне попапа
        const closeOnOutside = (e) => {
            if (!popup.contains(e.target)) {
                popup.remove();
                this._currentPopup = null;
                document.removeEventListener('click', closeOnOutside);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
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

    // ── last_seen ─────────────────────────────────────
    startLastSeenUpdater() {
        if (this.lastSeenInterval) clearInterval(this.lastSeenInterval);
        this.lastSeenInterval = setInterval(async () => {
            if (!this.currentUser) return;
            try {
                await supabase.from('game_saves')
                    .update({ last_seen: new Date().toISOString(), updated_at: new Date().toISOString() })
                    .eq('user_id', this.currentUser.id);
            } catch(e) {}
        }, 30000);
    },

    stopLastSeenUpdater() {
        if (this.lastSeenInterval) { clearInterval(this.lastSeenInterval); this.lastSeenInterval = null; }
    },

    destroy() {
        if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
        this.stopLastSeenUpdater();
        if (this._currentPopup) {
            this._currentPopup.remove();
            this._currentPopup = null;
        }
    },

    escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]
        );
    },
};

window.spaceModule = spaceModule;