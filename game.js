// game.js - ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ С МУЛЬТИПЛЕЕРОМ

import init, { start_game, apply_config_from_admin } from './pkg/corebox_rs.js';
import { initStatistics, updateStatisticsDisplay, switchTab, gameStats, loadUserStatistics, resetUserStatistics, updateStatisticsFromRust } from './statistics.js';
import { craftModule } from './craft.js';
import { designModule } from './design.js';
import { fleetModule } from './fleet.js';
import { spaceModule } from './space-module.js';
import { Sounds } from './sounds.js';
import { initAuth, logout, getCurrentUser, login, register } from './auth.js';
import { saveGameToCloud, loadGameFromCloud, syncStatisticsToCloud } from './save.js';
import { supabase } from './supabase.js';
// ИМПОРТ МУЛЬТИПЛЕЕРНЫХ ФУНКЦИЙ
import {
    sendShip,
    processArrivedMissions,
    getTargetPlayers,
    getLatestScoutData,
    getUnreadNotifications,
    markAllNotificationsRead,
    subscribeToNotifications,
} from './multiplayer_combat.js';

let game;
let currentUser = null;
let lastRustStats = null;
let isAutoClicking = false;
let isGameInitialized = false;
let comboCount = 0;
let lastClickTime = 0;
let prestigeLevel = Number(localStorage.getItem('corebox_prestige_level')) || 0;
let randomEventTimer = -60;
let _saveTimer = null;
let _cloudSaveTimer = null;
let _lastSeenTimer = null;
let lastProcessedAttackHash = null;
let _gameLoopInterval = null;
let offlineProgressShown = false;

// МУЛЬТИПЛЕЕРНЫЕ ПЕРЕМЕННЫЕ
let _notifChannel = null;
let _missionPollInterval = null;

let _universalChannel = null;
let _keepAliveChannel = null;

function getUniversalChannel() {
    if (!_universalChannel && typeof BroadcastChannel !== 'undefined') {
        try {
            _universalChannel = new BroadcastChannel('corebox_game');
        } catch(e) {}
    }
    return _universalChannel;
}

function getKeepAliveChannel() {
    if (!_keepAliveChannel && typeof BroadcastChannel !== 'undefined') {
        try {
            _keepAliveChannel = new BroadcastChannel('corebox_keepalive');
            _keepAliveChannel.onmessage = (e) => {
                if (e.data.type === 'ping') {
                    _keepAliveChannel.postMessage({ type: 'pong' });
                }
            };
        } catch(e) {}
    }
    return _keepAliveChannel;
}

function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        if (currentUser) saveCurrentUserStatistics();
    }, 5000);
}

// ========== НОВАЯ ФУНКЦИЯ: ОБНОВЛЕНИЕ last_seen ==========
async function updateLastSeen() {
    if (!currentUser) return;
    try {
        const { error } = await supabase
            .from('game_saves')
            .update({ 
                last_seen: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', currentUser.id);
        
        if (error) {
            console.warn("Ошибка обновления last_seen:", error);
        } else {
            console.log("✅ last_seen обновлён для", currentUser.email);
        }
    } catch(e) {
        console.error("Ошибка в updateLastSeen:", e);
    }
}

function startLastSeenUpdater() {
    if (_lastSeenTimer) clearInterval(_lastSeenTimer);
    _lastSeenTimer = setInterval(() => {
        if (currentUser) {
            updateLastSeen();
        }
    }, 30000);
    console.log("🔄 Запущен обновление last_seen (каждые 30 сек)");
}

function stopLastSeenUpdater() {
    if (_lastSeenTimer) {
        clearInterval(_lastSeenTimer);
        _lastSeenTimer = null;
    }
}

async function getOrCreateMapPosition(userId) {
    const key = `corebox_map_pos_${userId}`;
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
    
    try {
        const { data } = await supabase
            .from('game_saves')
            .select('map_x, map_y')
            .eq('user_id', userId)
            .maybeSingle();
        
        if (data?.map_x) {
            localStorage.setItem(key, JSON.stringify({ x: data.map_x, y: data.map_y }));
            return { x: data.map_x, y: data.map_y };
        }
    } catch(e) {}
    
    let x, y;
    do {
        x = 5 + Math.random() * 90;
        y = 5 + Math.random() * 90;
    } while (Math.hypot(x - 50, y - 50) < 15);
    
    localStorage.setItem(key, JSON.stringify({ x, y }));
    return { x, y };
}

// ========== ОБЛАЧНОЕ СОХРАНЕНИЕ ==========
async function cloudSaveNow(force = false) {
    if (!currentUser || !game) return;
    
    try {
        const result = await saveGameToCloud(game, force);
        
        if (result.success) {
            console.log("✅ Облако обновлено");
            await updateLastSeen();
        } else if (result.error === "Конфликт: облако новее" && result.server_save) {
            console.warn("Обнаружен конфликт, загружаем облачную версию");
            addToLog("⚠️ Обнаружен конфликт сохранений, загружаем облачную версию", "warning");
            
            try {
                game.load_game_state(JSON.stringify(result.server_save));
                addToLog("💾 Загружена облачная версия (была новее)");
                await updateLastSeen();
            } catch(e) {
                console.error("Ошибка загрузки облачной версии:", e);
            }
        }
    } catch(e) {
        console.error('Ошибка при сохранении в облако:', e);
    }
}

function scheduleCloudSave() {
    if (!currentUser) return;
    if (_cloudSaveTimer) clearTimeout(_cloudSaveTimer);
    _cloudSaveTimer = setTimeout(async () => {
        await cloudSaveNow(false);
        _cloudSaveTimer = null;
    }, 2000);
}

function showFloatingText(text, x, y) {
    const el = document.createElement('div');
    el.className = 'floating-text';
    el.textContent = text;
    el.style.cssText = `left:${x}px;top:${y}px`;
    document.body.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 500);
    }, 800);
}

function addToLog(msg, type = 'info') {
    const log = document.getElementById('logBox');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    entry.textContent = `[${ts}] ${msg}`;
    log.appendChild(entry);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    
    const channel = getUniversalChannel();
    if (channel) {
        try {
            channel.postMessage({
                type: 'log',
                message: msg,
                logType: type,
                timestamp: Date.now()
            });
        } catch(e) {}
    }
}

function triggerRandomEvent() {
    const events = [
        { name: '🎁 Найден тайник!', effect: () => { game.add_resource('coal', 30 + Math.floor(Math.random() * 40)); return '+30-70 угля'; } },
        { name: '☄️ Метеоритный дождь!', effect: () => { game.add_resource('ore', 15 + Math.floor(Math.random() * 25)); return '+15-40 руды'; } },
        { name: '⚠️ Перегрев системы!', effect: () => { const p = game?.get_computational_power() || 0; game.subtract_power(Math.min(20, Math.floor(p * 0.1))); return '-мощности'; } },
        { name: '💀 Саботаж повстанцев!', effect: () => {
            const c = game?.get_resource('coal') || 0;
            if (c === 0) return 'нечего красть';
            game.subtract_resource('coal', Math.min(25, Math.floor(c * 0.15)));
            return '-угля';
        } },
        { name: '🔧 Ремонтный дрон!', effect: () => { game.repair_systems(); return 'системы восстановлены'; } },
        { name: '📡 Спутниковая связь!', effect: () => { game.add_power(25 + Math.floor(Math.random() * 35)); return '+мощности'; } }
    ];
    const e = events[Math.floor(Math.random() * events.length)];
    const result = e.effect();
    Sounds.upgrade();
    addToLog(`✨ ${e.name} ${result}`);
    showFloatingText(e.name, 300, 100);
}

function prestigeReset() {
    if (!confirm('ПРЕСТИЖ!\nНачнёте заново, получите бонусы. Продолжить?')) return;
    prestigeLevel++;
    localStorage.setItem('corebox_prestige_level', prestigeLevel);
    if (typeof game.reset_progress === 'function') game.reset_progress();
    showFloatingText(`🔁 ПРЕСТИЖ ${prestigeLevel}!`, window.innerWidth / 2, window.innerHeight / 2);
    document.dispatchEvent(new CustomEvent('prestigeComplete', { detail: { level: prestigeLevel } }));
    scheduleCloudSave();
}

function getPrestigeBonus() {
    return { critBonus: prestigeLevel * 0.01, comboBonus: prestigeLevel * 0.05, eventBonus: prestigeLevel * 0.005 };
}

function calculateOfflineProgress(saved) {
    const lastShown = parseInt(localStorage.getItem('corebox_offline_shown') || '0');
    const elapsed = Math.min(Math.floor((Date.now() - (saved?._savedAt || Date.now())) / 1000), 8 * 3600);
    if (elapsed < 10 || Date.now() - lastShown < 60000) return null;
    const ticks = elapsed;
    const passive = saved?._passive_rates || { coal: 0.004, trash: 0.008, ore: 0.003 };
    return {
        elapsedSeconds: elapsed,
        coalGained: Math.floor(ticks * passive.coal),
        trashGained: Math.floor(ticks * passive.trash),
        oreGained: Math.floor(ticks * passive.ore),
        cyclesPassed: Math.floor(elapsed / 32),
        attacksDuringOffline: Math.floor(Math.random() * (elapsed / 100) + 1)
    };
}

