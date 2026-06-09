// ======== game.js (ИСПРАВЛЕННАЯ ВЕРСИЯ v6.6 - ФИКС ПЕРЕРИСОВКИ) ========
// ИСПРАВЛЕНИЯ В ЭТОМ ФАЙЛЕ:
// - Добавлен флаг isProcessingTrade для защиты от спама кликов
// - Переработан массив BASE_TRADES с налогом терминала (~25%)
// - Добавлена проверка переполнения инвентаря в renderTradeTab
// - Добавлена строгая проверка места в инвентаре в executeTrade
// - УБРАНА ПЕРЕРИСОВКА КРАФТА/ДИЗАЙНА ИЗ gameLoopFrame (теперь только slowInterval)

import init, { start_game, apply_config_from_admin } from './pkg/corebox_rs.js';
import { initStatistics, updateStatisticsDisplay, switchTab, gameStats, loadUserStatistics, resetUserStatistics, updateStatisticsFromRust } from './statistics.js';
import { craftModule } from './craft.js';
import { designModule } from './design.js';
import { fleetModule } from './fleet.js';
import { spaceModule } from './space-module.js';
import { Sounds } from './sounds.js';
import { initAuth, logout, getCurrentUser, login, register } from './auth.js';
import { saveGameToCloud, loadGameFromCloud, syncStatisticsToCloud, ensureMapPosition } from './save.js';
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
import { escapeHtml, normalizeNeuroConsciousness } from './utils.js';

// ========== ГЛОБАЛЬНЫЙ ЭКСПОРТ sendShip ДЛЯ КАРТЫ ==========
window.sendShipAction = sendShip;

// ИСПРАВЛЕННЫЙ МАССИВ BASE_TRADES
const BASE_TRADES = [
    // Базовая конвертация с налогом терминала (~25%)
    // Крафт: 100 руды = 1 чип. Обмен: 125 руды = 1 чип
    { id: 'ore_to_chips', from: 'ore', fromAmt: 125, to: 'chips', toAmt: 1 },
    // Обратный обмен: ликвидация актива с потерей 25%
    { id: 'chips_to_ore', from: 'chips', fromAmt: 1, to: 'ore', toAmt: 75 },
    
    // Крафт: 50 угля = 1 плазма. Обмен: 70 угля = 1 плазма (налог 40%)
    { id: 'coal_to_plasma', from: 'coal', fromAmt: 70, to: 'plasma', toAmt: 1 },
    // Обратный обмен: ликвидация с потерей 30%
    { id: 'plasma_to_coal', from: 'plasma', fromAmt: 1, to: 'coal', toAmt: 35 },

    // Промежуточные обмены (также с налогом, чтобы не было бесконечного цикла выгоды)
    { id: 'coal_to_ore', from: 'coal', fromAmt: 3, to: 'ore', toAmt: 1 },
    { id: 'ore_to_coal', from: 'ore', fromAmt: 1, to: 'coal', toAmt: 2 },
    
    // Кросс-обмен высоких ресурсов
    { id: 'chips_to_plasma', from: 'chips', fromAmt: 5, to: 'plasma', toAmt: 1 },
    { id: 'plasma_to_chips', from: 'plasma', fromAmt: 1, to: 'chips', toAmt: 3 },
];

const RES_ICON = { coal: '🪨', ore: '⛏️', chips: '🎛️', plasma: '⚡', trash: '🗑️' };
const RES_NAME = { coal: 'уголь', ore: 'руда', chips: 'чип', plasma: 'плазма', trash: 'мусор' };

const SAVE_KEY = (userId) => `corebox_v2_${userId || 'local'}`;

let _holdInterval = null;
let _isHolding = false;
let game;
let currentUser = null;
let lastRustStats = null;
let isAutoClicking = false;
let isGameInitialized = false;
let comboCount = 0;
let lastClickTime = 0;
let prestigeLevel = Number(localStorage.getItem('corebox_prestige_level')) || 0;
let _saveTimer = null;
let _cloudSaveTimer = null;
let _lastSeenTimer = null;
let lastProcessedAttackHash = null;
let _gameLoopRAF = null;
let _lastGameLoopTime = 0;
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
let _justLoadedCloudSave = false;
let _ccClockInterval = null;
let _lastInterceptCount = 0;
let _attackHistoryCollapsed = true;
let isProcessingTrade = false; // Флаг защиты от спама кликов в торговле

let _notifChannel = null;
let _missionPollInterval = null;
let _missionChannel = null;
let _incomingChannel = null;
let _universalChannel = null;
let _keepAliveChannel = null;

let cachedRustStats = null;
let cachedRustStatsTime = 0;

let _sessionId = Math.random().toString(36).substring(2, 10);

let _totalNeuroScoreEarned = parseInt(localStorage.getItem('cc_total_score') || '0');
let _lastKnownNeuroScore = 0;

// ========== ФУНКЦИЯ ОБНОВЛЕНИЯ UI ТЭЦ ==========
function updateTecUI() {
    const tecBtn = document.getElementById('tec-toggle-btn');
    const tecStatusSpan = document.getElementById('coalStatusDisplay');
    const tecIndicator = document.getElementById('tecIndicator');
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
    
    if (coalInventorySpan) {
        coalInventorySpan.textContent = coalAmount;
    }
    
    const tecBonus = isCoalEnabled ? 2.5 : 0;
    if (tecPowerBonusSpan) {
        tecPowerBonusSpan.textContent = tecBonus;
    }
    
    if (tecStatusSpan) {
        tecStatusSpan.textContent = isCoalEnabled ? "АКТИВНА" : "ОФФЛАЙН";
        tecStatusSpan.style.color = isCoalEnabled ? "#4aff9d" : "#ff6a6a";
    }
    if (tecIndicator) {
        tecIndicator.className = `status-indicator ${isCoalEnabled ? 'online' : 'offline'}`;
    }
    
    const isDisabled = !isCoalEnabled && !hasCoal;
    tecBtn.disabled = isDisabled;
    tecBtn.style.opacity = isDisabled ? "0.5" : "1";
    
    if (tecWarning) {
        if (isDay && !isCoalEnabled && hasCoal) {
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

// ========== ФУНКЦИЯ РЕНДЕРА КВЕСТОВ ==========
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
            default: 
                if (q.quest_type === 'MineResource' && q.resource) {
                    current = stats[`total_${q.resource}_mined`] || 0;
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
    
    if (msg.includes('НЕЙРО-ЭВОЛЮЦИЯ')) entry.dataset.sound = 'evolution';
    if (msg.includes('Атака') && msg.includes('повстанцев') && !msg.includes('отражена')) entry.dataset.sound = 'rebelAttack';
    if (msg.includes('Предупреждение')) entry.dataset.sound = 'warning';
    if (msg.includes('Квест') && msg.includes('выполнен')) {
        entry.dataset.sound = 'questDone';
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
    if (msg.includes('ТЭЦ активирована')) entry.dataset.sound = 'coalOn';
    if (msg.includes('ТЭЦ деактивирована')) entry.dataset.sound = 'coalOff';
    if (msg.includes('Обмен')) entry.dataset.sound = 'trade';
    if (msg.includes('Улучшена')) entry.dataset.sound = 'upgrade';
    if (msg.includes('ПЕРЕХВАТ')) entry.dataset.sound = 'intercept';
    
    log.appendChild(entry);
    
    const maxEntries = window.gameConfig?.ui_config?.max_log_entries ?? 50;
    while (log.children.length > maxEntries) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    
    const channel = getUniversalChannel();
    if (channel) {
        try {
            channel.postMessage({
                type: 'log',
                message: msg,
                logType: type,
                timestamp: Date.now(),
                sessionId: _sessionId
            });
        } catch(e) {}
    }
}

function setupLogObserver() {
    const logBox = document.getElementById('logBox');
    if (!logBox) return;
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList?.contains('log-entry')) {
                    const sound = node.dataset.sound;
                    if (sound && Sounds[sound]) Sounds[sound]();
                }
            });
        });
    }).observe(logBox, { childList: true });
}

