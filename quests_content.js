export const QUESTS_CONTENT = [

    {
        id: "3bd16a6a-3c3a-44dd-bca7-75add0883e4a",
        order: 1,
        title: "Первый импульс",
        description: "Турбина запущена. Сделай 30 кликов добычи — каждый нагревает турбину. Нажимай кнопку ДОБЫЧА, пока не перегреется, затем жди остывания и повторяй. Уголь и мусор случайно появляются в инвентаре.",
        hint: "Нажми большую кнопку ⚙️ ДОБЫЧА в правом нижнем углу.",
        quest_type: "MineAny",
        target: 30,
        reward: 15,
        reward_coal: 5,
        reward_trash: 15,
        reward_ore: 0,
        reward_chips: 0,
        reward_plasma: 0,
        enabled: true,
        unlocks: ["coal_trade"],
    },

    {
        id: "046d9d57-8748-4a38-b930-271680f9ed62",
        order: 2,
        title: "Первая ночь",
        description: "Ночью система потребляет уголь. Если угля нет — добыча заблокирована. Активируй ТЭЦ до заката и переживи 3 ночных цикла.",
        hint: "Следи за полосой времени вверху. Держи запас угля хотя бы 5 шт.",
        quest_type: "SurviveNight",
        target: 3,
        reward: 20,
        reward_coal: 10,
        reward_trash: 20,
        reward_ore: 0,
        reward_chips: 0,
        reward_plasma: 0,
        enabled: true,
        unlocks: [],
    },

    {
        id: "4a391a8b-34ef-45b3-8e92-a734a373dad9",
        order: 3,
        title: "Протокол защиты",
        description: "Повстанцы начинают вылазки. Без защиты ночью они крадут ресурсы. Накопи 1 плазму и активируй защиту во вкладке МОДУЛИ.",
        hint: "Путь к плазме: уголь → руда (торговля) → плазма (крафт).",
        quest_type: "ActivateDefense",
        target: 1,
        reward: 50,
        reward_coal: 0,
        reward_trash: 30,
        reward_ore: 20,
        reward_chips: 0,
        reward_plasma: 1,
        enabled: true,
        unlocks: [],
    },

    {
        id: "2e7fcdab-30e7-49ea-849f-56a0abbdbc46",
        order: 4,
        title: "Стойкость под огнём",
        description: "Защита активна — теперь учись её применять. Переживи 3 атаки повстанцев. Следи за предупреждениями ИИ в Командном пункте.",
        hint: "Убедись, что защита активирована (вкладка МОДУЛИ) перед каждой ночью.",
        quest_type: "SurviveAttack",
        target: 3,
        reward: 60,
        reward_coal: 10,
        reward_trash: 30,
        reward_ore: 20,
        reward_chips: 2,
        reward_plasma: 0,
        enabled: true,
        unlocks: [],
    },

    {
        id: "688e7d28-ae71-452d-ad6d-1a8ac91d4b35",
        order: 5,
        title: "Нейро-пробуждение",
        description: "ИИ-система получает опыт с каждой угрозой. Доведи нейро-эволюцию до уровня 3 — это разблокирует адаптивную оборону и добычу руды.",
        hint: "Очки эволюции начисляются за отражённые атаки и ночи выживания.",
        quest_type: "ReachEvolutionLevel",
        target: 3,
        reward: 80,
        reward_coal: 0,
        reward_trash: 30,
        reward_ore: 50,
        reward_chips: 3,
        reward_plasma: 0,
        enabled: true,
        unlocks: ["ore"],
    },

    {
        id: "quest_neuro_tactician",
        order: 6,
        title: "Нейро-тактик",
        description: "Чипы — это мозг твоей базы. Накопи 5 чипов, чтобы разблокировать продвинутые операции в Командном пункте (Пропаганда, Патчи).",
        hint: "Скрафти чипы из 100 руды во вкладке КРАФТ или обменяй ресурсы.",
        quest_type: "CollectResource",
        target: 5,
        resource: "chips",
        reward: 100,
        reward_coal: 20,
        reward_trash: 40,
        reward_ore: 0,
        reward_chips: 5,
        reward_plasma: 2,
        enabled: true,
        unlocks: [],
    },

    {
        id: "quest_fleet_blueprint",
        order: 7,
        title: "Первый чертёж",
        description: "Флот открывает экспансию в космос. Разработай чертёж любого корабля во вкладке РАЗРАБОТКА. Стоимость — вычислительная мощность.",
        hint: "РАЗРАБОТКА → кнопка 📐 СОЗДАТЬ ЧЕРТЁЖ. Нужно 200 ед. мощности для Грузового.",
        quest_type: "BlueprintUnlocked",
        target: 1,
        reward: 60,
        reward_coal: 20,
        reward_trash: 40,
        reward_chips: 5,
        reward_plasma: 2,
        enabled: true,
        unlocks: [],
    },

    {
        id: "quest_neuro_frontier",
        order: 8,
        title: "Граница сознания",
        description: "Нейросеть готова управлять автономной экспансией. Доведи нейро-эволюцию до уровня 8.",
        hint: "Отражай угрозы, переживай ночи и развивай защитные модули.",
        quest_type: "ReachEvolutionLevel",
        target: 8,
        reward: 140,
        reward_coal: 30,
        reward_trash: 60,
        reward_chips: 8,
        reward_plasma: 3,
        enabled: true,
        unlocks: [],
    },

    {
        id: "quest_plasma_reserve",
        order: 9,
        title: "Глубокий резерв",
        description: "Стабилизируй энергосеть перед дальними экспедициями. Накопи 10 единиц плазмы.",
        hint: "Плазма нужна для защиты, флота и продвинутых операций — не трать весь запас сразу.",
        quest_type: "CollectResource",
        target: 10,
        resource: "plasma",
        reward: 180,
        reward_coal: 40,
        reward_trash: 80,
        reward_chips: 10,
        reward_plasma: 4,
        enabled: true,
        unlocks: [],
    },

    {
        id: "quest_supply_network",
        order: 10,
        title: "Сеть снабжения",
        description: "Построй устойчивую экономику колонии. Накопи 25 чипов для командных операций и fleet-инфраструктуры.",
        hint: "Чипы можно получить через крафт, торговлю и награды за угрозы.",
        quest_type: "CollectResource",
        target: 25,
        resource: "chips",
        reward: 240,
        reward_coal: 60,
        reward_trash: 100,
        reward_chips: 15,
        reward_plasma: 5,
        enabled: true,
        unlocks: [],
    }

];