function showOfflineRewardPopup(p) {
    const mins = Math.floor(p.elapsedSeconds / 60);
    const timeStr = mins > 60 ? `${Math.floor(mins / 60)}ч ${mins % 60}м` : `${mins}м`;
    addToLog(`⏰ Офлайн ${timeStr}: +${p.coalGained}🪨 +${p.trashGained}♻️ +${p.oreGained}⛏️`);
    showFloatingText(`⏰ Офлайн ${timeStr}`, window.innerWidth/2, 200);
    const popup = document.createElement('div');
    popup.className = 'offline-popup';
    popup.innerHTML = `<h3>⏰ ВОЗВРАЩЕНИЕ</h3><p>Прошло: ${timeStr}</p><div class="offline-resources"><div>🪨 +${p.coalGained}</div><div>♻️ +${p.trashGained}</div><div>⛏️ +${p.oreGained}</div></div><button onclick="this.parentElement.remove()">ПРОДОЛЖИТЬ</button>`;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 5000);
    localStorage.setItem('corebox_offline_shown', Date.now().toString());
}

function switchStatusTab(tab) {
    ['system-status', 'statistics', 'leaderboard'].forEach(t => {
        const section = document.getElementById(`${t}-section`);
        const tabEl = document.getElementById(`${t}-tab`);
        if (section) section.style.display = 'none';
        if (tabEl) tabEl.classList.remove('active');
    });
    const activeSection = document.getElementById(`${tab}-section`);
    const activeTab = document.getElementById(`${tab}-tab`);
    if (activeSection) activeSection.style.display = 'block';
    if (activeTab) activeTab.classList.add('active');
}

async function loadLeaderboard() {
    const container = document.getElementById('leaderboardContainer');
    if (!container) return;
    container.innerHTML = '<div>⏳ Загрузка...</div>';
    if (!currentUser) {
        container.innerHTML = '<div>🔐 Войдите для просмотра лидерборда</div>';
        return;
    }
    try {
        const { getLeaderboard } = await import('./save.js');
        const leaders = await getLeaderboard();
        if (!leaders?.length) { container.innerHTML = '<div>📋 Нет данных</div>'; return; }
        container.innerHTML = leaders.map((e, i) => `<div class="leaderboard-row ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}"><span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i+1+'.'}</span><span class="lb-name">${escapeHtml(e.username || 'Игрок')}</span><span class="lb-score">⛏️ ${(e.total_mined || 0).toLocaleString()}</span><span class="lb-nights">🌙 ${e.nights || 0}</span></div>`).join('');
    } catch(e) { container.innerHTML = '<div>❌ Ошибка</div>'; }
}

function escapeHtml(str) {
    return str?.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    }) || '';
}

function getCurrentGameState() {
    if (!game) return null;
    try {
        const statsJson = game.get_statistics();
        if (statsJson) {
            const parsed = JSON.parse(statsJson);
            parsed.mining_level = parsed.upgrades?.mining ?? parsed.mining_level ?? 0;
            parsed.defense_active = parsed.upgrades?.defense ?? parsed.defense_active ?? false;
            parsed.defense_level = parsed.upgrades?.defense_level ?? parsed.defense_level ?? 0;
            parsed.computational_power = game.get_computational_power() || 0;
            parsed.max_computational_power = game.get_max_computational_power ? game.get_max_computational_power() : 1000;
            return parsed;
        }
    } catch(e) {}
    return null;
}

function showAuthUI() {
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('gameContent').style.display = 'none';
    document.getElementById('userInfo').style.display = 'none';
}

function showGameUI() {
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('gameContent').style.display = 'block';
    document.getElementById('userInfo').style.display = 'block';
}

function updateUserDisplay(user) {
    const usernameDisplay = document.getElementById('usernameDisplay');
    const prestigeTag = prestigeLevel > 0 ? ` ✦${prestigeLevel}` : '';
    const displayName = user?.user_metadata?.username || user?.email?.split('@')[0] || 'Игрок';
    if (usernameDisplay) usernameDisplay.textContent = displayName + prestigeTag;
}

async function loadFromCloudAndMerge() {
    if (!currentUser || !game) return null;
    
    try {
        const cloudSave = await loadGameFromCloud(true);
        
        if (cloudSave) {
            const localBackup = localStorage.getItem('corebox_save_backup');
            let shouldLoad = true;
            
            if (localBackup) {
                try {
                    const local = JSON.parse(localBackup);
                    if (local.timestamp > cloudSave.timestamp) {
                        shouldLoad = false;
                        addToLog("💾 Локальное сохранение новее облачного, используем его");
                    }
                } catch(e) {}
            }
            
            if (shouldLoad) {
                game.load_game_state(JSON.stringify(cloudSave));
                addToLog(`💾 Загружено облачное сохранение (${new Date(cloudSave.timestamp).toLocaleString()})`);
                
                if (cloudSave.blueprints) {
                    window.dispatchEvent(new CustomEvent('blueprintsLoaded', { 
                        detail: { blueprints: cloudSave.blueprints } 
                    }));
                }
                
                if (cloudSave.fleet) {
                    window.dispatchEvent(new CustomEvent('fleetLoaded', { 
                        detail: { fleet: cloudSave.fleet } 
                    }));
                }
                
                return cloudSave;
            }
        }
        
        return null;
    } catch(e) {
        console.error("Ошибка загрузки из облака:", e);
        return null;
    }
}

// ========== НОВАЯ ФУНКЦИЯ: ПРИМЕНЕНИЕ PENDING LOOT ==========
function _applyPendingLoot() {
    try {
        const pending = JSON.parse(localStorage.getItem('corebox_pending_loot') || '{}');
        if (!Object.keys(pending).length) return;

        let applied = false;
        if (game && typeof game.add_resource === 'function') {
            for (const [res, amt] of Object.entries(pending)) {
                game.add_resource(res, amt);
            }
            applied = true;
        }

        if (!applied) {
            const saved = localStorage.getItem('corebox_save');
            if (saved) {
                try {
                    const state = JSON.parse(saved);
                    if (state.inventory) {
                        for (const [res, amt] of Object.entries(pending)) {
                            if (state.inventory[res] !== undefined) {
                                state.inventory[res] += amt;
                            }
                        }
                        localStorage.setItem('corebox_save', JSON.stringify(state));
                        applied = true;
                    }
                } catch(e) {}
            }
        }

        if (applied) {
            const names = { ore:'руды', coal:'угля', chips:'чипов', plasma:'плазмы', trash:'мусора' };
            const text = Object.entries(pending)
                .map(([r, a]) => `${a} ${names[r] || r}`)
                .join(', ');
            addToLog(`📦 Грузовой доставил: +${text}`);
            localStorage.removeItem('corebox_pending_loot');
        }
    } catch(e) {
        console.warn('Ошибка применения loot:', e);
    }
}

// ========== НОВАЯ ФУНКЦИЯ: ПРИМЕНЕНИЕ ОСВОБОЖДЁННЫХ КОРАБЛЕЙ ОТ EDGE FUNCTION ==========
async function _applyReleasedShips(userId) {
    if (!userId) return;
    
    try {
        // Читаем корабли которые Edge Function освободила пока игрок был офлайн
        const { data: released, error } = await supabase
            .from('fleet_released')
            .select('*')
            .eq('user_id', userId)
            .eq('applied', false);
        
        if (error) {
            console.warn("Ошибка чтения fleet_released:", error);
            return;
        }
        
        if (!released || released.length === 0) return;
        
        console.log(`🚀 Применяем ${released.length} освобождённых кораблей...`);
        
        for (const entry of released) {
            // Освобождаем корабль во флоте
            if (fleetModule && fleetModule.setShipMissionStatus) {
                fleetModule.setShipMissionStatus(entry.ship_id, false);
            }
            
            // Если грузовой — добавляем loot в pending
            if (entry.ship_type === 'cargo' && entry.loot && Object.keys(entry.loot).length > 0) {
                const pending = JSON.parse(localStorage.getItem('corebox_pending_loot') || '{}');
                for (const [res, amt] of Object.entries(entry.loot)) {
                    if (amt && amt > 0) {
                        pending[res] = (pending[res] || 0) + amt;
                    }
                }
                localStorage.setItem('corebox_pending_loot', JSON.stringify(pending));
                
                const lootText = Object.entries(entry.loot)
                    .filter(([,a]) => a && a > 0)
                    .map(([r,a]) => `+${a} ${r}`)
                    .join(', ');
                addToLog(`📦 Грузовой доставил пока вас не было: ${lootText}`);
            }
            
            if (entry.ship_type === 'scout') {
                addToLog(`🔭 Разведчик вернулся пока вас не было.`);
            }
            if (entry.ship_type === 'combat') {
                const lootText = entry.loot && Object.keys(entry.loot).length > 0 
                    ? ` Добыча: ${Object.entries(entry.loot).map(([r,a]) => `${a} ${r}`).join(', ')}`
                    : '';
                addToLog(`⚔️ Боевой корабль вернулся пока вас не было.${lootText}`);
            }
            
            // Помечаем как применённое
            await supabase
                .from('fleet_released')
                .update({ applied: true })
                .eq('id', entry.id);
        }
        
        // Применяем накопленный loot
        _applyPendingLoot();
        
    } catch(e) {
        console.error("Ошибка в _applyReleasedShips:", e);
    }
}