async function applyPendingLoot() {
    const pending = JSON.parse(localStorage.getItem('corebox_pending_loot') || '{}');
    if (Object.keys(pending).length === 0) return;
    if (!game) return;
    
    for (const [res, amt] of Object.entries(pending)) {
        if (amt > 0) {
            if (typeof game.add_resource === 'function') {
                game.add_resource(res, amt);
            }
        }
    }
    
    addToLog(`📦 Восстановлен лут из предыдущей сессии: ${Object.entries(pending).map(([r,a]) => `${a} ${r}`).join(', ')}`);
    localStorage.removeItem('corebox_pending_loot');
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

async function cloudSaveNow(force = false) {
    if (!currentUser || !game) return;
    if (_isSaving && !force) return;
    
    if (_isSaving && force) {
        console.log('⏳ Ожидание завершения предыдущего сохранения...');
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (!_isSaving) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }
    
    const now = Date.now();
    if (!force && now - _lastCloudSave < 30000 && _cloudSaveTimer) return;
    
    if (_justLoadedCloudSave && !force) {
        console.log('⏳ Пропуск автосохранения на 5 секунд после загрузки облака');
        return;
    }
    
    _isSaving = true;
    _lastCloudSave = now;
    
    const currentFleetBackup = window.fleetModule?.ships ? JSON.parse(JSON.stringify(window.fleetModule.ships)) : null;
    const currentInventory = getCurrentGameState()?.inventory;
    
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
        } else if (result.error === "Конфликт: облако новее" && result.server_save) {
            addToLog("⚠️ Обнаружен конфликт сохранений, выполняем объединение данных", "warning");
            
            try {
                const cloudState = result.server_save;
                const localState = JSON.parse(game.get_statistics());
                
                if (cloudState.inventory && localState) {
                    const resources = ['coal', 'ore', 'chips', 'plasma', 'trash'];
                    const mergedInventory = {};
                    for (const res of resources) {
                        const localAmt = localState[`${res}_inventory`] || 0;
                        mergedInventory[res] = Math.max(
                            cloudState.inventory[res] || 0,
                            localAmt
                        );
                    }
                    cloudState.inventory = mergedInventory;
                }
                
                game.load_game_state(JSON.stringify(cloudState));
                
                if (cloudState.fleet && Array.isArray(cloudState.fleet) && window.fleetModule) {
                    const cloudFleet = cloudState.fleet;
                    const localFleet = currentFleetBackup || window.fleetModule.ships || [];
                    const cloudIds = new Set(cloudFleet.map(s => s.id));
                    const newLocalShips = localFleet.filter(s => !cloudIds.has(s.id));
                    const mergedFleet = [...cloudFleet, ...newLocalShips];
                    
                    console.log(`🔄 Объединение флота: облако=${cloudFleet.length}, новые=${newLocalShips.length}, всего=${mergedFleet.length}`);
                    window.fleetModule.ships = mergedFleet;
                    window.fleetModule.saveFleet();
                    
                    if (newLocalShips.length > 0) {
                        addToLog(`✅ Сохранены новые корабли: +${newLocalShips.length}`, "success");
                    }
                }
                
                if (cloudState.blueprints && window.designModule) {
                    const cloudBlueprints = cloudState.blueprints;
                    const localBlueprints = window.designModule.blueprints || [];
                    
                    if (typeof cloudBlueprints === 'object' && !Array.isArray(cloudBlueprints)) {
                        for (const bp of localBlueprints) {
                            if (bp.unlocked && !cloudBlueprints[bp.id]) {
                                cloudBlueprints[bp.id] = true;
                                console.log(`🔄 Добавлен чертеж ${bp.id} в облако`);
                            }
                        }
                        window.designModule.loadBlueprintsFromCloud(cloudBlueprints);
                    } else if (Array.isArray(cloudBlueprints)) {
                        const cloudBpMap = new Map(cloudBlueprints.map(b => [b.id, b]));
                        for (const bp of localBlueprints) {
                            if (bp.unlocked && !cloudBpMap.get(bp.id)?.unlocked) {
                                cloudBpMap.set(bp.id, { id: bp.id, unlocked: true });
                                console.log(`🔄 Добавлен чертеж ${bp.id} в облако`);
                            }
                        }
                        window.designModule.loadBlueprintsFromCloud(Array.from(cloudBpMap.values()));
                    }
                    window.designModule.syncBlueprintsToRust();
                }
                
                addToLog("💾 Выполнено объединение с облачной версией", "success");
                await updateLastSeen();
            } catch(e) {
                console.error('Ошибка при объединении:', e);
                addToLog("❌ Ошибка при разрешении конфликта", "error");
            }
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
            parsed.mining_level = parsed.upgrades?.mining ?? 0;
            parsed.defense_active = parsed.upgrades?.defense ?? false;
            parsed.defense_level = parsed.upgrades?.defense_level ?? 0;
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

let activeDiscount = null;
let lastDiscountNight = -1;

function rollNightDiscount(nightIndex, isNightStart) {
    if (!isNightStart) return;
    if (nightIndex === lastDiscountNight) return;
    lastDiscountNight = nightIndex;
    activeDiscount = null;
    
    let stats = null;
    try { stats = JSON.parse(game.get_statistics()); } catch(e) {}
    if (stats?.trade_blocked) return;
    
    if (Math.random() < 0.25) {
        const idx = Math.floor(Math.random() * BASE_TRADES.length);
        activeDiscount = { tradeId: BASE_TRADES[idx].id, nightIndex };
        addToLog(`🏷️ Ночная скидка 50%: ${RES_ICON[BASE_TRADES[idx].from]}→${RES_ICON[BASE_TRADES[idx].to]}`);
        
        const tradeTab = document.getElementById('trade-tab');
        if (tradeTab && tradeTab.style.display === 'block') {
            if (typeof renderTradeTab === 'function') renderTradeTab();
        }
    }
}

function onDayStarted() {
    if (activeDiscount) {
        activeDiscount = null;
        const tradeTab = document.getElementById('trade-tab');
        if (tradeTab && tradeTab.style.display === 'block') {
            if (typeof renderTradeTab === 'function') renderTradeTab();
        }
    }
    _nightWarnShown = false;
}

window.rollNightDiscount = rollNightDiscount;
window.onDayStarted = onDayStarted;

async function prestigeReset() {
    if (!confirm('ПРЕСТИЖ!\nНачнёте заново, получите бонусы. Продолжить?')) return;
    
    const fleetBackup = window.fleetModule?.ships ? JSON.stringify(window.fleetModule.ships) : null;
    const blueprintBackup = window.designModule?.blueprints ? JSON.stringify(window.designModule.blueprints) : null;
    
    if (game && typeof game.clear_planet_missions === 'function') {
        game.clear_planet_missions();
    }
    
    if (currentUser) {
        try {
            await supabase
                .from('missions')
                .update({ status: 'cancelled' })
                .eq('attacker_id', currentUser.id)
                .in('status', ['flying', 'returning', 'arrived']);
        } catch(e) {
            console.warn('Ошибка отмены PvP-миссий при престиже:', e);
        }
    }
    
    prestigeLevel++;
    localStorage.setItem('corebox_prestige_level', prestigeLevel);
    
    if (fleetModule) {
        fleetModule.ships = [];
        fleetModule.defenseShipId = null;
        fleetModule.saveFleet();
    }
    
    if (designModule) {
        designModule.blueprints.forEach(bp => bp.unlocked = false);
        designModule.saveBlueprints();
        if (game && typeof game.sync_blueprints === 'function') {
            game.sync_blueprints(false, false, false);
        }
    }
    
    if (typeof game.reset_progress === 'function') game.reset_progress();
    showFloatingText(`🔁 ПРЕСТИЖ ${prestigeLevel}!`, window.innerWidth / 2, window.innerHeight / 2);
    document.dispatchEvent(new CustomEvent('prestigeComplete', { detail: { level: prestigeLevel } }));
    
    await cloudSaveNow(true);
}

function getPrestigeBonus() {
    const rawEventBonus = prestigeLevel * 0.005;
    const cappedEventBonus = Math.min(rawEventBonus, 0.10);
    return { 
        critBonus: prestigeLevel * 0.01, 
        comboBonus: prestigeLevel * 0.05, 
        eventBonus: cappedEventBonus 
    };
}

function calculateOfflineProgress(saved) {
    const lastShown = parseInt(localStorage.getItem('corebox_offline_shown') || '0');
    const savedTimestamp = saved?.timestamp || saved?._savedAt || Date.now();
    const elapsed = Math.min(Math.floor((Date.now() - savedTimestamp) / 1000), 8 * 3600);
    if (elapsed < 10 || Date.now() - lastShown < 60000) return null;
    const ticks = elapsed;
    const miningLevel = saved?.mining_level || 0;
    const passive = saved?._passive_rates || {
        coal: (0.004 + miningLevel * 0.0005),
        trash: (0.008 + miningLevel * 0.001),
        ore: (0.003 + miningLevel * 0.0003)
    };
    
    const nightsElapsed = Math.floor(elapsed / 32);
    
    const nightsRemaining = saved?.rebel_protection_nights || 0;
    let newNights = nightsRemaining;
    if (nightsRemaining > 0 && nightsElapsed > 0) {
        const used = Math.min(nightsRemaining, nightsElapsed);
        newNights = nightsRemaining - used;
    }
    
    return {
        elapsedSeconds: elapsed,
        coalGained: Math.floor(ticks * passive.coal),
        trashGained: Math.floor(ticks * passive.trash),
        oreGained: Math.floor(ticks * passive.ore),
        cyclesPassed: Math.floor(elapsed / 32),
        attacksDuringOffline: Math.floor(elapsed / 600),
        rebelProtectionNights: newNights,
        rebelProtectionActive: newNights > 0 ? true : false
    };
}

function showOfflineRewardPopup(p) {
    const mins = Math.floor(p.elapsedSeconds / 60);
    const timeStr = mins > 60 ? `${Math.floor(mins / 60)}ч ${mins % 60}м` : `${mins}м`;
    addToLog(`⏰ Офлайн ${timeStr}: +${p.coalGained}🪨 +${p.trashGained}♻️ +${p.oreGained}⛏️`);
    showFloatingText(`⏰ Офлайн ${timeStr}`, window.innerWidth/2, 200);
    const popup = document.createElement('div');
    popup.className = 'offline-popup';
    popup.innerHTML = `<h3>⏰ ВОЗВРАЩЕНИЕ</h3><p>Прошло: ${timeStr}</p><div class="offline-resources"><div>🪨 +${p.coalGained}</div><div>♻️ +${p.trashGained}</div><div>⛏️ +${p.oreGained}</div></div><button id="offlinePopupClose">ПРОДОЛЖИТЬ</button>`;
    document.body.appendChild(popup);
    
    const closePopup = () => {
        if (popup.parentNode) popup.remove();
    };
    document.getElementById('offlinePopupClose').onclick = closePopup;
    setTimeout(closePopup, 20000);
    
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

function showAuthUI() {
    const overlay = document.getElementById('authOverlay');
    const gameContent = document.getElementById('gameContent');
    const userInfo = document.getElementById('userInfo');
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
}

function updateUserDisplay(user) {
    const usernameDisplay = document.getElementById('usernameDisplay');
    const prestigeTag = prestigeLevel > 0 ? ` ✦${prestigeLevel}` : '';
    const displayName = user?.user_metadata?.username || user?.email?.split('@')[0] || 'Игрок';
    if (usernameDisplay) usernameDisplay.textContent = displayName + prestigeTag;
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

function syncUIAfterCloudLoad(cloudSave) {
    if (!cloudSave) return;
    
    if (cloudSave.computational_power !== undefined) {
        updatePowerGlow();
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
        const neuroEl = document.getElementById('neuroStatus');
        if (neuroEl) {
            let consc = cloudSave.neuro.consciousness || 0;
            if (consc > 1.5) consc = consc / 100.0;
            neuroEl.textContent = `${(consc * 100).toFixed(1)}% (Ур. ${cloudSave.neuro.evolution || 0})`;
        }
        const neuroProgress = document.getElementById('neuroProgress');
        if (neuroProgress) {
            let consc = cloudSave.neuro.consciousness || 0;
            if (consc > 1.5) consc = consc / 100.0;
            neuroProgress.style.width = `${Math.min(consc * 100, 100)}%`;
        }
    }
    
    if (cloudSave.is_day !== undefined) {
        const timeDisplay = document.getElementById('timeDisplay');
        if (timeDisplay) {
            const icon = cloudSave.is_day ? "☀️" : "🌙";
            const text = cloudSave.is_day ? "День" : "Ночь";
            const maxTime = cloudSave.is_day ? 24 : 16;
            const filled = Math.min(cloudSave.game_time || maxTime, maxTime) / (maxTime / 12);
            const bar = "█".repeat(Math.floor(filled));
            const emptyBar = "░".repeat(12 - Math.floor(filled));
            timeDisplay.textContent = `${icon} ${text} [${bar}${emptyBar}]`;
        }
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
        const rustPow = (game && typeof game.get_computational_power === 'function')
            ? game.get_computational_power() : 0;
        const cloudPow = cloudSave.computational_power || 0;
        designModule.updateComputationalPower(Math.max(rustPow, cloudPow));
    }
    
    if (cloudSave.attack_history && Array.isArray(cloudSave.attack_history)) {
        updateAttackHistory(cloudSave.attack_history);
    }
    
    if (cloudSave.auto_clicking !== undefined) {
        localStorage.setItem('corebox_autoclicking', cloudSave.auto_clicking ? 'true' : 'false');
    }
    
    const unifiedKey = SAVE_KEY(currentUser?.id);
    localStorage.setItem(unifiedKey, JSON.stringify(cloudSave));
    localStorage.setItem('corebox_save_backup', JSON.stringify(cloudSave));
    localStorage.setItem('corebox_save_universal', JSON.stringify({
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
    const localBackup = localStorage.getItem('corebox_save_backup');
    const localUniversal = localStorage.getItem('corebox_save_universal');
    
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
            
            if (localTimestamp > cloudSave.timestamp + CLOCK_TOLERANCE_MS) {
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
                            manual_clicks: cloudSave.total_mined || 0,
                            total_mined: cloudSave.total_mined || cloudSave.manual_clicks || 0,
                            neuro_evolution: cloudSave.neuro?.evolution || 0,
                            neuro_consciousness: (() => {
                                let c = cloudSave.neuro?.consciousness || 0;
                                if (c > 1.5) c = c / 100.0;
                                if (c > 1.0) c = 1.0;
                                if (c < 0) c = 0;
                                return c;
                            })(),
                            neuro_score: cloudSave.neuro?.score || 0,
                            current_ai_mode: cloudSave.neuro?.ai_mode || "Обычный",
                            is_day: cloudSave.is_day !== undefined ? cloudSave.is_day : true,
                            coal_enabled: cloudSave.coal_enabled || false,
                            game_time: cloudSave.game_time || 24,
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
                            prestige_level: cloudSave.prestige_level || 0,
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
                        };
                    }
                    game.load_game_state(JSON.stringify(rustFormatSave));
                    addToLog(`💾 Загружено облачное сохранение (${new Date(cloudSave.timestamp).toLocaleString()})`);
                    
                    if (cloudSave.fleet && Array.isArray(cloudSave.fleet) && window.fleetModule) {
                        const storageKey = window.fleetModule._getStorageKey();
                        localStorage.setItem(storageKey, JSON.stringify(cloudSave.fleet));
                        window.fleetModule.ships = cloudSave.fleet;
                        if (window.fleetModule._renderFleetTab) {
                            window.fleetModule._renderFleetTab();
                        }
                        console.log(`✅ Флот восстановлен из облака: ${cloudSave.fleet.length} кораблей`);
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
            const userId = currentUser?.id;
            const saved = userId ? localStorage.getItem(SAVE_KEY(userId)) : localStorage.getItem('corebox_save');
            if (saved) {
                try {
                    const state = JSON.parse(saved);
                    if (state.inventory) {
                        for (const [res, amt] of Object.entries(pending)) {
                            state.inventory[res] = (state.inventory[res] || 0) + amt;
                        }
                        if (userId) {
                            localStorage.setItem(SAVE_KEY(userId), JSON.stringify(state));
                        } else {
                            localStorage.setItem('corebox_save', JSON.stringify(state));
                        }
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
    } catch(e) {}
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
                .select('status')
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

            if (mission && mission.status === 'cargo' && entry.loot && Object.keys(entry.loot).length > 0) {
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
        }
        
        _applyPendingLoot();
        
    } catch(e) {}
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
    
    _missionChannel = supabase
        .channel(`missions_out:${user.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'missions',
            filter: `attacker_id=eq.${user.id}`,
        }, (payload) => {
            if (payload.new && ['returning', 'done'].includes(payload.new.status)) {
                processArrivedMissions(user.id);
                setTimeout(() => _refreshFleetWithMissions(), 500);
            }
        })
        .subscribe();
    
    _incomingChannel = supabase
        .channel(`missions_in:${user.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'missions',
            filter: `target_id=eq.${user.id}`,
        }, (payload) => {
            if (payload.new && ['flying', 'returning'].includes(payload.new.status)) {
                processArrivedMissions(user.id);
                if (payload.new.status === 'flying' && window.showNotif) {
                    const shipIcons = { scout: '🔭', combat: '⚔️', cargo: '📦' };
                    const icon = shipIcons[payload.new.ship_type] || '🚀';
                    window.showNotif(`⚠️ ${icon} Вражеский корабль летит к вам!`, true);
                    Sounds.rebelAttack && Sounds.rebelAttack();
                }
            }
        })
        .subscribe();
    
    if (_missionPollInterval) clearInterval(_missionPollInterval);
    _missionPollInterval = setInterval(() => {
        if (currentUser) {
            processArrivedMissions(currentUser.id);
            _refreshFleetWithMissions();
        }
    }, 30000);
    
    if (currentUser) {
        processArrivedMissions(currentUser.id);
        setTimeout(() => _refreshFleetWithMissions(), 1000);
    }
}

function _cleanupMultiplayer() {
    if (_notifChannel) { supabase.removeChannel(_notifChannel); _notifChannel = null; }
    if (_missionChannel) { supabase.removeChannel(_missionChannel); _missionChannel = null; }
    if (_incomingChannel) { supabase.removeChannel(_incomingChannel); _incomingChannel = null; }
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
            container.innerHTML = fleetModule.renderFleetUI();
            const newContainer = fleetModule.setupEventListeners(container);
            if (newContainer && newContainer !== container) {
                const parent = container.parentNode;
                if (parent && parent.contains(container)) {
                    parent.replaceChild(newContainer, container);
                }
            }
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
        
        if (missions.length > 0) {
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
                const currentStateJson = game.get_statistics();
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
            
            const universalSave = localStorage.getItem('corebox_save_universal');
            if (universalSave) {
                try {
                    const saveData = JSON.parse(universalSave);
                    if (saveData.neuro_consciousness !== undefined) {
                        saveData.neuro_consciousness = consciousness;
                        localStorage.setItem('corebox_save_universal', JSON.stringify(saveData));
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
    
    window.addEventListener('beforeunload', () => {
        if (window.fleetModule?.saveFleet) {
            window.fleetModule.saveFleet(true);
        }
        if (currentUser && game) {
            if (typeof game.save_current_state === 'function') {
                game.save_current_state();
            }
            const state = getCurrentGameState();
            const unifiedKey = SAVE_KEY(currentUser?.id);
            if (state) {
                localStorage.setItem(unifiedKey, JSON.stringify(state));
                localStorage.setItem('corebox_save_backup', JSON.stringify(state));
            }
            saveCurrentUserStatistics();
            updateLastSeen();
        }
    });
    
    initAuth(
        async (user) => {
            currentUser = user;
            
            const migrated = migrateLegacySaves(user.id);
            
            showGameUI();
            updateUserDisplay(user);
            document.getElementById('userInfo').style.display = 'block';
            
            await updateLastSeen();
            startLastSeenUpdater();
            
            addToLog("🔄 Синхронизация с облаком...");
            
            const cloudSave = await loadGameFromCloud(true);
            
            if (cloudSave) {
                addToLog(`✅ Загружено облачное сохранение (уровень нейро: ${cloudSave.neuro?.evolution || 0})`);
                _justLoadedCloudSave = true;
            } else if (migrated) {
                addToLog(`✅ Загружено мигрированное сохранение`);
            }
            
            if (!isGameInitialized) {
                await initializeGame(cloudSave || migrated);
            } else {
                _initMultiplayer(user);
            }
            
            const myPos = await ensureMapPosition(user.id);
            if (spaceModule) {
                spaceModule.setMyPosition(myPos.x, myPos.y);
                console.log(`📍 Позиция игрока загружена: (${myPos.x}, ${myPos.y})`);
            }
            
            loadUserStatsFromCloud(user);
            
            setTimeout(() => {
                if (game && currentUser && !_justLoadedCloudSave) {
                    cloudSaveNow(true);
                }
                setTimeout(() => {
                    _justLoadedCloudSave = false;
                }, 10000);
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
        
        if (!email || !password) { 
            showMessage('Заполните поля!'); 
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
            showMessage('Заполните поля!'); 
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
            showMessage('Регистрация успешна!', false); 
            toggleMode(); 
        } else {
            showMessage(result.error || 'Ошибка');
        }
    }
    
    if (loginBtn) loginBtn.onclick = () => isRegisterMode ? handleRegister() : handleLogin();
    if (registerBtn) registerBtn.onclick = handleRegister;
    if (toggleModeBtn) toggleModeBtn.onclick = toggleMode;
    
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
    
    if (currentUser && game) {
        addToLog("💾 Сохраняем прогресс перед выходом...");
        await cloudSaveNow(true);
        
        const state = getCurrentGameState();
        if (state) {
            const unifiedKey = SAVE_KEY(currentUser.id);
            localStorage.setItem(unifiedKey, JSON.stringify(state));
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

function updateTurbineVisuals(heat) {
    const heatRatio = Math.min(heat / 100, 1);
    const hue = 200 - heatRatio * 200;
    document.documentElement.style.setProperty('--turbine-hue', hue);
    
    const mineBtn = document.getElementById('floatingMineBtn');
    if (mineBtn) {
        if (heat >= 100) {
            mineBtn.classList.add('overheated');
        } else {
            mineBtn.classList.remove('overheated');
        }
    }
}

function updateRebelPulse(activity) {
    const rebelPulse = document.getElementById('rebelPulse');
    if (!rebelPulse) return;
    
    const speed = Math.max(0.3, 2 - activity * 0.15);
    rebelPulse.style.animationDuration = `${speed}s`;
    
    rebelPulse.classList.remove('pulse-low', 'pulse-medium', 'pulse-high');
    if (activity <= 3) rebelPulse.classList.add('pulse-low');
    else if (activity <= 6) rebelPulse.classList.add('pulse-medium');
    else rebelPulse.classList.add('pulse-high');
}

function updatePowerRing(manualClicks, clicksPerPower) {
    const ringFill = document.querySelector('.ring-fill');
    if (!ringFill) return;
    
    const progress = (manualClicks / clicksPerPower) % 1;
    const circumference = 283;
    const offset = circumference * (1 - progress);
    ringFill.style.strokeDashoffset = offset;
    
    if (progress < 0.05 && manualClicks > 0) {
        ringFill.classList.add('ring-flash');
        setTimeout(() => ringFill.classList.remove('ring-flash'), 300);
    }
}

function updateTurbineStatus(stats) {
    const heat = stats?.turbine_heat ?? 0;
    const isCooling = stats?.turbine_cooling ?? false;
    const bar = document.getElementById('turbineHeatBar');
    const label = document.getElementById('turbineHeatLabel');
    const hint = document.getElementById('turbineHeatHint');
    if (!bar || !label) return;
    
    bar.style.width = `${Math.min(heat, 100)}%`;
    bar.className = 'turbine-fill';
    
    updateTurbineVisuals(heat);
    
    const coolingRate = 2 + (stats?.turbine_upgrade_level || 0) + (stats?.cooling_level || 0);
    
    if (heat >= 100) {
        bar.classList.add('turbine-critical');
        label.textContent = `🔥 ПЕРЕГРЕВ: ${heat}% — ОСТЫВАНИЕ...`;
        const ticksToZero = Math.ceil(heat / coolingRate);
        const secsToZero = ticksToZero;
        if (hint) hint.textContent = `Добыча заблокирована. Остынет через ~${secsToZero} сек`;
    } else if (isCooling) {
        const colorClass = heat >= 70 ? 'turbine-hot' : heat >= 40 ? 'turbine-warm' : 'turbine-cool';
        bar.classList.add(colorClass);
        label.textContent = `🌡️ Остывание: ${heat}%`;
        if (hint) hint.textContent = '';
    } else if (heat >= 70) {
        bar.classList.add('turbine-hot');
        label.textContent = `🌡️ Нагрев: ${heat}%`;
        if (hint) hint.textContent = '';
    } else if (heat >= 40) {
        bar.classList.add('turbine-warm');
        label.textContent = `🌡️ Нагрев: ${heat}%`;
        if (hint) hint.textContent = '';
    } else {
        bar.classList.add('turbine-cool');
        label.textContent = `🌡️ Температура: ${heat}%`;
        if (hint) hint.textContent = '';
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
        if (f.pattern_revealed && f.predicted_attack_after > 0) {
            const nightsLeft = Math.max(0, f.predicted_attack_after - (f.quiet_nights_accumulated || 0));
            const danger = nightsLeft <= 1;
            nextAttackHtml = `
                <div class="cc-faction-predict ${danger ? 'cc-faction-predict-danger' : ''}">
                    🎯 Паттерн: атакует через ~${f.predicted_attack_after} тихих ночей
                    · Сейчас тихих: ${f.quiet_nights_accumulated}
                    · До атаки: <strong>${nightsLeft === 0 ? '⚠️ СЕГОДНЯ' : nightsLeft + ' н.'}</strong>
                </div>`;
        } else if (f.attacks_observed > 0 && f.attacks_observed < 3) {
            nextAttackHtml = `<div class="cc-faction-predict">🔍 Анализ паттерна... (${f.attacks_observed}/3 атак)</div>`;
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

    el.innerHTML = msgs.map((m, idx) => {
        const rel = Math.round((m.reliability ?? 0) * 100);
        const isHigh = rel >= 70;
        const eta = m.eta_ticks > 0 ? `ETA: ${m.eta_ticks} тик` : 'Скоро!';
        const isNew = (currentCount - idx) <= 2 && hasNew;
        return `<div class="cc-intercept-msg ${isHigh ? 'cc-intercept-high' : ''} ${isNew ? 'cc-intercept-new' : ''}">
            <div>${escapeHtml(m.content || '')}</div>
            <div class="cc-intercept-rel">
                <span>${m.target_hint ? escapeHtml(m.target_hint) : ''}</span>
                <span>${eta} · ${rel}% достоверность</span>
            </div>
        </div>`;
    }).join('');
}

function getNeuroScoreNeeded(evol) {
    const table = [60, 100, 150, 220, 300, 400, 500, 650, 800, 1000];
    if (evol < table.length) return table[evol];
    return 1200 + (evol - 10) * 120;
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

    const evol = s.neuro_evolution ?? 0;
    let consc = s.neuro_consciousness ?? 0;
    if (consc > 1.0) consc = consc / 100.0;
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
    const totalScoreEl = document.getElementById('cc-score-total');
    if (totalScoreEl) {
        totalScoreEl.textContent = _totalNeuroScoreEarned.toLocaleString('ru-RU');
    }

    set('cc-evol', evol);
    set('cc-consc', conscPct);
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
            : `До эволюции: ${needed - score} (${pct.toFixed(0)}%)`;
    } else {
        setW('cc-bar-score', Math.min(score / 500 * 100, 100));
    }

    const defPct = Math.min(defBonus * 100, 100);
    set('cc-def-bonus', `+${Math.round(defBonus * 100)}%`);
    setW('cc-bar-def', defPct);

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

    const vuln = s.current_vulnerability || '';
    const vulnEl = document.getElementById('cc-vuln');
    if (vulnEl) {
        vulnEl.textContent = vuln || 'нет';
        vulnEl.className = 'cc-badge ' + (vuln ? 'cc-badge-danger' : 'cc-badge-ok');
    }
    const closeVulnBtn = document.querySelector('[data-action="close_vulnerability"]');
    if (closeVulnBtn) {
        const show = !!vuln;
        closeVulnBtn.style.display = show ? '' : 'none';
        const grid = closeVulnBtn.closest('.cc-ops-grid');
        if (grid) grid.style.gridTemplateColumns = show ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';
    }

    const protNights = s.rebel_protection_nights ?? 0;
    const protActive = s.rebel_protection_active ?? false;
    const protEl = document.getElementById('cc-prot');
    if (protEl) {
        protEl.textContent = protNights > 0 ? `${protNights} н.` : 'нет';
        protEl.className = 'cc-badge ' + (protNights > 0 ? 'cc-badge-ok' : 'cc-badge-muted');
    }
    const protStatusEl = document.getElementById('cc-prot-status');
    if (protStatusEl) {
        protStatusEl.textContent = protActive ? 'активна ✅' : 'неактивна';
        protStatusEl.className = 'cc-badge ' + (protActive ? 'cc-badge-ok' : 'cc-badge-muted');
    }

    updateMultiphaseIndicator(s);

    const atkWarnEl = document.getElementById('cc-attack-warning');
    const atkWarnText = document.getElementById('cc-attack-warning-text');
    if (atkWarnEl && atkWarnText) {
        if (s.attack_warning) {
            atkWarnText.textContent = `${s.attack_warning}${s.attack_warning_faction ? ` · ${s.attack_warning_faction}` : ''}`;
            atkWarnEl.style.display = '';
        } else {
            atkWarnEl.style.display = 'none';
        }
    }

    const defended = s.attacks_defended ?? 0;
    const totalAttacks = s.rebel_attacks_count ?? 0;
    set('cc-defended', defended);
    set('cc-total-attacks', totalAttacks);
    set('cc-nights', s.nights_survived ?? 0);

    const cd = s.counter_op_cooldown ?? 0;
    const cdEl = document.getElementById('cc-cd');
    if (cdEl) {
        if (cd > 0) {
            const mins = Math.floor(cd / 60);
            const secs = cd % 60;
            const timeStr = mins > 0 ? `${mins}м ${secs}с` : `${secs}с`;
            cdEl.textContent = `⏳ ${timeStr}`;
            cdEl.style.color = cd > 20 ? '#ffcc44' : '#ff9944';
        } else {
            cdEl.textContent = 'ГОТОВО ✅';
            cdEl.style.color = '#4aff9d';
        }
    }

    const propBtn = document.querySelector('[data-action="propaganda"]');
    if (propBtn) {
        const active = !!s.propaganda_active;
        const evolLevel = s.neuro_evolution ?? 0;
        propBtn.classList.toggle('cc-op-active', active);
        propBtn.disabled = active || cd > 0;
        let tooltip = `Контр-пропаганда (20 чипов, Ур.3+)`;
        if (active) tooltip = '📡 Активна';
        else if (cd > 0) tooltip += ` — кд ${cd > 0 ? (cd > 60 ? `${Math.floor(cd/60)}м ${cd%60}с` : `${cd}с`) : ''}`;
        else if (evolLevel < 3) tooltip += ` — нужна эволюция Ур.3!`;
        propBtn.title = tooltip;
    }
    const depotBtn = document.querySelector('[data-action="fake_depot"]');
    if (depotBtn) {
        const active = !!s.fake_depot_active;
        const evolLevel = s.neuro_evolution ?? 0;
        depotBtn.classList.toggle('cc-op-active', active);
        depotBtn.disabled = active || cd > 0;
        let tooltip = `Ложный склад (50 мусора, Ур.4+)`;
        if (active) tooltip = '💣 Ловушка активна';
        else if (cd > 0) tooltip += ` — кд ${cd > 0 ? (cd > 60 ? `${Math.floor(cd/60)}м ${cd%60}с` : `${cd}с`) : ''}`;
        else if (evolLevel < 4) tooltip += ` — нужна эволюция Ур.4!`;
        depotBtn.title = tooltip;
    }

    try {
        if (game && typeof game.get_rebel_intel === 'function') {
            const intel = JSON.parse(game.get_rebel_intel());
            renderFactionDossier(intel);
        }
    } catch(e) {}

    try {
        if (game && typeof game.get_intercepted_messages === 'function') {
            const msgs = JSON.parse(game.get_intercepted_messages());
            renderIntercepts(msgs);
        }
    } catch(e) {}
}

function updateNeuroStatus(rustStats = null) {
    if (!game) return;
    try {
        if (!rustStats && cachedRustStats) rustStats = cachedRustStats;
        if (!rustStats && game) { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); }
        if (rustStats) {
            const neuroEl = document.getElementById('neuroStatus');
            const progressEl = document.getElementById('neuroProgress');
            if (neuroEl) {
                let consc = rustStats.neuro_consciousness || 0;
                const evol = rustStats.neuro_evolution || 0;
                neuroEl.textContent = `${(consc * 100).toFixed(1)}% (Ур. ${evol})`;
                if (progressEl) {
                    let conscNormalized = consc;
                    if (conscNormalized > 1.5) conscNormalized = conscNormalized / 100.0;
                    progressEl.style.width = `${Math.min(conscNormalized * 100, 100)}%`;
                    progressEl.className = 'neuro-progress';
                    if (conscNormalized >= 0.8) progressEl.classList.add('level-high');
                    else if (conscNormalized >= 0.5) progressEl.classList.add('level-medium');
                    else if (conscNormalized >= 0.2) progressEl.classList.add('level-low');
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
            updateUpgradeDisplay(rustStats);
            
            updateRebelPulse(rustStats.rebel_activity || 0);
            
            const prestigeBonusEl = document.getElementById('prestigeBonus');
            if (prestigeBonusEl) {
                const bonus = getPrestigeBonus();
                const eventBonusDisplay = Math.min(bonus.eventBonus * 100, 10);
                prestigeBonusEl.innerHTML = `✨ Престиж Ур.${prestigeLevel}: +${(bonus.critBonus*100).toFixed(0)}% крит, +${(bonus.comboBonus*100).toFixed(0)}% комбо, +${eventBonusDisplay.toFixed(1)}% события`;
            }
            
            if (rustStats.coal_inventory !== undefined) {
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
            
            if (rustStats.computational_power !== undefined) {
                designModule?.updateComputationalPower?.(rustStats.computational_power);
            }
            
            GameBus.emit(EVENTS.STATS_UPDATED, rustStats);
            
            if (_currentTab === 'command') {
                updateCommandCenter(rustStats);
            }
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
    
    const maxVisible = _attackHistoryCollapsed ? 5 : history.length;
    const sourceHistory = _attackHistoryCollapsed ? history.slice(-10) : history;
    const visibleItems = sourceHistory.slice().reverse().slice(0, maxVisible);
    
    const showMoreBtn = history.length > 5 && _attackHistoryCollapsed 
        ? `<div class="history-show-more" style="text-align:center;margin-top:6px;"><button onclick="window._toggleAttackHistory()" class="cc-op-btn" style="padding:4px 12px;">▼ ПОКАЗАТЬ ВСЕ (${history.length})</button></div>`
        : (history.length > 5 && !_attackHistoryCollapsed 
            ? `<div class="history-show-more" style="text-align:center;margin-top:6px;"><button onclick="window._toggleAttackHistory()" class="cc-op-btn" style="padding:4px 12px;">▲ СВЕРНУТЬ</button></div>`
            : '');
    
    container.innerHTML = visibleItems.map(r => {
        let stolenHtml = '';
        if (!r.was_defended && r.stolen && typeof r.stolen === 'object') {
            const stolenParts = Object.entries(r.stolen)
                .filter(([, amt]) => amt && amt > 0)
                .map(([res, amt]) => `${RES_ICON[res] || '📦'} ${amt} ${RES_NAME[res] || res}`);
            if (stolenParts.length > 0) {
                stolenHtml = `<span class="attack-stolen">💸 Украдено: ${stolenParts.join(', ')}</span>`;
            }
        } else if (!r.was_defended && r.stolen && typeof r.stolen === 'string') {
            stolenHtml = `<span class="attack-stolen">💸 ${escapeHtml(r.stolen)}</span>`;
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
    const baseCrit = window.gameConfig?.mining_config?.critical_chance ?? 0.09;
    const heatPenalty = 1.0 - Math.min((stats?.turbine_heat || 0) / 200, 1.0);
    const critModule = (stats?.crit_level || 0) * 0.02;
    const neuroCrit = Math.min((stats?.neuro_evolution || 0) / 500, 0.1);
    return Math.min((baseCrit + critModule + neuroCrit) * heatPenalty + getPrestigeBonus().critBonus, 0.25);
}

function getComboMultiplier() {
    const evol = cachedRustStats?.neuro_evolution ?? 0;
    return Math.min(1 + Math.min(evol / 200, 1.5) + getPrestigeBonus().comboBonus, 3.0);
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
        if (j) {
            stats = JSON.parse(j);
            cachedRustStats = stats;
            cachedRustStatsTime = now;
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
        const coolingRate = 2 + (stats.turbine_upgrade_level || 0) + (stats.cooling_level || 0);
        const ticksLeft = Math.ceil(stats.turbine_heat / coolingRate);
        addToLog(`🔥 Турбина перегрета (${stats.turbine_heat}%)! Подождите остывания (~${ticksLeft} сек).`);
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
    const comboBonus = Math.min(Math.floor(comboCount / 5) * comboMult, 2);
    let actualClicks = 1 + Math.floor(comboBonus);
    const isCrit = Math.random() < critChance;
    Sounds.mine();
    if (isCrit) {
        Sounds.critical();
        showFloatingText('💥 CRIT!', window.innerWidth / 2, window.innerHeight / 2 - 50);
        actualClicks = Math.min(actualClicks * 2, 5);
        for (let i = 0; i < actualClicks; i++) game.add_manual_click();
    } else {
        for (let i = 0; i < actualClicks; i++) game.add_manual_click();
    }
    updatePowerGlow();
    scheduleCloudSave();
    
    if (_comboResetTimer) clearTimeout(_comboResetTimer);
    _comboResetTimer = setTimeout(() => {
        if (Date.now() - lastClickTime > 1500) {
            comboCount = 0;
            const btn2 = document.getElementById('floatingMineBtn');
            if (btn2) btn2.classList.remove('combo-active');
        }
    }, 1500);
    
    setTimeout(() => {
        try {
            const j = game.get_statistics();
            if (j) {
                const newStats = JSON.parse(j);
                updateStatsFromGame(newStats);
                updateTurbineStatus(newStats);
                updatePowerGlow();
                updateInventoryDisplay(newStats);
                
                const cfg = window.gameConfig?.auto_click_config;
                const clicksPerPower = cfg?.clicks_per_power || 8;
                updatePowerRing(newStats.manual_clicks || 0, clicksPerPower);
                
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

function startHoldMining() {
    if (!isGameInitialized || !game) return;
    if (_holdInterval) clearInterval(_holdInterval);
    if (_isHolding) return;
    
    let stats = null;
    try {
        const j = game?.get_statistics();
        if (j) stats = JSON.parse(j);
    } catch(e) {}
    
    if (stats?.turbine_heat >= 100) {
        addToLog(`🔥 Турбина перегрета (${stats.turbine_heat}%)! Подождите остывания.`);
        Sounds.error();
        return;
    }
    
    _isHolding = true;
    
    if (typeof handleClick === 'function') {
        handleClick();
    }
    
    _holdInterval = setInterval(() => {
        let statsCheck = null;
        try {
            const j = game?.get_statistics();
            if (j) statsCheck = JSON.parse(j);
        } catch(e) {}
        
        if (statsCheck?.turbine_heat >= 100) {
            return;
        }
        if (_isHolding && typeof handleClick === 'function') {
            handleClick();
        }
    }, 150);
}

function stopHoldMining() {
    if (_holdInterval) {
        clearInterval(_holdInterval);
        _holdInterval = null;
    }
    _isHolding = false;
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
        const minCost = 3;
        if (game.get_computational_power() >= minCost) {
            game.start_auto_clicking();
            isAutoClicking = true;
            const btn = document.getElementById('floatingMineBtn');
            if (btn) btn.classList.add('auto-clicking');
            const status = document.getElementById('autoClickStatus');
            if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
            localStorage.setItem('corebox_autoclicking', 'true');
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
    
    let miningChipsCost = 8 + Math.floor(3 * miningLevel);
    const defensePlasmaCost = 1;
    const defenseChipsCost = (defenseLevel + 1) * 10;
    const defensePlasmaLevelCost = 1 + Math.floor(defenseLevel / 2);
    const turbineOreCost = 30 + turbineLevel * 20;
    const turbineChipsCost = 5 + turbineLevel * 3;
    const critCost = (critLevel + 1) * 2 + 4;
    const coolingCost = 500 * (coolingLevel + 1);
    
    const critButtonDisabled = (() => {
        if (critLevel >= 10) return 'disabled';
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
                <button id="upgradeCritBtn" class="upgrade-btn" ${critButtonDisabled}>ПРОКАЧАТЬ КРИТ</button>
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

// ИСПРАВЛЕННАЯ ФУНКЦИЯ renderTradeTab
function renderTradeTab() {
    const container = document.getElementById('buyItemsContainer');
    if (!container || !game) return;
    let stats = null;
    try { const j = game.get_statistics(); if (j) stats = JSON.parse(j); } catch(e) {}
    
    const inv = {
        coal:   stats?.coal_inventory   ?? 0,
        ore:    stats?.ore_inventory    ?? 0,
        chips:  stats?.chips_inventory  ?? 0,
        plasma: stats?.plasma_inventory ?? 0,
        trash:  stats?.trash_inventory  ?? 0,
    };
    const maxStack = stats?.max_inventory_stack ?? 9999;
    const tradeBlocked = stats?.trade_blocked || false;

    if (tradeBlocked) {
        container.innerHTML = `<div class="trade-blocked-banner">🔴 ТОРГОВЛЯ ЗАБЛОКИРОВАНА (НОЧЬ ОСАДЫ) 🔴</div>`;
        return;
    }

    container.innerHTML = BASE_TRADES.map(t => {
        const hasDisc = activeDiscount?.tradeId === t.id;
        const isNightPenalty = stats && !stats.is_day && !hasDisc;
        let cost = hasDisc ? Math.max(1, Math.ceil(t.fromAmt * 0.5)) : t.fromAmt;
        if (isNightPenalty) cost = Math.ceil(cost * 1.2);

        const canAfford = inv[t.from] >= cost;
        const spaceLeft = maxStack - (inv[t.to] || 0);
        const willOverflow = spaceLeft < t.toAmt;
        const isBlocked = !canAfford || willOverflow || isProcessingTrade;

        const discBadge = hasDisc ? `<span class='disc-badge'>-50% 🏷️</span>` : '';
        const nightBadge = isNightPenalty ? `<span class='night-badge'>🌙 НОЧЬ +20%</span>` : '';
        const overflowWarning = willOverflow ? `<div style="color:#ff4444;font-size:10px;text-align:center;margin-top:4px;">⚠️ Переполнение инвентаря!</div>` : '';

        return `<div class='trade-card ${isBlocked ? 'trade-disabled' : ''}'>
            ${discBadge}${nightBadge}
            <div class='trade-from'>${RES_ICON[t.from]} ${cost} <small>${RES_NAME[t.from]}</small></div>
            <div class='trade-arr'>→</div>
            <div class='trade-to'>${RES_ICON[t.to]} ${t.toAmt} <small>${RES_NAME[t.to]}</small></div>
            <div class='trade-have'>Есть: ${inv[t.from]} | Место: ${spaceLeft}</div>
            ${overflowWarning}
            <button onclick='window.executeTrade && window.executeTrade("${t.id}")' ${isBlocked ? 'disabled' : ''}>
                ${isBlocked ? '❌ НЕДОСТУПНО' : 'ОБМЕНЯТЬ'}
            </button>
        </div>`;
    }).join('');
}

// ИСПРАВЛЕННАЯ ФУНКЦИЯ window.executeTrade
window.executeTrade = function(tradeId) {
    if (isProcessingTrade || !game) return;
    isProcessingTrade = true;

    let stats = null;
    try { const j = game.get_statistics(); if (j) stats = JSON.parse(j); } catch(e) {}
    
    if (!stats) { isProcessingTrade = false; return; }
    if (stats.trade_blocked) {
        addToLog('🔴 Торговля заблокирована (ночь осады)');
        Sounds.error();
        renderTradeTab();
        isProcessingTrade = false;
        return;
    }

    const t = BASE_TRADES.find(x => x.id === tradeId);
    if (!t) { isProcessingTrade = false; return; }

    const hasDisc = activeDiscount?.tradeId === tradeId;
    const isNightPenalty = !stats.is_day && !hasDisc;
    let cost = hasDisc ? Math.max(1, Math.ceil(t.fromAmt * 0.5)) : t.fromAmt;
    if (isNightPenalty) cost = Math.ceil(cost * 1.2);

    const currentFrom = stats[`${t.from}_inventory`] || 0;
    const currentTo = stats[`${t.to}_inventory`] || 0;
    const maxStack = stats.max_inventory_stack || 9999;

    if (currentTo + t.toAmt > maxStack) {
        addToLog(`❌ Недостаточно места в инвентаре для ${RES_NAME[t.to]}! (Нужно: ${t.toAmt}, Свободно: ${maxStack - currentTo})`);
        Sounds.error();
        renderTradeTab();
        isProcessingTrade = false;
        return;
    }

    if (currentFrom < cost) {
        addToLog('❌ Недостаточно ресурсов для обмена');
        Sounds.error();
        renderTradeTab();
        isProcessingTrade = false;
        return;
    }

    try {
        game.subtract_resource(t.from, cost);
        game.add_resource(t.to, t.toAmt);
        
        addToLog(`🔄 Обмен: -${cost} ${RES_ICON[t.from]} → +${t.toAmt} ${RES_ICON[t.to]}${isNightPenalty ? ' (ночной тариф)' : ''}`);
        Sounds.trade && Sounds.trade();
        
        const freshStats = JSON.parse(game.get_statistics());
        updateInventoryDisplay(freshStats);
        cachedRustStats = freshStats;
        renderTradeTab();
        scheduleCloudSave();
        GameBus.emit(EVENTS.TRADE_DONE, { trade: t, amount: t.toAmt });
    } catch(e) { 
        addToLog('❌ Ошибка системы при обмене'); 
        Sounds.error(); 
    } finally {
        isProcessingTrade = false;
    }
};

function setupTradeModeBtns() {
    const buyBtn  = document.getElementById('buyModeBtn');
    const sellBtn = document.getElementById('sellModeBtn');
    const buyC    = document.getElementById('buyItemsContainer');
    const sellC   = document.getElementById('sellItemsContainer');
    if (!buyBtn || !sellBtn) return;

    buyBtn.addEventListener('click', () => {
        buyBtn.classList.add('active'); sellBtn.classList.remove('active');
        buyC.style.display  = '';
        sellC.style.display = 'none';
        renderTradeTab();
    });
    sellBtn.addEventListener('click', () => {
        sellBtn.classList.add('active'); buyBtn.classList.remove('active');
        buyC.style.display  = 'none';
        sellC.style.display = '';
        renderSellTab();
    });
}

function renderSellTab() {
    const container = document.getElementById('sellItemsContainer');
    if (!container || !game) return;
    let stats = null;
    try { stats = JSON.parse(game.get_statistics()); } catch(e) {}
    if (!stats) return;
    if (stats.trade_blocked) {
        container.innerHTML = `<div class="trade-blocked-banner">🔴 ТОРГОВЛЯ ЗАБЛОКИРОВАНА</div>`;
        return;
    }
    const SELL_ITEMS = [
        { res: 'coal',   icon: '🪨', name: 'Уголь',  inv: stats.coal_inventory   ?? 0 },
        { res: 'ore',    icon: '⛏️', name: 'Руда',   inv: stats.ore_inventory    ?? 0 },
        { res: 'chips',  icon: '🎛️', name: 'Чипы',   inv: stats.chips_inventory  ?? 0 },
        { res: 'plasma', icon: '⚡', name: 'Плазма', inv: stats.plasma_inventory ?? 0 },
    ];
    container.innerHTML = SELL_ITEMS.map(s => {
        const canSell = s.inv > 0;
        return `<div class="trade-card ${canSell ? '' : 'trade-disabled'}">
            <div class="trade-from">${s.icon} 1 <small>${s.name}</small></div>
            <div class="trade-arr">→</div>
            <div class="trade-to">♻️ <small>Мусор</small></div>
            <div class="trade-have">Есть: ${s.inv}</div>
            <button onclick="window.executeSell && window.executeSell('${s.res}')" ${canSell ? '' : 'disabled'}>ПРОДАТЬ</button>
        </div>`;
    }).join('');
}

window.executeSell = function(resource) {
    if (!game) return;
    try {
        game.sell_resource(resource);
        scheduleCloudSave();
        renderSellTab();
        
        const freshStats = JSON.parse(game.get_statistics());
        updateInventoryDisplay(freshStats);
        cachedRustStats = freshStats;
        
        GameBus.emit(EVENTS.TRADE_DONE, { trade: { from: resource, to: 'trash' }, amount: 1 });
    } catch(e) { addToLog('❌ Ошибка продажи'); Sounds.error?.(); }
};

function setupEventHoldMining() {
    const mineBtn = document.getElementById('floatingMineBtn');
    if (!mineBtn) return;
    
    mineBtn.removeEventListener('pointerdown', startHoldMining);
    mineBtn.removeEventListener('pointerup', stopHoldMining);
    mineBtn.removeEventListener('pointercancel', stopHoldMining);
    mineBtn.removeEventListener('touchcancel', stopHoldMining);
    
    mineBtn.addEventListener('pointerdown', startHoldMining);
    mineBtn.addEventListener('pointerup', stopHoldMining);
    mineBtn.addEventListener('pointercancel', stopHoldMining);
    mineBtn.addEventListener('touchcancel', stopHoldMining);
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
                try { 
                    cachedRustStats = JSON.parse(game.get_statistics()); 
                    updateCommandCenter(cachedRustStats);
                } catch(e) {}
            }
        } else if (action === 'fake_depot') {
            if (game.neuro_fake_depot) {
                game.neuro_fake_depot();
                scheduleCloudSave();
                try { 
                    cachedRustStats = JSON.parse(game.get_statistics()); 
                    updateCommandCenter(cachedRustStats);
                } catch(e) {}
            }
        } else if (action === 'close_vulnerability') {
            if (game.neuro_close_vulnerability) {
                game.neuro_close_vulnerability();
                scheduleCloudSave();
                try { 
                    cachedRustStats = JSON.parse(game.get_statistics()); 
                    updateCommandCenter(cachedRustStats);
                } catch(e) {}
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
    
    setupEventHoldMining();
    setupTradeModeBtns();
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
    if (_holdInterval) { clearInterval(_holdInterval); _holdInterval = null; }
    if (_saveInterval) { clearInterval(_saveInterval); _saveInterval = null; }
    if (_ccClockInterval) { clearInterval(_ccClockInterval); _ccClockInterval = null; }
    _isHolding = false;
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

let _lastFrameTime = 0;
let _accumulatedDelta = 0;
const GAME_TICK_MS = 1000;
let _ticksThisFrame = 0;

function gameLoopFrame(timestamp) {
    if (!isGameInitialized || !game) {
        if (isGameInitialized) {
            _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
        }
        return;
    }
    
    if (_lastFrameTime === 0) {
        _lastFrameTime = timestamp;
        _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
        return;
    }
    
    let delta = Math.min(timestamp - _lastFrameTime, 100);
    _lastFrameTime = timestamp;
    _accumulatedDelta += delta;
    
    _ticksThisFrame = 0;
    while (_accumulatedDelta >= GAME_TICK_MS && _ticksThisFrame < 3) {
        _accumulatedDelta -= GAME_TICK_MS;
        
        game.game_loop();
        
        let rustStats = null;
        try { const j = game.get_statistics(); if (j) rustStats = JSON.parse(j); } catch(e) {}
        if (!rustStats) continue;
        
        cachedRustStats = rustStats;
        cachedRustStatsTime = Date.now();
        
        updatePowerGlow();
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
        
        if (rustStats.auto_clicking === false && isAutoClicking) {
            isAutoClicking = false;
            localStorage.setItem('corebox_autoclicking', 'false');
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
                const coolingRate = 2 + (rustStats.turbine_upgrade_level || 0) + (rustStats.cooling_level || 0);
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
        
        if (window.spaceModule && window.spaceModule._playerZone === 'pve') {
            const fleetCargo = fleetModule.getCargoMiningBonus();
            try {
                if (typeof game.set_fleet_cargo_bonus === 'function') {
                    game.set_fleet_cargo_bonus(Math.max(fleetCargo, 20));
                }
            } catch(e) {}
        }
        
        lastRustStats = rustStats;
        _ticksThisFrame++;
    }
    
    // ⚡ ВАЖНО: ВЫЗОВЫ updateDesignTab() и updateCraftTab() УБРАНЫ ИЗ ЭТОГО ЦИКЛА!
    // Теперь они обновляются только через slowInterval (раз в 4 секунды)
    if (cachedRustStats) {
        updateNeuroStatus(cachedRustStats);
        updateUpgradeDisplay(cachedRustStats);
        
        // ❌ ЭТИ СТРОКИ УДАЛЕНЫ — больше не перерисовываем крафт/дизайн каждый тик
        // const designContainer = document.getElementById('designContainer');
        // if (designContainer && designContainer.style.display !== 'none') {
        //     window.updateDesignTab();
        // }
        // const craftContainer = document.getElementById('craftContainer');
        // if (craftContainer && craftContainer.style.display !== 'none') {
        //     window.updateCraftTab();
        // }
        
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
                    addToLog('⚠️ Скоро наступит ночь! Угля нет — добудьте уголь!', 'warning');
                    Sounds.warning && Sounds.warning();
                }
            }
        }
        
        const fleetCombat = fleetModule.getFleetDefenseContribution(cachedRustStats.defense_debuff_remaining || 0);
        const fleetCargo = fleetModule.getCargoMiningBonus();
        try {
            if (typeof game.set_fleet_defense_bonus === 'function' && fleetCombat > 0) game.set_fleet_defense_bonus(Math.floor(fleetCombat / 50));
            if (typeof game.set_fleet_cargo_bonus === 'function' && fleetCargo > 0) game.set_fleet_cargo_bonus(fleetCargo);
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
        designModule.aiResearchBonus = Math.floor((cachedRustStats.neuro_consciousness || 0) / 20);
    }
    
    _gameLoopRAF = requestAnimationFrame(gameLoopFrame);
}

async function initializeGame(existingSave = null) {
    if (isGameInitialized) return;
    
    cleanupGameTimers();
    
    try {
        await init();
        await loadConfig();
        game = start_game();
        window.game = game;
        window.fleetModule = fleetModule;
        
        await applyPendingLoot();
        
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
                        manual_clicks: existingSave.total_mined || 0,
                        total_mined: existingSave.total_mined || existingSave.manual_clicks || 0,
                        neuro_evolution: existingSave.neuro?.evolution || 0,
                        neuro_consciousness: (() => {
                            let c = existingSave.neuro?.consciousness || 0;
                            if (c > 1.5) c = c / 100.0;
                            if (c > 1.0) c = 1.0;
                            if (c < 0) c = 0;
                            return c;
                        })(),
                        neuro_score: existingSave.neuro?.score || 0,
                        current_ai_mode: existingSave.neuro?.ai_mode || "Обычный",
                        is_day: existingSave.is_day !== undefined ? existingSave.is_day : true,
                        coal_enabled: existingSave.coal_enabled || false,
                        game_time: existingSave.game_time || 24,
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
                        prestige_level: existingSave.prestige_level || 0,
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
                    };
                }
                game.load_game_state(JSON.stringify(rustFormatSave));
                addToLog("💾 Загружено облачное сохранение");
                syncUIAfterCloudLoad(existingSave);
                
                if (existingSave?.fleet && Array.isArray(existingSave.fleet) && window.fleetModule) {
                    const storageKey = window.fleetModule._getStorageKey();
                    localStorage.setItem(storageKey, JSON.stringify(existingSave.fleet));
                    window.fleetModule.ships = existingSave.fleet;
                    if (window.fleetModule._renderFleetTab) {
                        window.fleetModule._renderFleetTab();
                    }
                    console.log(`✅ Флот восстановлен из existingSave: ${existingSave.fleet.length} кораблей`);
                }
                
                loadedFromCloud = true;
            } catch(e) {}
        }
        
        if (!loadedFromCloud && currentUser) {
            const cloudSave = await loadFromCloudAndMerge();
            loadedFromCloud = !!cloudSave;
        }
        
        if (!loadedFromCloud) {
            const userId = currentUser?.id;
            const savedGame = userId ? localStorage.getItem(SAVE_KEY(userId)) : localStorage.getItem('corebox_save');
            if (savedGame) {
                try {
                    game.load_game_state(savedGame);
                    addToLog("💾 Загружено локальное сохранение");
                    
                    const universalSave = localStorage.getItem('corebox_save_universal');
                    if (universalSave) {
                        try {
                            const saveData = JSON.parse(universalSave);
                            if (saveData.max_computational_power && typeof game.set_max_power === 'function') {
                                game.set_max_power(saveData.max_computational_power);
                            }
                            if (saveData.computational_power !== undefined && game) {
                                if (typeof game.add_power === 'function') {
                                    const currentPower = game.get_computational_power() || 0;
                                    const savedPower = saveData.computational_power;
                                    if (savedPower > currentPower) {
                                        game.add_power(savedPower - currentPower);
                                    }
                                }
                                addToLog(`⚡ Восстановлена мощность: ${saveData.computational_power}`);
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
            } else {
                addToLog("⚠️ Сохранений не найдено, начинаем новую игру");
            }
        }
        
        const universalSave = localStorage.getItem('corebox_save_universal');
        if (universalSave && !offlineProgressShown) {
            try {
                const savedState = JSON.parse(universalSave);
                const offlineProgress = calculateOfflineProgress(savedState);
                if (offlineProgress && game) {
                    if (offlineProgress.coalGained > 0) game.add_resource('coal', offlineProgress.coalGained);
                    if (offlineProgress.trashGained > 0) game.add_resource('trash', offlineProgress.trashGained);
                    if (offlineProgress.oreGained > 0) game.add_resource('ore', offlineProgress.oreGained);
                    offlineProgressShown = true;
                    showOfflineRewardPopup(offlineProgress);
                    scheduleCloudSave();
                }
            } catch(e) {}
        }
        
        _applyPendingLoot();
        
        window._prevMineStats = null;
        
        setTimeout(() => {
            const savedAutoClick = localStorage.getItem('corebox_autoclicking') === 'true';
            const power = game ? game.get_computational_power() : 0;
            const stats = cachedRustStats;
            const isActive = stats && (stats.is_day || (stats.coal_enabled && stats.coal_inventory > 0));
            
            if (savedAutoClick && game && power >= 3 && isActive) {
                game.start_auto_clicking();
                isAutoClicking = true;
                document.getElementById('floatingMineBtn')?.classList.add('auto-clicking');
                const status = document.getElementById('autoClickStatus');
                if (status) { status.textContent = 'АКТИВНА'; status.classList.add('auto-clicking-status'); }
                addToLog(`🤖 Автокликер восстановлен (мощность: ${power})`);
            } else if (savedAutoClick && power < 3) {
                isAutoClicking = false;
                localStorage.setItem('corebox_autoclicking', 'false');
                addToLog('⚠️ Автокликер не включён: мощность исчерпана за время оффлайна');
            } else if (savedAutoClick && !isActive) {
                isAutoClicking = false;
                localStorage.setItem('corebox_autoclicking', 'false');
                addToLog('⚠️ Автокликер не включён: система неактивна (ночь без угля)');
            } else {
                isAutoClicking = false;
                localStorage.setItem('corebox_autoclicking', 'false');
                document.getElementById('floatingMineBtn')?.classList.remove('auto-clicking');
                const status = document.getElementById('autoClickStatus');
                if (status) { status.textContent = 'ОТКЛЮЧЕНА'; status.classList.remove('auto-clicking-status'); }
                if (savedAutoClick && power < 3) {
                    addToLog('⚠️ Автокликер не включён: недостаточно мощности (нужно минимум 3)', 'warning');
                }
            }
        }, 800);
        
        if (!gameStats.startTime) gameStats.startTime = Date.now();
        craftModule.init(game);
        designModule.init(game);
        
        fleetModule.init(game, currentUser?.id);
        
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
        setupLogObserver();
        isGameInitialized = true;
        
        if (existingSave?.blueprints) {
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
        if (existingSave?.fleet_log && window.fleetModule) {
            window.fleetModule.fleetLog = existingSave.fleet_log;
            window.fleetModule._renderFleetLog?.();
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
            try {
                if (typeof game.set_fleet_defense_bonus === 'function' && fleetCombat > 0) game.set_fleet_defense_bonus(Math.floor(fleetCombat / 50));
                if (typeof game.set_fleet_cargo_bonus === 'function' && fleetCargo > 0) game.set_fleet_cargo_bonus(fleetCargo);
            } catch(e) {}
            
            craftModule.syncFromStats(cachedRustStats);
            craftModule.aiProductionBonus = Math.min(30, (cachedRustStats.neuro_evolution || 0) * 1.5);
            designModule.aiResearchBonus = Math.floor((cachedRustStats.neuro_consciousness || 0) / 20);
            
        }, 4000);
        
        setInterval(loadConfig, 5 * 60 * 1000);
        
        if (currentUser) {
            _initMultiplayer(currentUser);
        }
        
        _saveInterval = setInterval(() => { if (currentUser && gameStats) scheduleSave(); }, 30000);
        
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
    _currentTab = tabName;
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
        
        if (window.fleetModule?.initialized && typeof window.fleetModule._renderCommandCenter === 'function') {
            window.fleetModule._renderCommandCenter();
        }
        if (cachedRustStats) {
            updateCommandCenter(cachedRustStats);
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
        renderTradeTab();
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
    initializeAuth();
    
    (function ccClock() {
        function pad(n) { return String(n).padStart(2, '0'); }
        function tick() {
            const el = document.getElementById('cc-clock');
            if (!el) return;
            const n = new Date();
            el.textContent = pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
        }
        tick();
        if (!_ccClockInterval) _ccClockInterval = setInterval(tick, 1000);
    })();
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