export function applyQuestReward(questId, game) {
    const q = QUESTS_CONTENT.find(x => x.id === questId);
    if (!q || !game) return false;

    if (q.reward_coal  > 0) game.add_resource('coal',   q.reward_coal);
    if (q.reward_trash > 0) game.add_resource('trash',  q.reward_trash);
    if (q.reward_ore   > 0) game.add_resource('ore',    q.reward_ore);
    if (q.reward_chips > 0) game.add_resource('chips',  q.reward_chips);
    if (q.reward_plasma > 0) game.add_resource('plasma', q.reward_plasma);

    if (window.addToLog) {
        const rewards = [];
        if (q.reward_coal > 0) rewards.push(`${q.reward_coal}🪨`);
        if (q.reward_trash > 0) rewards.push(`${q.reward_trash}♻️`);
        if (q.reward_ore > 0) rewards.push(`${q.reward_ore}⛏️`);
        if (q.reward_chips > 0) rewards.push(`${q.reward_chips}🎛️`);
        if (q.reward_plasma > 0) rewards.push(`${q.reward_plasma}⚡`);
        if (rewards.length) {
            window.addToLog(`🎁 Награда за квест "${q.title}": +${rewards.join(', ')}`, "success");
        }
    }

    return true;
}

export function getQuestContent(questId) {
    return QUESTS_CONTENT.find(x => x.id === questId) || null;
}