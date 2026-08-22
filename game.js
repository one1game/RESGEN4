import init, { start_game, apply_config_from_admin } from './pkg/corebox_rs.js';
import { initStatistics, updateStatisticsDisplay, switchTab, gameStats, loadUserStatistics, resetUserStatistics, updateStatisticsFromRust, scheduleStatsDisplayUpdate } from './statistics.js';
import { checkAchievements } from './achievements.js';
import { craftModule } from './craft.js';
import { designModule } from './design.js';
import { fleetModule } from './fleet.js';
import { spaceModule } from './space-module.js';
import { Sounds } from './sounds.js';
import { initAuth, logout, getCurrentUser, login, register } from './auth.js';
import { saveGameToCloud, loadGameFromCloud, syncStatisticsToCloud, ensureMapPosition, applyPendingLoot } from './save.js';
import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';
import { QUESTS_CONTENT, applyQuestReward, getQuestContent } from './quests_content.js';
import {
    sendShip,
    processArrivedMissions,
    getTargetPlayers,
    getLatestScoutData,
    getUnreadNotifications,
    markAllNotificationsRead,
    subscribeToNotifications,
} from './multiplayer_combat.js';
import { tradeModule } from './trade.js';
import { escapeHtml, normalizeNeuroConsciousness } from './utils.js';

window.sendShipAction = sendShip;

function cleanupPrestigeData() {
  localStorage.removeItem('corebox_prestige_level');
  console.log('🧹 Данные престижа удалены');
}

function updateDayNightVisuals(stats) {
    const container = document.getElementById('timeDisplay');
    if (!container || !stats) return;

    const isDay = stats.is_day;
    const currentTime = stats.game_time;
    const maxTime = isDay
        ? (window.gameConfig?.time_config?.day_duration || 180)
        : (window.gameConfig?.time_config?.night_duration || 300);

    const safeTime = Math.max(0, currentTime || 0);
    const percent = Math.max(0, Math.min(100, (safeTime / maxTime) * 100));
    const mins = Math.floor(safeTime / 60);
    const secs = safeTime % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    const icon = isDay ? '☀️' : '🌙';
    const text = isDay ? 'ДЕНЬ' : 'НОЧЬ';
    const color = isDay ? '#ffcc44' : '#4a9eff';

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <span style="font-size:20px;">${icon}</span>
            <div style="flex:1; display:flex; flex-direction:column; gap:3px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; color:${color}; font-weight:bold;">
                    <span>${text}</span>
                    <span style="font-variant-numeric: tabular-nums;">${timeStr}</span>
                </div>
                <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                    <div style="width:${percent}%; height:100%; background: linear-gradient(90deg, ${color}, ${isDay ? '#ff9900' : '#0044ff'}); transition: width 1s linear; border-radius:4px;"></div>
                </div>
            </div>
        </div>
    `;
}

const RES_ICON = { coal: '🪨', ore: '⛏️', chips: '🎛️', plasma: '⚡', trash: '🗑️' };
const RES_NAME = { coal: 'уголь', ore: 'руда', chips: 'чип', plasma: 'плазма', trash: 'мусор' };

const SAVE_KEY = (userId) => `corebox_v2_${userId || 'local'}`;
const USER_STORAGE_KEY = (base, userId = currentUser?.id) => `${base}_${userId || 'anon'}`;

let game;
let currentUser = null;
let lastRustStats = null;
let isAutoClicking = false;
let isGameInitialized = false;
let comboCount = 0;
let lastClickTime = 0;

let _saveTimer = null;
let _cloudSaveTimer = null;
let _lastSeenTimer = null;
let _tradeListenerAttached = false;
function attachTradeListener() {
    if (_tradeListenerAttached) return;
    _tradeListenerAttached = true;
    GameBus.on(EVENTS.TRADE_DONE, async (data) => {
        if (data.type === 'created') {
            addToLog('📝 Вы выставили предложение на рынок');
        } else if (data.type === 'accepted') {
            addToLog('✅ P2P-обмен завершён');
        }
        await reloadInventoryFromCloud();
    });
}
let lastProcessedAttackHash = null;
let _gameLoopRAF = null;
let _lastFrameTime = 0;
let offlineProgressShown = false;
let lastAlertMode = null;
let _missionTimerInterval = null;
let _lowPowerWarned = false;
let _comboResetTimer = null;
let _lastAutoClickSound = 0;
let _isSaving = false;
let _nightWarnShown = false;
let _currentTab = 'inventory';
let _fleetUITimer = null;
let _lastCloudSave = 0;
let _ccClockInterval = null;
let _lastInterceptCount = 0;
let _attackHistoryCollapsed = true;
let _accumulatedDelta = 0;
const GAME_TICK_MS = 1000;
let _ticksThisFrame = 0;

let _catchupFramesLeft = 0;
const MAX_CATCHUP_FRAMES = 60;
const MAX_ACCUMULATED = GAME_TICK_MS * 30;

let _lastCloudLoadTime = 0;

let _notifChannel = null;
let _missionPollInterval = null;
let _missionChannel = null;
let _incomingChannel = null;
let _universalChannel = null;
let _keepAliveChannel = null;
let _pvpChannel = null;

let cachedRustStats = null;
let cachedRustStatsTime = 0;

let _sessionId = Math.random().toString(36).substring(2, 10);

let _totalNeuroScoreEarned = parseInt(localStorage.getItem('cc_total_score') || '0');
let _lastKnownNeuroScore = 0;

let lastDiscountNight = (() => {
    for (let i = 0; i < 100; i++) {
        if (localStorage.getItem(`corebox_discount_night_${i}`)) return i;
    }
    return null;
})();

let _fleetAttackTimeout = null;

let _lastIntelTime = 0;
let _cachedIntel = null;
let _cachedMessages = null;

let _tabHiddenInterval = null;
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        _lastFrameTime = 0;
        _tabHiddenInterval = setInterval(() => {
            try { if (game) game.game_loop(); } catch(e) {}
        }, 1000);
    } else {
        if (_tabHiddenInterval) {
            clearInterval(_tabHiddenInterval);
            _tabHiddenInterval = null;
        }
    }
});

window._processedEtaMessages = new Set();

function shouldSkipAutoSave() {
    return Date.now() - _lastCloudLoadTime < 10000;
}

function rollNightDiscount(nightIndex, isNightStart) {
    if (!isNightStart) return;
    if (nightIndex === lastDiscountNight) return;
    const storageKey = `corebox_discount_night_${nightIndex}`;
    try {
        if (localStorage.getItem(storageKey)) {
            lastDiscountNight = nightIndex;
            return;
        }
        lastDiscountNight = nightIndex;
        localStorage.setItem(storageKey, '1');

        let stats = null;
        try { stats = JSON.parse(game.get_statistics()); } catch(e) {}
        if (stats?.trade_blocked) return;
    } catch(e) {
        console.warn('rollNightDiscount localStorage error:', e);
    }
}

function onDayStarted() {
    if (lastDiscountNight !== null && lastDiscountNight >= 0) {
        const prevKey = `corebox_discount_night_${lastDiscountNight}`;
        localStorage.removeItem(prevKey);
    }
    lastDiscountNight = null;
    _nightWarnShown = false;
}

window.rollNightDiscount = rollNightDiscount;
window.onDayStarted = onDayStarted;

function updateTecUI() {
    const tecBtn = document.getElementById('tec-toggle-btn');
    const tecStatusSpan = document.getElementById('coalStatusDisplay');
    const tecDot = document.getElementById('tec-dot');
    const tecWarning = document.getElementById('tec-warning');
    const coalInventorySpan = document.getElementById('coalInventoryAmount');
    const tecPowerBonusSpan = document.getElementById('tecPowerBonus');

    if (!tecBtn) return;

    let stats = cachedRustStats;
    if (!stats && game) {
        try {
            const j = game.get_statistics();
            if (j) stats = JSON.parse(j);
        } catch(e) {}
    }
    if (!stats) return;

    const isCoalEnabled = stats.coal_enabled === true;
    const hasCoal = (stats.coal_inventory || 0) > 0;
    const isDay = stats.is_day === true;
    const coalAmount = stats.coal_inventory || 0;

    const isTecSabotaged = stats.tec_sabotaged === true;
    const tecSabotageRemaining = stats.tec_sabotage_remaining || 0;

    if (coalInventorySpan) {
        coalInventorySpan.textContent = coalAmount;
    }

    const cfg = window.gameConfig?.game_balance_config;
    const coalBonus = cfg?.coal_mining_bonus ?? 2;
    const tecBonus = isCoalEnabled ? coalBonus : 0;

    if (tecPowerBonusSpan) {
        tecPowerBonusSpan.textContent = `+${tecBonus}`;
    }

    let statusText = "ОФФЛАЙН";
    let statusColor = "#ff6a6a";

    if (isTecSabotaged) {
        statusText = `🔥 САБОТАЖ (${tecSabotageRemaining}т)`;
        statusColor = "#ff4444";
    } else if (isCoalEnabled) {
        statusText = "АКТИВНА";
        statusColor = "#4aff9d";
    }

    if (tecStatusSpan) {
        tecStatusSpan.textContent = statusText;
        tecStatusSpan.style.color = statusColor;
    }

    const coalStatusEl = document.getElementById('coalStatus');
    if (coalStatusEl) {
        coalStatusEl.textContent = statusText;
        coalStatusEl.style.color = statusColor;
    }

    if (tecDot) {
        tecDot.className = isTecSabotaged
            ? 'tec-dot offline'
            : `tec-dot ${isCoalEnabled ? 'online' : 'offline'}`;
    }

    const isDisabled = isTecSabotaged || (!isCoalEnabled && !hasCoal);
    tecBtn.disabled = isDisabled;
    tecBtn.style.opacity = isDisabled ? "0.5" : "1";

    if (tecWarning) {
        if (isTecSabotaged) {
            tecWarning.textContent = `🔥 ТЭЦ САБОТИРОВАНА повстанцами! Повторное включение невозможно. Подождите ${tecSabotageRemaining} тиков.`;
            tecWarning.style.display = "block";
            tecWarning.style.backgroundColor = "rgba(255,68,68,0.15)";
            tecWarning.style.color = "#ff6644";
            tecWarning.style.borderLeftColor = "#ff4444";
            tecWarning.className = "tec-warning warning-sabotage";
        } else if (isDay && !isCoalEnabled && hasCoal) {
            tecWarning.textContent = "⚠️ День, ТЭЦ выключена. Добыча работает, но в 2 раза медленнее. Включите ТЭЦ для полной эффективности!";
            tecWarning.style.display = "block";
            tecWarning.className = "tec-warning warning-day";
        } else if (!isDay && !isCoalEnabled) {
            if (!hasCoal) {
                tecWarning.textContent = "⚠️ НОЧЬ! Угля нет. Добыча невозможна! Добудьте уголь или включите ТЭЦ.";
            } else {
                tecWarning.textContent = "⚠️ НОЧЬ! ТЭЦ выключена. Включите ТЭЦ для добычи.";
            }
            tecWarning.style.display = "block";
            tecWarning.className = "tec-warning warning-night";
        } else if (isDay && isCoalEnabled) {
            tecWarning.textContent = "✅ День, ТЭЦ активна. Добыча работает на 100% эффективности.";
            tecWarning.style.backgroundColor = "rgba(74,255,157,0.1)";
            tecWarning.style.color = "#4aff9d";
            tecWarning.style.borderLeftColor = "#4aff9d";
            tecWarning.style.display = "block";
            tecWarning.className = "tec-warning warning-good";
        } else {
            tecWarning.style.display = "none";
        }
    }
}

function renderQuestsTab() {
    const container = document.getElementById('questsContainer');
    if (!container || !game) return;

    let stats = null;
    try { stats = JSON.parse(game.get_statistics()); } catch(e) {
        container.innerHTML = '<div class="quest-error">Нет данных</div>';
        return;
    }

    const quests = stats.quests || [];
    const currentQuestIdx = stats.current_quest || 0;

    if (!quests.length) {
        container.innerHTML = '<div class="quest-card quest-locked"><div class="quest-title">📋 Заданий пока нет</div><div class="quest-description">Скоро появятся новые квесты</div></div>';
        return;
    }

    container.innerHTML = quests.map((q, i) => {
        const isCurrent = i === currentQuestIdx;
        const isCompleted = q.completed === true;
        const isLocked = i > currentQuestIdx;

        let cls = '';
        let statusText = '';
        let statusIcon = '';

        if (isCompleted) {
            cls = 'quest-done';
            statusText = 'ВЫПОЛНЕНО';
            statusIcon = '✅ ';
        } else if (isCurrent) {
            cls = 'quest-active';
            statusText = 'АКТИВНО';
            statusIcon = '▶️ ';
        } else {
            cls = 'quest-locked';
            statusText = 'ЗАБЛОКИРОВАНО';
            statusIcon = '🔒 ';
        }

        const extra = QUESTS_CONTENT.find(x => x.id === q.id) || {};
        const rewardHtml = !isCompleted && !isLocked ?
            `<div class="quest-reward-hint">🏆 Награда: ${extra.reward_trash || 0}♻️ ${extra.reward_coal ? '+' + extra.reward_coal + '🪨' : ''} ${extra.reward_ore ? '+' + extra.reward_ore + '⛏️' : ''}</div>` : '';

        return `
            <div class="quest-card ${cls}" data-quest-id="${q.id}">
                <div class="quest-header">
                    <div class="quest-title">${statusIcon}${escapeHtml(q.title || 'Квест')}</div>
                    <div class="quest-status ${isCompleted ? 'status-done' : isCurrent ? 'status-active' : 'status-locked'}">${statusText}</div>
                </div>
                ${!isLocked ? `<div class="quest-description">${escapeHtml(q.description || extra.description || '')}</div>` : ''}
                ${extra.hint && !isLocked && !isCompleted ? `<div class="quest-hint">💡 ${escapeHtml(extra.hint)}</div>` : ''}
                ${rewardHtml}
                ${!isLocked && !isCompleted ? `<div class="quest-progress-bar"><div class="quest-progress-fill" style="width: 0%"></div></div>` : ''}
            </div>
        `;
    }).join('');

    if (quests[currentQuestIdx] && !quests[currentQuestIdx].completed) {
        const q = quests[currentQuestIdx];
        const target = q.target || 1;
        let current = 0;

        switch (q.quest_type) {
            case 'MineAny': current = stats.total_mined || 0; break;
            case 'SurviveNight': current = stats.nights_survived || 0; break;
            case 'ActivateDefense': current = stats.upgrades?.defense ? 1 : 0; break;
            case 'SurviveAttack': current = stats.rebel_attacks_count || 0; break;
            case 'ReachEvolutionLevel': current = stats.neuro_evolution || 0; break;
            case 'BlueprintUnlocked':
                current = (stats.blueprint_cargo_unlocked || stats.blueprint_scout_unlocked || stats.blueprint_combat_unlocked) ? 1 : 0;
                break;
            default:
                if (q.quest_type === 'MineResource' && q.resource) {
                    current = stats[`total_${q.resource}_mined`] || 0;
                } else if (q.quest_type === 'CollectResource' && q.resource) {
                    current = stats.inventory?.[q.resource] || 0;
                }
                break;
        }

        const percent = Math.min((current / target) * 100, 100);
        const progressFill = document.querySelector('.quest-active .quest-progress-fill');
        if (progressFill) progressFill.style.width = `${percent}%`;

        const progressText = document.createElement('div');
        progressText.className = 'quest-progress-text';
        progressText.textContent = `${current}/${target}`;
        const questCard = document.querySelector('.quest-active');
        if (questCard && !questCard.querySelector('.quest-progress-text')) {
            questCard.appendChild(progressText);
        }
    }
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

    if (msg.includes('Квест') && msg.includes('выполнен')) {
        const match = msg.match(/Квест "([^"]+)" выполнен/);
        if (match && game) {
            const questTitle = match[1];
            const quest = QUESTS_CONTENT.find(q => q.title === questTitle);
            if (quest) {
                applyQuestReward(quest.id, game);
                const freshStats = JSON.parse(game.get_statistics());
                updateInventoryDisplay(freshStats);
                cachedRustStats = freshStats;
            }
        }
    }

    log.appendChild(entry);

    const maxEntries = window.gameConfig?.ui_config?.max_log_entries ?? 50;
    while (log.children.length > maxEntries) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
}

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

async function updateLastSeen() {
    if (!currentUser) return;
    try {
        const { error } = await supabase
            .from('game_saves')
            .upsert({
                user_id: currentUser.id,
                last_seen: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        if (error) console.warn("Ошибка обновления last_seen:", error);
    } catch(e) {}
}

function startLastSeenUpdater() {
    if (_lastSeenTimer) clearInterval(_lastSeenTimer);
    _lastSeenTimer = setInterval(() => {
        if (currentUser) updateLastSeen();
    }, 30000);
}

function stopLastSeenUpdater() {
    if (_lastSeenTimer) {
        clearInterval(_lastSeenTimer);
        _lastSeenTimer = null;
    }
}

let _saveQueue = Promise.resolve();

function cloudSaveNow(force = false) {
    if (!currentUser || !game) return Promise.resolve();
    _saveQueue = _saveQueue.then(() => _doSave(force));
    return _saveQueue;
}

async function _doSave(force = false) {
    if (!force && shouldSkipAutoSave()) {
        console.log('⏳ Пропуск автосохранения (недавно загружено облако)');
        if (!_cloudSaveTimer) {
            _cloudSaveTimer = setTimeout(() => {
                _cloudSaveTimer = null;
                cloudSaveNow(false);
            }, 5000);
        }
        return;
    }

    const now = Date.now();
    if (!force && now - _lastCloudSave < 30000) {
        if (!_cloudSaveTimer) {
            _cloudSaveTimer = setTimeout(() => {
                _cloudSaveTimer = null;
                cloudSaveNow(false);
            }, 5000);
        }
        return;
    }

    _isSaving = true;
    _lastCloudSave = now;

    try {
        const result = await saveGameToCloud(game, force);

        if (result.success) {
            await updateLastSeen();

            const indicator = document.getElementById('saveIndicator');
            if (indicator) {
                indicator.textContent = '💾 Сохранено';
                indicator.style.opacity = '1';
                setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
            }
            console.log('✅ Облачное сохранение успешно');
            GameBus.emit(EVENTS.CLOUD_SAVE_DONE, { timestamp: Date.now() });
        }

    } catch(e) {
        console.error('Ошибка в cloudSaveNow:', e);
    } finally {
        _isSaving = false;
    }
}

function scheduleCloudSave() {
    if (!currentUser) return;

    const now = Date.now();
    if (now - _lastCloudSave > 30000) {
        cloudSaveNow(false);
        return;
    }

    if (_cloudSaveTimer) clearTimeout(_cloudSaveTimer);
    _cloudSaveTimer = setTimeout(async () => {
        await cloudSaveNow(false);
        _cloudSaveTimer = null;
    }, 5000);
}

window.cloudSaveNow = cloudSaveNow;

function getCurrentGameState() {
    if (!game) return null;
    try {
        const statsJson = game.get_statistics();
        if (statsJson) {
            const parsed = JSON.parse(statsJson);
            parsed.computational_power = game.get_computational_power() || 0;
            parsed.max_computational_power = game.get_max_computational_power ? game.get_max_computational_power() : 1000;

            if (window.fleetModule) {
                parsed.fleet = window.fleetModule.ships;
                parsed.defense_ship_id = window.fleetModule.defenseShipId || null;
                parsed.fleet_log = window.fleetModule.fleetLog || [];
            }

            if (window.designModule) {
                parsed.blueprints = {
                    cargo: window.designModule.blueprints.find(b => b.id === 'cargo')?.unlocked || false,
                    scout: window.designModule.blueprints.find(b => b.id === 'scout')?.unlocked || false,
                    combat: window.designModule.blueprints.find(b => b.id === 'combat')?.unlocked || false,
                };
            }

            return parsed;
        }
    } catch(e) {}
    return null;
}

function loadEmergencySnapshot(userId) {
    const key = `${SAVE_KEY(userId)}_emergency`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') return null;
        snapshot._isEmergencySnapshot = true;
        return snapshot;
    } catch (e) {
        console.warn('Не удалось прочитать аварийный snapshot:', e);
        return null;
    }
}

function clearEmergencySnapshot(userId) {
    try { localStorage.removeItem(`${SAVE_KEY(userId)}_emergency`); } catch (e) {}
}

function migrateLegacySaves(userId) {
    const legacyKeys = ['corebox_save', 'corebox_save_backup'];
    let bestSave = null;
    let bestTs = 0;

    for (const key of legacyKeys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const ts = parsed.timestamp || parsed._savedAt || 0;
            if (ts > bestTs) {
                bestTs = ts;
                bestSave = parsed;
            }
        } catch(e) {}
    }

    if (bestSave) {
        const newKey = SAVE_KEY(userId);
        localStorage.setItem(newKey, JSON.stringify(bestSave));
        legacyKeys.forEach(k => localStorage.removeItem(k));
        console.log('✅ Мигрировано старое сохранение');
        return bestSave;
    }
    return null;
}

function _initMultiplayer(user) {
    if (!user || !user.id) return;

    if (fleetModule) {
        fleetModule.currentUserId = user.id;
    }

    fleetModule.restoreMissionsFromDB(user.id).then(() => {
        processArrivedMissions(user.id);
        _refreshFleetWithMissions();
        _applyReleasedShips(user.id);
    }).catch(() => {
        _applyReleasedShips(user.id);
    });

    getUnreadNotifications(user.id).then(notifs => {
        notifs.forEach(n => _showCombatNotification(n, false));
        if (notifs.length > 0) markAllNotificationsRead(user.id);
    });

    if (_missionChannel) {
        supabase.removeChannel(_missionChannel);
        _missionChannel = null;
    }
    if (_incomingChannel) {
        supabase.removeChannel(_incomingChannel);
        _incomingChannel = null;
    }

    if (_pvpChannel) {
        supabase.removeChannel(_pvpChannel);
    }

    _pvpChannel = supabase
        .channel(`pvp_unified_${user.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'missions',
            filter: `or(attacker_id.eq.${user.id},target_id.eq.${user.id})`
        }, async (payload) => {
            const mission = payload.new;
            const isRelevant = ['arrived', 'returning', 'done'].includes(mission.status);
            if (!isRelevant) return;

            const processedKey = `processed_${mission.id}_${mission.status}`;
            if (sessionStorage.getItem(processedKey)) return;
            sessionStorage.setItem(processedKey, Date.now().toString());

            try {
                await processArrivedMissions(user.id);
                await reloadInventoryFromCloud();
                _refreshFleetWithMissions();
            } catch (e) {
                console.warn('PVP channel error:', e);
            }
        })
        .subscribe();

    if (_missionPollInterval) clearInterval(_missionPollInterval);
    _missionPollInterval = setInterval(() => {
        if (currentUser) {
            processArrivedMissions(currentUser.id);
            _refreshFleetWithMissions();
        }
    }, 60000);

    if (currentUser) {
        processArrivedMissions(currentUser.id);
        setTimeout(() => _refreshFleetWithMissions(), 1000);
    }
}

