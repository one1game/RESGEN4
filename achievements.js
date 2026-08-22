export const ACHIEVEMENTS = [
    { id: 'first_night', title: 'Первая ночь', desc: 'Пережить первую ночь', condition: s => s.nightsSurvived >= 1, icon: '🌙' },
    { id: 'coal_lord', title: 'Угольный магнат', desc: 'Добыть 1000 угля', condition: s => s.coalMined >= 1000, icon: '🪨' },
    { id: 'neuro_3', title: 'Пробуждение', desc: 'Нейро-эволюция Ур.3', condition: s => s.neuroEvolution >= 3, icon: '🧠' },
    { id: 'fleet_5', title: 'Адмирал', desc: 'Построить 5 кораблей', condition: s => s.fleetShips >= 5, icon: '🚀' },

    { id: 'defense_10', title: 'Крепость', desc: 'Отразить 10 атак', condition: s => s.attacksDefended >= 10, icon: '🛡️' },
    { id: 'ore_5000', title: 'Рудный барон', desc: 'Добыть 5000 руды', condition: s => s.oreMined >= 5000, icon: '⛏️' },
    { id: 'play_10h', title: 'Марафонец', desc: '10 часов в игре', condition: s => s.playTime >= 36000, icon: '⏱️' },
    { id: 'first_blueprint', title: 'Архитектор флота', desc: 'Разблокировать первый чертёж', condition: s => s.blueprintCargoUnlocked || s.blueprintScoutUnlocked || s.blueprintCombatUnlocked, icon: '📐' },
    { id: 'plasma_10', title: 'Плазменный резерв', desc: 'Накопить 10 плазмы', condition: s => s.plasma >= 10, icon: '⚡' },
    { id: 'chips_25', title: 'Сеть снабжения', desc: 'Накопить 25 чипов', condition: s => s.chips >= 25, icon: '🎛️' },
    { id: 'pvp_victory', title: 'Первый прорыв', desc: 'Победить в PvP-бою', condition: s => s.pvpWins >= 1, icon: '⚔️' },
];

export function checkAchievements(gameStats) {
    const userId = window.currentUser?.id || 'anon';
    const storageKey = `corebox_achievements_${userId}`;
    let unlocked = [];
    try {
        unlocked = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(unlocked)) unlocked = [];
    } catch (e) {
        unlocked = [];
    }
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(ach => {
        if (!unlocked.includes(ach.id) && ach.condition(gameStats)) {
            unlocked.push(ach.id);
            newlyUnlocked.push(ach);
        }
    });
    if (newlyUnlocked.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(unlocked));
        newlyUnlocked.forEach(ach => {
            if (window.showNotif) {
                window.showNotif(`🏅 ${ach.icon} ${ach.title}`, false);
            }
        });
    }
    return newlyUnlocked;
}