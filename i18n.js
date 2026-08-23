(() => {
  const pairs = [
    ['ИНВЕНТАРЬ','INVENTORY'],['МОДУЛИ','MODULES'],['ТОРГОВЛЯ','TRADE'],['ЗАДАНИЯ','QUESTS'],['КОМАНДНЫЙ ПУНКТ','COMMAND CENTER'],['КРАФТ','CRAFT'],['РАЗРАБОТКА','DEVELOPMENT'],['ФЛОТ','FLEET'],['КАРТА','MAP'],
    ['ВЫЧИСЛИТЕЛЬНАЯ МОЩНОСТЬ','COMPUTATIONAL POWER'],['ПРОГРЕСС СИНХРОНИЗАЦИИ','SYNC PROGRESS'],['АВТОМАТИЧЕСКАЯ ДОБЫЧА','AUTOMATED MINING'],['ТИР МОЩНОСТИ','POWER TIER'],['МОЩНОСТЬ/ЦИКЛ','POWER/CYCLE'],['ИНТЕРВАЛ','INTERVAL'],['СТОИМОСТЬ','COST'],['СЕК','SEC'],['МОЩН','POWER'],
    ['СТАТИСТИКА','STATISTICS'],['СИСТЕМНЫЙ СТАТУС','SYSTEM STATUS'],['СОХРАНИТЬ','SAVE'],['ЗАГРУЗИТЬ','LOAD'],['СИНХРОНИЗАЦИЯ','SYNC'],['ОТКРЫТЬ ИНВЕНТАРЬ','OPEN INVENTORY'],['ОТКРЫТЬ КАРТУ','OPEN MAP'],['ОТКРЫТЬ КОМАНДНЫЙ ПУНКТ','OPEN COMMAND CENTER'],['ОТКРЫТЬ РАЗРАБОТКУ','OPEN DEVELOPMENT'],['ОТКРЫТЬ КРАФТ','OPEN CRAFT'],
    ['ОТКЛЮЧЕНА','OFF'],['ВКЛЮЧЕНА','ON'],['АКТИВНА','ACTIVE'],['ГОТОВО','READY'],['ЗАГРУЗКА','LOADING'],['ОШИБКА','ERROR'],['ПРОДОЛЖИТЬ','CONTINUE'],['ОТМЕНА','CANCEL'],['ЗАКРЫТЬ','CLOSE'],['ПОДТВЕРДИТЬ','CONFIRM'],['НАЗАД','BACK'],
    ['ВКЛЮЧИТЬ ТЭЦ','ENABLE POWER PLANT'],['ПРОВЕРИТЬ ТЭЦ','CHECK POWER PLANT'],['Восстановить питание','Restore power'],['Запитать контур','Power the grid'],['Охладить турбину','Cool the turbine'],['Система стабильна','System stable'],['Зафиксирована угроза','Threat detected'],['Нарастить добычу','Increase production'],['Открыть первый blueprint','Unlock first blueprint'],['Собрать первый корабль','Build first ship'],['Расширить влияние','Expand influence'],
    ['ОПЕРАЦИОННЫЙ БРИФ','OPERATIONS BRIEF'],['СЛЕДУЮЩИЙ ШАГ','NEXT ACTION'],['УГРОЗА','THREAT'],['ПРОИЗВОДСТВО','PRODUCTION'],['ЦЕЛЬ','OBJECTIVE'],['СЕКТОР','SECTOR'],['РИСК','RISK'],['НАГРАДА','REWARD'],['РАЗВЕДКА','RECON'],['ОБОРОНА','GUARD'],['ЭКСПЕДИЦИЯ','EXPEDITION'],['АРХИВ','ARCHIVE'],['ЦЕЛИ','GOALS'],['ФРАКЦИИ','FACTIONS'],
    ['Сырьевой коридор','Ore Corridor'],['Охота за сигналом','Signal Hunt'],['Оборона периметра','Perimeter Guard'],['Импульс из пустоты','Void Pulse'],['ВЫБЕРИТЕ СЛЕДУЮЩИЙ ПРИКАЗ','CHOOSE YOUR NEXT ORDER'],['АКТИВНЫЙ ПРИКАЗ','ACTIVE ORDER'],['Outpost готов к операции','Outpost ready for orders'],['Нет завершённых операций. Выберите первый приказ.','No completed operations. Choose your first order.'],['Архив пуст','Archive empty'],['Включить энергоконтур','Enable the power grid'],['дождитесь дня','wait for daylight'],['остановлено вручную','stopped manually'],['мощность исчерпана','power depleted'],['турбина перегрета','turbine overheated'],['контур не запитан','grid unpowered'],
    ['Нейро-сеть требует авторизации','Neural network authorization required'],['Нейро-интерфейс','Neural interface'],['Квантовый ключ','Quantum key'],['Позывной','Callsign'],['минимум 6 символов','at least 6 characters'],['Как вас называть?','What should we call you?'],['Войти в систему','Enter system'],['Нет аккаунта? Зарегистрироваться','No account? Sign up'],['Ваш прогресс сохраняется локально на этом сервере','Your progress is saved locally on this server'],['ИСТОРИЯ МИРА','WORLD HISTORY'],['Нейро-эволюция','Neural evolution'],['СОХРАНЕНО','SAVED'],['Выйти','Log out'],['Включить/выключить звук','Toggle sound'],['ЦИКЛ СИСТЕМЫ','SYSTEM CYCLE'],['ДЕНЬ','DAY'],['СИСТЕМНЫЙ СТАТУС','SYSTEM STATUS'],['ЛИДЕРЫ','LEADERBOARD'],['ДИАГНОСТИКА ЯДРА','CORE DIAGNOSTICS'],['ТЭЦ','POWER PLANT'],['УГОЛЬ','COAL'],['РУДА','ORE'],['ПЛАЗМА','PLASMA'],['ЧИПЫ','CHIPS'],['ЭНЕРГИЯ','ENERGY'],['УРОВЕНЬ','LEVEL'],['ОПЫТ','XP'],['ЗАПАС','STOCKPILE'],['ПОТРЕБЛЕНИЕ','CONSUMPTION'],['ВОССТАНОВЛЕНИЕ','RECOVERY'],['СОСТОЯНИЕ','STATUS'],['Нормально','Nominal'],['Активно','Active'],['Остановлено','Stopped'],['Включить','Enable'],['Выключить','Disable'],['ВЫХОД','LOG OUT'],['ВХОД','LOG IN'],['РЕГИСТРАЦИЯ','SIGN UP'],['ПАРОЛЬ','PASSWORD'],['ИМЯ ПОЛЬЗОВАТЕЛЯ','USERNAME'],['СОЗДАТЬ АККАУНТ','CREATE ACCOUNT'],['ВОЙТИ В ИГРУ','ENTER GAME'],
    ['РУ','RU'],['АНГ','EN']
  ];
  const maps = { ru: Object.fromEntries(pairs.map(([ru]) => [ru, ru])), en: Object.fromEntries(pairs) };
  const localeKey = 'corebox_locale';
  let locale = localStorage.getItem(localeKey) || 'en';
  let previousLocale = 'ru';
  const replaceText = (text, from, to) => {
    let next = text;
    const entries = pairs.map(([ru, en]) => [from === 'ru' ? ru : en, to === 'ru' ? ru : en]).filter(([a,b]) => a && a !== b).sort((a,b) => b[0].length - a[0].length);
    for (const [a,b] of entries) next = next.split(a).join(b);
    return next;
  };
  function translate(root = document.body, from = previousLocale, to = locale) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => { const next = replaceText(node.nodeValue, from, to); if (next !== node.nodeValue) node.nodeValue = next; });
    root.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach(el => ['placeholder','title','aria-label'].forEach(attr => { const value = el.getAttribute(attr); if (value) el.setAttribute(attr, replaceText(value, from, to)); }));
    document.documentElement.lang = to;
    document.querySelectorAll('[data-i18n-locale]').forEach(el => { el.classList.toggle('is-active', el.dataset.i18nLocale === to); });
  }
  function setLocale(next) { if (!['ru','en'].includes(next) || next === locale) return; previousLocale = locale; locale = next; localStorage.setItem(localeKey, locale); translate(document.body, previousLocale, locale); window.dispatchEvent(new CustomEvent('corebox:locale', { detail: locale })); }
  window.coreboxI18n = { get locale() { return locale; }, setLocale, translate };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-i18n-locale]').forEach(el => el.addEventListener('click', () => setLocale(el.dataset.i18nLocale)));
    translate(document.body, 'ru', locale);
    const observer = new MutationObserver(mutations => { if (locale === 'ru') return; for (const m of mutations) m.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) translate(node, 'ru', locale); }); });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
