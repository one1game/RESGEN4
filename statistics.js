import { normalizeNeuroConsciousness } from './utils.js';

export let gameStats = {
    totalClicks: 0, maxPowerReached: 0, nightsSurvived: 0, rebelAttacks: 0,
    attacksDefended: 0, coalMined: 0, trashMined: 0, plasmaMined: 0,
    oreMined: 0, coalBurned: 0, coalStolen: 0, playTime: 0,
    startTime: Date.now(), sessionsCount: 1, lastSessionDate: new Date().toISOString(),
    oreStolenTotal: 0, totalMined: 0, rebelActivity: 0, visibility: 0,
    neuroEvolution: 0, neuroConsciousness: 0, neuroScore: 0,
    fleetShips: 0, fleetCombatPower: 0, blueprintsUnlocked: 0,
    miningLevel: 0, defenseLevel: 0, defenseActive: false,
    computationalPower: 0, currentAiMode: 'Обычный',
    consecutiveDefenses: 0, longestDefenseStreak: 0,

    accumulatedPlayTime: 0,
    _sessionCounted: false,
};

let _statisticsLoadedOnce = false;
let _statsDisplayTimer = null;
let _sessionSnapshot = null;

export function scheduleStatsDisplayUpdate() {
    if (_statsDisplayTimer) return;
    _statsDisplayTimer = setTimeout(() => {
        updateStatisticsDisplay();
        _statsDisplayTimer = null;
    }, 500);
}

function sanitizeStats(stats) {
    if (!stats || typeof stats !== 'object') return stats;
    const MAX_SAFE = 1e9;

    const result = { ...stats };
    Object.keys(result).forEach(key => {
        const val = result[key];
        if (typeof val === 'number') {
            if (!Number.isFinite(val) || val < 0) result[key] = 0;
            else if (val > MAX_SAFE) result[key] = MAX_SAFE;
        }
    });
    return result;
}

export function initStatistics() {
    setupStatisticsEventListeners();
    startPlayTimeTracker();
    takeSessionSnapshot();
}

export function takeSessionSnapshot() {
    _sessionSnapshot = { ...gameStats };
    sessionStorage.setItem('corebox_session_snapshot', JSON.stringify(_sessionSnapshot));
}

function getDelta(key) {
    if (!_sessionSnapshot) {
        const saved = sessionStorage.getItem('corebox_session_snapshot');
        if (saved) _sessionSnapshot = JSON.parse(saved);
    }
    if (!_sessionSnapshot) return 0;
    const current = gameStats[key] || 0;
    const previous = _sessionSnapshot[key] || 0;
    return Math.max(0, current - previous);
}

function renderDelta(key) {
    const delta = getDelta(key);
    if (delta > 0) {
        return ` (+${delta})`;
    }
    return '';
}

export function loadUserStatistics(userStats) {
    if (!userStats || typeof userStats !== 'object') {
        console.warn('loadUserStatistics: невалидные данные');
        return;
    }
    userStats = sanitizeStats(userStats);

    if (_statisticsLoadedOnce) {
        Object.keys(userStats).forEach(key => {
            if (key in gameStats && typeof userStats[key] === 'number') {
                gameStats[key] = userStats[key];
            }
        });
        updateStatisticsDisplay();
        return;
    }
    _statisticsLoadedOnce = true;

    const sessionCountedKey = 'corebox_session_counted';
    const sessionAlreadyCounted = sessionStorage.getItem(sessionCountedKey) === 'true';
    if (!gameStats._sessionCounted && !sessionAlreadyCounted) {
        gameStats.sessionsCount = (userStats.sessionsCount || 0) + 1;
        gameStats._sessionCounted = true;
        sessionStorage.setItem(sessionCountedKey, 'true');
        console.log(`📊 Сессия #${gameStats.sessionsCount} засчитана`);
    } else {

        gameStats.sessionsCount = userStats.sessionsCount || gameStats.sessionsCount || 1;
    }

    gameStats.lastSessionDate = new Date().toISOString();

    if (!gameStats.startTime || gameStats._sessionCounted) {
        gameStats.startTime = Date.now();
    }

    gameStats.accumulatedPlayTime = userStats.playTime || 0;

    Object.keys(gameStats).forEach(key => {
        if (key in userStats && !['startTime', '_sessionCounted', 'accumulatedPlayTime'].includes(key)) {
            gameStats[key] = userStats[key];
        }
    });

    updateStatisticsDisplay();
}