// ========== МУЛЬТИПЛЕЕРНАЯ ИНИЦИАЛИЗАЦИЯ ==========
function _initMultiplayer(user) {
    if (!user) return;

    // Realtime оповещения
    if (_notifChannel) supabase.removeChannel(_notifChannel);
    _notifChannel = subscribeToNotifications(user.id, (notif) => {
        _showCombatNotification(notif);
    });

    // Показать непрочитанные при входе
    getUnreadNotifications(user.id).then(notifs => {
        notifs.forEach(n => _showCombatNotification(n, false));
        if (notifs.length > 0) markAllNotificationsRead(user.id);
    });

    // НОВОЕ: при старте проверяем освобождённые корабли от Edge Function
    _applyReleasedShips(user.id);

    // Polling прибывших миссий (запасной вариант, реже — раз в 2 минуты)
    if (_missionPollInterval) clearInterval(_missionPollInterval);
    _missionPollInterval = setInterval(() => {
        if (currentUser) processArrivedMissions(currentUser.id);
    }, 120000);  // 2 минуты вместо 30 секунд
    
    if (currentUser) processArrivedMissions(currentUser.id);
}

function _cleanupMultiplayer() {
    if (_notifChannel) { supabase.removeChannel(_notifChannel); _notifChannel = null; }
    if (_missionPollInterval) { clearInterval(_missionPollInterval); _missionPollInterval = null; }
}

function _showCombatNotification(notif, playSound = true) {
    if (window.showNotif) {
        window.showNotif(notif.message, notif.type === 'under_attack' || notif.type === 'looted');
    }
    addToLog(notif.message);
    _updateNotifBadge();
}

async function _updateNotifBadge() {
    const fleetBtn = document.getElementById('fleet-tab-btn');
    if (fleetBtn && currentUser) {
        const notifs = await getUnreadNotifications(currentUser.id);
        const badge = fleetBtn.querySelector('.notif-badge');
        if (notifs.length > 0) {
            if (!badge) {
                const b = document.createElement('span');
                b.className = 'notif-badge';
                b.style.cssText = 'background:#f44;color:#fff;border-radius:50%;font-size:9px;padding:1px 4px;margin-left:4px;';
                b.textContent = notifs.length;
                fleetBtn.appendChild(b);
            } else {
                badge.textContent = notifs.length;
            }
        } else if (badge) badge.remove();
    }
}

async function _refreshFleetWithMissions() {
    if (!currentUser) return;
    const container = document.getElementById('fleetContainer');
    if (!container) return;

    const { getActiveMissions } = await import('./multiplayer_combat.js');
    const missions = await getActiveMissions(currentUser.id);

    container.innerHTML = fleetModule.renderFleetUI();
    fleetModule.setupEventListeners(container);

    if (missions.length > 0) {
        const missionsHtml = document.createElement('div');
        missionsHtml.className = 'panel';
        missionsHtml.innerHTML = `
            <div class="panel-title">
                <span>🚀 АКТИВНЫЕ МИССИИ</span>
                <span class="collapse-icon">▼</span>
            </div>
            <div class="panel-content">
                ${missions.map(m => {
                    const isOut  = m.attacker_id === currentUser.id;
                    const eta    = new Date(isOut ? m.arrives_at : m.arrives_at);
                    const diff   = Math.max(0, Math.ceil((eta - Date.now()) / 60000));
                    const icons  = { scout:'🔭', combat:'⚔️', cargo:'📦' };
                    return `
                    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;">
                        ${icons[m.ship_type] ?? '🚀'}
                        ${isOut ? 'Отправлен' : 'Входящий'} ${m.ship_type}
                        · статус: ${m.status === 'flying' ? `прибудет через ${diff} мин` : 'возвращается'}
                    </div>`;
                }).join('')}
            </div>
        `;
        container.parentNode.insertBefore(missionsHtml, container);
    }
}

// ========== ИСПРАВЛЕННАЯ ИНИЦИАЛИЗАЦИЯ АВТОРИЗАЦИИ ==========
function initializeAuth() {
    setupAuthFormHandlers();
    getKeepAliveChannel();
    
    initAuth(
        async (user) => {
            currentUser = user;
            showGameUI();
            updateUserDisplay(user);
            document.getElementById('userInfo').style.display = 'block';
            
            await updateLastSeen();
            startLastSeenUpdater();
            
            addToLog("🔄 Синхронизация с облаком...");
            
            const cloudSave = await loadGameFromCloud(true);
            
            if (cloudSave) {
                addToLog(`✅ Загружено облачное сохранение (уровень нейро: ${cloudSave.neuro?.evolution || 0})`);
            }
            
            if (!isGameInitialized) {
                await initializeGame(cloudSave);
            }
            
            loadUserStatsFromCloud(user);
            
            // МУЛЬТИПЛЕЕР — ИНИЦИАЛИЗАЦИЯ
            _initMultiplayer(user);
            
            setTimeout(() => {
                if (game && currentUser) {
                    cloudSaveNow(true);
                }
            }, 5000);
        },
        () => {
            stopLastSeenUpdater();
            _cleanupMultiplayer();
            currentUser = null;
            showAuthUI();
            isGameInitialized = false;
        }
    );
}

async function loadUserStatsFromCloud(user) {
    if (!user) return;
    try {
        const users = JSON.parse(localStorage.getItem('corebox_users') || '{}');
        if (users[user.email]?.statistics) loadUserStatistics(users[user.email].statistics);
        else { gameStats.startTime = Date.now(); gameStats.sessionsCount = 1; updateStatisticsDisplay(); }
    } catch(e) {}
}

function setupAuthFormHandlers() {
    let isRegisterMode = false;
    const loginBtn = document.getElementById('btn-login');
    const registerBtn = document.getElementById('btn-register');
    const toggleModeBtn = document.getElementById('btn-toggle-mode');
    const usernameGroup = document.getElementById('username-group');
    const authTitle = document.querySelector('#authOverlay .auth-header h2');
    const authMessage = document.getElementById('auth-message');
    
    function showMessage(text, isError = true) {
        if (authMessage) {
            authMessage.textContent = text;
            authMessage.className = `auth-message ${isError ? 'error' : 'success'}`;
            setTimeout(() => authMessage.textContent = '', 5000);
        }
    }
    
    function toggleMode() {
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            if (authTitle) authTitle.textContent = '📝 Регистрация';
            if (usernameGroup) usernameGroup.style.display = 'block';
            if (loginBtn) loginBtn.textContent = '📝 Зарегистрироваться';
            if (registerBtn) registerBtn.style.display = 'none';
            if (toggleModeBtn) toggleModeBtn.textContent = '🔑 Уже есть аккаунт? Войти';
        } else {
            if (authTitle) authTitle.textContent = '🔑 Вход в CoreBox';
            if (usernameGroup) usernameGroup.style.display = 'none';
            if (loginBtn) loginBtn.textContent = '🔑 Войти';
            if (registerBtn) registerBtn.style.display = 'block';
            if (toggleModeBtn) toggleModeBtn.textContent = '✨ Нет аккаунта? Зарегистрироваться';
        }
    }
    
    async function handleLogin() {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        if (!email || !password) { showMessage('Заполните поля!'); return; }
        const result = await login(email, password);
        showMessage(result.success ? 'Вход выполнен!' : (result.error || 'Ошибка'), result.success);
    }
    
    async function handleRegister() {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const username = document.getElementById('auth-username').value.trim();
        if (!email || !password) { showMessage('Заполните поля!'); return; }
        if (password.length < 6) { showMessage('Пароль минимум 6 символов!'); return; }
        const result = await register(email, password, username || email.split('@')[0]);
        if (result.success) { showMessage('Регистрация успешна!', false); toggleMode(); }
        else showMessage(result.error || 'Ошибка');
    }
    
    if (loginBtn) loginBtn.onclick = () => isRegisterMode ? handleRegister() : handleLogin();
    if (registerBtn) registerBtn.onclick = handleRegister;
    if (toggleModeBtn) toggleModeBtn.onclick = toggleMode;
    
    const onEnter = (e) => { if (e.key === 'Enter') isRegisterMode ? handleRegister() : handleLogin(); };
    document.getElementById('auth-email')?.addEventListener('keypress', onEnter);
    document.getElementById('auth-password')?.addEventListener('keypress', onEnter);
    document.getElementById('auth-username')?.addEventListener('keypress', onEnter);
}

