export const ACHIEVEMENTS = [
    { id: 'first_night', title: 'Первая ночь', desc: 'Пережить первую ночь', condition: s => s.nightsSurvived >= 1, icon: '🌙' },
    { id: 'coal_lord', title: 'Угольный магнат', desc: 'Добыть 1000 угля', condition: s => s.coalMined >= 1000, icon: '🪨' },
    { id: 'neuro_3', title: 'Пробуждение', desc: 'Нейро-эволюция Ур.3', condition: s => s.neuroEvolution >= 3, icon: '🧠' },
    { id: 'fleet_5', title: 'Адмирал', desc: 'Построить 5 кораблей', condition: s => s.fleetShips >= 5, icon: '🚀' },

    { id: 'defense_10', title: 'Крепость', desc: 'Отразить 10 атак', condition: s => s.attacksDefended >= 10, icon: '🛡️' },
    { id: 'ore_5000', title: 'Рудный барон', desc: 'Добыть 5000 руды', condition: s => s.oreMined >= 5000, icon: '⛏️' },
    { id: 'play_10h', title: 'Марафонец', desc: '10 часов в игре', condition: s => s.playTime >= 36000, icon: '⏱️' },
];

export function checkAchievements(gameStats) {
    const unlocked = JSON.parse(localStorage.getItem('corebox_achievements') || '[]');
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(ach => {
        if (!unlocked.includes(ach.id) && ach.condition(gameStats)) {
            unlocked.push(ach.id);
            newlyUnlocked.push(ach);
        }
    });
    if (newlyUnlocked.length > 0) {
        localStorage.setItem('corebox_achievements', JSON.stringify(unlocked));
        newlyUnlocked.forEach(ach => {
            if (window.showNotif) {
                window.showNotif(`🏅 ${ach.icon} ${ach.title}`, false);
            }
        });
    }
    return newlyUnlocked;
}