function showConfirmDialog(message, onConfirm, onCancel) {
    const existing = document.querySelector('.custom-confirm-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'custom-confirm-dialog';
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
        font-family: monospace;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: #1a1a1a;
        border: 2px solid #ffaa44;
        border-radius: 16px;
        padding: 24px;
        max-width: 320px;
        text-align: center;
    `;
    content.innerHTML = `
        <div style="font-size: 18px; margin-bottom: 16px;">⚠️ ${message}</div>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="confirm-yes" style="background: #ff4444; border: none; padding: 8px 20px; border-radius: 8px; color: white; cursor: pointer;">ДА</button>
            <button id="confirm-no" style="background: #444444; border: none; padding: 8px 20px; border-radius: 8px; color: white; cursor: pointer;">НЕТ</button>
        </div>
    `;

    dialog.appendChild(content);
    document.body.appendChild(dialog);

    const onYes = () => {
        dialog.remove();
        if (onConfirm) onConfirm();
    };
    const onNo = () => {
        dialog.remove();
        if (onCancel) onCancel();
    };

    document.getElementById('confirm-yes').onclick = onYes;
    document.getElementById('confirm-no').onclick = onNo;
}

export function resetUserStatistics() {
    return new Promise((resolve) => {
        showConfirmDialog('Сбросить статистику?', () => {
            const preserved = {
                sessionsCount: gameStats.sessionsCount,
                accumulatedPlayTime: gameStats.accumulatedPlayTime,
                _sessionCounted: true
            };
            Object.keys(gameStats).forEach(k => {
                if (typeof gameStats[k] === 'number') gameStats[k] = 0;
                else if (typeof gameStats[k] === 'boolean') gameStats[k] = false;
                else if (typeof gameStats[k] === 'string') gameStats[k] = '';
            });
            gameStats.sessionsCount = preserved.sessionsCount;
            gameStats.accumulatedPlayTime = preserved.accumulatedPlayTime;
            gameStats._sessionCounted = true;
            gameStats.startTime = Date.now();
            gameStats.lastSessionDate = new Date().toISOString();
            gameStats.currentAiMode = 'Обычный';

            startPlayTimeTracker();

            updateStatisticsDisplay();

            document.dispatchEvent(new CustomEvent('resetUserStats', { detail: { stats: gameStats } }));

            if (window.cloudSaveNow) {
                window.cloudSaveNow(true).catch(e => console.warn('Cloud save after reset failed:', e));
            }
            if (window.saveCurrentUserStatistics) {
                window.saveCurrentUserStatistics();
            }
            resolve(true);
        }, () => {
            resolve(false);
        });
    });
}

export function updateStatisticsFromRust(rustStats) {
    if (!rustStats) return;

    const safeNum = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

    gameStats.totalMined = safeNum(rustStats.total_mined,
        (gameStats.coalMined || 0) + (gameStats.trashMined || 0) +
        (gameStats.plasmaMined || 0) + (gameStats.oreMined || 0)
    );

    gameStats.coalMined = Math.max(gameStats.coalMined || 0, safeNum(rustStats.total_coal_mined));
    gameStats.trashMined = Math.max(gameStats.trashMined || 0, safeNum(rustStats.total_trash_mined));
    gameStats.plasmaMined = Math.max(gameStats.plasmaMined || 0, safeNum(rustStats.total_plasma_mined));
    gameStats.oreMined = Math.max(gameStats.oreMined || 0, safeNum(rustStats.total_ore_mined));
    gameStats.coalBurned = safeNum(rustStats.total_coal_burned, gameStats.coalBurned);
    gameStats.coalStolen = safeNum(rustStats.total_coal_stolen, gameStats.coalStolen);

    gameStats.nightsSurvived = safeNum(rustStats.nights_survived, gameStats.nightsSurvived);
    gameStats.rebelAttacks = safeNum(rustStats.rebel_attacks_count, gameStats.rebelAttacks);
    gameStats.attacksDefended = safeNum(rustStats.attacks_defended, gameStats.attacksDefended);

    const rebelAct = safeNum(rustStats.rebel_activity, 0);
    const miningLvl = safeNum(rustStats.upgrades?.mining, 0);
    const fleetShips = window.fleetModule?.ships?.length || 0;
    gameStats.visibility = Math.min(100, Math.round(rebelAct * 5 + miningLvl * 2 + fleetShips * 1.5));

    gameStats.rebelActivity = rebelAct;
    gameStats.computationalPower = safeNum(rustStats.computational_power);
    gameStats.currentAiMode = (rustStats.current_ai_mode || 'Обычный').trim() || 'Обычный';

    gameStats.neuroEvolution = safeNum(rustStats.neuro_evolution);
    let nc = safeNum(rustStats.neuro_consciousness);
    nc = normalizeNeuroConsciousness(nc);
    gameStats.neuroConsciousness = nc;
    gameStats.neuroScore = safeNum(rustStats.neuro_score);

    gameStats.miningLevel = safeNum(rustStats.upgrades?.mining);
    gameStats.defenseLevel = safeNum(rustStats.upgrades?.defense_level);
    gameStats.defenseActive = rustStats.upgrades?.defense === true;

    gameStats.consecutiveDefenses = safeNum(rustStats.consecutive_successful_defenses,
        gameStats.attacksDefended > 0 ? gameStats.attacksDefended : 0);
    gameStats.longestDefenseStreak = safeNum(rustStats.longest_defense_streak,
        gameStats.consecutiveDefenses);

    const bp = [
        rustStats.blueprint_cargo_unlocked === true,
        rustStats.blueprint_scout_unlocked === true,
        rustStats.blueprint_combat_unlocked === true
    ];
    gameStats.blueprintsUnlocked = bp.filter(Boolean).length;

    updateStatisticsDisplay();
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0 сек';
    seconds = Math.floor(seconds);
    if (seconds < 60) return `${seconds} сек`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${Math.floor(seconds % 60)} сек`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
    return `${Math.floor(seconds / 86400)} дн ${Math.floor((seconds % 86400) / 3600)} ч`;
}

function setDelta(id, delta) {
    const el = document.getElementById(id + 'Delta');
    if (!el) return;
    if (delta > 0) {
        el.textContent = `(+${delta})`;
        el.style.display = 'inline';
        el.style.color = '#4caf50';
    } else {
        el.style.display = 'none';
    }
}

export function updateStatisticsDisplay() {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = val;
    };

    set('totalClicks', (gameStats.totalClicks || 0).toLocaleString());
    set('maxPowerReached', gameStats.maxPowerReached || 0);
    set('nightsSurvived', gameStats.nightsSurvived || 0);
    set('totalMined', (gameStats.totalMined || 0).toLocaleString());
    set('rebelAttacks', gameStats.rebelAttacks || 0);
    set('attacksDefended', gameStats.attacksDefended || 0);
    set('rebelActivity', gameStats.rebelActivity || 0);
    set('visibility', (gameStats.visibility || 0) + '%');
    set('consecutiveDefenses', gameStats.consecutiveDefenses || 0);
    set('longestDefenseStreak', gameStats.longestDefenseStreak || 0);

    const fieldsWithDelta = ['coalMined', 'trashMined', 'plasmaMined', 'oreMined', 'coalBurned', 'coalStolen'];
    fieldsWithDelta.forEach(field => {
        const value = (gameStats[field] || 0).toLocaleString();
        set(field, value);
        const delta = getDelta(field);
        setDelta(field, delta);
    });

    const totalMinedDelta = getDelta('totalMined');
    setDelta('totalMined', totalMinedDelta);

    set('playTime', formatTime(gameStats.playTime || 0));
    set('computationalPower', gameStats.computationalPower || 0);
    set('currentAiMode', gameStats.currentAiMode || 'Обычный');
    set('miningLevel', gameStats.miningLevel || 0);
    set('defenseLevel', gameStats.defenseLevel || 0);
    set('defenseActive', gameStats.defenseActive ? '✅ Активна' : '❌ Неактивна');
    set('blueprintsUnlocked', (gameStats.blueprintsUnlocked || 0) + '/3');
    set('neuroEvolution', gameStats.neuroEvolution || 0);
    set('neuroConsciousness', ((gameStats.neuroConsciousness || 0) * 100).toFixed(1) + '%');
    set('neuroScore', gameStats.neuroScore || 0);
    set('sessionsCount', gameStats.sessionsCount || 1);
    set('lastSessionDate', gameStats.lastSessionDate ? new Date(gameStats.lastSessionDate).toLocaleString('ru') : '—');

    try {
        const fm = window.fleetModule;
        if (fm && Array.isArray(fm.ships)) {
            set('fleetShips', fm.ships.length + '/' + (fm.maxFleetSize || 20));
            set('fleetCombatPower', typeof fm.getTotalCombatPower === 'function' ? fm.getTotalCombatPower() : 0);
        } else {
            const fleetKey = window.currentUser?.id ? `corebox_fleet_${window.currentUser.id}` : 'corebox_fleet';
            try {
                const fleet = JSON.parse(localStorage.getItem(fleetKey) || '[]');
                set('fleetShips', fleet.length + '/20');
            } catch (e) {
                set('fleetShips', '0/20');
            }
            set('fleetCombatPower', 0);
        }
    } catch (e) {
        console.warn('Ошибка обновления статистики флота:', e);
    }
}