async function handleLogout() {
    stopLastSeenUpdater();
    _cleanupMultiplayer();
    
    if (_universalChannel) { _universalChannel.close(); _universalChannel = null; }
    if (_keepAliveChannel) { _keepAliveChannel.close(); _keepAliveChannel = null; }
    if (_gameLoopInterval) { clearInterval(_gameLoopInterval); _gameLoopInterval = null; }
    offlineProgressShown = false;
    
    if (currentUser && game) {
        addToLog("💾 Сохраняем прогресс перед выходом...");
        await cloudSaveNow(true);
        
        const state = getCurrentGameState();
        if (state) {
            localStorage.setItem('corebox_save', JSON.stringify(state));
            addToLog("💾 Локальное сохранение создано");
        }
        
        saveCurrentUserStatistics();
    }
    
    const result = await logout();
    if (result.success) {
        isGameInitialized = false;
        prestigeLevel = 0;
        localStorage.removeItem('corebox_prestige_level');
        localStorage.removeItem('corebox_autoclicking');
        
        setTimeout(() => {
            location.reload();
        }, 500);
    }
}

function initializeCollapsiblePanels() {
    setTimeout(() => {
        document.querySelectorAll('.panel-title').forEach((title, i) => {
            if (title.dataset.collapseInit === '1') return;
            title.dataset.collapseInit = '1';
            const panel = title.closest('.panel');
            if (panel && !panel.id) panel.id = `panel-${i}`;
            title.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                panel.classList.toggle('collapsed');
                const icon = title.querySelector('.collapse-icon');
                if (icon) icon.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
                savePanelStates();
            });
        });
        restorePanelStates();
    }, 100);
}

function savePanelStates() {
    const states = {};
    document.querySelectorAll('.panel').forEach(p => { if (p.id) states[p.id] = p.classList.contains('collapsed'); });
    localStorage.setItem('corebox_panel_states', JSON.stringify(states));
}

function restorePanelStates() {
    try {
        const saved = localStorage.getItem('corebox_panel_states');
        if (saved) {
            const states = JSON.parse(saved);
            document.querySelectorAll('.panel').forEach(p => {
                if (p.id && states[p.id]) {
                    p.classList.add('collapsed');
                    const icon = p.querySelector('.collapse-icon');
                    if (icon) icon.textContent = '▶';
                }
            });
        }
    } catch(e) {}
}

function updatePowerGlow() {
    if (!game) return;
    const power = game.get_computational_power();
    const maxPower = game.get_max_computational_power ? game.get_max_computational_power() : 1000;
    const percent = (power / maxPower) * 100;
    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return;
    btn.classList.remove('power-low', 'power-medium', 'power-high', 'power-full');
    if (percent >= 80) btn.classList.add('power-full');
    else if (percent >= 50) btn.classList.add('power-high');
    else if (percent >= 20) btn.classList.add('power-medium');
    else if (percent > 0) btn.classList.add('power-low');
}

function updateTurbineStatus(stats) {
    const heat = stats?.turbine_heat ?? 0;
    const isCooling = stats?.turbine_cooling ?? false;
    const bar = document.getElementById('turbineHeatBar');
    const label = document.getElementById('turbineHeatLabel');
    const hint = document.getElementById('turbineHeatHint');
    if (!bar || !label) return;
    bar.style.width = `${heat}%`;
    bar.className = 'turbine-fill';
    if (isCooling || heat >= 100) {
        bar.classList.add('turbine-critical');
        label.textContent = `🔥 ПЕРЕГРЕВ: ${heat}% — ОСТЫВАНИЕ...`;
        if (hint) hint.textContent = 'Добыча заблокирована';
    } else if (heat >= 70) { bar.classList.add('turbine-hot'); label.textContent = `🌡️ Перегрев: ${heat}%`; }
    else if (heat >= 40) { bar.classList.add('turbine-warm'); label.textContent = `🌡️ Перегрев: ${heat}%`; }
    else { bar.classList.add('turbine-cool'); label.textContent = `🌡️ Перегрев: ${heat}%`; }
}

function updateNeuroStatus(rustStats = null) {
    if (!game) return;
    try {
        if (!rustStats) { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); }
        if (rustStats) {
            const neuroEl = document.getElementById('neuroStatus');
            const progressEl = document.getElementById('neuroProgress');
            if (neuroEl) {
                const consc = rustStats.neuro_consciousness || 0;
                const evol = rustStats.neuro_evolution || 0;
                neuroEl.textContent = `${consc.toFixed(1)}% (Ур. ${evol})`;
                if (progressEl) {
                    progressEl.style.width = `${Math.min(consc, 100)}%`;
                    progressEl.className = 'neuro-progress';
                    if (consc >= 80) progressEl.classList.add('level-high');
                    else if (consc >= 50) progressEl.classList.add('level-medium');
                    else if (consc >= 20) progressEl.classList.add('level-low');
                }
            }
            const aiModeEl = document.getElementById('aiMode');
            if (aiModeEl) aiModeEl.textContent = rustStats.current_ai_mode || '⚙️ Обычный';
            
            const warningEl = document.getElementById('attackWarning');
            if (warningEl) {
                if (rustStats.attack_warning) {
                    warningEl.style.display = 'block';
                    warningEl.innerHTML = `⚠️ ${rustStats.attack_warning}${rustStats.attack_warning_faction ? ` от ${rustStats.attack_warning_faction}` : ''}`;
                } else warningEl.style.display = 'none';
            }
            
            ['miningDebuff', 'autoclickDebuff', 'defenseDebuff'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            if (rustStats.mining_debuff_remaining > 0) {
                const el = document.getElementById('miningDebuff');
                if (el) { el.style.display = 'block'; el.textContent = `🔧 Саботаж добычи: ${rustStats.mining_debuff_remaining} тиков`; }
            }
            if (rustStats.autoclick_debuff_remaining > 0) {
                const el = document.getElementById('autoclickDebuff');
                if (el) { el.style.display = 'block'; el.textContent = `😨 Псих. атака: ${rustStats.autoclick_debuff_remaining} тиков`; }
            }
            if (rustStats.defense_debuff_remaining > 0) {
                const el = document.getElementById('defenseDebuff');
                if (el) { el.style.display = 'block'; el.textContent = `🛡️ Защита повреждена: ${rustStats.defense_debuff_remaining} ночей`; }
            }
            
            updateAttackHistory(rustStats.attack_history || []);
            updateFactionPanel(rustStats.rebel_factions || [], rustStats.last_attacking_faction || '');
            updateUpgradeDisplay(rustStats);
        }
    } catch(e) {}
}

function updateUpgradeDisplay(stats) {
    if (!stats) return;
    const critEl = document.getElementById('critLevel');
    if (critEl) critEl.textContent = `Ур. ${stats.crit_level || 0}/10 (+${(stats.crit_level || 0) * 2}% крит)`;
    const coolingEl = document.getElementById('coolingLevel');
    if (coolingEl) coolingEl.textContent = `Ур. ${stats.cooling_level || 0}/10 (-${(stats.cooling_level || 0) * 15}% нагрев)`;
    const powerEl = document.getElementById('powerTier');
    if (powerEl) powerEl.textContent = `Тир ${stats.power_tier || 0} | +${(stats.power_tier || 0) + 1} мощности/клик`;
    const critCostEl = document.getElementById('critCost');
    if (critCostEl) critCostEl.textContent = `Стоимость: по ${((stats.crit_level || 0) + 1) * 2 + 4} каждого ресурса`;
    const coolingCostEl = document.getElementById('coolingCost');
    if (coolingCostEl) coolingCostEl.textContent = `Стоимость: ${500 * ((stats.cooling_level || 0) + 1)} угля`;
}

function updateAttackHistory(history) {
    const container = document.getElementById('attackHistory');
    if (!container) return;
    if (!history?.length) { container.innerHTML = '<div class="history-empty">Атак ещё не было</div>'; return; }
    container.innerHTML = history.slice().reverse().map(r => `<div class="attack-record ${r.was_defended ? 'defended' : 'failed'}"><span class="attack-faction">${escapeHtml(r.faction)}</span><span class="attack-type">${escapeHtml(r.attack_type)}</span><span class="attack-result">${r.was_defended ? '✅' : '❌'} ${escapeHtml(r.result)}</span></div>`).join('');
}

function updateFactionPanel(factions, lastAttacker) {
    const container = document.getElementById('factionPanel');
    if (!container || !factions?.length) { if (container) container.innerHTML = '<div class="faction-empty">Нет данных о фракциях</div>'; return; }
    container.innerHTML = factions.map(f => `<div class="faction-row ${f.includes(lastAttacker) && lastAttacker ? 'faction-active' : ''}">${escapeHtml(f)}</div>`).join('');
}

