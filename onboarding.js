// Lightweight first-session onboarding. It only guides navigation; game state stays in CoreGame.
const ONBOARDING_KEY = 'corebox_onboarding_v1_seen';

function getOnboardingKey() {
    const userId = window.currentUser?.id || 'anon';
    return `${ONBOARDING_KEY}_${userId}`;
}

function isGameVisible() {
    const tabs = document.getElementById('tabs');
    if (!tabs) return false;
    const style = window.getComputedStyle(tabs);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function openTab(tabName) {
    const button = document.querySelector(`[data-tab="${tabName}"]`);
    if (button) button.click();
}

function showOnboarding() {
    if (!isGameVisible() || localStorage.getItem(getOnboardingKey()) === '1') return;
    if (document.getElementById('corebox-onboarding')) return;

    const panel = document.createElement('aside');
    panel.id = 'corebox-onboarding';
    panel.className = 'corebox-onboarding';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Быстрый старт CoreBox');
    panel.innerHTML = `
      <div class="corebox-onboarding__eyebrow">COREBOX // QUICK START</div>
      <h2>Запусти первую смену</h2>
      <p class="corebox-onboarding__intro">Три коротких шага откроют базовую петлю игры. Прогресс остаётся локально и не требует внешней базы.</p>
      <ol>
        <li><button data-onboard-tab="inventory"><b>Добыча</b><span>Сделай первые клики и собери ресурсы.</span></button></li>
        <li><button data-onboard-tab="upgrades"><b>Модули</b><span>Активируй ТЭЦ и подготовься к ночи.</span></button></li>
        <li><button data-onboard-tab="quests"><b>Задания</b><span>Следуй цепочке, чтобы открыть флот и карту.</span></button></li>
      </ol>
      <div class="corebox-onboarding__actions">
        <button class="corebox-onboarding__primary" data-onboard-tab="inventory">Начать смену</button>
        <button class="corebox-onboarding__dismiss">Больше не показывать</button>
      </div>`;

    document.body.appendChild(panel);
    panel.querySelectorAll('[data-onboard-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            openTab(button.dataset.onboardTab);
            panel.remove();
        });
    });
    panel.querySelector('.corebox-onboarding__dismiss')?.addEventListener('click', () => {
        localStorage.setItem(getOnboardingKey(), '1');
        panel.remove();
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => {
        if (isGameVisible()) {
            showOnboarding();
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(showOnboarding, 500);
});