let playTimeInterval;
function startPlayTimeTracker() {
    if (playTimeInterval) clearInterval(playTimeInterval);
    playTimeInterval = setInterval(() => {
        const sessionSeconds = Math.floor((Date.now() - gameStats.startTime) / 1000);
        gameStats.playTime = gameStats.accumulatedPlayTime + sessionSeconds;
    }, 1000);
}

function setupStatisticsEventListeners() {
    const refreshBtn = document.getElementById('refreshStatsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => updateStatisticsDisplay());
}

export function switchTab(tabName) {
    const systemSection = document.getElementById('system-status-section');
    const statisticsSection = document.getElementById('statistics-section');
    const systemTab = document.getElementById('system-status-tab');
    const statisticsTab = document.getElementById('statistics-tab');
    if (!systemSection || !statisticsSection) return;
    if (tabName === 'system') {
        systemSection.style.display = 'block';
        statisticsSection.style.display = 'none';
        systemTab?.classList.add('active');
        statisticsTab?.classList.remove('active');
    } else {
        systemSection.style.display = 'none';
        statisticsSection.style.display = 'block';
        systemTab?.classList.remove('active');
        statisticsTab?.classList.add('active');
        updateStatisticsDisplay();
    }
}

export function exportStatistics() {
    const data = {
        ...gameStats,
        exportedAt: Date.now(),
        version: '1.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corebox_stats_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.showNotif) window.showNotif('📤 Статистика экспортирована', false);
}

export function importStatistics() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const sanitized = sanitizeStats(data);
            Object.assign(gameStats, sanitized);
            updateStatisticsDisplay();
            if (window.cloudSaveNow) window.cloudSaveNow(true);
            if (window.showNotif) window.showNotif('📥 Статистика импортирована', false);
        } catch (err) {
            if (window.showNotif) window.showNotif('❌ Ошибка импорта файла', true);
        }
    };
    input.click();
}