function setupLogObserver() {
    const logBox = document.getElementById('logBox');
    if (!logBox) return;
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList?.contains('log-entry')) {
                    const msg = node.textContent || '';
                    if (msg.includes('НЕЙРО-ЭВОЛЮЦИЯ')) Sounds.evolution();
                    if (msg.includes('Атака') && msg.includes('повстанцев') && !msg.includes('отражена')) Sounds.rebelAttack();
                    if (msg.includes('Предупреждение')) Sounds.warning();
                    if (msg.includes('Квест') && msg.includes('выполнен')) Sounds.questDone();
                    if (msg.includes('ТЭЦ активирована')) Sounds.coalOn && Sounds.coalOn();
                    if (msg.includes('ТЭЦ деактивирована')) Sounds.coalOff && Sounds.coalOff();
                    if (msg.includes('Обмен')) Sounds.trade && Sounds.trade();
                    if (msg.includes('Улучшена')) Sounds.upgrade();
                    if (msg.includes('добыт') && msg.includes('чип')) Sounds.chips();
                    if (msg.includes('добыт') && msg.includes('плазма')) Sounds.plasma();
                }
            });
        });
    }).observe(logBox, { childList: true });
}

function getCritChance(stats) {
    return 0.05 + Math.min((stats?.neuro_evolution || 0) / 500, 0.1) + getPrestigeBonus().critBonus + ((stats?.crit_level || 0) * 0.02);
}

function getComboMultiplier() {
    const evol = game?.get_neuro_evolution ? game.get_neuro_evolution() : 0;
    return 1 + Math.min(evol / 200, 1.5) + getPrestigeBonus().comboBonus;
}

function updateStatsFromGame(rustStats = null) {
    if (!game) return;
    try {
        if (!rustStats) { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); }
        if (rustStats) {
            const currentPower = game.get_computational_power() || 0;
            if (currentPower > gameStats.maxPowerReached) gameStats.maxPowerReached = currentPower;
            const rustClicks = rustStats.total_clicks || 0;
            if (rustClicks > (window._lastClickCount || 0)) {
                gameStats.totalClicks += rustClicks - (window._lastClickCount || 0);
                window._lastClickCount = rustClicks;
            }
            if (!lastRustStats) { lastRustStats = rustStats; return; }
            const diff = {
                nights_survived: Math.max(0, (rustStats.nights_survived || 0) - (lastRustStats.nights_survived || 0)),
                rebel_attacks: Math.max(0, (rustStats.rebel_attacks_count || 0) - (lastRustStats.rebel_attacks_count || 0)),
                attacks_defended: Math.max(0, (rustStats.attacks_defended || 0) - (lastRustStats.attacks_defended || 0)),
                coal_mined: Math.max(0, (rustStats.coal_mined || 0) - (lastRustStats.coal_mined || 0)),
                trash_mined: Math.max(0, (rustStats.trash_mined || 0) - (lastRustStats.trash_mined || 0)),
                plasma_mined: Math.max(0, (rustStats.plasma_mined || 0) - (lastRustStats.plasma_mined || 0)),
                ore_mined: Math.max(0, (rustStats.ore_mined || 0) - (lastRustStats.ore_mined || 0)),
                coal_burned: Math.max(0, (rustStats.coal_burned || 0) - (lastRustStats.coal_burned || 0)),
                coal_stolen: Math.max(0, (rustStats.coal_stolen || 0) - (lastRustStats.coal_stolen || 0))
            };
            gameStats.nightsSurvived += diff.nights_survived;
            gameStats.rebelAttacks += diff.rebel_attacks;
            gameStats.attacksDefended += diff.attacks_defended;
            gameStats.coalMined += diff.coal_mined;
            gameStats.trashMined += diff.trash_mined;
            gameStats.plasmaMined += diff.plasma_mined;
            gameStats.oreMined = (gameStats.oreMined || 0) + diff.ore_mined;
            gameStats.coalBurned += diff.coal_burned;
            gameStats.coalStolen += diff.coal_stolen;
            lastRustStats = rustStats;
            if (currentUser) scheduleSave();
        }
    } catch(e) {}
}

function handleClick() {
    if (!game) return;
    const now = Date.now();
    let stats = null;
    try { const j = game.get_statistics(); if (j) stats = JSON.parse(j); } catch(e) {}
    const isActive = stats && (stats.coal_enabled || stats.is_day);
    const isOverheated = stats && stats.turbine_heat >= 100;
    if (!isActive) {
        addToLog('❌ Система неактивна! Дождитесь дня или включите ТЭЦ.');
        Sounds.error();
        return;
    }
    if (isOverheated) {
        addToLog('🔥 Турбина перегрета! Подождите остывания.');
        Sounds.error();
        return;
    }
    const btn = document.getElementById('floatingMineBtn');
    if (now - lastClickTime < 1000) {
        comboCount++;
        Sounds.combo && Sounds.combo();
        if (btn && comboCount === 2) btn.classList.add('combo-active');
    } else {
        comboCount = 1;
        if (btn) btn.classList.remove('combo-active');
    }
    lastClickTime = now;
    if (comboCount > 1) showFloatingText(`x${comboCount}`, window.innerWidth / 2 + 50, window.innerHeight / 2 - 30);
    const critChance = getCritChance(stats);
    const comboMult = getComboMultiplier();
    const comboBonus = Math.floor(comboCount / 5) * comboMult;
    const actualClicks = 1 + Math.floor(comboBonus);
    const isCrit = Math.random() < critChance;
    Sounds.mine();
    if (isCrit) {
        Sounds.critical();
        showFloatingText('💥 CRIT!', window.innerWidth / 2, window.innerHeight / 2 - 50);
        for (let i = 0; i < actualClicks * 2; i++) game.add_manual_click();
    } else {
        for (let i = 0; i < actualClicks; i++) game.add_manual_click();
    }
    updatePowerGlow();
    scheduleCloudSave();
    setTimeout(() => { if (Date.now() - lastClickTime > 1500) comboCount = 0; }, 1500);
}

function toggleAutoClicking() {
    if (!game) return;
    if (isAutoClicking) {
        game.stop_auto_clicking();
        isAutoClicking = false;
        const btn = document.getElementById('floatingMineBtn');
        if (btn) btn.classList.remove('auto-clicking');
        const status = document.getElementById('autoClickStatus');
        if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
        localStorage.setItem('corebox_autoclicking', 'false');
        Sounds.autoStop && Sounds.autoStop();
    } else {
        if (game.get_computational_power() > 0) {
            game.start_auto_clicking();
            isAutoClicking = true;
            const btn = document.getElementById('floatingMineBtn');
            if (btn) btn.classList.add('auto-clicking');
            const status = document.getElementById('autoClickStatus');
            if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
            localStorage.setItem('corebox_autoclicking', 'true');
            Sounds.autoStart && Sounds.autoStart();
        } else {
            const btn = document.getElementById('floatingMineBtn');
            if (btn) {
                btn.classList.add('no-power');
                Sounds.error();
                setTimeout(() => btn.classList.remove('no-power'), 800);
            }
        }
    }
    updatePowerGlow();
    scheduleCloudSave();
}

function setupLongPressHandlers() {
    const btn = document.getElementById('floatingMineBtn');
    let timer;
    if (!btn) return;
    btn.addEventListener('mousedown', () => timer = setTimeout(() => toggleAutoClicking(), 600));
    btn.addEventListener('mouseup', () => clearTimeout(timer));
    btn.addEventListener('mouseleave', () => clearTimeout(timer));
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); timer = setTimeout(() => toggleAutoClicking(), 600); }, { passive: false });
    btn.addEventListener('touchend', () => clearTimeout(timer));
    btn.addEventListener('touchcancel', () => clearTimeout(timer));
}