async function reloadInventoryFromCloud() {
    if (!currentUser || !game) return;
    if (window._isReloadingInventory) return;
    window._isReloadingInventory = true;

    try {
        const { data, error } = await supabase
            .from('game_saves')
            .select('full_state')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (error || !data?.full_state) return;

        const cloudState = data.full_state;
        const currentState = JSON.parse(game.get_statistics());

        if (cloudState.inventory) {
            const resources = ['coal', 'ore', 'chips', 'plasma', 'trash'];
            let changed = false;

            for (const res of resources) {
                const cloudAmt = cloudState.inventory[res] || 0;
                const currentAmt = currentState[`${res}_inventory`] || 0;

                if (cloudAmt !== currentAmt) {
                    const diff = cloudAmt - currentAmt;
                    if (diff > 0) {
                        game.add_resource(res, diff);
                        changed = true;
                    } else if (diff < 0) {
                        game.subtract_resource(res, -diff);
                        changed = true;
                    }
                }
            }

            if (changed) {
                const freshStats = JSON.parse(game.get_statistics());
                updateInventoryDisplay(freshStats);
                cachedRustStats = freshStats;
                addToLog('🔄 Инвентарь синхронизирован с облаком', 'info');
            }
        }
    } catch(e) {
        console.warn('Ошибка синхронизации инвентаря:', e);
    } finally {
        window._isReloadingInventory = false;
    }
}
window.reloadInventoryFromCloud = reloadInventoryFromCloud;

function _cleanupMultiplayer() {
    if (_notifChannel) { supabase.removeChannel(_notifChannel); _notifChannel = null; }
    if (_missionChannel) { supabase.removeChannel(_missionChannel); _missionChannel = null; }
    if (_incomingChannel) { supabase.removeChannel(_incomingChannel); _incomingChannel = null; }
    if (_pvpChannel) { supabase.removeChannel(_pvpChannel); _pvpChannel = null; }
    if (_missionPollInterval) { clearInterval(_missionPollInterval); _missionPollInterval = null; }
    if (_missionTimerInterval) { clearInterval(_missionTimerInterval); _missionTimerInterval = null; }
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

    if (_missionTimerInterval) {
        clearInterval(_missionTimerInterval);
        _missionTimerInterval = null;
    }

    try {
        const { getActiveMissions } = await import('./multiplayer_combat.js');
        const missions = await getActiveMissions(currentUser.id);

        if (container && _currentTab === 'fleet') {
            fleetModule._renderFleetTab?.();
        }

        let missionsPanel = document.getElementById('activeMissionsPanel');
        const fleetTabContent = document.getElementById('fleet-tab');

        if (fleetTabContent && !missionsPanel) {
            const panel = document.createElement('div');
            panel.id = 'activeMissionsPanel';
            panel.className = 'panel';
            panel.style.marginTop = '10px';
            fleetTabContent.appendChild(panel);
            missionsPanel = panel;
        }

        if (!missionsPanel) return;

        if (missions && missions.length > 0) {
            missionsPanel.style.display = 'block';

            const now = Date.now();
            const missionItems = missions.map(m => {
                const isOut = m.attacker_id === currentUser.id;
                const targetTime = new Date(isOut ? m.returns_at : m.arrives_at);
                const diffMs = Math.max(0, targetTime.getTime() - now);
                const diffMin = Math.floor(diffMs / 60000);
                const diffSec = Math.floor((diffMs % 60000) / 1000);
                const timeStr = diffMin > 0 ? `${diffMin} мин ${diffSec} сек` : `${diffSec} сек`;

                const icons = { scout: '🔭', combat: '⚔️', cargo: '📦' };
                const statusText = m.status === 'flying'
                    ? (isOut ? `летит к цели` : `влетает`)
                    : `возвращается`;

                return `
                    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;" data-mission-id="${m.id}">
                        ${icons[m.ship_type] ?? '🚀'} ${m.ship_type}
                        · ${isOut ? '📤 Ваш' : '📥 Входящий'}
                        · ${statusText}
                        · <span id="mission-timer-${m.id}">${timeStr}</span>
                    </div>`;
            }).join('');

            missionsPanel.innerHTML = `
                <div class="panel-title">
                    <span>🚀 АКТИВНЫЕ МИССИИ</span>
                    <span class="collapse-icon">▼</span>
                </div>
                <div class="panel-content">
                    ${missionItems}
                </div>
            `;

            _missionTimerInterval = setInterval(() => {
                const now = Date.now();
                missions.forEach(m => {
                    const isOut = m.attacker_id === currentUser.id;
                    const targetTime = new Date(isOut ? m.returns_at : m.arrives_at);
                    const diffMs = Math.max(0, targetTime.getTime() - now);
                    const diffMin = Math.floor(diffMs / 60000);
                    const diffSec = Math.floor((diffMs % 60000) / 1000);
                    const timeEl = document.getElementById(`mission-timer-${m.id}`);
                    if (timeEl) {
                        timeEl.textContent = diffMin > 0 ? `${diffMin} мин ${diffSec} сек` : `${diffSec} сек`;
                    }
                });
            }, 1000);

            const title = missionsPanel.querySelector('.panel-title');
            if (title) {
                title.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    missionsPanel.classList.toggle('collapsed');
                    const icon = title.querySelector('.collapse-icon');
                    if (icon) icon.textContent = missionsPanel.classList.contains('collapsed') ? '▶' : '▼';
                });
            }
        } else {
            missionsPanel.style.display = 'none';
        }
    } catch(e) {}
}

window._refreshFleetWithMissions = _refreshFleetWithMissions;

function validateAndFixNeuroConsciousness() {
    if (!game) return;

    try {
        const statsJson = game.get_statistics();
        if (!statsJson) return;
        const stats = JSON.parse(statsJson);

        const evolution = stats.neuro_evolution || 0;
        let consciousness = stats.neuro_consciousness || 0;
        let fixed = false;

        consciousness = normalizeNeuroConsciousness(consciousness);

        const expectedMin = Math.max(0.05, evolution * 0.03);

        if (consciousness < expectedMin * 0.5 && evolution >= 3) {
            const restoredValue = expectedMin;
            addToLog(`⚠️ Восстановлено нейро-сознание: ${(restoredValue * 100).toFixed(1)}% (было ${(consciousness * 100).toFixed(1)}%)`, "warning");
            consciousness = restoredValue;
            fixed = true;
        }

        if (fixed) {
            try {
                const currentStateJson = game.get_universal_save();
                const currentState = JSON.parse(currentStateJson);
                currentState.neuro_consciousness = consciousness;
                game.load_game_state(JSON.stringify(currentState));
            } catch(e) {
                console.warn('Не удалось применить исправление сознания в Rust:', e);
            }

            const save = localStorage.getItem('corebox_save_backup');
            if (save) {
                try {
                    const saveData = JSON.parse(save);
                    if (saveData.neuro) {
                        saveData.neuro.consciousness = consciousness;
                        localStorage.setItem('corebox_save_backup', JSON.stringify(saveData));
                    }
                } catch(e) {}
            }

            const universalSave = localStorage.getItem(USER_STORAGE_KEY('corebox_save_universal'));
            if (universalSave) {
                try {
                    const saveData = JSON.parse(universalSave);
                    if (saveData.neuro_consciousness !== undefined) {
                        saveData.neuro_consciousness = consciousness;
                        localStorage.setItem(USER_STORAGE_KEY('corebox_save_universal'), JSON.stringify(saveData));
                    }
                } catch(e) {}
            }

            setTimeout(() => cloudSaveNow(true), 500);
        }

        updateNeuroStatus();

    } catch(e) {}
}

function initializeAuth() {
    const authOverlay = document.getElementById('authOverlay');
    const loginBtn = document.getElementById('btn-login');
    const registerBtn = document.getElementById('btn-register');
    const toggleModeBtn = document.getElementById('btn-toggle-mode');

    if (!loginBtn) return;

    setupAuthFormHandlers();
    getKeepAliveChannel();

    document.addEventListener('pointerdown', async function initAudioOnFirstInteraction() {
        try {
            await Sounds.resume();
        } catch(e) {}
        document.removeEventListener('pointerdown', initAudioOnFirstInteraction);
    }, { once: true });

    window.addEventListener('beforeunload', () => {
        if (window.fleetModule?.saveFleet) {
            window.fleetModule.saveFleet(true);
        }
        if (currentUser && game) {
            if (typeof game.save_current_state === 'function') {
                game.save_current_state();
            }
            if (typeof game.get_universal_save === 'function') {
                const nestedStateJson = game.get_universal_save();
                const nestedState = JSON.parse(nestedStateJson);
                if (window.fleetModule?.ships) {
                    nestedState.fleet = window.fleetModule.ships;
                }
                if (window.fleetModule?.defenseShipId) {
                    nestedState.defense_ship_id = window.fleetModule.defenseShipId;
                }
                const unifiedKey = SAVE_KEY(currentUser?.id);
                localStorage.setItem(unifiedKey, JSON.stringify(nestedState));
                localStorage.setItem(USER_STORAGE_KEY('corebox_save_backup', currentUser.id), JSON.stringify(nestedState));
            }
            saveCurrentUserStatistics();
            updateLastSeen();
        }
    });

    initAuth(
        async (user) => {
            currentUser = user;
            window.currentUser = user;

            try {
                const savedMuted = localStorage.getItem('corebox_sound_muted') === 'true';
                if (savedMuted && window.Sounds?.setMusicEnabled) {
                    window.Sounds.setMusicEnabled(false);
                }
            } catch(e) {}

            const migrated = migrateLegacySaves(user.id);
            const emergencySnapshot = loadEmergencySnapshot(user.id);

            showGameUI();
            updateUserDisplay(user);
            document.getElementById('userInfo').style.display = 'block';

            await updateLastSeen();
            startLastSeenUpdater();

            addToLog("🔄 Загрузка локального прогресса...");

            const cloudSave = await loadGameFromCloud(true);
            const initialSave = cloudSave || migrated || emergencySnapshot;

            if (cloudSave) {
                _lastCloudLoadTime = Date.now();
                addToLog(`✅ Загружен сохранённый прогресс (уровень нейро: ${cloudSave.neuro?.evolution || 0})`);
            } else if (migrated) {
                addToLog(`✅ Загружено мигрированное сохранение`);
            } else if (emergencySnapshot) {
                addToLog('⚠️ Восстановлен аварийный локальный snapshot', 'warning');
            }

            if (!isGameInitialized) {
                await initializeGame(initialSave);
            } else {
                _initMultiplayer(user);
            }

            if (emergencySnapshot && initialSave === emergencySnapshot) {
                clearEmergencySnapshot(user.id);
            }

            const myPos = await ensureMapPosition(user.id);
            if (spaceModule) {
                spaceModule.setMyPosition(myPos.x, myPos.y);
                console.log(`📍 Позиция игрока загружена: (${myPos.x}, ${myPos.y})`);
            }

            loadUserStatsFromCloud(user);

            const savedMuted = localStorage.getItem('corebox_sound_muted') === 'true';
            if (savedMuted) {
                try {
                    await Sounds.toggleMute();
                    const muteBtn = document.getElementById('muteToggleBtn');
                    if (muteBtn) {
                        muteBtn.textContent = '🔇';
                        muteBtn.classList.add('muted');
                    }
                } catch(e) {}
            }

            setTimeout(() => {
                if (game && currentUser) {
                    cloudSaveNow(true);
                }
            }, 5000);
        },
        () => {
            stopLastSeenUpdater();
            cleanupGameTimers();
            _cleanupMultiplayer();
            if (_missionTimerInterval) {
                clearInterval(_missionTimerInterval);
                _missionTimerInterval = null;
            }
            if (_saveInterval) {
                clearInterval(_saveInterval);
                _saveInterval = null;
            }
            currentUser = null;
            window.currentUser = null;
            showAuthUI();
            isGameInitialized = false;
            GameBus.clear();
        }
    );
}

let _saveInterval = null;

async function loadUserStatsFromCloud(user) {
    if (!user) return;
    try {
        const scopedKey = USER_STORAGE_KEY('corebox_user_stats', user.id);
        const raw = localStorage.getItem(scopedKey);
        if (raw) loadUserStatistics(JSON.parse(raw));
        else { gameStats.startTime = Date.now(); gameStats.sessionsCount = 1; updateStatisticsDisplay(); }
    } catch(e) {}
}

function setupAuthFormHandlers() {
    let isRegisterMode = false; // false = режим входа, true = режим регистрации
    const loginBtn = document.getElementById('btn-login');
    const registerBtn = document.getElementById('btn-register');
    const toggleModeBtn = document.getElementById('btn-toggle-mode');
    const usernameGroup = document.getElementById('username-group');
    const authTitle = document.querySelector('#authOverlay .auth-header h2');
    const authMessage = document.getElementById('auth-message');
    if (!loginBtn) return;

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
            // РЕЖИМ РЕГИСТРАЦИИ
            if (authTitle) authTitle.textContent = '📝 Регистрация';
            if (usernameGroup) usernameGroup.style.display = 'block';
            if (loginBtn) loginBtn.textContent = '📝 Зарегистрироваться';
            if (registerBtn) registerBtn.style.display = 'none';
            if (toggleModeBtn) toggleModeBtn.textContent = '🔑 Уже есть аккаунт? Войти';
        } else {
            // РЕЖИМ ВХОДА (ПО УМОЛЧАНИЮ)
            if (authTitle) authTitle.textContent = '🔑 Вход в CoreBox';
            if (usernameGroup) usernameGroup.style.display = 'none'; // Скрываем поле имени
            if (loginBtn) loginBtn.textContent = '🔑 Войти';
            if (registerBtn) registerBtn.style.display = 'block';
            if (toggleModeBtn) toggleModeBtn.textContent = '✨ Нет аккаунта? Зарегистрироваться';
        }
    }

    async function handleLogin() {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        if (!email || !password) {
            showMessage('Заполните email и пароль!');
            return;
        }
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = '⏳ Вход...';
        }
        const result = await login(email, password);
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = isRegisterMode ? '📝 Зарегистрироваться' : '🔑 Войти';
        }
        showMessage(result.success ? 'Вход выполнен!' : (result.error || 'Ошибка'), result.success);
    }

    async function handleRegister() {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const username = document.getElementById('auth-username').value.trim();
        if (!email || !password) {
            showMessage('Заполните все поля!');
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showMessage('Введите корректный email!');
            return;
        }
        if (password.length < 6) {
            showMessage('Пароль должен быть минимум 6 символов');
            return;
        }
        if (registerBtn) {
            registerBtn.disabled = true;
            registerBtn.textContent = '⏳ Регистрация...';
        }
        const result = await register(email, password, username || email.split('@')[0]);
        if (registerBtn) {
            registerBtn.disabled = false;
            registerBtn.textContent = '📝 Регистрация';
        }
        if (result.success) {
            showMessage('Регистрация успешна! Теперь войдите.', false);
            toggleMode(); // Переключаем на вход
        } else {
            showMessage(result.error || 'Ошибка');
        }
    }

    // ✅ Кнопка loginBtn работает в обоих режимах
    if (loginBtn) loginBtn.onclick = () => isRegisterMode ? handleRegister() : handleLogin();

    // ✅ Кнопка registerBtn переключает в режим регистрации
    if (registerBtn) {
        registerBtn.onclick = () => {
            if (!isRegisterMode) toggleMode();
        };
    }

    // ✅ Переключение режимов
    if (toggleModeBtn) toggleModeBtn.onclick = toggleMode;

    // Обработка Enter
    const onEnter = (e) => {
        if (e.key === 'Enter') {
            isRegisterMode ? handleRegister() : handleLogin();
        }
    };
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const usernameInput = document.getElementById('auth-username');
    if (emailInput) emailInput.addEventListener('keypress', onEnter);
    if (passwordInput) passwordInput.addEventListener('keypress', onEnter);
    if (usernameInput) usernameInput.addEventListener('keypress', onEnter);

    // ✅ ИНИЦИАЛИЗАЦИЯ: показываем режим ВХОДА по умолчанию
    toggleMode(); // переключит в isRegisterMode=true
    toggleMode(); // и обратно в false (режим входа)
}

