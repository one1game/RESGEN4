// ======== statistics.js (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ - ИСПРАВЛЕНА) ========

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
    consecutiveDefenses: 0, longestDefenseStreak: 0, prestige: 0,
};

export function initStatistics() {
    setupStatisticsEventListeners();
    startPlayTimeTracker();
}

export function loadUserStatistics(userStats) {
    if (!userStats) return;
    Object.keys(gameStats).forEach(key => { if (key in userStats) gameStats[key] = userStats[key]; });
    gameStats.sessionsCount = (userStats.sessionsCount || 0) + 1;
    gameStats.lastSessionDate = new Date().toISOString();
    gameStats.startTime = Date.now() - ((userStats.playTime || 0) * 1000);
    updateStatisticsDisplay();
}

export function resetUserStatistics() {
    if (!confirm('Сбросить статистику?')) return false;
    const preserved = { sessionsCount: gameStats.sessionsCount };
    Object.keys(gameStats).forEach(k => {
        if (typeof gameStats[k] === 'number') gameStats[k] = 0;
        else if (typeof gameStats[k] === 'boolean') gameStats[k] = false;
        else if (typeof gameStats[k] === 'string') gameStats[k] = '';
    });
    gameStats.sessionsCount = preserved.sessionsCount;
    gameStats.startTime = Date.now();
    gameStats.lastSessionDate = new Date().toISOString();
    gameStats.currentAiMode = 'Обычный';
    updateStatisticsDisplay();
    return true;
}

export function updateStatisticsFromRust(rustStats) {
    if (!rustStats) return;
    gameStats.totalMined = rustStats.total_mined || 0;
    gameStats.coalMined = rustStats.coal_mined || rustStats.total_coal_mined || gameStats.coalMined;
    gameStats.trashMined = rustStats.trash_mined || rustStats.total_trash_mined || gameStats.trashMined;
    gameStats.plasmaMined = rustStats.plasma_mined || rustStats.total_plasma_mined || gameStats.plasmaMined;
    gameStats.oreMined = rustStats.ore_mined || rustStats.total_ore_mined || gameStats.oreMined;
    gameStats.coalBurned = rustStats.coal_burned || rustStats.total_coal_burned || gameStats.coalBurned;
    gameStats.coalStolen = rustStats.coal_stolen || rustStats.total_coal_stolen || gameStats.coalStolen;
    gameStats.nightsSurvived = rustStats.nights_survived || gameStats.nightsSurvived;
    // БАГ №4: правильное поле из Rust — rebel_attacks_count
    gameStats.rebelAttacks = rustStats.rebel_attacks_count || gameStats.rebelAttacks;
    gameStats.attacksDefended = rustStats.attacks_defended || gameStats.attacksDefended;
    gameStats.rebelActivity = rustStats.rebel_activity || 0;
    gameStats.computationalPower = rustStats.computational_power || 0;
    gameStats.currentAiMode = rustStats.current_ai_mode || 'Обычный';
    gameStats.neuroEvolution = rustStats.neuro_evolution || 0;
    gameStats.neuroConsciousness = rustStats.neuro_consciousness || 0;
    gameStats.neuroScore = rustStats.neuro_score || 0;
    gameStats.miningLevel = rustStats.upgrades?.mining || 0;
    gameStats.defenseLevel = rustStats.upgrades?.defense_level || 0;
    gameStats.defenseActive = rustStats.upgrades?.defense || false;
    gameStats.consecutiveDefenses = rustStats.consecutive_successful_defenses || 0;
    gameStats.longestDefenseStreak = rustStats.longest_defense_streak || 0;
    const bp = [rustStats.blueprint_cargo_unlocked, rustStats.blueprint_scout_unlocked, rustStats.blueprint_combat_unlocked];
    gameStats.blueprintsUnlocked = bp.filter(Boolean).length;
    updateStatisticsDisplay();
}

export function updateStatisticsDisplay() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
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
    set('coalMined', (gameStats.coalMined || 0).toLocaleString());
    set('trashMined', (gameStats.trashMined || 0).toLocaleString());
    set('plasmaMined', (gameStats.plasmaMined || 0).toLocaleString());
    set('oreMined', (gameStats.oreMined || 0).toLocaleString());
    set('coalBurned', (gameStats.coalBurned || 0).toLocaleString());
    set('coalStolen', (gameStats.coalStolen || 0).toLocaleString());
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
    set('prestige', gameStats.prestige || 0);
    try {
        const fm = window.fleetModule;
        if (fm) {
            set('fleetShips', fm.ships.length + '/' + fm.maxFleetSize);
            set('fleetCombatPower', fm.getTotalCombatPower());
        }
    } catch(e) {}
}

function formatTime(seconds) {
    if (seconds < 60) return `${Math.floor(seconds)} сек`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${Math.floor(seconds % 60)} сек`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
    return `${Math.floor(seconds / 86400)} дн ${Math.floor((seconds % 86400) / 3600)} ч`;
}

let playTimeInterval;
function startPlayTimeTracker() {
    if (playTimeInterval) clearInterval(playTimeInterval);
    playTimeInterval = setInterval(() => { gameStats.playTime += 1; }, 1000);
}

function setupStatisticsEventListeners() {
    const refreshBtn = document.getElementById('refreshStatsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => updateStatisticsDisplay());
    // Обработчик сброса статистики перенесён в game.js
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