function renderUpgradesTab() {
    const container = document.getElementById('upgradesContainer');
    if (!container) return;
    
    let stats = null;
    try { 
        const j = game?.get_statistics(); 
        if (j) stats = JSON.parse(j); 
    } catch(e) {}
    
    const inv = {
        coal: stats?.coal_inventory ?? 0,
        ore: stats?.ore_inventory ?? 0,
        chips: stats?.chips_inventory ?? 0,
        plasma: stats?.plasma_inventory ?? 0,
        trash: stats?.trash_inventory ?? 0
    };
    
    const miningLevel = stats?.upgrades?.mining ?? 0;
    const defenseActive = stats?.upgrades?.defense ?? false;
    const defenseLevel = stats?.upgrades?.defense_level ?? 0;
    const critLevel = stats?.crit_level ?? 0;
    const coolingLevel = stats?.cooling_level ?? 0;
    const turbineLevel = stats?.turbine_upgrade_level ?? 0;
    
    const miningChipsCost = 10 + miningLevel * 2;
    const defensePlasmaCost = 1;
    const defenseChipsCost = (defenseLevel + 1) * 10;
    const defensePlasmaLevelCost = 1 + Math.floor(defenseLevel / 2);
    const turbineOreCost = 30 + turbineLevel * 20;
    const turbineChipsCost = 5 + turbineLevel * 3;
    const critCost = (critLevel + 1) * 2 + 4;
    const coolingCost = 500 * (coolingLevel + 1);
    
    const html = `
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">⛏️ ЭФФЕКТИВНОСТЬ ДОБЫЧИ</div>
                <div class="upgrade-level">УР. ${miningLevel}/10</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${miningLevel * 10}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🎛️</span><span>МИКРОСХЕМЫ:</span></div>
                    <div class="requirement-value">${inv.chips}/${miningChipsCost}</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeMiningBtn" class="upgrade-btn" ${inv.chips >= miningChipsCost && miningLevel < 10 ? '' : 'disabled'}>АКТИВИРОВАТЬ</button>
            </div>
        </div>
        
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">🛡️ СИСТЕМА ЗАЩИТЫ</div>
                <div class="upgrade-level" id="defenseStatusText">${defenseActive ? 'АКТИВНА' : 'НЕАКТИВНА'}</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${defenseActive ? 100 : 0}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">⚡</span><span>ПЛАЗМА:</span></div>
                    <div class="requirement-value">${inv.plasma}/${defensePlasmaCost}</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeDefenseBtn" class="upgrade-btn" ${!defenseActive && inv.plasma >= defensePlasmaCost ? '' : 'disabled'}>АКТИВИРОВАТЬ</button>
            </div>
        </div>
        
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">💪 УСИЛЕНИЕ ЗАЩИТЫ</div>
                <div class="upgrade-level">УР. ${defenseLevel}/5</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${defenseLevel * 20}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🎛️</span><span>МИКРОСХЕМЫ:</span></div>
                    <div class="requirement-value">${inv.chips}/${defenseChipsCost}</div>
                </div>
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">⚡</span><span>ПЛАЗМА:</span></div>
                    <div class="requirement-value">${inv.plasma}/${defensePlasmaLevelCost}</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeDefenseLevelBtn" class="upgrade-btn" ${defenseActive && defenseLevel < 5 && inv.chips >= defenseChipsCost && inv.plasma >= defensePlasmaLevelCost ? '' : 'disabled'}>УСИЛИТЬ</button>
            </div>
        </div>
        
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">⚙️ ТУРБИНА</div>
                <div class="upgrade-level">УР. ${turbineLevel}/5</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${turbineLevel * 20}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">⛏️</span><span>РУДА:</span></div>
                    <div class="requirement-value">${inv.ore}/${turbineOreCost}</div>
                </div>
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🎛️</span><span>ЧИПЫ:</span></div>
                    <div class="requirement-value">${inv.chips}/${turbineChipsCost}</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeTurbineBtn" class="upgrade-btn" ${turbineLevel < 5 && inv.ore >= turbineOreCost && inv.chips >= turbineChipsCost ? '' : 'disabled'}>УЛУЧШИТЬ</button>
            </div>
        </div>
        
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">💥 КРИТ-МОДУЛЬ</div>
                <div class="upgrade-level">Ур. ${critLevel}/10</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${critLevel * 10}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">💰</span><span>СТОИМОСТЬ:</span></div>
                    <div class="requirement-value">по ${critCost} каждого</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeCritBtn" class="upgrade-btn" ${critLevel < 10 && inv.coal >= critCost && inv.ore >= critCost && inv.chips >= critCost && inv.plasma >= critCost && inv.trash >= critCost ? '' : 'disabled'}>ПРОКАЧАТЬ КРИТ</button>
            </div>
        </div>
        
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">❄️ ОХЛАЖДЕНИЕ</div>
                <div class="upgrade-level">Ур. ${coolingLevel}/10</div>
            </div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${coolingLevel * 10}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🪨</span><span>СТОИМОСТЬ:</span></div>
                    <div class="requirement-value">${coolingCost} угля</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeCoolingBtn" class="upgrade-btn" ${coolingLevel < 10 && inv.coal >= coolingCost ? '' : 'disabled'}>ПРОКАЧАТЬ ОХЛАЖДЕНИЕ</button>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
    
    container.querySelectorAll('.upgrade-btn').forEach(btn => {
        if (btn.disabled) return;
        if (btn.id === 'upgradeMiningBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_mining(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeDefenseBtn') btn.onclick = () => { Sounds.upgrade(); game.activate_defense(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeDefenseLevelBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_defense(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeTurbineBtn') btn.onclick = () => { Sounds.upgrade(); if(game.upgrade_turbine()) scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeCritBtn') btn.onclick = () => { Sounds.upgrade(); if(game.upgrade_crit_module) game.upgrade_crit_module(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeCoolingBtn') btn.onclick = () => { Sounds.upgrade(); if(game.upgrade_cooling_module) game.upgrade_cooling_module(); scheduleCloudSave(); renderUpgradesTab(); };
    });
}

function switchMainTab(tabName) {
    const tabs = ['inventory', 'upgrades', 'trade', 'quests', 'command', 'craft', 'design', 'fleet', 'space'];
    tabs.forEach(t => {
        const el = document.getElementById(`${t}-tab`);
        if (el) { el.style.display = 'none'; el.classList.remove('active'); }
    });
    const active = document.getElementById(`${tabName}-tab`);
    if (active) { active.style.display = 'block'; active.classList.add('active'); }
    tabs.forEach(t => {
        const btn = document.getElementById(`${t}-tab-btn`);
        if (btn) btn.classList.toggle('active', t === tabName);
    });
    
    if (tabName === 'upgrades') {
        renderUpgradesTab();
    } else if (tabName === 'craft') {
        updateCraftTab();
    } else if (tabName === 'design') {
        updateDesignTab();
    } else if (tabName === 'fleet') {
        _refreshFleetWithMissions();
    } else if (tabName === 'trade') {
        renderTradeTab();
    } else if (tabName === 'space') {
        if (spaceModule.initialized) {
            spaceModule.onTabActivated();
        }
    }
}

function updateCraftTab() {
    if (!game) return;
    const container = document.getElementById('craftContainer');
    if (!container) return;
    try {
        const j = game.get_statistics();
        if (j) {
            const stats = JSON.parse(j);
            craftModule.syncFromStats(stats);
            container.innerHTML = craftModule.renderCraftUI();
            craftModule.setupEventListeners(container);
        }
    } catch(e) {}
}

function updateDesignTab() {
    if (!game) return;
    const container = document.getElementById('designContainer');
    if (!container) return;
    try {
        designModule.updateComputationalPower(game.get_computational_power());
        container.innerHTML = designModule.renderDesignUI();
        designModule.setupEventListeners(container);
    } catch(e) {}
}

function updateFleetTab() {
    const container = document.getElementById('fleetContainer');
    if (!container) return;
    try {
        container.innerHTML = fleetModule.renderFleetUI();
        const newContainer = fleetModule.setupEventListeners(container);
    } catch(e) {}
}

const BASE_TRADES = [
    { id: 'coal_to_ore', from: 'coal', fromAmt: 3, to: 'ore', toAmt: 1 },
    { id: 'ore_to_coal', from: 'ore', fromAmt: 1, to: 'coal', toAmt: 2 },
    { id: 'ore_to_chips', from: 'ore', fromAmt: 50, to: 'chips', toAmt: 1 },
    { id: 'chips_to_ore', from: 'chips', fromAmt: 1, to: 'ore', toAmt: 30 },
    { id: 'coal_to_plasma', from: 'coal', fromAmt: 80, to: 'plasma', toAmt: 1 },
    { id: 'plasma_to_coal', from: 'plasma', fromAmt: 1, to: 'coal', toAmt: 60 },
    { id: 'chips_to_plasma', from: 'chips', fromAmt: 5, to: 'plasma', toAmt: 1 },
    { id: 'plasma_to_chips', from: 'plasma', fromAmt: 1, to: 'chips', toAmt: 4 },
];
const RES_ICON = { coal: '🪨', ore: '⛏️', chips: '🎛️', plasma: '⚡', trash: '🗑️' };
const RES_NAME = { coal: 'уголь', ore: 'руда', chips: 'чип', plasma: 'плазма' };
let activeDiscount = null;
let lastDiscountNight = -1;

function rollNightDiscount(nightIndex) {
    if (nightIndex === lastDiscountNight) return;
    lastDiscountNight = nightIndex;
    activeDiscount = null;
    if (Math.random() < 0.25) {
        const idx = Math.floor(Math.random() * BASE_TRADES.length);
        activeDiscount = { tradeId: BASE_TRADES[idx].id, nightIndex };
        addToLog(`🏷️ Ночная скидка 50%: ${RES_ICON[BASE_TRADES[idx].from]}→${RES_ICON[BASE_TRADES[idx].to]}`);
        renderTradeTab();
    }
}

function onDayStarted() { if (activeDiscount) { activeDiscount = null; renderTradeTab(); } }

function renderTradeTab() {
    const container = document.getElementById('buyItemsContainer');
    if (!container || !game) return;
    let stats = null;
    try { const j = game.get_statistics(); if (j) stats = JSON.parse(j); } catch(e) {}
    const inv = {
        coal: stats?.coal_inventory || 0,
        ore: stats?.ore_inventory || 0,
        chips: stats?.chips_inventory || 0,
        plasma: stats?.plasma_inventory || 0,
    };
    container.innerHTML = BASE_TRADES.map(t => {
        const hasDisc = activeDiscount?.tradeId === t.id;
        const cost = hasDisc ? Math.max(1, Math.ceil(t.fromAmt * 0.5)) : t.fromAmt;
        const canAfford = inv[t.from] >= cost;
        const discBadge = hasDisc ? `<span class='disc-badge'>-50% 🏷️</span>` : '';
        return `<div class='trade-card ${canAfford ? '' : 'trade-disabled'}'>${discBadge}<div class='trade-from'>${RES_ICON[t.from]} ${cost} <small>${RES_NAME[t.from]}</small></div><div class='trade-arr'>→</div><div class='trade-to'>${RES_ICON[t.to]} ${t.toAmt} <small>${RES_NAME[t.to]}</small></div><div class='trade-have'>Есть: ${inv[t.from]}</div><button onclick='window.executeTrade && window.executeTrade("${t.id}")' ${canAfford ? '' : 'disabled'}>ОБМЕНЯТЬ</button></div>`;
    }).join('');
}

window.executeTrade = function(tradeId) {
    if (!game) return;
    const t = BASE_TRADES.find(x => x.id === tradeId);
    if (!t) return;
    const hasDisc = activeDiscount?.tradeId === tradeId;
    const cost = hasDisc ? Math.max(1, Math.ceil(t.fromAmt * 0.5)) : t.fromAmt;
    try {
        game.subtract_resource(t.from, cost);
        game.add_resource(t.to, t.toAmt);
        addToLog(`🔄 Обмен: -${cost} ${RES_ICON[t.from]} → +${t.toAmt} ${RES_ICON[t.to]}`);
        Sounds.trade && Sounds.trade();
        renderTradeTab();
        scheduleCloudSave();
    } catch(e) { addToLog('❌ Недостаточно ресурсов'); Sounds.error(); }
};

function setupEventListeners() {
    const floatingBtn = document.getElementById('floatingMineBtn');
    if (floatingBtn) floatingBtn.addEventListener('click', handleClick);
    setupLongPressHandlers();
    
    const tabs = [
        { id: 'inventory-tab-btn', tab: 'inventory' }, { id: 'upgrades-tab-btn', tab: 'upgrades' },
        { id: 'trade-tab-btn', tab: 'trade' }, { id: 'quests-tab-btn', tab: 'quests' },
        { id: 'command-tab-btn', tab: 'command' }, { id: 'craft-tab-btn', tab: 'craft' },
        { id: 'design-tab-btn', tab: 'design' }, { id: 'fleet-tab-btn', tab: 'fleet' },
        { id: 'space-tab-btn', tab: 'space' }
    ];
    tabs.forEach(({ id, tab }) => document.getElementById(id)?.addEventListener('click', () => switchMainTab(tab)));
    
    document.addEventListener('click', (e) => {
        if (!game) return;
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        const resource = target.getAttribute('data-resource');
        Sounds.click && Sounds.click();
        if (action === 'buy' && resource) game.buy_resource(resource);
        else if (action === 'sell' && resource) game.sell_resource(resource);
        else if (action === 'toggle-coal') game.toggle_coal();
    });
    
    const clearLog = document.getElementById('clearLogBtn');
    if (clearLog) clearLog.onclick = () => { if (game && typeof game.clear_log === 'function') game.clear_log(); Sounds.click && Sounds.click(); };
    
    const systemTab = document.getElementById('system-status-tab');
    if (systemTab) systemTab.onclick = () => { switchStatusTab('system-status'); Sounds.click && Sounds.click(); };
    const statsTab = document.getElementById('statistics-tab');
    if (statsTab) statsTab.onclick = () => { switchStatusTab('statistics'); updateStatsFromGame(); updateNeuroStatus(); Sounds.click && Sounds.click(); };
    const leaderTab = document.getElementById('leaderboard-tab');
    if (leaderTab) leaderTab.onclick = () => { switchStatusTab('leaderboard'); loadLeaderboard(); Sounds.click && Sounds.click(); };
    const refreshLeader = document.getElementById('refreshLeaderboardBtn');
    if (refreshLeader) refreshLeader.onclick = () => { loadLeaderboard(); Sounds.click && Sounds.click(); };
    const refreshStats = document.getElementById('refreshStatsBtn');
    if (refreshStats) refreshStats.onclick = () => { updateStatisticsDisplay(); Sounds.click && Sounds.click(); };
    
    const resetStats = document.getElementById('resetStatsBtn');
    if (resetStats) resetStats.onclick = () => {
        Sounds.error();
        const wasReset = resetUserStatistics();
        if (wasReset) {
            document.dispatchEvent(new CustomEvent('resetUserStats', { detail: { stats: gameStats } }));
            saveCurrentUserStatistics();
        } else {
            Sounds.click && Sounds.click();
        }
    };
    
    const prestigeBtn = document.getElementById('prestigeBtn');
    if (prestigeBtn) prestigeBtn.onclick = () => { prestigeReset(); Sounds.click && Sounds.click(); };
    const autoScroll = document.getElementById('autoScrollBtn');
    if (autoScroll) autoScroll.onclick = () => { Sounds.click && Sounds.click(); const log = document.getElementById('logBox'); if (log) log.scrollTop = log.scrollHeight; };
    
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => handleLogout();
    
    document.addEventListener('craftResult', (e) => {
        if (e.detail) {
            const notif = document.createElement('div');
            notif.className = `notification ${e.detail.success ? 'success' : 'error'}`;
            notif.textContent = e.detail.success ? e.detail.message : e.detail.error;
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 2000);
            if (e.detail.success && e.detail.recipe?.result?.type === 'ship') {
                fleetModule.addShip(e.detail.recipe.result.subtype);
                scheduleCloudSave();
            }
        }
    });
    document.addEventListener('designResult', (e) => { if (e.detail?.success) scheduleCloudSave(); });
    document.addEventListener('fleetAction', (e) => { if (e.detail?.success) scheduleCloudSave(); });
}

function saveCurrentUserStatistics() {
    if (!currentUser) return;
    const users = JSON.parse(localStorage.getItem('corebox_users') || '{}');
    if (!users[currentUser.email]) users[currentUser.email] = {};
    users[currentUser.email].statistics = {
        totalClicks: gameStats.totalClicks, maxPowerReached: gameStats.maxPowerReached,
        nightsSurvived: gameStats.nightsSurvived, rebelAttacks: gameStats.rebelAttacks,
        attacksDefended: gameStats.attacksDefended, coalMined: gameStats.coalMined,
        trashMined: gameStats.trashMined, plasmaMined: gameStats.plasmaMined,
        oreMined: gameStats.oreMined || 0, coalBurned: gameStats.coalBurned,
        coalStolen: gameStats.coalStolen, playTime: gameStats.playTime,
        sessionsCount: gameStats.sessionsCount, lastSessionDate: gameStats.lastSessionDate
    };
    localStorage.setItem('corebox_users', JSON.stringify(users));
}

async function initializeGame(existingSave = null) {
    if (isGameInitialized) return;
    
    try {
        await init();
        await loadConfig();
        game = start_game();
        window.game = game;
        window.fleetModule = fleetModule;
        
        let loadedFromCloud = false;
        
        if (existingSave) {
            try {
                game.load_game_state(JSON.stringify(existingSave));
                addToLog("💾 Загружено облачное сохранение");
                loadedFromCloud = true;
            } catch(e) {
                console.warn("Ошибка загрузки переданного сохранения:", e);
            }
        }
        
        if (!loadedFromCloud && currentUser) {
            const cloudSave = await loadFromCloudAndMerge();
            loadedFromCloud = !!cloudSave;
        }
        
        if (!loadedFromCloud) {
            const savedGame = localStorage.getItem('corebox_save');
            if (savedGame) {
                try {
                    game.load_game_state(savedGame);
                    addToLog("💾 Загружено локальное сохранение");
                } catch(e) {
                    console.warn("Ошибка загрузки локального сохранения:", e);
                }
            } else {
                addToLog("⚠️ Сохранений не найдено, начинаем новую игру");
            }
        }
        
        // ПРИМЕНЯЕМ PENDING LOOT ПОСЛЕ ЗАГРУЗКИ
        _applyPendingLoot();
        
        if (localStorage.getItem('corebox_autoclicking') === 'true') {
            isAutoClicking = true;
            setTimeout(() => {
                if (isAutoClicking && game && game.get_computational_power() > 0) {
                    game.start_auto_clicking();
                    document.getElementById('floatingMineBtn')?.classList.add('auto-clicking');
                    const status = document.getElementById('autoClickStatus');
                    if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
                    Sounds.autoStart && Sounds.autoStart();
                } else {
                    isAutoClicking = false;
                    localStorage.setItem('corebox_autoclicking', 'false');
                    document.getElementById('floatingMineBtn')?.classList.remove('auto-clicking');
                    const status = document.getElementById('autoClickStatus');
                    if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
                }
            }, 2000);
        }
        
        if (!gameStats.startTime) gameStats.startTime = Date.now();
        craftModule.init(game);
        designModule.init(game);
        fleetModule.init(game);
        spaceModule.init(game, currentUser);
        initStatistics();
        setupEventListeners();
        initializeCollapsiblePanels();
        updatePowerGlow();
        setupLogObserver();
        isGameInitialized = true;
        
        if (_gameLoopInterval) clearInterval(_gameLoopInterval);
        _gameLoopInterval = setInterval(() => {
            if (!game) return;
            game.game_loop();
            updatePowerGlow();
            let rustStats = null;
            let prevAttackCount = lastRustStats?.rebel_attacks_count || 0;
            let prevIsDay = lastRustStats?.is_day;
            try { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); } catch(e) {}
            if (rustStats) {
                if (rustStats.rebel_attacks_count > prevAttackCount) {
                    const lastAttack = rustStats.attack_history?.[rustStats.attack_history.length - 1];
                    if (lastAttack?.was_defended) Sounds.defended && Sounds.defended();
                    else Sounds.hit && Sounds.hit();
                }
                if (rustStats.is_day !== prevIsDay) {
                    if (rustStats.is_day) Sounds.dayStart && Sounds.dayStart();
                    else Sounds.nightStart && Sounds.nightStart();
                }
                updateStatsFromGame(rustStats);
                updateNeuroStatus(rustStats);
                updateTurbineStatus(rustStats);
                updateUpgradeDisplay(rustStats);
                
                const turbineLevel = rustStats.turbine_upgrade_level ?? 0;
                const turbineLevelEl = document.getElementById('turbineLevel');
                if (turbineLevelEl) turbineLevelEl.textContent = `УР. ${turbineLevel}/5`;
                const turbineCostEl = document.getElementById('turbineCost');
                if (turbineCostEl) turbineCostEl.textContent = `${30 + turbineLevel * 20}⛏️ + ${5 + turbineLevel * 3}🎛️`;
                const turbineBtn = document.getElementById('upgradeTurbineBtn');
                if (turbineBtn) turbineBtn.disabled = turbineLevel >= 5;
                
                craftModule.syncFromStats(rustStats);
                craftModule.aiProductionBonus = Math.min(30, (rustStats.neuro_evolution || 0) * 1.5);
                designModule.aiResearchBonus = Math.floor((rustStats.neuro_consciousness || 0) / 20);
                designModule.updateComputationalPower(game.get_computational_power());
                
                const fleetCombat = fleetModule.getFleetDefenseContribution();
                const fleetCargo = fleetModule.getCargoMiningBonus();
                try {
                    if (typeof game.set_fleet_defense_bonus === 'function' && fleetCombat > 0) game.set_fleet_defense_bonus(Math.floor(fleetCombat / 50));
                    if (typeof game.set_fleet_cargo_bonus === 'function' && fleetCargo > 0) game.set_fleet_cargo_bonus(fleetCargo);
                } catch(e) {}
                
                if (rustStats.current_ai_mode) {
                    const mode = rustStats.current_ai_mode;
                    if (mode.includes('Стратегическое отступление') || mode.includes('консервирует')) {
                        if (typeof game.set_temporary_defense_bonus === 'function') game.set_temporary_defense_bonus(40);
                    } else if (mode.includes('Предсказание') || mode.includes('угроза')) fleetModule.setAlertMode(true);
                    else { fleetModule.setAlertMode(false); if (typeof game.set_temporary_defense_bonus === 'function') game.set_temporary_defense_bonus(0); }
                } else fleetModule.setAlertMode(false);
                
                const history = rustStats.attack_history || [];
                if (history.length > 0) {
                    const last = history[history.length - 1];
                    const attackKey = `${last.game_time}_${last.faction}_${last.was_defended}`;
                    if (last && !last.was_defended && attackKey !== lastProcessedAttackHash) {
                        lastProcessedAttackHash = attackKey;
                        const damageResult = fleetModule.damageRandomCombatShip(last.attack_type);
                        if (damageResult) addToLog(`⚔️ ${damageResult.shipName} получил ${damageResult.damage} урона! (${damageResult.newHealth}/${damageResult.maxHealth})`);
                    }
                }
                
                if (rustStats.nights_survived !== undefined) rollNightDiscount(rustStats.nights_survived);
                
                if (currentUser && rustStats) {
                    window._autoSaveCounter = (window._autoSaveCounter || 0) + 1;
                    if (window._autoSaveCounter >= 30) {
                        window._autoSaveCounter = 0;
                        cloudSaveNow(false);
                    }
                    window._leaderCounter = (window._leaderCounter || 0) + 1;
                    if (window._leaderCounter >= 10) {
                        window._leaderCounter = 0;
                        syncStatisticsToCloud({
                            total_mined: rustStats.total_clicks || 0,
                            neuro_score: rustStats.neuro_score || 0,
                            nights_survived: rustStats.nights_survived || 0
                        });
                    }
                }
                lastRustStats = rustStats;
                
                const channel = getUniversalChannel();
                if (channel) {
                    try {
                        channel.postMessage({
                            type: 'game_loop',
                            stats: rustStats,
                            power: game.get_computational_power(),
                            maxPower: game.get_max_computational_power ? game.get_max_computational_power() : 1000,
                            fleet: fleetModule.ships,
                            timestamp: Date.now()
                        });
                    } catch(e) {}
                }
            }
            randomEventTimer++;
            if (randomEventTimer >= 30) {
                randomEventTimer = 0;
                const evol = rustStats?.neuro_evolution || 0;
                const eventBonus = Math.min(evol / 1000, 0.05) + getPrestigeBonus().eventBonus;
                if (Math.random() < 0.03 + eventBonus) triggerRandomEvent();
            }
            if (!isAutoClicking && Date.now() - lastClickTime > 1500) comboCount = 0;
        }, 1000);
        
        setInterval(loadConfig, 30000);
        setInterval(() => {
            if (currentUser && game) {
                cloudSaveNow(false);
            }
        }, 30000);
        
    } catch(e) { 
        console.error("Ошибка запуска:", e);
        addToLog(`❌ Ошибка инициализации: ${e.message}`, "error");
    }
}

let lastConfigHash = null;
async function loadConfig() {
    try {
        const resp = await fetch("config.json?_=" + Date.now());
        const configStr = await resp.text();
        let hash = 0;
        for (let i = 0; i < configStr.length; i++) { hash = ((hash << 5) - hash) + configStr.charCodeAt(i); hash |= 0; }
        if (hash !== lastConfigHash) {
            lastConfigHash = hash;
            try { apply_config_from_admin(configStr); } catch(e) {}
            if (game) game.reload_config();
        }
    } catch(e) {}
}

window.addEventListener('beforeunload', () => {
    if (currentUser && game) {
        if (typeof game.save_current_state === 'function') {
            game.save_current_state();
        }
        const state = getCurrentGameState();
        if (state) localStorage.setItem('corebox_save_backup', JSON.stringify(state));
        saveCurrentUserStatistics();
        updateLastSeen();
    }
});
setInterval(() => { if (currentUser && gameStats) scheduleSave(); }, 30000);

document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
});

document.addEventListener('resetUserStats', (e) => { if (e.detail && currentUser) saveCurrentUserStatistics(); });
document.addEventListener('gameEvent', (e) => {
    if (e.detail && currentUser) {
        const { type, amount = 1 } = e.detail;
        if (type === 'coal_mined') gameStats.coalMined += amount;
        else if (type === 'trash_mined') gameStats.trashMined += amount;
        else if (type === 'plasma_mined') gameStats.plasmaMined += amount;
        else if (type === 'ore_mined') gameStats.oreMined = (gameStats.oreMined || 0) + amount;
        else if (type === 'coal_burned') gameStats.coalBurned += amount;
        else if (type === 'coal_stolen') gameStats.coalStolen += amount;
        else if (type === 'night_started') gameStats.nightsSurvived++;
        else if (type === 'rebel_attack') gameStats.rebelAttacks++;
        else if (type === 'attack_defended') gameStats.attacksDefended++;
        else if (type === 'day_started') onDayStarted();
        scheduleSave();
    }
});
setTimeout(() => {
    if (document.getElementById('leaderboardContainer') && currentUser) loadLeaderboard();
}, 3000);