async function handleLogout() {
    stopLastSeenUpdater();
    _cleanupMultiplayer();

    if (_missionTimerInterval) {
        clearInterval(_missionTimerInterval);
        _missionTimerInterval = null;
    }

    if (_saveInterval) {
        clearInterval(_saveInterval);
        _saveInterval = null;
    }

    if (_universalChannel) { _universalChannel.close(); _universalChannel = null; }
    if (_keepAliveChannel) { _keepAliveChannel.close(); _keepAliveChannel = null; }
    if (_gameLoopRAF) { cancelAnimationFrame(_gameLoopRAF); _gameLoopRAF = null; }
    if (_fleetUITimer) { clearInterval(_fleetUITimer); _fleetUITimer = null; }
    if (_ccClockInterval) { clearInterval(_ccClockInterval); _ccClockInterval = null; }
    offlineProgressShown = false;

    localStorage.removeItem('corebox_pending_loot');

    if (window._disconnectMobileObservers) {
        try { window._disconnectMobileObservers(); } catch(e) {}
    }
    if (window._disconnectInputZoomObserver) {
        try { window._disconnectInputZoomObserver(); } catch(e) {}
    }

    try {
        if (window.Sounds?.destroy) {
            await window.Sounds.destroy();
        }
    } catch(e) {}

    if (currentUser && game) {
        addToLog("💾 Сохраняем прогресс перед выходом...");
        try {
            await cloudSaveNow(true);

            if (typeof game.get_universal_save === 'function') {
                const nestedStateJson = game.get_universal_save();
                const nestedState = JSON.parse(nestedStateJson);
                if (window.fleetModule?.ships) {
                    nestedState.fleet = window.fleetModule.ships;
                }
                if (window.fleetModule?.defenseShipId) {
                    nestedState.defense_ship_id = window.fleetModule.defenseShipId;
                }
                const unifiedKey = SAVE_KEY(currentUser.id);
                localStorage.setItem(unifiedKey, JSON.stringify(nestedState));
                addToLog("💾 Локальное сохранение создано");
            }
            saveCurrentUserStatistics();
        } catch (e) {
            console.error('Ошибка сохранения при logout:', e);
            try {
                if (game && typeof game.get_universal_save === 'function') {
                    const emergencyState = JSON.parse(game.get_universal_save());
                    emergencyState.fleet = window.fleetModule?.ships || emergencyState.fleet || [];
                    emergencyState.defense_ship_id = window.fleetModule?.defenseShipId || emergencyState.defense_ship_id || null;
                    emergencyState._emergencySavedAt = Date.now();
                    localStorage.setItem(`${SAVE_KEY(currentUser.id)}_emergency`, JSON.stringify(emergencyState));
                    addToLog('⚠️ Аварийный локальный snapshot сохранён');
                }
            } catch (emergencyError) {
                console.error('Ошибка аварийного локального snapshot:', emergencyError);
            }
        }
    }

    const result = await logout();
    if (result.success) {
        tradeModule.cleanup();
        isGameInitialized = false;
        localStorage.removeItem('corebox_autoclicking');

        setTimeout(() => location.reload(), 0);
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
    if (!btn) {
        console.warn('⚠️ updatePowerGlow: кнопка floatingMineBtn не найдена');
        return;
    }
    btn.classList.remove('power-low', 'power-medium', 'power-high', 'power-full');
    if (percent >= 80) btn.classList.add('power-full');
    else if (percent >= 50) btn.classList.add('power-high');
    else if (percent >= 20) btn.classList.add('power-medium');
    else if (percent > 0) btn.classList.add('power-low');
}

function updatePowerTierLabel() {
    if (!game) return;
    const tierEl = document.getElementById('powerTier');
    if (!tierEl) return;
    const stats = JSON.parse(game.get_statistics() || '{}');
    const tier = stats.power_tier ?? 0;
    const perClick = 1 + tier;
    tierEl.textContent = `Тир ${tier} | +${perClick} мощности/клик`;
}

function updateAutoClickSettingsUI() {
    const cfg = window.gameConfig?.auto_click_config;
    if (!cfg) return;

    const powerEl = document.getElementById('powerPerClick');
    if (powerEl) powerEl.textContent = cfg.power_per_manual_click ?? 1;

    const intervalEl = document.getElementById('autoClickInterval');
    if (intervalEl) intervalEl.textContent = cfg.auto_click_interval ?? 2;

    const costEl = document.getElementById('autoClickCost');
    if (costEl) costEl.textContent = cfg.power_per_auto_click ?? 3;
}

function updateTurbineVisuals(heat) {
    const heatRatio = Math.min(heat / 100, 1);
    const hue = 200 - heatRatio * 200;
    document.documentElement.style.setProperty('--turbine-hue', hue);

    const mineBtn = document.getElementById('floatingMineBtn');
    if (!mineBtn) return;

    if (heat >= 100) {
        mineBtn.classList.add('overheated');
    } else {
        if (mineBtn.classList.contains('overheated')) {
            mineBtn.classList.remove('overheated');
            mineBtn.style.animation = 'none';
            void mineBtn.offsetWidth;
            mineBtn.style.animation = '';
        }
    }
}

function updateRebelPulse(activity) {
    const dot = document.getElementById('rebel-dot');
    if (!dot) return;

    dot.classList.remove('pulse-low', 'pulse-medium', 'pulse-high', 'online', 'danger');
    if (activity <= 3) dot.classList.add('pulse-low', 'online');
    else if (activity <= 6) dot.classList.add('pulse-medium', 'danger');
    else dot.classList.add('pulse-high', 'danger');
}

function updatePowerRing(manualClicks, clicksPerPower) {
    const ringFill = document.querySelector('.ring-fill');
    if (!ringFill) return;

    // ✅ ИСПРАВЛЕНО: manualClicks теперь уже является остатком (0-7)
    const progress = clicksPerPower > 0 ? manualClicks / clicksPerPower : 0;
    const circumference = 283;
    const offset = circumference * (1 - progress);
    ringFill.style.strokeDashoffset = offset;
    // Флеш при заполнении
    if (progress >= 0.95 && manualClicks > 0) {
        ringFill.classList.add('ring-flash');
        setTimeout(() => ringFill.classList.remove('ring-flash'), 300);
    }
}

function _updateSysDots(stats) {
    if (!stats) return;
    const setDot = (id, active) => {
        const dot = document.getElementById(id);
        if (!dot) return;
        dot.className = active ? 'sys-dot online' : 'sys-dot offline';
    };
    setDot('coal-dot', stats.coal_enabled === true && !stats.tec_sabotaged);
    setDot('ai-dot', stats.ai_active === true);
    setDot('defense-dot', stats.defense_active === true);
    // rebel-dot handled by updateRebelPulse
}

function updateTurbineStatus(stats) {
    const heat = stats?.turbine_heat ?? 0;
    const isCooling = stats?.turbine_cooling ?? false;
    const bar = document.getElementById('turbineHeatBar');
    const label = document.getElementById('turbineHeatLabel');
    if (!bar || !label) return;

    bar.style.width = `${Math.min(heat, 100)}%`;
    bar.className = 'turbine-fill';

    updateTurbineVisuals(heat);

    const coolingRate = Math.ceil(1.5
        + ((stats?.turbine_upgrade_level || 0) * 0.25)
        + ((stats?.cooling_level || 0) * 0.30));

    if (heat >= 100) {
        bar.classList.add('turbine-critical');
        const ticksToZero = Math.ceil(heat / coolingRate);
        label.textContent = `${heat}% (🔥 ${ticksToZero}с)`;
    } else if (isCooling) {
        const colorClass = heat >= 70 ? 'turbine-hot' : heat >= 40 ? 'turbine-warm' : 'turbine-cool';
        bar.classList.add(colorClass);
        label.textContent = `${heat}% (❄️ остыв.)`;
    } else if (heat >= 70) {
        bar.classList.add('turbine-hot');
        label.textContent = `${heat}%`;
    } else if (heat >= 40) {
        bar.classList.add('turbine-warm');
        label.textContent = `${heat}%`;
    } else {
        bar.classList.add('turbine-cool');
        label.textContent = `${heat}%`;
    }

    if (heat >= 100) {
        const ticksLeft = Math.ceil(heat / coolingRate);
        const btn = document.getElementById('floatingMineBtn');
        if (btn) {
            btn.classList.add('turbine-critical');
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = `🌡️ ${ticksLeft}с`;
        }
    }
}

function renderFactionDossier(factions) {
    const el = document.getElementById('cc-factions');
    if (!el) return;
    if (!factions?.length) {
        el.innerHTML = '<div class="cc-intercept-empty">Нет данных</div>';
        return;
    }

    const FACTION_ICONS = { scavengers: '🗑️', technomads: '⚙️', cyber_rebels: '💻' };
    el.innerHTML = factions.map(f => {
        const icon = FACTION_ICONS[f.id] || '👥';
        const frustrated = f.is_frustrated ? ' ⚡Агрессивны' : '';
        const losses = f.consecutive_losses > 0 ? escapeHtml(` (${f.consecutive_losses} пораж.)`) : '';
        const hintText = (escapeHtml(f.hint || '') + losses).trim();

        let nextAttackHtml = '';
        if (f.pattern_revealed && f.predicted_attack_after > 0 && f.attacks_observed >= 5) {
            const nightsLeft = Math.max(0, f.predicted_attack_after - (f.quiet_nights_accumulated || 0));
            const danger = nightsLeft <= 1;
            nextAttackHtml = `
                <div class="cc-faction-predict ${danger ? 'cc-faction-predict-danger' : ''}">
                    🎯 Паттерн: атакует через ~${f.predicted_attack_after} тихих ночей
                    · Сейчас тихих: ${f.quiet_nights_accumulated}
                    · До атаки: <strong>${nightsLeft === 0 ? '⚠️ СЕГОДНЯ' : nightsLeft + ' н.'}</strong>
                </div>`;
        } else if (f.attacks_observed > 0 && f.attacks_observed < 5) {
            nextAttackHtml = `<div class="cc-faction-predict">🔍 Анализ паттерна... (${f.attacks_observed}/5 атак)</div>`;
        }

        return `<div class="cc-faction-row ${f.consecutive_losses >= 3 ? 'cc-faction-weak' : ''}">
            <span class="cc-faction-icon">${icon}</span>
            <div class="cc-faction-info">
                <div class="cc-faction-name">${escapeHtml(f.name)}${frustrated}</div>
                ${hintText ? `<div class="cc-faction-hint">${hintText}</div>` : ''}
                ${nextAttackHtml}
            </div>
        </div>`;
    }).join('');
}

function renderIntercepts(msgs) {
    const el = document.getElementById('cc-intercepts');
    if (!el) return;
    if (!msgs?.length) {
        el.innerHTML = '<div class="cc-intercept-empty">Нет перехватов</div>';
        return;
    }

    const currentCount = msgs.length;
    const hasNew = currentCount !== _lastInterceptCount;
    if (hasNew && _lastInterceptCount !== 0 && currentCount > _lastInterceptCount) {
        el.classList.add('intercepts-updated');
        setTimeout(() => el.classList.remove('intercepts-updated'), 500);

        if (Sounds.intercept) Sounds.intercept();
        else if (Sounds.warning) Sounds.warning();

        if (_currentTab !== 'command') {
            const badge = document.getElementById('command-tab-btn');
            if (badge && !badge.dataset.interceptBadge) {
                badge.dataset.interceptBadge = '1';
                badge.style.position = 'relative';
                const dot = document.createElement('span');
                dot.id = 'intercept-badge';
                dot.style.cssText = 'position:absolute;top:2px;right:2px;width:6px;height:6px;background:#4aff9d;border-radius:50%;animation:cc-pulse 1s infinite;';
                badge.appendChild(dot);
            }
        }
    }
    _lastInterceptCount = currentCount;

    const etaItems = [];

    el.innerHTML = msgs.map((m, idx) => {
        const rel = Math.round((m.reliability ?? 0) * 100);
        const isHigh = rel >= 70;
        const eta = m.eta_ticks || 0;
        const isNew = (currentCount - idx) <= 2 && hasNew;

        let etaHtml = '';
        if (eta > 0) {
            const etaSeconds = eta * 2;
            etaHtml = `<span class="cc-eta-timer" data-eta="${eta}" data-message-idx="${idx}" style="color:#ffcc44;font-weight:bold;">⏱️ ${etaSeconds}с</span>`;
            etaItems.push({ idx, eta, message: m });
        }

        return `<div class="cc-intercept-msg ${isHigh ? 'cc-intercept-high' : ''} ${isNew ? 'cc-intercept-new' : ''}">
            <div>${escapeHtml(m.content || '')}</div>
            <div class="cc-intercept-rel">
                <span>${m.target_hint ? escapeHtml(m.target_hint) : ''}</span>
                <span>${etaHtml} · ${rel}% достоверность</span>
            </div>
        </div>`;
    }).join('');

    window._etaItems = etaItems;
    window._etaLastUpdate = Date.now();
}

function getNeuroScoreNeeded(evol) {
    const table = [60, 100, 150, 220, 300, 400, 500, 650, 800, 1000, 1250, 1550, 1900, 2300, 2800];
    if (evol < table.length) return table[evol];
    return 3400 + (evol - 15) * 150;
}

function updateMultiphaseIndicator(s) {
    const mpRow = document.getElementById('cc-multiphase-row');
    if (mpRow) {
        if (s.multiphase_warning) {
            const phase = s.multiphase_phase ?? 0;
            const timer = s.multiphase_timer ?? 0;
            const phaseLabel = ['🔴 Фаза 1: Разведка', '⚡ Фаза 2: Основной удар', '💥 Фаза 3: Финальный штурм'][phase] || '⚡ АТАКА';
            mpRow.style.display = 'flex';
            mpRow.innerHTML = `
                <span class="cc-threat-label" style="color:#ff6644;font-weight:bold">${phaseLabel}</span>
                <span class="cc-badge cc-badge-danger">${timer > 0 ? `${timer}т` : 'СЕЙЧАС'}</span>
            `;
        } else {
            mpRow.style.display = 'none';
        }
    }
}

function updateCommandCenter(s) {
    if (!s) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    const setW = (id, pct) => {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.min(pct, 100) + '%';
    };

    // ── OPERATIONS BRIEF: один ясный следующий приказ ──
    const briefTitle = document.getElementById('cc-brief-title');
    const briefBody = document.getElementById('cc-brief-body');
    const briefAction = document.getElementById('cc-brief-action');
    if (briefTitle && briefBody && briefAction) {
        const coal = Number(s.coal_inventory ?? s.coal ?? 0);
        const power = Number(s.computational_power ?? 0);
        const mined = Number(s.total_mined ?? 0);
        let brief = { title: 'Система стабильна', body: 'База работает. Выберите следующий вектор развития.', label: 'ОТКРЫТЬ КОМАНДНЫЙ ПУНКТ', tab: 'command' };
        if (s.attack_warning || s.fleet_under_attack) {
            brief = { title: 'Зафиксирована угроза', body: 'Проверьте защиту и активные маршруты, прежде чем отправлять новый корабль.', label: 'ПРОВЕРИТЬ ЗАЩИТУ', tab: 'command' };
        } else if (mined < 100) {
            brief = { title: 'Нарастить добычу', body: 'Соберите первые ресурсы и подготовьте базу к включению ТЭЦ.', label: 'ОТКРЫТЬ ИНВЕНТАРЬ', tab: 'inventory' };
        } else if (!s.coal_enabled && coal > 0) {
            brief = { title: 'Включить ТЭЦ', body: 'Уголь уже доступен. Включите энергоконтур, чтобы ускорить накопление мощности.', label: 'ОТКРЫТЬ КОМАНДНЫЙ ПУНКТ', tab: 'command' };
        } else if (!s.blueprint_cargo_unlocked && power >= 50) {
            brief = { title: 'Открыть первый blueprint', body: 'Вычислительной мощности достаточно для перехода от добычи к проектированию.', label: 'ОТКРЫТЬ РАЗРАБОТКУ', tab: 'design' };
        } else if (s.blueprint_cargo_unlocked && !(window.fleetModule?.ships?.length)) {
            brief = { title: 'Собрать первый корабль', body: 'Грузовой blueprint открыт. Создайте корабль и начните осваивать карту.', label: 'ОТКРЫТЬ КРАФТ', tab: 'craft' };
        } else if (s.blueprint_cargo_unlocked) {
            brief = { title: 'Расширить влияние', body: 'Флот готов. Исследуйте спиральную карту и выбирайте цель с учётом дистанции и риска.', label: 'ОТКРЫТЬ КАРТУ', tab: 'space' };
        }
        briefTitle.textContent = brief.title;
        briefBody.textContent = brief.body;
        briefAction.textContent = brief.label;
        briefAction.dataset.tab = brief.tab;
        if (!briefAction.dataset.bound) {
            briefAction.dataset.bound = 'true';
            briefAction.addEventListener('click', () => {
                if (typeof switchMainTab === 'function') switchMainTab(briefAction.dataset.tab);
            });
        }
    }

    // ── ШАПКА: день/ночь ──
    const isDay = !!s.is_day;
    const dayLabel = document.getElementById('cc-day-label');
    if (dayLabel) {
        dayLabel.textContent = isDay ? 'ДЕНЬ' : 'НОЧЬ';
        dayLabel.style.color = isDay ? '#ffcc44' : '#4a9eff';
    }
    const dot = document.getElementById('cc-status-dot');
    if (dot) {
        dot.style.background = isDay ? '#ffcc44' : '#4a9eff';
    }

    // ── ЧАСЫ (реальное время) ──
    if (!_ccClockInterval) {
        const clockEl = document.getElementById('cc-clock');
        const updateClock = () => {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
        };
        updateClock();
        _ccClockInterval = setInterval(updateClock, 1000);
    }

    // ── СВОДКА: нейро + угрозы ──
    const evol = s.neuro_evolution ?? 0;
    let consc = s.neuro_consciousness ?? 0;
    consc = normalizeNeuroConsciousness(consc);
    const conscPct = Math.round(consc * 100);
    const score = s.neuro_score ?? 0;
    const defBonus = s.neuro_defense_bonus ?? 0;
    const aiMode = s.current_ai_mode || 'Обычный';

    if (score !== _lastKnownNeuroScore) {
        if (score > _lastKnownNeuroScore && _lastKnownNeuroScore >= 0) {
            _totalNeuroScoreEarned += (score - _lastKnownNeuroScore);
            localStorage.setItem('cc_total_score', String(_totalNeuroScoreEarned));
        }
        _lastKnownNeuroScore = score;
    }

    set('cc-evol', evol);
    set('cc-consc', `${conscPct}%`);
    setW('cc-bar-consc', conscPct);
    set('cc-aimode', `Режим: ${aiMode}`);
    set('cc-score', score.toLocaleString('ru-RU'));

    const scoreNext = document.getElementById('cc-score-next');
    if (scoreNext) {
        const needed = game && typeof game.get_neuro_score_needed === 'function'
            ? game.get_neuro_score_needed()
            : getNeuroScoreNeeded(evol);
        const pct = Math.min(score / needed * 100, 100);
        setW('cc-bar-score', pct);
        scoreNext.textContent = score >= needed
            ? '✅ Эволюция готова!'
            : `до эвол.: ${needed - score}`;
    }

    const defPct = Math.min(defBonus * 100, 100);
    set('cc-def-bonus', `+${Math.round(defBonus * 100)}%`);

    // Активность повстанцев
    const activity = s.rebel_activity ?? 0;
    const rebelBadge = document.getElementById('cc-rebel-badge');
    if (rebelBadge) {
        rebelBadge.textContent = `${activity}/15`;
        rebelBadge.className = 'cc-badge ' + (activity >= 10 ? 'cc-badge-danger' : activity >= 5 ? 'cc-badge-warn' : 'cc-badge-ok');
    }
    const barRebelEl = document.getElementById('cc-bar-rebel');
    if (barRebelEl) {
        barRebelEl.className = 'cc-bar-fill ' + (activity >= 10 ? 'cc-bar-red' : activity >= 5 ? 'cc-bar-amber' : 'cc-bar-teal');
        barRebelEl.style.width = Math.min(activity / 15 * 100, 100) + '%';
    }

    // Уязвимость
    const vuln = s.current_vulnerability || '';
    const vulnEl = document.getElementById('cc-vuln');
    if (vulnEl) {
        vulnEl.textContent = vuln || 'нет';
        vulnEl.className = 'cc-badge ' + (vuln ? 'cc-badge-danger' : 'cc-badge-ok');
    }

    // Защита (статус)
    const protStatusEl = document.getElementById('cc-prot-status');
    if (protStatusEl) {
        let statusText = '';
        if (s.fleet_shield_active) statusText += '🛡️Флот ';
        if (s.blueprints_encrypted) statusText += '🔐Чертежи ';
        if (s.planets_fortified) statusText += '🏰Планеты ';

        if (statusText) {
            protStatusEl.textContent = statusText;
            protStatusEl.className = 'cc-badge cc-badge-ok';
        } else {
            const protActive = s.rebel_protection_active ?? false;
            const protNights = s.rebel_protection_nights ?? 0;
            protStatusEl.textContent = protNights > 0 ? `${protNights}н.` : (protActive ? '✅' : '—');
            protStatusEl.className = 'cc-badge ' + (protNights > 0 ? 'cc-badge-ok' : (protActive ? 'cc-badge-ok' : 'cc-badge-muted'));
        }
    }

    // ── АКТИВНЫЕ ТРЕВОГИ ──
    updateMultiphaseIndicator(s);

    const atkWarnEl = document.getElementById('cc-attack-warning');
    const atkWarnText = document.getElementById('cc-attack-warning-text');
    if (atkWarnEl && atkWarnText) {
        if (s.attack_warning) {
            atkWarnText.textContent = `${s.attack_warning}${s.attack_warning_faction ? ' · ' + s.attack_warning_faction : ''}`;
            atkWarnEl.style.display = '';
        } else {
            atkWarnEl.style.display = 'none';
        }
    }

    // Blueprint lock
    const blueprintLockEl = document.getElementById('cc-blueprint-lock');
    if (blueprintLockEl) {
        if (s.blueprint_locked) {
            blueprintLockEl.style.display = 'flex';
            blueprintLockEl.innerHTML = `
                <span class="cc-threat-label" style="color:#ff6644">
                    📐 Чертёж ${s.locked_blueprint_id || 'неизвестный'} УКРАДЕН!
                </span>
                <span class="cc-badge cc-badge-danger">${s.blueprint_lock_remaining || 0}т</span>
            `;
        } else {
            blueprintLockEl.style.display = 'none';
        }
    }

    // TEC sabotage
    const tecSabotageEl = document.getElementById('cc-tec-sabotage');
    if (tecSabotageEl) {
        if (s.tec_sabotaged) {
            tecSabotageEl.style.display = 'flex';
            tecSabotageEl.innerHTML = `
                <span class="cc-threat-label" style="color:#ff6644">🔥 ТЭЦ САБОТИРОВАНА!</span>
                <span class="cc-badge cc-badge-danger">${s.tec_sabotage_remaining || 0}т</span>
            `;
        } else {
            tecSabotageEl.style.display = 'none';
        }
    }

    // Breaches
    const breachEl = document.getElementById('cc-breaches');
    const breachRow = document.getElementById('cc-breaches-row');
    if (breachEl && breachRow) {
        const breaches = s.total_breaches || 0;
        breachEl.textContent = breaches;
        breachRow.style.display = breaches > 0 ? 'flex' : 'none';
    }

    // Fleet attack
    const fleetAttackEl = document.getElementById('cc-fleet-attack');
    if (fleetAttackEl) {
        if (s.fleet_under_attack && s.fleet_attack_damage > 0) {
            fleetAttackEl.style.display = 'flex';
            fleetAttackEl.innerHTML = `
                <span class="cc-threat-label" style="color:#ff6644">🚀 ФЛОТ АТАКОВАН! (-${s.fleet_attack_damage} HP)</span>
                <span class="cc-badge cc-badge-danger">⚠️</span>
            `;
            // ✅ НЕ сбрасываем таймер, если он уже идёт
            if (!_fleetAttackTimeout) {
                _fleetAttackTimeout = setTimeout(() => {
                    if (fleetAttackEl) fleetAttackEl.style.display = 'none';
                    _fleetAttackTimeout = null;
                }, 10000);
            }
        } else if (!s.fleet_under_attack) {
            fleetAttackEl.style.display = 'none';
            if (_fleetAttackTimeout) {
                clearTimeout(_fleetAttackTimeout);
                _fleetAttackTimeout = null;
            }
        }
    }

    // Fear level
    const fearLevel = s.fear_level || 0;
    const fearEl = document.getElementById('cc-fear-level');
    if (fearEl) {
        if (fearLevel > 0) {
            fearEl.style.display = 'flex';
            const fearText = fearLevel >= 10 ? 'ПАНИКА' : fearLevel >= 5 ? 'ТРЕВОГА' : 'ОБЕСПОКОЕННОСТЬ';
            const fearColor = fearLevel >= 10 ? '#ff4444' : fearLevel >= 5 ? '#ffcc44' : '#ff9944';
            const overclockHtml = fearLevel >= 5 ? `
                <span style="color:#4aff9d;font-weight:bold;margin-left:8px;font-size:10px;background:rgba(74,255,157,0.15);padding:2px 8px;border-radius:4px;">
                    ⚡ ОВЕРКЛОК: Эволюция x1.5
                </span>` : '';
            fearEl.innerHTML = `
                <span class="cc-threat-label" style="color:${fearColor};font-weight:bold">😨 Страх: ${fearLevel} (${fearText})</span>
                <span class="cc-badge ${fearLevel >= 10 ? 'cc-badge-danger' : fearLevel >= 5 ? 'cc-badge-warn' : 'cc-badge-ok'}">${fearLevel}%</span>
                ${overclockHtml}
            `;
        } else {
            fearEl.style.display = 'none';
        }
    }

    // ── КОНТР-ОПЕРАЦИИ (создаём кнопки однократно + добавляем обработчики) ──
    const cd = s.counter_op_cooldown ?? 0;
    const cdEl = document.getElementById('cc-cd');
    if (cdEl) {
        if (cd > 0) {
            const mins = Math.floor(cd / 60);
            const secs = cd % 60;
            cdEl.textContent = `⏳ ${mins > 0 ? mins + 'м ' + secs + 'с' : secs + 'с'}`;
            cdEl.style.color = cd > 20 ? '#ffcc44' : '#ff9944';
        } else {
            cdEl.textContent = 'ГОТОВО ✅';
            cdEl.style.color = '#4aff9d';
        }
    }

    const opsGrid = document.querySelector('.cc-ops-grid');
    if (opsGrid) {
        const buttons = opsGrid.querySelectorAll('.cc-op-btn');
        const hasButtons = buttons.length > 0;

        if (!hasButtons) {
            opsGrid.innerHTML = `
                <button class="cc-op-btn" data-action="propaganda" data-cooldown="35">
                    <span class="cc-op-icon">📡</span>Пропаганда<span class="cc-op-cost">20 чипов</span>
                </button>
                <button class="cc-op-btn" data-action="fake_depot" data-cooldown="45">
                    <span class="cc-op-icon">💣</span>Ложный склад<span class="cc-op-cost">50 мусора</span>
                </button>
                <button class="cc-op-btn" data-action="close_vulnerability" data-cooldown="25">
                    <span class="cc-op-icon">🔒</span>Залатать<span class="cc-op-cost">15 чипов</span>
                </button>
                <button class="cc-op-btn" data-action="fleet_shield" data-cooldown="50">
                    <span class="cc-op-icon">🛡️</span>Защита флота<span class="cc-op-cost">25 чипов</span>
                </button>
                <button class="cc-op-btn" data-action="encrypt_blueprints" data-cooldown="60">
                    <span class="cc-op-icon">🔐</span>Шифр чертежей<span class="cc-op-cost">30 чипов</span>
                </button>
                <button class="cc-op-btn" data-action="fortify_planets" data-cooldown="80">
                    <span class="cc-op-icon">🏰</span>Укрепить планеты<span class="cc-op-cost">3 плазмы</span>
                </button>
            `;
            // Привязываем обработчики клика
            _setupCcOpButtons(opsGrid);
        }

        // Показать/скрыть кнопку «залатать» в зависимости от уязвимости
        const closeVulnBtn = opsGrid.querySelector('[data-action="close_vulnerability"]');
        if (closeVulnBtn) {
            closeVulnBtn.style.display = vuln ? '' : 'none';
        }
        // Подгоняем грид: 3 колонки с «залатать», 2 без неё
        opsGrid.style.gridTemplateColumns = vuln ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';

        const evolLevel = s.neuro_evolution ?? 0;
        const currentTick = s.tick_count || 0;

        opsGrid.querySelectorAll('.cc-op-btn').forEach(btn => {
            const action = btn.dataset.action;
            const costEl = btn.querySelector('.cc-op-cost');
            let btnCd = 0;
            try {
                if (game && typeof game.get_neuro_cooldown === 'function') {
                    btnCd = game.get_neuro_cooldown(action, currentTick) || 0;
                } else {
                    btnCd = cd;
                }
            } catch(e) { btnCd = cd; }

            const requiredLevel = {
                propaganda: 3, fake_depot: 4, close_vulnerability: 2,
                fleet_shield: 4, encrypt_blueprints: 5, fortify_planets: 6
            }[action] || 0;

            const isOnCooldown = btnCd > 0;
            const isLocked = evolLevel < requiredLevel;
            btn.disabled = isOnCooldown || isLocked;
            btn.classList.toggle('on-cooldown', isOnCooldown);

            if (costEl) {
                if (isOnCooldown) {
                    const mins = Math.floor(btnCd / 60);
                    const secs = btnCd % 60;
                    costEl.textContent = `⏳ ${mins > 0 ? mins + 'м ' + secs + 'с' : secs + 'с'}`;
                    costEl.style.color = '#ff9944';
                } else {
                    const costs = { propaganda: '20 чипов', fake_depot: '50 мусора',
                        close_vulnerability: '15 чипов', fleet_shield: '25 чипов',
                        encrypt_blueprints: '30 чипов', fortify_planets: '3 плазмы' };
                    costEl.textContent = costs[action] || '—';
                    costEl.style.color = isLocked ? '#666' : '#555';
                }
            }
        });
    }

    // ── СТАТИСТИКА (в свёрнутой панели) ──
    const defended = s.attacks_defended ?? 0;
    const totalAttacks = s.rebel_attacks_count ?? 0;
    set('cc-defended', defended);
    set('cc-total-attacks', totalAttacks);
    set('cc-nights', s.nights_survived ?? 0);
    const totalScoreEl = document.getElementById('cc-score-total');
    if (totalScoreEl) {
        totalScoreEl.textContent = _totalNeuroScoreEarned.toLocaleString('ru-RU');
    }

    // ── РАЗВЕДКА (обновление кэша каждые 2с) ──
    const now = Date.now();
    if (now - _lastIntelTime > 2000) {
        try {
            if (game && typeof game.get_rebel_intel === 'function') {
                _cachedIntel = JSON.parse(game.get_rebel_intel());
            }
            if (game && typeof game.get_intercepted_messages === 'function') {
                _cachedMessages = JSON.parse(game.get_intercepted_messages());
            }
            _lastIntelTime = now;
        } catch(e) {}
    }
    if (_cachedIntel) renderFactionDossier(_cachedIntel);
    if (_cachedMessages) renderIntercepts(_cachedMessages);
}

// ── Настройка обработчиков контр-операций ──
let _ccOpsSetup = false;
function _setupCcOpButtons(grid) {
    if (_ccOpsSetup) return;
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.cc-op-btn');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.action;
        if (!action || !game) return;

        Sounds.click && Sounds.click();

        const actions = {
            propaganda: 'run_propaganda',
            fake_depot: 'run_fake_depot',
            close_vulnerability: 'close_vulnerability',
            fleet_shield: 'run_fleet_shield',
            encrypt_blueprints: 'encrypt_blueprints',
            fortify_planets: 'fortify_planets'
        };
        const method = actions[action];
        if (method && typeof game[method] === 'function') {
            try {
                game[method]();
                scheduleCloudSave();
                if (cachedRustStats) {
                    requestAnimationFrame(() => updateCommandCenter(cachedRustStats));
                }
            } catch(e) { console.error('Ошибка контр-операции:', action, e); }
        }
    });
    _ccOpsSetup = true;
}

// ── Сворачиваемые панели ──
let _ccPanelsSetup = false;
function _setupCcPanels() {
    if (_ccPanelsSetup) return;
    document.querySelectorAll('.cc-panel-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const panel = hdr.closest('.cc-panel');
            if (!panel) return;
            const body = panel.querySelector('.cc-panel-body');
            const isOpen = panel.classList.toggle('open');
            if (body) body.style.display = isOpen ? '' : 'none';
            localStorage.setItem('cc_panel_' + hdr.dataset.panel, isOpen ? '1' : '0');
        });
    });
    // Восстановить состояние панелей
    document.querySelectorAll('.cc-panel-hdr').forEach(hdr => {
        const saved = localStorage.getItem('cc_panel_' + hdr.dataset.panel);
        if (saved === '1') {
            const panel = hdr.closest('.cc-panel');
            if (panel) {
                panel.classList.add('open');
                const body = panel.querySelector('.cc-panel-body');
                if (body) body.style.display = '';
            }
        }
    });
    _ccPanelsSetup = true;
}

function processEtaTimers() {
    if (!window._etaItems || window._etaItems.length === 0) return;

    const toRemove = [];

    window._etaItems.forEach((item, idx) => {
        if (!item) return;
        const eta = item.eta || 0;
        const messageId = item.message?.content || '';
        const key = `eta_${messageId.substring(0, 30)}`;

        item.eta = Math.max(0, eta - 1);

        const timerEl = document.querySelector(`.cc-eta-timer[data-message-idx="${item.idx}"]`);
        if (timerEl) {
            const seconds = item.eta * 2;
            timerEl.textContent = seconds > 0 ? `⏱️ ${seconds}с` : '🚨 СЕЙЧАС!';
            timerEl.style.color = seconds <= 0 ? '#ff4444' : '#ffcc44';
        }

        if (eta <= 0 && !window._processedEtaMessages.has(key)) {
            window._processedEtaMessages.add(key);

            try {
                if (game && typeof game.set_temporary_defense_bonus === 'function') {
                    game.set_temporary_defense_bonus(20);
                    if (window.addToLog) {
                        window.addToLog('🛡️ Экстренное уклонение активировано! +20% защиты на 5 тиков.', 'success');
                    }
                }
            } catch(e) {
                console.warn('ETA defense boost failed:', e);
            }

            toRemove.push(idx);
        }
    });

    if (toRemove.length > 0) {
        window._etaItems = window._etaItems.filter((_, i) => !toRemove.includes(i));
    }

    if (window._processedEtaMessages.size > 100) {
        const entries = [...window._processedEtaMessages];
        window._processedEtaMessages = new Set(entries.slice(-50));
    }
}

function updateNeuroStatus(rustStats = null) {
    if (!game) return;
    try {
        if (!rustStats && cachedRustStats) rustStats = cachedRustStats;
        if (!rustStats && game) { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); }
        if (rustStats) {
            const neuroEl = document.getElementById('neuroStatusShort');
            const progressEl = document.getElementById('neuroProgress');
            if (neuroEl) {
                let consc = rustStats.neuro_consciousness || 0;
                const evol = rustStats.neuro_evolution || 0;
                consc = normalizeNeuroConsciousness(consc);
                neuroEl.textContent = `${(consc * 100).toFixed(1)}% (Ур. ${evol})`;
                if (progressEl) {
                    progressEl.style.width = `${Math.min(consc * 100, 100)}%`;
                    progressEl.className = 'neuro-progress';
                    if (consc >= 0.8) progressEl.classList.add('level-high');
                    else if (consc >= 0.5) progressEl.classList.add('level-medium');
                    else if (consc >= 0.2) progressEl.classList.add('level-low');
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

            updateRebelPulse(rustStats.rebel_activity || 0);

            {
                const coalLeft = rustStats.coal_inventory;
                const cfg = window.gameConfig?.coal_consumption_config;
                const avgNightCost = cfg ? (cfg.night_coal_min + cfg.night_coal_max) / 2 : 2;
                const avgDayCost = cfg ? (cfg.day_coal_min + cfg.day_coal_max) / 2 : 1;
                const cyclesLeft = Math.floor(coalLeft / (avgNightCost + avgDayCost));
                const coalHintEl = document.getElementById('coalNightsHint');
                if (coalHintEl) {
                    coalHintEl.textContent = coalLeft > 0
                        ? `≈ ${cyclesLeft} цикл${cyclesLeft === 1 ? '' : cyclesLeft < 5 ? 'а' : 'ов'} (ночь+день)`
                        : 'Угля нет!';
                    coalHintEl.style.color = cyclesLeft < 2 ? '#f88' : '#8f8';
                }
            }

            {
                designModule?.updateComputationalPower?.(rustStats.computational_power);
            }

            GameBus.emit(EVENTS.STATS_UPDATED, rustStats);

            if (_currentTab === 'command') {
                updateCommandCenter(rustStats);
                processEtaTimers();
            }
            _updateSysDots(cachedRustStats);
        }
    } catch(e) {}
}

function updateAttackHistory(history) {
    const container = document.getElementById('attackHistory');
    if (!container) return;
    if (!history?.length) { container.innerHTML = '<div class="history-empty">Атак ещё не было</div>'; return; }

    const maxVisible = _attackHistoryCollapsed ? 5 : history.length;

    const visibleItems = history.slice().reverse().slice(0, maxVisible);

    const showMoreBtn = history.length > 5 && _attackHistoryCollapsed
        ? `<div class="history-show-more" style="text-align:center;margin-top:6px;"><button onclick="window._toggleAttackHistory()" class="cc-op-btn" style="padding:4px 12px;">▼ ПОКАЗАТЬ ВСЕ (${history.length})</button></div>`
        : (history.length > 5 && !_attackHistoryCollapsed
            ? `<div class="history-show-more" style="text-align:center;margin-top:6px;"><button onclick="window._toggleAttackHistory()" class="cc-op-btn" style="padding:4px 12px;">▲ СВЕРНУТЬ</button></div>`
            : '');

    container.innerHTML = visibleItems.map(r => {
        let stolenHtml = '';
        if (r.stolen && typeof r.stolen === 'object' && Object.keys(r.stolen).length > 0) {
            const stolenParts = Object.entries(r.stolen)
                .filter(([, amt]) => amt && amt > 0)
                .map(([res, amt]) => `${RES_ICON[res] || '📦'} ${amt} ${RES_NAME[res] || res}`);
            if (stolenParts.length > 0) {
                stolenHtml = `<span class="attack-stolen">💸 Украдено: ${stolenParts.join(', ')}</span>`;
            }
        } else if (!r.was_defended && r.result && r.result.includes('украдено')) {
            stolenHtml = `<span class="attack-stolen">💸 ${escapeHtml(r.result)}</span>`;
        }

        return `<div class="attack-record ${r.was_defended ? 'defended' : 'failed'}">
            <span class="attack-faction">${escapeHtml(r.faction || 'Неизвестно')}</span>
            <span class="attack-type">${escapeHtml(r.attack_type || '')}</span>
            <span class="attack-result">${r.was_defended ? '✅' : '❌'} ${escapeHtml(r.result || '')}</span>
            ${stolenHtml}
        </div>`;
    }).join('') + showMoreBtn;
}

function _toggleAttackHistory() {
    _attackHistoryCollapsed = !_attackHistoryCollapsed;
    if (cachedRustStats) {
        updateAttackHistory(cachedRustStats.attack_history || []);
    }
}
window._toggleAttackHistory = _toggleAttackHistory;

function getCritChance(stats) {
    const baseCrit = window.gameConfig?.mining_config?.critical_chance ?? 0.11;
    const heatPenalty = 1.0 - Math.min((stats?.turbine_heat || 0) / 200, 1.0);
    const critModule = (stats?.crit_level || 0) * 0.025;
    const neuroCrit = Math.min((stats?.neuro_evolution || 0) / 400, 0.15);

    let fleetCount = 0;
    if (window.fleetModule && window.fleetModule.ships) {
        fleetCount = window.fleetModule.ships.length;
    }
    const fleetBonus = Math.min(fleetCount * 0.005, 0.08);

    return Math.min((baseCrit + critModule + neuroCrit + fleetBonus) * heatPenalty, 0.30);
}

function getComboMultiplier() {
    const evol = cachedRustStats?.neuro_evolution ?? 0;
    return Math.min(1 + Math.min(evol / 200, 1.5), 3.0);
}

function updateStatsFromGame(rustStats) {
    if (!game) return;
    try {
        if (!rustStats) rustStats = cachedRustStats;
        if (!rustStats) return;

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
            coal_mined: Math.max(0, (rustStats.total_coal_mined || 0) - (lastRustStats.total_coal_mined || 0)),
            trash_mined: Math.max(0, (rustStats.total_trash_mined || 0) - (lastRustStats.total_trash_mined || 0)),
            plasma_mined: Math.max(0, (rustStats.total_plasma_mined || 0) - (lastRustStats.total_plasma_mined || 0)),
            ore_mined: Math.max(0, (rustStats.total_ore_mined || 0) - (lastRustStats.total_ore_mined || 0)),
            coal_burned: Math.max(0, (rustStats.total_coal_burned || 0) - (lastRustStats.total_coal_burned || 0)),
            coal_stolen: Math.max(0, (rustStats.total_coal_stolen || 0) - (lastRustStats.total_coal_stolen || 0))
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
    } catch(e) {}
}

function handleClick() {
    if (!game) return;

    const now = Date.now();

    let stats = null;
    try {
        const j = game.get_statistics();

        if (j && j !== '{}') {
            stats = JSON.parse(j);
            if ((!stats.is_day || stats.is_day === true) && stats.game_time === undefined) {
                stats = cachedRustStats;
            }
            if (stats) {
                cachedRustStats = stats;
                cachedRustStatsTime = now;
            }
        }
    } catch(e) {}

    if (!stats) {
        if (cachedRustStats && (now - cachedRustStatsTime) < 5000) {
            stats = cachedRustStats;
        } else {
            return;
        }
    }

    const isActive = stats && (stats.is_day || (stats.coal_enabled && stats.coal_inventory > 0));
    const isOverheated = stats && stats.turbine_heat >= 100;

    if (!isActive) {
        comboCount = 0;
        lastClickTime = 0;
        const isNight = stats?.is_day === false;
        const hasCoal = (stats?.coal_inventory || 0) > 0;

        if (isNight && !stats?.coal_enabled) {
            if (!hasCoal) {
                addToLog('❌ Ночь: уголь закончился! Добудьте уголь или дождитесь дня.');
            } else {
                addToLog('❌ Ночь: включите ТЭЦ для работы.');
            }
        } else {
            addToLog('❌ Система неактивна! Дождитесь дня или включите ТЭЦ.');
        }
        Sounds.error();
        return;
    }

    if (isOverheated) {
        comboCount = 0;
        lastClickTime = 0;
        const coolingRate = Math.ceil(1.5
            + ((stats.turbine_upgrade_level || 0) * 0.25)
            + ((stats.cooling_level || 0) * 0.30));
        const ticksLeft = Math.ceil(stats.turbine_heat / coolingRate);
        addToLog(`🔥 Турбина перегрета (${stats.turbine_heat}%)! Подождите остывания (~${ticksLeft} сек).`);
        Sounds.error();
        return;
    }

    const btn = document.getElementById('floatingMineBtn');

    if (now - lastClickTime >= 1000) {
        comboCount = 0;
        if (btn) btn.classList.remove('combo-active');
    }

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
    const comboBonus = Math.min(Math.floor(comboCount / 5) * comboMult, 2);
    let actualClicks = 1 + Math.floor(comboBonus);
    // ✅ Отображаем реальную мощность за клик
    const powerPerClickEl = document.getElementById('clickComboIndicator');
    if (powerPerClickEl && actualClicks > 1) {
        powerPerClickEl.textContent = `x${actualClicks}`;
        powerPerClickEl.style.display = 'block';
        setTimeout(() => { powerPerClickEl.style.display = 'none'; }, 800);
    }
    const isCrit = Math.random() < critChance;
    Sounds.mine();
    if (isCrit) {
        Sounds.critical();
        showFloatingText('💥 CRIT!', window.innerWidth / 2, window.innerHeight / 2 - 50);
        actualClicks = Math.min(actualClicks * 2, 5);
        if (typeof game.add_manual_click_with_multiplier === 'function') {
            game.add_manual_click_with_multiplier(actualClicks);
        } else {
            for (let i = 0; i < actualClicks; i++) game.add_manual_click();
        }
    } else {
        // ✅ Передаём комбо-бонус мощности в Rust
        if (typeof game.add_manual_click_with_combo === 'function') {
            const comboPowerBonus = Math.floor(comboCount / 5) * comboMult;
            for (let i = 0; i < actualClicks; i++) {
                game.add_manual_click_with_combo(comboPowerBonus);
            }
        } else {
            for (let i = 0; i < actualClicks; i++) game.add_manual_click();
        }
    }
    updatePowerGlow();
    updatePowerTierLabel();
    scheduleCloudSave();

    if (_comboResetTimer) clearTimeout(_comboResetTimer);
    _comboResetTimer = setTimeout(() => {
        comboCount = 0;
        const btn2 = document.getElementById('floatingMineBtn');
        if (btn2) btn2.classList.remove('combo-active');
    }, 1500);

    setTimeout(() => {
        try {
            const j = game.get_statistics();
            if (j) {
                const newStats = JSON.parse(j);
                updateStatsFromGame(newStats);
                updateTurbineStatus(newStats);
                updatePowerGlow();
                updatePowerTierLabel();
                updateInventoryDisplay(newStats);

                const cfg = window.gameConfig?.auto_click_config;
                const clicksPerPower = cfg?.clicks_per_power || 8;
                // ✅ ИСПРАВЛЕНО: читаем правильные переменные
                const rawClicks = newStats.total_clicks || 0;           // Глобальный счетчик
                const remainder = newStats.manual_clicks_remainder || 0; // Остаток (0-7)

                // Обновляем кольцо мощности (передаем именно остаток)
                updatePowerRing(remainder, clicksPerPower);

                // Обновляем текст прогресса
                const clickProgressText = document.getElementById('clickProgressText');
                if (clickProgressText) {
                    clickProgressText.textContent = `${remainder}/${clicksPerPower}`;
                }

                // Обновляем полосу прогресса
                const clickProgressBar = document.getElementById('clickProgress');
                if (clickProgressBar) {
                    const pct = clicksPerPower > 0 ? (remainder / clicksPerPower) * 100 : 0;
                    clickProgressBar.style.width = `${pct}%`;
                }

                if (window._prevMineStats) {
                    const coalD  = (newStats.coal_inventory  || 0) - (window._prevMineStats.coal_inventory  || 0);
                    const trashD = (newStats.trash_inventory || 0) - (window._prevMineStats.trash_inventory || 0);
                    const oreD   = (newStats.ore_inventory   || 0) - (window._prevMineStats.ore_inventory   || 0);
                    if (coalD  > 0) showFloatingText(`+${coalD}🪨`,  window.innerWidth/2 - 30, window.innerHeight/2 - 60);
                    if (trashD > 0) showFloatingText(`+${trashD}♻️`, window.innerWidth/2 + 20, window.innerHeight/2 - 80);
                    if (oreD   > 0) showFloatingText(`+${oreD}⛏️`,   window.innerWidth/2,       window.innerHeight/2 - 100);
                }
                window._prevMineStats = newStats;

                updateTecUI();
            }
        } catch(e) {}
    }, 50);

    try {
        if (typeof game.check_quests === 'function') {
            game.check_quests();
        }
    } catch(e) {}
}

function toggleAutoClicking() {
    if (!game) return;
    let stats = null;
    try {
        const j = game.get_statistics();
        if (j) stats = JSON.parse(j);
    } catch(e) {}

    const isActive = stats && (stats.is_day || (stats.coal_enabled && stats.coal_inventory > 0));
    if (!isActive) {
        if (window.showNotif) window.showNotif('❌ Система неактивна! Включите ТЭЦ или дождитесь дня', true);
        return;
    }

    if (isAutoClicking) {
        game.stop_auto_clicking();
        isAutoClicking = false;
        const btn = document.getElementById('floatingMineBtn');
        if (btn) btn.classList.remove('auto-clicking');
        const status = document.getElementById('autoClickStatus');
        if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
        localStorage.setItem(USER_STORAGE_KEY('corebox_autoclicking'), 'false');
        Sounds.autoStop && Sounds.autoStop();
    } else {
        const cfg = window.gameConfig?.auto_click_config;
        const minCost = cfg?.power_per_auto_click ?? 3;
        if (game.get_computational_power() >= minCost) {
            game.start_auto_clicking();
            isAutoClicking = true;
            const btn = document.getElementById('floatingMineBtn');
            if (btn) btn.classList.add('auto-clicking');
            const status = document.getElementById('autoClickStatus');
            if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
            localStorage.setItem(USER_STORAGE_KEY('corebox_autoclicking'), 'true');
            Sounds.autoStart && Sounds.autoStart();

            setTimeout(() => {
                try {
                    const j = game.get_statistics();
                    if (j) {
                        const s = JSON.parse(j);
                        if (!s.auto_clicking && isAutoClicking) {
                            isAutoClicking = false;
                            const btn2 = document.getElementById('floatingMineBtn');
                            if (btn2) btn2.classList.remove('auto-clicking');
                            const status2 = document.getElementById('autoClickStatus');
                            if (status2) {
                                status2.textContent = 'ОТКЛЮЧЕНА';
                                status2.classList.remove('auto-clicking-status');
                            }
                            addToLog('⚠️ Автокликер отключён: недостаточно мощности', 'warning');
                        }
                    }
                } catch(e) {}
            }, 200);
        } else {
            const btn = document.getElementById('floatingMineBtn');
            if (btn) {
                btn.classList.add('no-power');
                Sounds.error();
                setTimeout(() => btn.classList.remove('no-power'), 800);
            }
            addToLog(`❌ Недостаточно мощности для автокликера (нужно минимум ${minCost})`, 'warning');
        }
    }
    updatePowerGlow();
    updatePowerTierLabel();
    scheduleCloudSave();
}

function renderUpgradesTab() {
    const container = document.getElementById('upgradesContainer');
    if (!container) return;

    if (_currentTab !== 'upgrades') return;

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

    const miningLevel = stats?.mining_level ?? 0;
    const defenseActive = stats?.defense_active ?? false;
    const defenseLevel = stats?.defense_level ?? 0;
    const critLevel = stats?.crit_level ?? 0;
    const coolingLevel = stats?.cooling_level ?? 0;
    const turbineLevel = stats?.turbine_upgrade_level ?? 0;

    let miningChipsCost = 8 + Math.floor(2.5 * miningLevel);
    const defensePlasmaCost = 1;
    const defenseChipsCost = (defenseLevel + 1) * 10;
    const defensePlasmaLevelCost = 1 + Math.floor(defenseLevel / 2);
    const turbineOreCost = 30 + turbineLevel * 20;
    const turbineChipsCost = 5 + turbineLevel * 3;
    const critCost = (critLevel + 1) * 2;
    const coolingCost = Math.round(200 * Math.pow(1.3, coolingLevel));

    const critButtonDisabled = (() => {
        if (critLevel >= 15) return 'disabled';
        const chipsNeed = (critLevel + 1) * 8;
        const otherNeed = (critLevel + 1) * 2;
        return (inv.chips >= chipsNeed &&
                inv.ore >= otherNeed &&
                inv.coal >= otherNeed &&
                inv.plasma >= otherNeed &&
                inv.trash >= otherNeed) ? '' : 'disabled';
    })();

    const html = `
        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">⛏️ ЭФФЕКТИВНОСТЬ ДОБЫЧИ</div>
                <div class="upgrade-level">УР. ${miningLevel}/15</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">+1.8% к шансу добычи за уровень | +3% угля при активной ТЭЦ</div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${(miningLevel / 15) * 100}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🎛️</span><span>МИКРОСХЕМЫ:</span></div>
                    <div class="requirement-value">${inv.chips}/${miningChipsCost}</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeMiningBtn" class="upgrade-btn" ${inv.chips >= miningChipsCost && miningLevel < 15 ? '' : 'disabled'}>УЛУЧШИТЬ ДОБЫЧУ</button>
            </div>
        </div>

        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">🛡️ СИСТЕМА ЗАЩИТЫ</div>
                <div class="upgrade-level" id="defenseStatusText">${defenseActive ? 'АКТИВНА' : 'НЕАКТИВНА'}</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">Блокирует атаки повстанцев | Уровень защиты снижает урон</div>
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
                <button id="upgradeDefenseBtn" class="upgrade-btn" ${!defenseActive && inv.plasma >= defensePlasmaCost ? '' : 'disabled'}>АКТИВИРОВАТЬ ЗАЩИТУ</button>
            </div>
        </div>

        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">💪 УСИЛЕНИЕ ЗАЩИТЫ</div>
                <div class="upgrade-level">УР. ${defenseLevel}/8</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">Увеличивает мощность защиты | +12.5% блокирования за уровень</div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${(defenseLevel / 8) * 100}%"></div>
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
                <button id="upgradeDefenseLevelBtn" class="upgrade-btn" ${defenseActive && defenseLevel < 8 && inv.chips >= defenseChipsCost && inv.plasma >= defensePlasmaLevelCost ? '' : 'disabled'}>УСИЛИТЬ ЗАЩИТУ</button>
            </div>
        </div>

        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">⚙️ ТУРБИНА</div>
                <div class="upgrade-level">УР. ${turbineLevel}/8</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">+10% к скорости охлаждения за уровень | -10% к нагреву турбины</div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${(turbineLevel / 8) * 100}%"></div>
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
                <button id="upgradeTurbineBtn" class="upgrade-btn" ${turbineLevel < 8 && inv.ore >= turbineOreCost && inv.chips >= turbineChipsCost ? '' : 'disabled'}>УЛУЧШИТЬ ТУРБИНУ</button>
            </div>
        </div>

        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">💥 КРИТ-МОДУЛЬ</div>
                <div class="upgrade-level">Ур. ${critLevel}/15</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">+2.5% к шансу крит. удара за уровень | Удваивает добычу при срабатывании</div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${(critLevel / 15) * 100}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🎛️</span><span>ЧИПЫ:</span></div>
                    <div class="requirement-value">${inv.chips}/${(critLevel + 1) * 8}</div>
                </div>
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">📦</span><span>ОСТАЛЬНЫЕ:</span></div>
                    <div class="requirement-value">по ${critCost} каждого</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeCritBtn" class="upgrade-btn" ${critButtonDisabled}>УЛУЧШИТЬ КРИТ</button>
            </div>
        </div>

        <div class="upgrade-card">
            <div class="upgrade-header">
                <div class="upgrade-title">❄️ ОХЛАЖДЕНИЕ</div>
                <div class="upgrade-level">Ур. ${coolingLevel}/15</div>
            </div>
            <div class="upgrade-desc" style="font-size:10px;color:#888;margin:4px 0;">-15% к нагреву за уровень | Предотвращает перегрев ТЭЦ</div>
            <div class="progress-container">
                <div class="progress-fill" style="width: ${(coolingLevel / 15) * 100}%"></div>
            </div>
            <div class="upgrade-requirements">
                <div class="requirement">
                    <div class="requirement-name"><span class="requirement-icon">🪨</span><span>СТОИМОСТЬ:</span></div>
                    <div class="requirement-value">${coolingCost} угля</div>
                </div>
            </div>
            <div class="upgrade-cost">
                <button id="upgradeCoolingBtn" class="upgrade-btn" ${coolingLevel < 15 && inv.coal >= coolingCost ? '' : 'disabled'}>УЛУЧШИТЬ ОХЛАЖДЕНИЕ</button>
            </div>
        </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.upgrade-btn').forEach(btn => {
        if (btn.disabled) return;
        if (btn.id === 'upgradeMiningBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_mining(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeDefenseBtn') btn.onclick = () => { Sounds.upgrade(); game.activate_defense(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeDefenseLevelBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_defense(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeTurbineBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_turbine(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeCritBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_crit_module(); scheduleCloudSave(); renderUpgradesTab(); };
        else if (btn.id === 'upgradeCoolingBtn') btn.onclick = () => { Sounds.upgrade(); game.upgrade_cooling_module(); scheduleCloudSave(); renderUpgradesTab(); };
    });
}

function setupEventListeners() {
    const tabs = [
        { id: 'inventory-tab-btn', tab: 'inventory' }, { id: 'upgrades-tab-btn', tab: 'upgrades' },
        { id: 'trade-tab-btn', tab: 'trade' }, { id: 'quests-tab-btn', tab: 'quests' },
        { id: 'command-tab-btn', tab: 'command' }, { id: 'craft-tab-btn', tab: 'craft' },
        { id: 'design-tab-btn', tab: 'design' }, { id: 'fleet-tab-btn', tab: 'fleet' },
        { id: 'space-tab-btn', tab: 'space' }
    ];
    tabs.forEach(({ id, tab }) => document.getElementById(id)?.addEventListener('click', () => switchMainTab(tab)));

    const muteBtn = document.getElementById('muteToggleBtn');
    if (muteBtn) {
        const savedMuted = localStorage.getItem('corebox_sound_muted') === 'true';
        if (savedMuted) {
            muteBtn.textContent = '🔇';
            muteBtn.classList.add('muted');
            if (window.Sounds?.setMusicEnabled) {
                window.Sounds.setMusicEnabled(false);
            }
        }

        muteBtn.onclick = async () => {
            const isEnabled = await Sounds.toggleMute();
            muteBtn.textContent = isEnabled ? '🔊' : '🔇';
            muteBtn.classList.toggle('muted', !isEnabled);
        };
    }

    document.addEventListener('click', (e) => {
        if (!game) return;
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        const resource = target.getAttribute('data-resource');

        if (action === 'buy' && resource) {
            game.buy_resource(resource);
            scheduleCloudSave();
        } else if (action === 'sell' && resource) {
            game.sell_resource(resource);
            scheduleCloudSave();
        } else if (action === 'toggle-coal') {
            if (!game) return;
            game.toggle_coal();
            scheduleCloudSave();

            setTimeout(() => {
                try {
                    const freshStats = JSON.parse(game.get_statistics());
                    cachedRustStats = freshStats;
                    updateTecUI();
                    updateInventoryDisplay(freshStats);

                    const coalStatusEl = document.getElementById('coalStatus');
                    if (coalStatusEl) {
                        coalStatusEl.textContent = freshStats.coal_enabled ? "АКТИВНА" : "ОФФЛАЙН";
                    }
                } catch(e) {}
            }, 50);
        }

        else if (action === 'propaganda') {
            if (game.neuro_propaganda) {
                game.neuro_propaganda();
                scheduleCloudSave();
            }
        } else if (action === 'fake_depot') {
            if (game.neuro_fake_depot) {
                game.neuro_fake_depot();
                scheduleCloudSave();
            }
        } else if (action === 'close_vulnerability') {
            if (game.neuro_close_vulnerability) {
                game.neuro_close_vulnerability();
                scheduleCloudSave();
            }
        } else if (action === 'fleet_shield') {
            if (game.neuro_deploy_fleet_shield) {
                game.neuro_deploy_fleet_shield();
                scheduleCloudSave();
            }
        } else if (action === 'encrypt_blueprints') {
            if (game.neuro_encrypt_blueprints) {
                game.neuro_encrypt_blueprints();
                scheduleCloudSave();
            }
        } else if (action === 'fortify_planets') {
            if (game.neuro_fortify_planets) {
                game.neuro_fortify_planets();
                scheduleCloudSave();
            }
        }
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

    const exportBtn = document.getElementById('exportStatsBtn');
    if (exportBtn) {
        exportBtn.onclick = () => {
            import('./statistics.js').then(m => m.exportStatistics());
        };
    }
    const importBtn = document.getElementById('importStatsBtn');
    if (importBtn) {
        importBtn.onclick = () => {
            import('./statistics.js').then(m => m.importStatistics());
        };
    }

    const resetStats = document.getElementById('resetStatsBtn');
    if (resetStats) resetStats.onclick = () => {
        Sounds.error();
        resetUserStatistics().then(wasReset => {
            if (wasReset) {
                document.dispatchEvent(new CustomEvent('resetUserStats', { detail: { stats: gameStats } }));
                saveCurrentUserStatistics();
            } else {
                Sounds.click && Sounds.click();
            }
        });
    };

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
            if (e.detail.success) GameBus.emit(EVENTS.CRAFT_DONE, e.detail);
        }
    });
    document.addEventListener('designResult', (e) => {
        if (e.detail?.success) {
            scheduleCloudSave();
            setTimeout(() => {
                window.updateCraftTab();
                window.updateDesignTab();
            }, 100);
        }
    });
    document.addEventListener('fleetAction', (e) => { if (e.detail?.success) scheduleCloudSave(); });
}

async function handleRebelAttackStolen(attackResult) {
    if (!attackResult?.stolen || !currentUser?.id) return;
    for (const [resource, amount] of Object.entries(attackResult.stolen)) {
        if (amount > 0) {
            try {
                const { data } = await supabase.rpc('steal_from_trades', {
                    p_victim_id: currentUser.id,
                    p_resource: resource,
                    p_amount: amount,
                });
                if (data?.trades_cancelled > 0) {
                    addToLog(`💀 Повстанцы украли ресурсы из ваших торговых предложений! (${data.trades_cancelled} сделок закрыто)`, 'warning');
                }
            } catch (e) {
                console.warn('steal_from_trades error:', e);
            }
        }
    }
}

function saveCurrentUserStatistics() {
    if (!currentUser) return;
    const key = USER_STORAGE_KEY('corebox_user_stats', currentUser.id);
    const statistics = {
        totalClicks: gameStats.totalClicks,
        maxPowerReached: gameStats.maxPowerReached,
        nightsSurvived: gameStats.nightsSurvived,
        rebelAttacks: gameStats.rebelAttacks,
        attacksDefended: gameStats.attacksDefended,
        coalMined: gameStats.coalMined,
        trashMined: gameStats.trashMined,
        plasmaMined: gameStats.plasmaMined,
        oreMined: gameStats.oreMined || 0,
        coalBurned: gameStats.coalBurned,
        coalStolen: gameStats.coalStolen,
        playTime: gameStats.accumulatedPlayTime,
        sessionsCount: gameStats.sessionsCount,
        lastSessionDate: gameStats.lastSessionDate,
        totalMined: gameStats.totalMined,
        consecutiveDefenses: gameStats.consecutiveDefenses,
        longestDefenseStreak: gameStats.longestDefenseStreak,
        visibility: gameStats.visibility,
        neuroEvolution: gameStats.neuroEvolution,
        neuroConsciousness: gameStats.neuroConsciousness,
        neuroScore: gameStats.neuroScore
    };
    localStorage.setItem(key, JSON.stringify(statistics));
}

function cleanupGameTimers() {
    if (_gameLoopRAF) { cancelAnimationFrame(_gameLoopRAF); _gameLoopRAF = null; }
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    if (_cloudSaveTimer) { clearTimeout(_cloudSaveTimer); _cloudSaveTimer = null; }
    if (_missionTimerInterval) { clearInterval(_missionTimerInterval); _missionTimerInterval = null; }
    if (_missionPollInterval) { clearInterval(_missionPollInterval); _missionPollInterval = null; }
    if (_lastSeenTimer) { clearInterval(_lastSeenTimer); _lastSeenTimer = null; }
    if (_universalChannel) { _universalChannel.close(); _universalChannel = null; }
    if (_keepAliveChannel) { _keepAliveChannel.close(); _keepAliveChannel = null; }
    if (_fleetUITimer) { clearInterval(_fleetUITimer); _fleetUITimer = null; }
    if (_saveInterval) { clearInterval(_saveInterval); _saveInterval = null; }
    if (_ccClockInterval) { clearInterval(_ccClockInterval); _ccClockInterval = null; }
    if (_tabHiddenInterval) { clearInterval(_tabHiddenInterval); _tabHiddenInterval = null; }
}

let lastConfigHash = null;
async function loadConfig() {
    try {
        const resp = await fetch("config.json?_=" + Date.now());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const configStr = await resp.text();
        let hash = 0;
        for (let i = 0; i < configStr.length; i++) { hash = ((hash << 5) - hash) + configStr.charCodeAt(i); hash |= 0; }
        if (hash !== lastConfigHash) {
            lastConfigHash = hash;
            try {
                const parsed = JSON.parse(configStr);
                apply_config_from_admin(configStr);
                if (game) game.reload_config();
                window.gameConfig = parsed;
            } catch(e) {
                addToLog('⚠️ Конфиг невалиден, пропускаем обновление', 'warning');
            }
        }
    } catch(e) {
        addToLog('⚠️ Конфиг не обновлён (нет соединения)', 'warning');
    }
}

function gameLoopFrame(timestamp) {
    if (!isGameInitialized || !game) {
        if (isGameInitialized) {
            _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
        }
        return;
    }

    if (_lastFrameTime === 0) {
        _lastFrameTime = timestamp;
        if (_accumulatedDelta > GAME_TICK_MS) {
            _catchupFramesLeft = Math.min(
                MAX_CATCHUP_FRAMES,
                Math.floor(_accumulatedDelta / GAME_TICK_MS)
            );
            console.log(`⏩ Запуск догонялки: ${_catchupFramesLeft} кадров`);
        }
        _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
        return;
    }

    const rawDelta = timestamp - _lastFrameTime;
    const delta = Math.min(rawDelta, 1000);
    _lastFrameTime = timestamp;
    _accumulatedDelta += delta;

    const MAX_TICKS_PER_FRAME = 3;
    const isCatchUp = _accumulatedDelta > GAME_TICK_MS * MAX_TICKS_PER_FRAME;
    let needFullRender = false;

    _ticksThisFrame = 0;
    while (_accumulatedDelta >= GAME_TICK_MS && _ticksThisFrame < MAX_TICKS_PER_FRAME) {
        _accumulatedDelta -= GAME_TICK_MS;

        game.game_loop();

        if (!isCatchUp || _ticksThisFrame === MAX_TICKS_PER_FRAME - 1) {
            const rustStats = tryGetStats();
            if (rustStats) {
                cachedRustStats = rustStats;
                cachedRustStatsTime = Date.now();
                updatePowerGlow();
                updatePowerTierLabel();
                updateTurbineStatus(rustStats);
                updateInventoryDisplay(rustStats);
                updateTecUI();
                updateStatsFromGame(rustStats);

                const power = game.get_computational_power();
                const maxPower = game.get_max_computational_power?.() || 1000;
                const powerPercent = (power / maxPower) * 100;
                if (isAutoClicking && powerPercent < 10 && powerPercent > 0) {
                    if (!_lowPowerWarned) {
                        _lowPowerWarned = true;
                        addToLog('⚠️ Мощность на исходе! Автокликер скоро остановится.');
                        Sounds.warning && Sounds.warning();
                    }
                } else {
                    _lowPowerWarned = false;
                }

                if (isAutoClicking && rustStats.turbine_heat >= 100) {
                    game.stop_auto_clicking();
                    isAutoClicking = false;
                    _lowPowerWarned = false;
                    localStorage.setItem(USER_STORAGE_KEY('corebox_autoclicking'), 'false');
                    document.getElementById('floatingMineBtn')?.classList.remove('auto-clicking');
                    const status = document.getElementById('autoClickStatus');
                    if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
                    addToLog('⏹️ Автодобыча остановлена: турбина перегрета', 'warning');
                }

                if (rustStats.auto_clicking === false && isAutoClicking) {
                    isAutoClicking = false;
                    _lowPowerWarned = false;
                    localStorage.setItem(USER_STORAGE_KEY('corebox_autoclicking'), 'false');
                    document.getElementById('floatingMineBtn')?.classList.remove('auto-clicking');
                    const status = document.getElementById('autoClickStatus');
                    if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
                    addToLog('⚡ Автокликер остановлен: мощность исчерпана');
                }

                const mineBtn = document.getElementById('floatingMineBtn');
                if (mineBtn && rustStats) {
                    const systemActive = rustStats.is_day || (rustStats.coal_enabled && rustStats.coal_inventory > 0);
                    const overheated = rustStats.turbine_heat >= 100;

                    if (!systemActive) {
                        mineBtn.classList.add('system-offline');
                        mineBtn.title = 'Система неактивна — ночь без угля';
                    } else if (overheated) {
                        mineBtn.classList.add('turbine-critical');
                        mineBtn.title = 'Турбина перегрета — ожидайте остывания';
                        const coolingRate = Math.ceil(1.5
            + ((rustStats.turbine_upgrade_level || 0) * 0.25)
            + ((rustStats.cooling_level || 0) * 0.30));
                        const ticksLeft = Math.ceil(rustStats.turbine_heat / coolingRate);
                        const btnText = mineBtn.querySelector('.btn-text');
                        if (btnText) btnText.textContent = `${ticksLeft}с`;
                    } else {
                        mineBtn.classList.remove('system-offline', 'turbine-critical');
                        mineBtn.title = 'Добыча активна';
                        const btnText = mineBtn.querySelector('.btn-text');
                        if (btnText && btnText.textContent.includes('с')) btnText.textContent = 'ДОБЫЧА';
                    }
                }

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
                            total_mined: rustStats.total_mined || rustStats.total_clicks || 0,
                            neuro_score: rustStats.neuro_score || 0,
                            nights_survived: rustStats.nights_survived || 0
                        });
                    }
                }

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

                if (!isAutoClicking && Date.now() - lastClickTime > 1500) comboCount = 0;

                window._flightLineCounter = (window._flightLineCounter || 0) + 1;
                if (window._flightLineCounter >= 5) {
                    window._flightLineCounter = 0;
                    if (window.spaceModule?.renderFlightLines) {
                        window.spaceModule.renderFlightLines();
                    }
                }

                window._missionRefreshCounter = (window._missionRefreshCounter || 0) + 1;
                if (window._missionRefreshCounter >= 10) {
                    window._missionRefreshCounter = 0;
                    if (fleetModule.refreshActiveMissions) {
                        fleetModule.refreshActiveMissions();
                    }
                }

                if (window.spaceModule && window.spaceModule.initialized) {
                    const fleetCargo = fleetModule.getCargoMiningBonus();
                    try {
                        if (typeof game.set_fleet_cargo_bonus === 'function') {
                            game.set_fleet_cargo_bonus(fleetCargo);
                        }
                        if (typeof game.set_fleet_power_bonus === 'function') {
                            game.set_fleet_power_bonus(Math.floor(fleetCargo / 10));
                        }
                    } catch(e) {}
                }

                lastRustStats = rustStats;
                needFullRender = true;
            }
        }
        _ticksThisFrame++;
    }

    if (_accumulatedDelta > MAX_ACCUMULATED) {
        console.warn(`⚠️ Слишком большое отставание, обрезаем до 30с`);
        _accumulatedDelta = MAX_ACCUMULATED;
    }

    if (_catchupFramesLeft > 0) _catchupFramesLeft--;

    if (needFullRender || _ticksThisFrame > 0) {
        processEtaTimers();
    }

    if (needFullRender && cachedRustStats) {

        updateDayNightVisuals(cachedRustStats);

        updateNeuroStatus(cachedRustStats);

        if (_currentTab === 'upgrades') {
            renderUpgradesTab();
        }

        const statsSection = document.getElementById('statistics-section');
        if (statsSection && statsSection.style.display !== 'none') {
            scheduleStatsDisplayUpdate();
        }

        updateStatisticsFromRust(cachedRustStats);

        window._achCounter = (window._achCounter || 0) + 1;
        if (window._achCounter >= 10) {
            window._achCounter = 0;
            const achievementStats = {
                ...gameStats,
                nightsSurvived: cachedRustStats.nights_survived ?? gameStats.nightsSurvived ?? 0,
                neuroEvolution: cachedRustStats.neuro_evolution ?? gameStats.neuroEvolution ?? 0,
                plasma: cachedRustStats.inventory?.plasma ?? cachedRustStats.plasma_inventory ?? 0,
                chips: cachedRustStats.inventory?.chips ?? cachedRustStats.chips_inventory ?? 0,
                blueprintCargoUnlocked: cachedRustStats.blueprint_cargo_unlocked === true,
                blueprintScoutUnlocked: cachedRustStats.blueprint_scout_unlocked === true,
                blueprintCombatUnlocked: cachedRustStats.blueprint_combat_unlocked === true,
                pvpWins: Math.max(
                    Number(cachedRustStats.pvp_wins || 0),
                    Number(gameStats.pvpWins || 0),
                    Number(localStorage.getItem(`corebox_pvp_wins_${window.currentUser?.id || 'anon'}`) || 0)
                ),
            };
            import('./achievements.js').then(m => m.checkAchievements(achievementStats)).catch(() => {});
        }

        if (cachedRustStats.nights_survived !== undefined && cachedRustStats.is_day !== undefined) {
            const isNightStart = !cachedRustStats.is_day && cachedRustStats.game_time !== undefined && cachedRustStats.game_time >= 16;
            rollNightDiscount(cachedRustStats.nights_survived, isNightStart);
        }

        if (cachedRustStats.is_day !== undefined && cachedRustStats.game_time !== undefined) {
            const timeLeft = cachedRustStats.game_time;
            const isDay = cachedRustStats.is_day;
            const coalCount = cachedRustStats.coal_inventory || 0;
            const coalEnabled = cachedRustStats.coal_enabled;

            if (isDay) _nightWarnShown = false;

            if (isDay && timeLeft <= 5 && timeLeft > 0 && !coalEnabled) {
                if (!_nightWarnShown) {
                    _nightWarnShown = true;
                    if (coalCount > 0) {
                        addToLog('⚠️ Скоро наступит ночь! Включите ТЭЦ для работы ночью!', 'warning');
                    } else {
                        addToLog('⚠️ Скоро наступит ночь! Угля нет — добудьте уголь!', 'warning');
                    }
                    Sounds.warning && Sounds.warning();
                }
            }
        }

        const fleetCombat = fleetModule.getFleetDefenseContribution(cachedRustStats.defense_debuff_remaining || 0);
        const fleetCargo = fleetModule.getCargoMiningBonus();
        const fleetRecon = fleetModule.getScoutReconBonus();
        try {
            if (typeof game.set_fleet_defense_bonus === 'function' && fleetCombat > 0) {
                game.set_fleet_defense_bonus(fleetCombat);
            }
            if (typeof game.set_fleet_cargo_bonus === 'function' && fleetCargo > 0) {
                game.set_fleet_cargo_bonus(fleetCargo);
            }
            if (typeof game.set_fleet_power_bonus === 'function') {
                game.set_fleet_power_bonus(Math.floor(fleetCargo / 10));
            }
        } catch(e) {}

        if (cachedRustStats.current_ai_mode) {
            const mode = cachedRustStats.current_ai_mode;
            let newAlertMode = false;
            if (mode.includes('Стратегическое отступление') || mode.includes('консервирует')) {
                if (typeof game.set_temporary_defense_bonus === 'function') game.set_temporary_defense_bonus(40);
            } else if (mode.includes('Предсказание') || mode.includes('угроза')) newAlertMode = true;
            else { if (typeof game.set_temporary_defense_bonus === 'function') game.set_temporary_defense_bonus(0); }

            if (newAlertMode !== lastAlertMode) {
                fleetModule.setAlertMode(newAlertMode);
                lastAlertMode = newAlertMode;
            }
        } else if (lastAlertMode !== false) {
            fleetModule.setAlertMode(false);
            lastAlertMode = false;
        }

        craftModule.syncFromStats(cachedRustStats);
        craftModule.aiProductionBonus = Math.min(30, (cachedRustStats.neuro_evolution || 0) * 1.5);

        const neuroConsc = cachedRustStats.neuro_consciousness || 0;
        const normalized = normalizeNeuroConsciousness(neuroConsc);
        designModule.aiResearchBonus = Math.floor(normalized * 100 / 20);
    }

    _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
}

function tryGetStats() {
    try {
        const j = game.get_statistics();
        if (j && j !== '{}') return JSON.parse(j);
    } catch(e) {}
    return null;
}

async function initializeGame(existingSave = null) {
    if (isGameInitialized) return;

    cleanupGameTimers();

    try {
        await init();
        await loadConfig();
        updateAutoClickSettingsUI();
        game = start_game();
        window.game = game;
        window.fleetModule = fleetModule;

        await applyPendingLoot();

        // 🧹 Очистка fleet-кэша при первом запуске после патча
        if (localStorage.getItem(USER_STORAGE_KEY('corebox_fleet_cleanup_v2')) !== 'done') {
            const userId = window.currentUser?.id;
            if (userId) {
                localStorage.removeItem(`corebox_fleet_${userId}`);
                localStorage.removeItem('corebox_last_combat_result');
                localStorage.removeItem('corebox_last_scout_result');
                localStorage.setItem(USER_STORAGE_KEY('corebox_fleet_cleanup_v2'), 'done');
                console.log('🧹 Fleet cache cleaned');
            }
        }

        let loadedFromCloud = false;

        if (existingSave) {
            try {
                let rustFormatSave = existingSave;
                if (existingSave.inventory && existingSave.inventory.coal !== undefined && !existingSave.ore_inventory) {
                    const cargoUnlocked = existingSave.blueprints?.cargo === true
                        || (Array.isArray(existingSave.blueprints) && existingSave.blueprints.find(b=>b.id==='cargo')?.unlocked === true);
                    const scoutUnlocked = existingSave.blueprints?.scout === true
                        || (Array.isArray(existingSave.blueprints) && existingSave.blueprints.find(b=>b.id==='scout')?.unlocked === true);
                    const combatUnlocked = existingSave.blueprints?.combat === true
                        || (Array.isArray(existingSave.blueprints) && existingSave.blueprints.find(b=>b.id==='combat')?.unlocked === true);

                    rustFormatSave = {
                        inventory: {
                            coal: existingSave.inventory.coal,
                            ore: existingSave.inventory.ore,
                            chips: existingSave.inventory.chips,
                            plasma: existingSave.inventory.plasma,
                            trash: existingSave.inventory.trash
                        },
                        upgrades: existingSave.upgrades || { mining: 0, defense: false, defense_level: 0, crit_level: 0, cooling_level: 0 },
                        computational_power: existingSave.computational_power || 0,
                        max_computational_power: existingSave.max_computational_power || 1000,
                        nights_survived: existingSave.nights_survived || 0,
                        manual_clicks: existingSave.manual_clicks || 0,
                        total_mined: existingSave.total_mined || 0,
                        neuro_evolution: existingSave.neuro?.evolution || 0,
                        neuro_consciousness: (() => {
                            let c = existingSave.neuro?.consciousness || 0;
                            c = normalizeNeuroConsciousness(c);
                            return c;
                        })(),
                        neuro_score: existingSave.neuro?.score || 0,
                        current_ai_mode: existingSave.neuro?.ai_mode || "Обычный",
                        is_day: existingSave.is_day !== undefined ? existingSave.is_day : true,
                        coal_enabled: existingSave.coal_enabled || false,
                        game_time: existingSave.game_time ?? 24,
                        rebel_activity: existingSave.rebel_activity || 0,
                        rebel_protection_nights: existingSave.rebel_protection_nights || 0,
                        rebel_protection_active: existingSave.rebel_protection_active || false,
                        turbine_heat: existingSave.turbine_heat || 0,
                        turbine_upgrade_level: existingSave.turbine_upgrade_level || 0,
                        total_coal_mined: existingSave.statistics?.total_coal_mined || 0,
                        total_trash_mined: existingSave.statistics?.total_trash_mined || 0,
                        total_plasma_mined: existingSave.statistics?.total_plasma_mined || 0,
                        total_ore_mined: existingSave.statistics?.total_ore_mined || 0,
                        total_coal_burned: existingSave.statistics?.total_coal_burned || 0,
                        total_coal_stolen: existingSave.statistics?.total_coal_stolen || 0,
                        rebel_attacks_count: existingSave.statistics?.rebel_attacks || 0,
                        attacks_defended: existingSave.statistics?.attacks_defended || 0,

                        last_ai_coal_threshold: existingSave.last_ai_coal_threshold || 0,
                        current_night_type: existingSave.current_night_type || "",
                        blueprint_cargo_unlocked: cargoUnlocked,
                        blueprint_scout_unlocked: scoutUnlocked,
                        blueprint_combat_unlocked: combatUnlocked,
                        quests_progress: existingSave.quests_progress || [],
                        planets: existingSave.planets || [],
                        active_planet_missions: existingSave.active_planet_missions || [],
                        chips_unlocked: existingSave.chips_unlocked ?? (existingSave.inventory?.chips > 0),
                        plasma_unlocked: existingSave.plasma_unlocked ?? (existingSave.inventory?.plasma > 0),
                        ore_unlocked: existingSave.ore_unlocked ?? (existingSave.neuro?.evolution >= 3),
                        map_x: existingSave.map_x ?? null,
                        map_y: existingSave.map_y ?? null,

                        blueprint_locked_until: existingSave.blueprint_locked_until || 0,
                        locked_blueprint_id: existingSave.locked_blueprint_id || "",
                        tec_sabotaged: existingSave.tec_sabotaged || false,
                        tec_sabotage_remaining: existingSave.tec_sabotage_remaining || 0,
                        total_breaches: existingSave.total_breaches || 0,
                        fleet_under_attack: existingSave.fleet_under_attack || false,
                        fleet_attack_damage: existingSave.fleet_attack_damage || 0,
                        fleet_shield_active: existingSave.fleet_shield_active || false,
                        fleet_shield_remaining: existingSave.fleet_shield_remaining || 0,
                        blueprints_encrypted: existingSave.blueprints_encrypted || false,
                        blueprint_encryption_remaining: existingSave.blueprint_encryption_remaining || 0,
                        planets_fortified: existingSave.planets_fortified || false,
                        planet_fortification_remaining: existingSave.planet_fortification_remaining || 0,
                    };
                }
                game.load_game_state(JSON.stringify(rustFormatSave));
                addToLog("💾 Загружено облачное сохранение");
                syncUIAfterCloudLoad(existingSave);

                if (existingSave?.fleet && Array.isArray(existingSave.fleet) && window.fleetModule) {
                    // ✅ Валидация флота перед восстановлением
                    const validFleet = existingSave.fleet.filter(s =>
                        s && typeof s.id === 'string' && typeof s.type === 'string'
                    );
                    const storageKey = window.fleetModule._getStorageKey();
                    localStorage.setItem(storageKey, JSON.stringify(validFleet));
                    window.fleetModule.ships = validFleet;

                    // ✅ Восстанавливаем защитника
                    if (window.fleetModule._loadDefenseShip) {
                        window.fleetModule._loadDefenseShip();
                    } else if (existingSave.defense_ship_id) {
                        const ship = validFleet.find(s => s.id === existingSave.defense_ship_id);
                        if (ship && !ship.onMission && ship.type === 'combat') {
                            window.fleetModule.defenseShipId = existingSave.defense_ship_id;
                            ship.onDefense = true;
                        }
                    }

                    // ✅ Синхронизируем статус в БД
                    if (window.fleetModule._syncFleetStatus) {
                        window.fleetModule._syncFleetStatus();
                    }

                    if (window.fleetModule._renderFleetTab) {
                        window.fleetModule._renderFleetTab();
                    }
                    console.log(`✅ Флот восстановлен из existingSave: ${validFleet.length} кораблей`);
                }

                loadedFromCloud = true;
            } catch(e) {}
        }

        if (!loadedFromCloud && currentUser) {
            const cloudSave = await loadFromCloudAndMerge();
            loadedFromCloud = !!cloudSave;
        }

        if (!loadedFromCloud) {
            const universalSave = localStorage.getItem(USER_STORAGE_KEY('corebox_save_universal'));
            if (universalSave) {
                try {
                    const saveData = JSON.parse(universalSave);
                    if (saveData.max_computational_power && typeof game.set_max_power === 'function') {
                        game.set_max_power(saveData.max_computational_power);
                    }
                    if (saveData.computational_power !== undefined && game && typeof game.add_power === 'function') {
                        const currentPower = game.get_computational_power() || 0;
                        const savedPower = saveData.computational_power;
                        if (savedPower > currentPower) {
                            game.add_power(savedPower - currentPower);
                            addToLog(`⚡ Восстановлена мощность: ${savedPower}`);
                        }
                    }
                } catch(e) {}
            }
            if (!localStorage.getItem('corebox_save_full') && !localStorage.getItem('corebox_save')) {
                addToLog("⚠️ Сохранений не найдено, начинаем новую игру");
            }
        }

        const universalSave = localStorage.getItem(USER_STORAGE_KEY('corebox_save_universal'));
        if (universalSave && !offlineProgressShown) {
            try {
                const savedState = JSON.parse(universalSave);
                const offlineProgress = calculateOfflineProgress(savedState);
                if (offlineProgress && game) {
                    if (offlineProgress.coalGained > 0) game.add_resource('coal', offlineProgress.coalGained);
                    if (offlineProgress.trashGained > 0) game.add_resource('trash', offlineProgress.trashGained);
                    if (offlineProgress.oreGained > 0) game.add_resource('ore', offlineProgress.oreGained);
                    if (offlineProgress.coalStolen > 0) game.subtract_resource('coal', offlineProgress.coalStolen);
                    if (offlineProgress.oreStolen > 0) game.subtract_resource('ore', offlineProgress.oreStolen);
                    if (offlineProgress.chipsStolen > 0) game.subtract_resource('chips', offlineProgress.chipsStolen);
                    if (offlineProgress.plasmaStolen > 0) game.subtract_resource('plasma', offlineProgress.plasmaStolen);
                    if (offlineProgress.powerGained > 0 && typeof game.add_power === 'function') game.add_power(offlineProgress.powerGained);
                    offlineProgressShown = true;
                    showOfflineRewardPopup(offlineProgress);
                    scheduleCloudSave();
                }
            } catch(e) {}
        }

        applyPendingLoot();

        window._prevMineStats = null;

        setTimeout(() => {
            const savedAutoClick = localStorage.getItem(USER_STORAGE_KEY('corebox_autoclicking')) === 'true';
            const power = game ? game.get_computational_power() : 0;
            const stats = cachedRustStats;
            const isActive = stats && (stats.is_day || (stats.coal_enabled && stats.coal_inventory > 0));

            const cfg = window.gameConfig?.auto_click_config;
            const minCost = cfg?.power_per_auto_click ?? 3;

            const canResume = savedAutoClick && game && power >= minCost && isActive;

            if (canResume) {
                game.start_auto_clicking();
                isAutoClicking = true;
                document.getElementById('floatingMineBtn')?.classList.add('auto-clicking');
                const status = document.getElementById('autoClickStatus');
                if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
                addToLog(`🤖 Автокликер восстановлен (мощность: ${power})`);
            } else {
                isAutoClicking = false;
                localStorage.setItem(USER_STORAGE_KEY('corebox_autoclicking'), 'false');
                document.getElementById('floatingMineBtn')?.classList.remove('auto-clicking');
                const status = document.getElementById('autoClickStatus');
                if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }

                if (savedAutoClick && power < minCost) {
                    addToLog(`⚠️ Автокликер не включён: недостаточно мощности (нужно минимум ${minCost})`, 'warning');
                } else if (savedAutoClick && !isActive) {
                    addToLog('⚠️ Автокликер не включён: система неактивна (ночь без угля)');
                }
            }
        }, 800);

        if (!gameStats.startTime) gameStats.startTime = Date.now();
        craftModule.init(game);
        designModule.init(game, currentUser?.id);
        fleetModule.init(game, currentUser?.id);
        tradeModule.init(game, currentUser?.id);

        attachTradeListener();

        if (currentUser) {
            console.log('ℹ️ Мультиплеер инициализирован');
        }

        designModule.updateComputationalPower(game.get_computational_power());

        spaceModule.init(game, currentUser);

        if (_fleetUITimer) clearInterval(_fleetUITimer);
        _fleetUITimer = setInterval(() => {
            if (window.fleetModule && _currentTab === 'fleet') {
                window.fleetModule._renderFleetTab?.();
            }
        }, 5000);

        setTimeout(() => {
            if (window._restorePlanetMissions) {
                window._restorePlanetMissions();
            }
        }, 2000);

        initStatistics();
        setupEventListeners();
        initializeCollapsiblePanels();
        updatePowerGlow();
        updatePowerTierLabel();
        isGameInitialized = true;

        // Восстановить последнюю открытую вкладку
        try {
            const savedTab = localStorage.getItem('corebox_active_tab');
            const validTabs = ['inventory', 'upgrades', 'trade', 'quests', 'command', 'craft', 'design', 'fleet', 'space'];
            if (savedTab && validTabs.includes(savedTab) && savedTab !== 'inventory') {
                switchMainTab(savedTab);
            }
        } catch(e) {}

        if (existingSave?.blueprints && currentUser?.id) {
            designModule.loadBlueprintsFromCloud(existingSave.blueprints);
        }

        if (existingSave?.defense_ship_id && window.fleetModule) {
            setTimeout(() => {
                const ship = window.fleetModule.ships.find(s => s.id === existingSave.defense_ship_id);
                if (ship && !ship.onMission && ship.type === 'combat') {
                    window.fleetModule.defenseShipId = existingSave.defense_ship_id;
                    ship.onDefense = true;
                    window.fleetModule.saveFleet();
                    window.fleetModule._renderFleetTab?.();
                }
            }, 2000);
        }
        if (existingSave?.fleet_log && existingSave.fleet_log.length > 0 && window.fleetModule) {
            const userId = window.currentUser?.id;
            const key = `corebox_fleet_log_${userId || 'anon'}`;
            const localSaved = localStorage.getItem(key);
            if (localSaved === null) {
                window.fleetModule.fleetLog = existingSave.fleet_log;
                window.fleetModule._renderFleetLog?.();
            }
        }

        setTimeout(() => {
            validateAndFixNeuroConsciousness();
        }, 1500);

        _lastFrameTime = 0;
        _accumulatedDelta = 0;
        _gameLoopRAF = requestAnimationFrame(gameLoopFrame);

        let slowInterval = setInterval(() => {
            if (!cachedRustStats) return;

            const designContainer = document.getElementById('designContainer');
            if (designContainer && designContainer.style.display !== 'none') {
                window.updateDesignTab();
            }

            const craftContainer = document.getElementById('craftContainer');
            if (craftContainer && craftContainer.style.display !== 'none') {
                window.updateCraftTab();
            }

            const fleetCombat = fleetModule.getFleetDefenseContribution(cachedRustStats.defense_debuff_remaining || 0);
            const fleetCargo = fleetModule.getCargoMiningBonus();
            const fleetRecon = fleetModule.getScoutReconBonus();
            try {
                if (typeof game.set_fleet_defense_bonus === 'function' && fleetCombat > 0) {
                    game.set_fleet_defense_bonus(fleetCombat);
                }
                if (typeof game.set_fleet_cargo_bonus === 'function' && fleetCargo > 0) {
                    game.set_fleet_cargo_bonus(fleetCargo);
                }
                if (typeof game.set_fleet_power_bonus === 'function') {
                    game.set_fleet_power_bonus(Math.floor(fleetCargo / 10));
                }
            } catch(e) {}

            craftModule.syncFromStats(cachedRustStats);
            craftModule.aiProductionBonus = Math.min(30, (cachedRustStats.neuro_evolution || 0) * 1.5);

            const neuroConsc = cachedRustStats.neuro_consciousness || 0;
            const normalized = normalizeNeuroConsciousness(neuroConsc);
            designModule.aiResearchBonus = Math.floor(normalized * 100 / 20);

        }, 4000);

        setInterval(loadConfig, 5 * 60 * 1000);

        if (currentUser) {
            _initMultiplayer(currentUser);
        }

        if (_saveInterval) clearInterval(_saveInterval);
        _saveInterval = setInterval(() => {
            if (game && typeof game.save_current_state === 'function') {
                game.save_current_state();
            }
        }, 30000);

        if (navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2) {
            document.body.classList.add('low-perf');
        }

        setTimeout(() => {
            if (cachedRustStats) {
                updateTecUI();
            }
        }, 500);

    } catch(e) {
        addToLog(`❌ Ошибка инициализации: ${e.message}`, "error");
        const errorContainer = document.createElement('div');
        errorContainer.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a1a;border:2px solid #f44;border-radius:16px;padding:20px;z-index:10001;text-align:center;';
        errorContainer.innerHTML = `
            <h3 style="color:#f44">⚠️ Ошибка инициализации</h3>
            <p>Не удалось запустить игру. Попробуйте:</p>
            <ul style="text-align:left">
                <li>Очистить кэш браузера</li>
                <li>Обновить страницу (F5)</li>
                <li>Проверить соединение с интернетом</li>
            </ul>
            <button id="wasmErrorReload" style="padding:8px 16px;background:#4aff9d;border:none;border-radius:8px;cursor:pointer">⟳ ОБНОВИТЬ СТРАНИЦУ</button>
        `;
        document.body.appendChild(errorContainer);
        document.getElementById('wasmErrorReload').onclick = () => location.reload();
    }
}

function switchMainTab(tabName) {

    if (_currentTab === 'space' && tabName !== 'space' && spaceModule.initialized) {
        spaceModule.onTabDeactivated();
    }

    _accumulatedDelta = 0;
    _lastFrameTime = 0;

    _currentTab = tabName;
    try { localStorage.setItem('corebox_active_tab', tabName); } catch(e) {}
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

    if (tabName === 'command') {
        const badge = document.getElementById('command-tab-btn');
        if (badge) { delete badge.dataset.interceptBadge; document.getElementById('intercept-badge')?.remove(); }

        if (!window.fleetModule?.isInitializing && typeof window.fleetModule._renderCommandCenter === 'function') {
            window.fleetModule._renderCommandCenter();
        }
        _setupCcPanels();
        if (cachedRustStats) {

            requestAnimationFrame(() => updateCommandCenter(cachedRustStats));
        }
    } else if (tabName === 'upgrades') {
        renderUpgradesTab();
    } else if (tabName === 'craft') {
        window.updateCraftTab();
    } else if (tabName === 'design') {
        window.updateDesignTab();
    } else if (tabName === 'fleet') {
        _refreshFleetWithMissions();
    } else if (tabName === 'trade') {
        tradeModule.loadOffers();
    } else if (tabName === 'quests') {
        renderQuestsTab();
    } else if (tabName === 'space') {
        if (spaceModule.initialized) {
            spaceModule.onTabActivated();
        }
        if (spaceModule) {
            spaceModule.isTabActive = (tabName === 'space');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    cleanupPrestigeData();
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

window.handleClick = handleClick;
window.toggleAutoClicking = toggleAutoClicking;
window.updateCraftTab = function() {
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
};

window.updateDesignTab = function() {
    if (!game) return;
    const container = document.getElementById('designContainer');
    if (!container) return;
    try {
        if (designModule && typeof designModule.syncBlueprintsFromRust === 'function') {
            designModule.syncBlueprintsFromRust();
        }
        designModule.updateComputationalPower(game.get_computational_power());
        container.innerHTML = designModule.renderDesignUI();
        designModule.setupEventListeners(container);
    } catch(e) {}
};

function syncUIAfterCloudLoad(cloudSave) {
    if (!cloudSave) return;

    if (cloudSave.computational_power !== undefined) {
        updatePowerGlow();
        updatePowerTierLabel();
        const powerText = document.getElementById('powerText');
        if (powerText) {
            powerText.textContent = `${cloudSave.computational_power}/${cloudSave.max_computational_power || 1000}`;
        }
        const powerFill = document.getElementById('powerFill');
        if (powerFill) {
            const percent = ((cloudSave.computational_power || 0) / (cloudSave.max_computational_power || 1000)) * 100;
            powerFill.style.width = `${percent}%`;
        }
        addToLog(`⚡ Мощность восстановлена: ${cloudSave.computational_power}/${cloudSave.max_computational_power || 1000}`);
    }

    if (cloudSave.neuro) {
        const neuroEl = document.getElementById('neuroStatusShort');
        if (neuroEl) {
            let consc = cloudSave.neuro.consciousness || 0;
            consc = normalizeNeuroConsciousness(consc);
            neuroEl.textContent = `${(consc * 100).toFixed(1)}% (Ур. ${cloudSave.neuro.evolution || 0})`;
        }
        const neuroProgress = document.getElementById('neuroProgress');
        if (neuroProgress) {
            let consc = cloudSave.neuro.consciousness || 0;
            consc = normalizeNeuroConsciousness(consc);
            neuroProgress.style.width = `${Math.min(consc * 100, 100)}%`;
        }
    }

    if (cloudSave.is_day !== undefined) {
        updateDayNightVisuals(cloudSave);
    }

    if (cloudSave.coal_enabled !== undefined) {
        const coalStatus = document.getElementById('coalStatus');
        if (coalStatus) {
            coalStatus.textContent = cloudSave.coal_enabled ? "АКТИВНА" : "ОФФЛАЙН";
        }
        const coalStatusDisplay = document.getElementById('coalStatusDisplay');
        if (coalStatusDisplay) {
            coalStatusDisplay.textContent = cloudSave.coal_enabled ? "АКТИВНА" : "ОФФЛАЙН";
        }
    }

    if (designModule) {
        // ✅ Используем ТОЛЬКО актуальное значение из Rust — оно источник истины
        const rustPow = (game && typeof game.get_computational_power === 'function')
            ? game.get_computational_power() : 0;
        designModule.updateComputationalPower(rustPow);
    }

    if (cloudSave.attack_history && Array.isArray(cloudSave.attack_history)) {
        updateAttackHistory(cloudSave.attack_history);
    }

    if (cloudSave.auto_clicking !== undefined) {
        localStorage.setItem('corebox_autoclicking', cloudSave.auto_clicking ? 'true' : 'false');
    }

    const unifiedKey = SAVE_KEY(currentUser?.id);
    localStorage.setItem(unifiedKey, JSON.stringify(cloudSave));
    localStorage.setItem(USER_STORAGE_KEY('corebox_save_backup', currentUser?.id), JSON.stringify(cloudSave));
    localStorage.setItem(USER_STORAGE_KEY('corebox_save_universal'), JSON.stringify({
        inventory: cloudSave.inventory,
        computational_power: cloudSave.computational_power,
        max_computational_power: cloudSave.max_computational_power,
        neuro_evolution: cloudSave.neuro?.evolution,
        chips_unlocked: cloudSave.chips_unlocked,
        plasma_unlocked: cloudSave.plasma_unlocked,
        timestamp: Date.now(),
        _savedAt: Date.now()
    }));

    updateTecUI();
}

async function loadFromCloudAndMerge() {
    if (!currentUser || !game) return null;

    const CLOCK_TOLERANCE_MS = 60000;
    const unifiedKey = SAVE_KEY(currentUser.id);
    const localBackup = localStorage.getItem(USER_STORAGE_KEY('corebox_save_backup', currentUser.id));
    const localUniversal = localStorage.getItem(USER_STORAGE_KEY('corebox_save_universal'));

    try {
        const cloudSave = await loadGameFromCloud(true);

        if (cloudSave) {
            let localTimestamp = 0;

            const unifiedRaw = localStorage.getItem(unifiedKey);
            if (unifiedRaw) {
                try {
                    const unified = JSON.parse(unifiedRaw);
                    localTimestamp = Math.max(localTimestamp, unified.timestamp || 0, unified._savedAt || 0);
                } catch(e) {}
            }

            if (localBackup) {
                try { localTimestamp = Math.max(localTimestamp, JSON.parse(localBackup).timestamp || 0, JSON.parse(localBackup)._savedAt || 0); } catch(e) {}
            }
            if (localUniversal) {
                try {
                    const u = JSON.parse(localUniversal);
                    const uTs = u.timestamp || u._savedAt || 0;
                    if (uTs > localTimestamp) localTimestamp = uTs;
                } catch(e) {}
            }

            let shouldLoad = true;
            const cloudTs = cloudSave.timestamp || cloudSave._savedAt || 0;

            if (localTimestamp > cloudTs + CLOCK_TOLERANCE_MS) {
                shouldLoad = false;
                addToLog("💾 Локальное сохранение новее облачного, используем его");
            }

            if (shouldLoad) {
                try {
                    let rustFormatSave = cloudSave;
                    if (cloudSave.inventory && cloudSave.inventory.coal !== undefined && !cloudSave.ore_inventory) {
                        const cargoUnlocked = cloudSave.blueprints?.cargo === true
                            || (Array.isArray(cloudSave.blueprints) && cloudSave.blueprints.find(b=>b.id==='cargo')?.unlocked === true);
                        const scoutUnlocked = cloudSave.blueprints?.scout === true
                            || (Array.isArray(cloudSave.blueprints) && cloudSave.blueprints.find(b=>b.id==='scout')?.unlocked === true);
                        const combatUnlocked = cloudSave.blueprints?.combat === true
                            || (Array.isArray(cloudSave.blueprints) && cloudSave.blueprints.find(b=>b.id==='combat')?.unlocked === true);

                        rustFormatSave = {
                            inventory: {
                                coal: cloudSave.inventory.coal,
                                ore: cloudSave.inventory.ore,
                                chips: cloudSave.inventory.chips,
                                plasma: cloudSave.inventory.plasma,
                                trash: cloudSave.inventory.trash
                            },
                            upgrades: cloudSave.upgrades || { mining: 0, defense: false, defense_level: 0, crit_level: 0, cooling_level: 0 },
                            computational_power: cloudSave.computational_power || 0,
                            max_computational_power: cloudSave.max_computational_power || 1000,
                            nights_survived: cloudSave.nights_survived || 0,
                            total_mined: cloudSave.total_mined || 0,
                            neuro_evolution: cloudSave.neuro?.evolution || 0,
                            neuro_consciousness: (() => {
                                let c = cloudSave.neuro?.consciousness || 0;
                                c = normalizeNeuroConsciousness(c);
                                return c;
                            })(),
                            neuro_score: cloudSave.neuro?.score || 0,
                            current_ai_mode: cloudSave.neuro?.ai_mode || "Обычный",
                            is_day: cloudSave.is_day !== undefined ? cloudSave.is_day : true,
                            coal_enabled: cloudSave.coal_enabled || false,
                            game_time: cloudSave.game_time ?? 24,
                            rebel_activity: cloudSave.rebel_activity || 0,
                            rebel_protection_nights: cloudSave.rebel_protection_nights || 0,
                            rebel_protection_active: cloudSave.rebel_protection_active || false,
                            turbine_heat: cloudSave.turbine_heat || 0,
                            turbine_upgrade_level: cloudSave.turbine_upgrade_level || 0,
                            total_coal_mined: cloudSave.statistics?.total_coal_mined || 0,
                            total_trash_mined: cloudSave.statistics?.total_trash_mined || 0,
                            total_plasma_mined: cloudSave.statistics?.total_plasma_mined || 0,
                            total_ore_mined: cloudSave.statistics?.total_ore_mined || 0,
                            total_coal_burned: cloudSave.statistics?.total_coal_burned || 0,
                            total_coal_stolen: cloudSave.statistics?.total_coal_stolen || 0,
                            rebel_attacks_count: cloudSave.statistics?.rebel_attacks || 0,
                            attacks_defended: cloudSave.statistics?.attacks_defended || 0,

                            last_ai_coal_threshold: cloudSave.last_ai_coal_threshold || 0,
                            current_night_type: cloudSave.current_night_type || "",
                            blueprint_cargo_unlocked: cargoUnlocked,
                            blueprint_scout_unlocked: scoutUnlocked,
                            blueprint_combat_unlocked: combatUnlocked,
                            quests_progress: cloudSave.quests_progress || [],
                            planets: cloudSave.planets || [],
                            active_planet_missions: cloudSave.active_planet_missions || [],
                            chips_unlocked: cloudSave.chips_unlocked ?? (cloudSave.inventory?.chips > 0),
                            plasma_unlocked: cloudSave.plasma_unlocked ?? (cloudSave.inventory?.plasma > 0),
                            ore_unlocked: cloudSave.ore_unlocked ?? (cloudSave.neuro?.evolution >= 3),
                            map_x: cloudSave.map_x ?? null,
                            map_y: cloudSave.map_y ?? null,

                            blueprint_locked_until: cloudSave.blueprint_locked_until || 0,
                            locked_blueprint_id: cloudSave.locked_blueprint_id || "",
                            tec_sabotaged: cloudSave.tec_sabotaged || false,
                            tec_sabotage_remaining: cloudSave.tec_sabotage_remaining || 0,
                            total_breaches: cloudSave.total_breaches || 0,
                            fleet_under_attack: cloudSave.fleet_under_attack || false,
                            fleet_attack_damage: cloudSave.fleet_attack_damage || 0,
                            fleet_shield_active: cloudSave.fleet_shield_active || false,
                            fleet_shield_remaining: cloudSave.fleet_shield_remaining || 0,
                            blueprints_encrypted: cloudSave.blueprints_encrypted || false,
                            blueprint_encryption_remaining: cloudSave.blueprint_encryption_remaining || 0,
                            planets_fortified: cloudSave.planets_fortified || false,
                            planet_fortification_remaining: cloudSave.planet_fortification_remaining || 0,
                        };
                    }
                    game.load_game_state(JSON.stringify(rustFormatSave));
                    addToLog(`💾 Загружено облачное сохранение (${new Date(cloudSave.timestamp).toLocaleString()})`);

                    if (cloudSave.fleet && Array.isArray(cloudSave.fleet) && window.fleetModule) {
                        const validFleet = cloudSave.fleet.filter(s =>
                            s && typeof s.id === 'string' && typeof s.type === 'string'
                        );
                        const storageKey = window.fleetModule._getStorageKey();
                        localStorage.setItem(storageKey, JSON.stringify(validFleet));
                        window.fleetModule.ships = validFleet;

                        // ✅ Восстанавливаем защитника
                        window.fleetModule._loadDefenseShip();

                        // ✅ Синхронизируем статус
                        if (window.fleetModule._syncFleetStatus) {
                            window.fleetModule._syncFleetStatus();
                        }

                        if (window.fleetModule._renderFleetTab) {
                            window.fleetModule._renderFleetTab();
                        }
                        console.log(`✅ Флот восстановлен из облака: ${validFleet.length} кораблей`);
                    }

                    if (window._restorePlanetMissions) {
                        setTimeout(() => window._restorePlanetMissions(), 500);
                    }
                } catch(e) {
                    addToLog("❌ Ошибка загрузки облачного сохранения", "error");
                    return null;
                }

                setTimeout(() => {
                    syncUIAfterCloudLoad(cloudSave);
                    updatePowerGlow();
                    updatePowerTierLabel();
                    updateTecUI();

                    if (craftModule) {
                        const stats = JSON.parse(game.get_statistics());
                        craftModule.syncFromStats(stats);
                    }
                    if (designModule) {
                        designModule.updateComputationalPower(cloudSave.computational_power);
                    }
                    renderTradeTab();
                    window.updateCraftTab();
                    window.updateDesignTab();
                    _refreshFleetWithMissions();

                    if (window.spaceModule) {
                        setTimeout(() => {
                            window.spaceModule.loadPlanetsFromRust();
                            window.spaceModule.renderPlanets();
                        }, 500);
                    }

                    GameBus.emit(EVENTS.CLOUD_LOAD_DONE, { save: cloudSave });
                }, 100);

                if (cloudSave.blueprints) {
                    window.dispatchEvent(new CustomEvent('blueprintsLoaded', {
                        detail: { blueprints: cloudSave.blueprints }
                    }));

                    if (designModule) {
                        designModule.loadBlueprintsFromCloud(cloudSave.blueprints);
                        designModule.syncBlueprintsToRust();
                        const designContainer = document.getElementById('designContainer');
                        if (designContainer && designContainer.style.display !== 'none') {
                            window.updateDesignTab();
                        }
                    }
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
        return null;
    }
}

function readPendingOfflineEffects() {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY('corebox_pending_offline_effects'));
        const effects = raw ? JSON.parse(raw) : [];
        return Array.isArray(effects) ? effects.filter(Boolean) : [];
    } catch (error) {
        return [];
    }
}

function queueOfflineEffect(effect) {
    const effects = readPendingOfflineEffects();
    effects.push({ ...effect, queuedAt: Date.now() });
    localStorage.setItem(USER_STORAGE_KEY('corebox_pending_offline_effects'), JSON.stringify(effects));
}

function consumePendingOfflineEffects() {
    const effects = readPendingOfflineEffects();
    localStorage.removeItem(USER_STORAGE_KEY('corebox_pending_offline_effects'));
    return effects;
}

function calculateOfflineProgress(saved) {
    const lastShown = parseInt(localStorage.getItem(USER_STORAGE_KEY('corebox_offline_shown')) || '0');
    const savedTimestamp = saved?.timestamp || saved?._savedAt || Date.now();
    const elapsed = Math.min(Math.floor((Date.now() - savedTimestamp) / 1000), 8 * 3600);

    if (elapsed < 10 || Date.now() - lastShown < 60000) return null;

    const ticks = elapsed;
    const posture = window.fleetModule?.getOfflineDefenseModifiers?.() || { attackMultiplier: 1, successMultiplier: 1, fleetSaveActive: false, stance: 'guard' };
    const offlineEffects = consumePendingOfflineEffects();
    const effectValue = (key, fallback = 1) => offlineEffects.reduce((value, effect) => {
        return effect[key] === undefined ? value : value * Number(effect[key]);
    }, fallback);
    const effectBonus = (key, fallback = 0) => offlineEffects.reduce((value, effect) => value + Number(effect[key] || 0), fallback);
    const miningLevel = saved?.mining_level || 0;
    const passive = saved?._passive_rates || {
        coal: (0.010 + miningLevel * 0.0006),
        trash: (0.008 + miningLevel * 0.0012),
        ore: (0.006 + miningLevel * 0.0004)
    };
    passive.power = passive.power || (0.05 + miningLevel * 0.002);

    const cycleDuration = 480;
    const cyclesElapsed = Math.floor(elapsed / cycleDuration);
    const nightsElapsed = cyclesElapsed;

    const avgNightCost = 2;
    const avgDayCost = 1;
    const coalBurned = Math.floor((nightsElapsed * avgNightCost + cyclesElapsed * avgDayCost) * effectValue('coalCostMultiplier'));

    const nightsRemaining = saved?.rebel_protection_nights || 0;
    const protectionActive = saved?.rebel_protection_active || false;
    let newNights = nightsRemaining;
    let breachesCount = 0;

    if (protectionActive && nightsRemaining > 0) {
        const used = Math.min(nightsRemaining, nightsElapsed);
        newNights = nightsRemaining - used;

        const avgActivity = 7;
        const breachChancePerNight = 0.08 + (avgActivity * 0.02);

        for (let i = 0; i < used; i++) {
            if (Math.random() < breachChancePerNight) {
                breachesCount++;
            }
        }
    }

    const baseAttackChance = 0.03;
    const attacksDuringOffline = Math.floor(nightsElapsed * baseAttackChance * 10 * posture.attackMultiplier * effectValue('attackMultiplier'));

    let coalStolen = 0;
    let oreStolen = 0;
    let chipsStolen = 0;
    let plasmaStolen = 0;

    const successfulAttacks = Math.floor(attacksDuringOffline * 0.5 * posture.successMultiplier * effectValue('successMultiplier'));

    for (let i = 0; i < successfulAttacks; i++) {
        const coalInventory = saved?.inventory?.coal || 0;
        const oreInventory = saved?.inventory?.ore || 0;
        const chipsInventory = saved?.inventory?.chips || 0;
        const plasmaInventory = saved?.inventory?.plasma || 0;

        coalStolen += Math.floor(coalInventory * 0.25 * Math.random());
        oreStolen += Math.floor(oreInventory * 0.20 * Math.random());
        chipsStolen += Math.floor(chipsInventory * 0.22 * Math.random());
        plasmaStolen += Math.floor(plasmaInventory * 0.18 * Math.random());
    }

    const fleetDamage = Math.floor(successfulAttacks * 0.3 * 20);
    const tecSabotageCount = Math.floor(successfulAttacks * 0.15);
    const blueprintTheftCount = Math.floor(successfulAttacks * 0.08);

    const coalGained = Math.floor(ticks * passive.coal) - coalBurned - coalStolen;
    const trashGained = Math.floor(ticks * passive.trash);
    const oreGained = Math.floor(ticks * passive.ore) - oreStolen;
    const chipsGained = -chipsStolen;
    const plasmaGained = -plasmaStolen;
    const powerGained = Math.floor(ticks * passive.power * effectValue('powerMultiplier') + effectBonus('powerFlat'));
    const chipsBonus = effectBonus('chipsFlat');
    const hasBlueprint = Array.isArray(saved?.blueprints)
        ? saved.blueprints.some(bp => bp?.unlocked === true)
        : Object.values(saved?.blueprints || {}).some(value => value === true || value?.unlocked === true);
    const recommendation = successfulAttacks > 0
        ? { text: 'Проверь ФЛОТ и восстанови защиту после атаки.', tab: 'fleet', label: 'ОТКРЫТЬ ФЛОТ' }
        : !hasBlueprint && powerGained >= 200
            ? { text: 'Открой РАЗРАБОТКУ: мощности достаточно для первого чертежа.', tab: 'design', label: 'ОТКРЫТЬ РАЗРАБОТКУ' }
            : powerGained > 0
                ? { text: 'Проверь МОДУЛИ и вложи вычислительную мощность в следующий upgrade.', tab: 'upgrades', label: 'ОТКРЫТЬ МОДУЛИ' }
                : { text: 'Собери ресурсы и выбери ближайшее задание.', tab: 'quests', label: 'ОТКРЫТЬ ЗАДАНИЯ' };

    return {
        elapsedSeconds: elapsed,
        cyclesPassed: cyclesElapsed,
        nightsPassed: nightsElapsed,

        coalGained: Math.max(0, coalGained),
        trashGained: Math.max(0, trashGained),
        oreGained: Math.max(0, oreGained),
        chipsGained: Math.max(0, chipsGained + chipsBonus),
        plasmaGained: Math.max(0, plasmaGained),
        powerGained: Math.max(0, powerGained),
        chipsBonus,
        offlineEffectsApplied: offlineEffects.map(effect => effect.label || effect.id || 'операционный эффект'),
        defenseStance: posture.stance,
        fleetsaveActive: posture.fleetSaveActive,

        coalBurned: coalBurned,

        rebelProtectionNights: newNights,
        rebelProtectionActive: newNights > 0,
        protectionBreaches: breachesCount,

        attacksDuringOffline: attacksDuringOffline,
        successfulAttacks: successfulAttacks,

        coalStolen: coalStolen,
        oreStolen: oreStolen,
        chipsStolen: chipsStolen,
        plasmaStolen: plasmaStolen,

        fleetDamage: fleetDamage,
        tecSabotageCount: tecSabotageCount,
        blueprintTheftCount: blueprintTheftCount,
        recommendedAction: recommendation.text,
        recommendedTab: recommendation.tab,
        recommendedLabel: recommendation.label,
    };
}

const AUTHORED_OFFLINE_INCIDENTS = [
    {
        id: 'ghost-packet', title: 'ПРИЗРАЧНЫЙ ПАКЕТ',
        body: 'В ночном трафике найден зашифрованный пакет. Он может ускорить ядро или раскрыть резерв чипов.',
        choices: [
            { id: 'quarantine', label: 'Карантин', costText: '−8 чипов', effect: '＋25 мощности · +25% мощности офлайн', can: s => (s.chips_inventory || 0) >= 8, apply: () => { game.subtract_resource('chips', 8); game.add_power(25); queueOfflineEffect({ id: 'kernel-buffer', label: 'KERNEL BUFFER', powerMultiplier: 1.25 }); } },
            { id: 'trace', label: 'Отследить источник', costText: '−10 мощности', effect: '＋10 чипов · +6 чипов офлайн', can: s => (s.computational_power || 0) >= 10, apply: () => { game.add_power(-10); game.add_resource('chips', 10); queueOfflineEffect({ id: 'signal-cache', label: 'SIGNAL CACHE', chipsFlat: 6 }); } }
        ]
    },
    {
        id: 'thermal-whisper', title: 'ТЕПЛОВОЙ ШЁПОТ',
        body: 'Сенсоры видят перегретый промышленный контур. Можно снять нагрузку или рискнуть ради дополнительной мощности.',
        choices: [
            { id: 'vent', label: 'Сбросить тепло', costText: '−6 угля', effect: '＋12 мощности · −50% расхода угля офлайн', can: s => (s.coal_inventory || 0) >= 6, apply: () => { game.subtract_resource('coal', 6); game.add_power(12); queueOfflineEffect({ id: 'thermal-vent', label: 'THERMAL VENT', coalCostMultiplier: 0.5 }); } },
            { id: 'overclock', label: 'Форсировать контур', costText: '−4 мусора', effect: '＋30 мощности · +35% мощности, +50% расхода угля', can: s => (s.trash_inventory || 0) >= 4, apply: () => { game.subtract_resource('trash', 4); game.add_power(30); queueOfflineEffect({ id: 'overclock', label: 'OVERCLOCK', powerMultiplier: 1.35, coalCostMultiplier: 1.5 }); } }
        ]
    },
    {
        id: 'rebel-decoy', title: 'ЛОЖНЫЙ СЛЕД',
        body: 'Повстанцы ищут ваш грузовой маршрут. Можно купить тишину ресурсами или превратить погоню в вычислительный импульс.',
        choices: [
            { id: 'decoy', label: 'Сбросить приманку', costText: '−12 руды', effect: '＋18 мощности · −50% атак офлайн', can: s => (s.ore_inventory || 0) >= 12, apply: () => { game.subtract_resource('ore', 12); game.add_power(18); queueOfflineEffect({ id: 'rebel-decoy', label: 'REBEL DECOY', attackMultiplier: 0.5 }); } },
            { id: 'counterintel', label: 'Контрразведка', costText: '−15 мощности', effect: '＋8 чипов · −65% успешных атак офлайн', can: s => (s.computational_power || 0) >= 15, apply: () => { game.add_power(-15); game.add_resource('chips', 8); queueOfflineEffect({ id: 'counterintel', label: 'COUNTERINTEL', successMultiplier: 0.35 }); } }
        ]
    }
];

function getOfflineIncident(p) {
    if (!p || (p.cyclesPassed || 0) < 1 || !game) return null;
    const stats = getCurrentRustStats() || {};
    const seed = Math.max(0, Math.floor((stats.nights_survived || 0) + (p.cyclesPassed || 0)));
    const incident = AUTHORED_OFFLINE_INCIDENTS[seed % AUTHORED_OFFLINE_INCIDENTS.length];
    const key = USER_STORAGE_KEY(`corebox_incident_${incident.id}_${seed}`);
    if (localStorage.getItem(key)) return null;
    return { ...incident, key, stats };
}

function resolveOfflineIncident(incident, choiceId) {
    const choice = incident?.choices?.find(item => item.id === choiceId);
    if (!choice || !game) return false;
    const stats = getCurrentRustStats() || {};
    if (!choice.can(stats)) { showNotif?.('НЕДОСТАТОЧНО РЕСУРСОВ ДЛЯ ЭТОГО РЕШЕНИЯ', true); return false; }
    choice.apply();
    localStorage.setItem(incident.key, Date.now().toString());
    addToLog(`🧩 ${incident.title}: ${choice.label} (${choice.effect})`, 'success');
    showNotif?.(`${choice.label}: ${choice.effect}`, false);
    const freshStats = getCurrentRustStats();
    if (freshStats) { cachedRustStats = freshStats; updateInventoryDisplay(freshStats); updateStatsFromGame(freshStats); if (typeof updateCommandCenter === 'function') updateCommandCenter(freshStats); }
    if (typeof scheduleCloudSave === 'function') scheduleCloudSave();
    return true;
}

function showOfflineRewardPopup(p) {
    const mins = Math.floor(p.elapsedSeconds / 60);
    const timeStr = mins > 60 ? `${Math.floor(mins / 60)}ч ${mins % 60}м` : `${mins}м`;

    addToLog(`⏰ Офлайн ${timeStr}: ${p.cyclesPassed} циклов`);

    if (p.coalGained > 0) {
        addToLog(`🪨 +${p.coalGained} угля (пассивная добыча)`);
        game.add_resource('coal', p.coalGained);
    }
    if (p.trashGained > 0) {
        addToLog(`♻️ +${p.trashGained} мусора`);
        game.add_resource('trash', p.trashGained);
    }
    if (p.oreGained > 0) {
        addToLog(`⛏️ +${p.oreGained} руды`);
        game.add_resource('ore', p.oreGained);
    }

    if (p.coalBurned > 0) {
        addToLog(`🔥 -${p.coalBurned} угля (ТЭЦ)`);
    }

    if (p.attacksDuringOffline > 0) {
        addToLog(`⚔️ Повстанцы атаковали ${p.attacksDuringOffline} раз (${p.successfulAttacks} успешно)`);
    }

    if (p.coalStolen > 0 || p.oreStolen > 0 || p.chipsStolen > 0 || p.plasmaStolen > 0) {
        const stolenText = [
            p.coalStolen > 0 ? `-${p.coalStolen}🪨` : '',
            p.oreStolen > 0 ? `-${p.oreStolen}⛏️` : '',
            p.chipsStolen > 0 ? `-${p.chipsStolen}🎛️` : '',
            p.plasmaStolen > 0 ? `-${p.plasmaStolen}⚡` : '',
        ].filter(Boolean).join(' ');
        addToLog(`💸 Украдено: ${stolenText}`);

        if (p.coalStolen > 0) game.subtract_resource('coal', p.coalStolen);
        if (p.oreStolen > 0) game.subtract_resource('ore', p.oreStolen);
        if (p.chipsStolen > 0) game.subtract_resource('chips', p.chipsStolen);
        if (p.plasmaStolen > 0) game.subtract_resource('plasma', p.plasmaStolen);
    }

    if (p.powerGained > 0) {
        addToLog(`⚡ +${p.powerGained} вычислительной мощности (пассивная добыча)`);
        game.add_power(p.powerGained);
    }
    if (p.chipsBonus > 0) {
        addToLog(`🎛️ +${p.chipsBonus} чипов (операционный эффект)`);
        game.add_resource('chips', p.chipsBonus);
    }
    if (p.offlineEffectsApplied?.length) {
        addToLog(`🧩 Эффекты окна: ${p.offlineEffectsApplied.join(', ')}`, 'success');
    }
    if (p.defenseStance || p.fleetsaveActive) {
        addToLog(`🛡️ Позиция офлайн: ${String(p.defenseStance || 'GUARD').toUpperCase()}${p.fleetsaveActive ? ' + FLEETSAVE' : ''}`);
    }

    handleRebelAttackStolen({
        stolen: {
            coal: p.coalStolen || 0,
            ore: p.oreStolen || 0,
            chips: p.chipsStolen || 0,
            plasma: p.plasmaStolen || 0,
        }
    });

    if (p.protectionBreaches > 0) {
        addToLog(`💀 Защита пробита ${p.protectionBreaches} раз!`);
    }

    if (p.fleetDamage > 0) {
        addToLog(`🚀 Флот получил ${p.fleetDamage} урона`);
    }

    if (p.tecSabotageCount > 0) {
        addToLog(`🔥 ТЭЦ саботирована ${p.tecSabotageCount} раз`);
    }

    if (p.blueprintTheftCount > 0) {
        addToLog(`📐 Чертежи крадены ${p.blueprintTheftCount} раз`);
    }

    showFloatingText(`⏰ Офлайн ${timeStr}`, window.innerWidth/2, 200);

    const popup = document.createElement('div');
    popup.className = 'offline-popup';

    let gainsHtml = '';
    if (p.coalGained > 0) gainsHtml += `<div>🪨 +${p.coalGained}</div>`;
    if (p.trashGained > 0) gainsHtml += `<div>♻️ +${p.trashGained}</div>`;
    if (p.oreGained > 0) gainsHtml += `<div>⛏️ +${p.oreGained}</div>`;

    let lossesHtml = '';
    if (p.coalBurned > 0) lossesHtml += `<div>🔥 -${p.coalBurned} (ТЭЦ)</div>`;
    if (p.coalStolen > 0) lossesHtml += `<div>💸 -${p.coalStolen}🪨</div>`;
    if (p.oreStolen > 0) lossesHtml += `<div>💸 -${p.oreStolen}⛏️</div>`;
    if (p.chipsStolen > 0) lossesHtml += `<div>💸 -${p.chipsStolen}🎛️</div>`;
    if (p.plasmaStolen > 0) lossesHtml += `<div>💸 -${p.plasmaStolen}⚡</div>`;

    const incident = getOfflineIncident(p);
    let eventsHtml = `<div class="offline-next-action">➡️ Следующий шаг: ${p.recommendedAction}</div>`;
    if (incident) {
        const choicesHtml = incident.choices.map(choice => {
            const available = choice.can(incident.stats);
            return `<button class="offline-incident-choice" data-incident-choice="${choice.id}" ${available ? '' : 'disabled'}><span>${choice.label}</span><small>${choice.costText} → ${choice.effect}</small></button>`;
        }).join('');
        eventsHtml += `<section class="offline-incident" aria-label="Инцидент возвращения"><div class="offline-incident__eyebrow">🧩 АВТОРСКИЙ ИНЦИДЕНТ</div><strong>${incident.title}</strong><p>${incident.body}</p><div class="offline-incident__choices">${choicesHtml}</div></section>`;
    }
    if (p.attacksDuringOffline > 0) {
        eventsHtml += `<div>⚔️ Атак: ${p.attacksDuringOffline} (${p.successfulAttacks} успешно)</div>`;
    }
    if (p.protectionBreaches > 0) {
        eventsHtml += `<div style="color:#ff6644">💀 Прорывов защиты: ${p.protectionBreaches}</div>`;
    }
    if (p.fleetDamage > 0) {
        eventsHtml += `<div style="color:#ff6644">🚀 Урон флоту: ${p.fleetDamage}</div>`;
    }
    if (p.offlineEffectsApplied?.length) {
        eventsHtml += `<div style="color:#4aff9d">🧩 Сработали эффекты: ${p.offlineEffectsApplied.join(', ')}</div>`;
    }
    if (p.defenseStance || p.fleetsaveActive) {
        eventsHtml += `<div style="color:#4aff9d">🛡️ Позиция: ${String(p.defenseStance || 'guard').toUpperCase()}${p.fleetsaveActive ? ' + FLEETSAVE' : ''}</div>`;
    }
    if (p.tecSabotageCount > 0) {
        eventsHtml += `<div style="color:#ff6644">🔥 Саботаж ТЭЦ: ${p.tecSabotageCount}</div>`;
    }
    if (p.blueprintTheftCount > 0) {
        eventsHtml += `<div style="color:#ff6644">📐 Кража чертежей: ${p.blueprintTheftCount}</div>`;
    }

    popup.innerHTML = `
        <h3>⏰ ВОЗВРАЩЕНИЕ</h3>
        <p>Прошло: ${timeStr} (${p.cyclesPassed} циклов)</p>
        ${gainsHtml ? `<div class="offline-resources"><h4>📈 ДОБЫЧА:</h4>${gainsHtml}</div>` : ''}
        ${lossesHtml ? `<div class="offline-losses"><h4>📉 РАСХОД:</h4>${lossesHtml}</div>` : ''}
        ${eventsHtml ? `<div class="offline-events"><h4>⚠️ СОБЫТИЯ:</h4>${eventsHtml}</div>` : ''}
        <div class="offline-popup-actions">
            <button id="offlineNextAction" class="offline-next-button">${p.recommendedLabel || 'ОТКРЫТЬ СЛЕДУЮЩИЙ ШАГ'}</button>
            <button id="offlinePopupClose" class="offline-close-button">ПРОДОЛЖИТЬ</button>
        </div>
    `;

    document.body.appendChild(popup);
    if (incident) {
        popup.querySelectorAll('[data-incident-choice]').forEach(button => {
            button.addEventListener('click', () => {
                if (resolveOfflineIncident(incident, button.dataset.incidentChoice)) {
                    popup.querySelector('.offline-incident')?.remove();
                }
            });
        });
    }

    const closePopup = () => {
        if (popup.parentNode) popup.remove();
    };

    document.getElementById('offlinePopupClose').onclick = closePopup;
    document.getElementById('offlineNextAction').onclick = () => {
        closePopup();
        if (p.recommendedTab) switchMainTab(p.recommendedTab);
    };
    setTimeout(closePopup, 30000);

    localStorage.setItem(USER_STORAGE_KEY('corebox_offline_shown'), Date.now().toString());
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

function showAuthUI() {
    const overlay = document.getElementById('authOverlay');
    const gameContent = document.getElementById('gameContent');
    const userInfo = document.getElementById('userInfo');
    document.body.classList.remove('corebox-ready');
    document.getElementById('corebox-onboarding')?.remove();
    if (overlay) overlay.style.display = 'flex';
    if (gameContent) gameContent.style.display = 'none';
    if (userInfo) userInfo.style.display = 'none';
}

function showGameUI() {
    const overlay = document.getElementById('authOverlay');
    const gameContent = document.getElementById('gameContent');
    const userInfo = document.getElementById('userInfo');
    if (overlay) overlay.style.display = 'none';
    if (gameContent) gameContent.style.display = 'block';
    if (userInfo) userInfo.style.display = 'block';
    document.body.classList.add('corebox-ready');
}

function updateUserDisplay(user) {
    const usernameDisplay = document.getElementById('usernameDisplay');
    const displayName = user?.user_metadata?.username || user?.email?.split('@')[0] || 'Игрок';
    if (usernameDisplay) usernameDisplay.textContent = displayName;
}

function updateInventoryDisplay(rustStats) {
    if (!rustStats) return;
    const container = document.getElementById('resourcesContainer');
    if (!container) return;

    const resources = {
        coal:   rustStats.coal_inventory   ?? 0,
        ore:    rustStats.ore_inventory    ?? 0,
        trash:  rustStats.trash_inventory  ?? 0,
        chips:  rustStats.chips_inventory  ?? 0,
        plasma: rustStats.plasma_inventory ?? 0,
    };

    const chips_unlocked  = rustStats.chips_unlocked  ?? true;
    const plasma_unlocked = rustStats.plasma_unlocked ?? true;

    const RES_META = {
        coal:   { name: 'Уголь',  img: 'img/ugol.png'   },
        ore:    { name: 'Руда',   img: 'img/ruda.png'   },
        trash:  { name: 'Мусор',  img: 'img/musor.png'  },
        chips:  { name: 'Чипы',   img: 'img/chipy.png'  },
        plasma: { name: 'Плазма', img: 'img/plazma.png' },
    };

    const items = [];
    if (resources.coal   > 0) items.push({ ...RES_META.coal,   count: resources.coal   });
    if (resources.ore    > 0) items.push({ ...RES_META.ore,    count: resources.ore    });
    if (resources.trash  > 0) items.push({ ...RES_META.trash,  count: resources.trash  });
    if (chips_unlocked  && resources.chips  > 0) items.push({ ...RES_META.chips,  count: resources.chips  });
    if (plasma_unlocked && resources.plasma > 0) items.push({ ...RES_META.plasma, count: resources.plasma });

    const MAX_SLOTS = 25;
    let html = '';

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        html += `<div class="resource-slot">
            <div class="resource-icon">
                <img src="${item.img}" alt="${item.name}" onerror="this.parentNode.textContent='📦'">
            </div>
            <div class="resource-name">${item.name}</div>
            <div class="resource-count">x${item.count}</div>
        </div>`;
    }

    for (let i = items.length; i < MAX_SLOTS; i++) {
        html += `<div class="resource-slot empty">
            <div class="resource-icon"><span>❓</span></div>
            <div class="resource-name">Пусто</div>
            <div class="resource-count">+</div>
        </div>`;
    }

    container.innerHTML = html;
}

async function _applyReleasedShips(userId) {
    if (!userId) return;

    try {
        const { data: released, error } = await supabase
            .from('fleet_released')
            .select('*')
            .eq('user_id', userId)
            .eq('applied', false);

        if (error) return;
        if (!released || released.length === 0) return;

        for (const entry of released) {
            const { data: mission } = await supabase
                .from('missions')
                .select('status, ship_type')
                .eq('fleet_ship_id', entry.ship_id)
                .eq('attacker_id', userId)
                .in('status', ['flying', 'returning'])
                .maybeSingle();

            if (!mission || mission.status === 'returning' || mission.status === 'done') {
                await supabase.from('fleet_released').update({ applied: true }).eq('id', entry.id);

                if (fleetModule && fleetModule.setShipMissionStatus) {
                    fleetModule.setShipMissionStatus(entry.ship_id, false);
                }
            }

            if (mission && mission.ship_type === 'cargo' && entry.loot && Object.keys(entry.loot).length > 0) {
                const pendingKey = USER_STORAGE_KEY('corebox_pending_loot', userId);
                const pending = JSON.parse(localStorage.getItem(pendingKey) || '{}');
                for (const [res, amt] of Object.entries(entry.loot)) {
                    if (amt && amt > 0) {
                        pending[res] = (pending[res] || 0) + amt;
                    }
                }
                localStorage.setItem(pendingKey, JSON.stringify(pending));

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
        }

        applyPendingLoot();

    } catch(e) {}
}

export { scheduleStatsDisplayUpdate };
