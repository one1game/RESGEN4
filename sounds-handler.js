import { Sounds } from './sounds.js';

const _soundDebounce = new Map();
function canPlaySound(name, cooldownMs = 2000) {
    const now = Date.now();
    const last = _soundDebounce.get(name) || 0;
    if (now - last < cooldownMs) return false;
    _soundDebounce.set(name, now);
    return true;
}

const processedSoundIds = new Map();
const MAX_PROCESSED_IDS = 200;

function addProcessedId(id) {
    processedSoundIds.set(id, Date.now());
    if (processedSoundIds.size > MAX_PROCESSED_IDS) {
        const now = Date.now();
        for (const [k, t] of processedSoundIds) {
            if (now - t > 5000) processedSoundIds.delete(k);
        }
        if (processedSoundIds.size > MAX_PROCESSED_IDS) {
            const entries = [...processedSoundIds.entries()]
                .sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < entries.length / 2; i++) {
                processedSoundIds.delete(entries[i][0]);
            }
        }
    }
}

const BUTTON_SOUND_MAP = [
    { selector: '.tab, .status-tab', sound: 'softClick' },
    { selector: '.craft-btn', sound: 'craft' },
    { selector: '.design-btn', sound: 'design' },
    { selector: '.upgrade-btn', sound: 'upgrade' },
    { selector: '#upgradeMiningBtn, #upgradeDefenseBtn, #upgradeDefenseLevelBtn, #upgradeTurbineBtn, #upgradeCritBtn, #upgradeCoolingBtn', sound: 'upgrade' },
    { selector: '.protection-btn, .protection-buy-btn, .protection-toggle-btn', sound: 'defense' },
    { selector: '.cc-op-btn', sound: 'click' },
    { selector: '.trade-card button, .trade-mode-btn', sound: 'trade' },
    { selector: '.ship-btn[data-action="repair"]', sound: 'click' },
    { selector: '.ship-btn[data-action="upgrade"]', sound: 'upgrade' },
    { selector: '.ship-btn[data-action="defense"]', sound: 'defense' },
    { selector: '.ship-btn[data-action="delete"]', sound: 'error' },
    { selector: '#pvp-combat-btn', sound: 'rebelAttack' },
    { selector: '#pvp-cargo-btn', sound: 'shipSend' },
    { selector: '#pvp-reset-target', sound: 'click' },
    { selector: '#space-research-btn', sound: 'evolution' },
    { selector: '.space-planet, .space-station, .other-player-marker', sound: 'softClick' },
    { selector: '#map-zoom-in, #map-zoom-out, #map-zoom-reset', sound: 'click' },
    { selector: '#prestigeBtn', sound: 'evolution' },
    { selector: '#resetStatsBtn', sound: 'error' },
    { selector: '.log-btn, .stat-btn, #refreshLeaderboardBtn, #refreshStatsBtn', sound: 'click' },
    { selector: '#clearLogBtn', sound: 'click' },
    { selector: '#logoutBtn', sound: 'error' },
    { selector: '#autoScrollBtn', sound: 'click' },
    { selector: '.panel-title', sound: 'softClick' },
    { selector: '.auth-btn, .toggle-btn', sound: 'click' },
    { selector: '.offline-popup button', sound: 'click' },
    { selector: '#station-btn-trade, #station-btn-close', sound: 'click' },
    { selector: '#planet-btn-cargo, #planet-btn-close', sound: 'click' },
];

function getSoundForButton(button) {
    for (const mapping of BUTTON_SOUND_MAP) {
        if (button.matches(mapping.selector)) {
            return mapping.sound;
        }
    }
    const id = button.id || '';
    if (id.includes('craft')) return 'craft';
    if (id.includes('design')) return 'design';
    if (id.includes('upgrade')) return 'upgrade';
    if (id.includes('defense')) return 'defense';
    if (id.includes('trade')) return 'trade';
    if (id.includes('prestige')) return 'evolution';
    if (id.includes('reset')) return 'error';
    if (id.includes('logout')) return 'error';
    const className = button.className || '';
    if (className.includes('craft-btn')) return 'craft';
    if (className.includes('design-btn')) return 'design';
    if (className.includes('upgrade-btn')) return 'upgrade';
    if (className.includes('trade')) return 'trade';
    return 'click';
}

let _buttonSoundHandler = null;

export function initButtonSounds() {
    console.log('🔊 Активация звуков для всех кнопок...');

    if (_buttonSoundHandler) {
        document.body.removeEventListener('click', _buttonSoundHandler, true);
        _buttonSoundHandler = null;
    }

    _buttonSoundHandler = (e) => {
        const button = e.target.closest('button, .tab, .status-tab, .craft-btn, .design-btn, .ship-btn, .upgrade-btn, .stat-btn, .log-btn, .auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn, .protection-btn, .cc-op-btn, .space-planet, .space-station, .other-player-marker, .panel-title');
        if (!button) return;

        if (!button.dataset.soundId) {
            button.dataset.soundId = `snd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        const soundId = button.dataset.soundId;

        if (processedSoundIds.has(soundId)) {
            const age = Date.now() - (processedSoundIds.get(soundId) || 0);
            if (age > 5000) {
                processedSoundIds.delete(soundId);
            } else {
                return;
            }
        }

        const soundName = getSoundForButton(button);
        if (Sounds[soundName]) {
            Sounds[soundName]().catch(() => {});
        }

        if (!button.classList.contains('no-feedback')) {
            const originalTransform = button.style.transform;
            button.style.transform = 'scale(0.97)';
            setTimeout(() => {
                button.style.transform = originalTransform;
            }, 100);
        }

        addProcessedId(soundId);
    };

    document.body.addEventListener('click', _buttonSoundHandler, true);

    setupMineButton();
    setupAutoClickObserver();
    setupLogObserver();
}

function setupMineButton() {
    const mineBtn = document.getElementById('floatingMineBtn');
    if (!mineBtn) return;
    mineBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        Sounds.mine().catch(() => {});
    });
    mineBtn.addEventListener('mousedown', () => { mineBtn.style.transform = 'scale(0.94)'; });
    mineBtn.addEventListener('mouseup', () => { mineBtn.style.transform = ''; });
    mineBtn.addEventListener('mouseleave', () => { mineBtn.style.transform = ''; });
    mineBtn.addEventListener('touchstart', () => { mineBtn.style.transform = 'scale(0.94)'; });
    mineBtn.addEventListener('touchend', () => { mineBtn.style.transform = ''; });
}

function setupAutoClickObserver() {
    const mineBtn = document.getElementById('floatingMineBtn');
    if (!mineBtn) return;
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (mineBtn.classList.contains('auto-clicking')) {
                    Sounds.autoStart().catch(() => {});
                }
            }
        });
    });
    observer.observe(mineBtn, { attributes: true });
}

function setupLogObserver() {
    const logBox = document.getElementById('logBox');
    if (!logBox) return;

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList?.contains('log-entry')) {
                    const text = node.textContent || '';

                    if (text.includes('НЕЙРО-ЭВОЛЮЦИЯ') && canPlaySound('evolution', 3000)) {
                        Sounds.evolution().catch(() => {});
                    }
                    else if (text.includes('Атака') && text.includes('повстанцев') && !text.includes('отражена') && canPlaySound('rebelAttack', 3000)) {
                        Sounds.rebelAttack().catch(() => {});
                    }
                    else if (text.includes('Наступила ночь') && canPlaySound('nightStart', 5000)) {
                        Sounds.nightStart().catch(() => {});
                    }

                    else if (text.includes('Квест') && text.includes('выполнен') && canPlaySound('questDone', 1000)) {
                        Sounds.questDone().catch(() => {});
                    }
                    else if (text.includes('Обмен') && canPlaySound('trade', 500)) {
                        Sounds.trade().catch(() => {});
                    }
                    else if (text.includes('Улучшена') && canPlaySound('upgrade', 500)) {
                        Sounds.upgrade().catch(() => {});
                    }
                    else if (text.includes('ТЭЦ активирована') && canPlaySound('coalOn', 500)) {
                        Sounds.coalOn().catch(() => {});
                    }
                    else if (text.includes('ТЭЦ деактивирована') && canPlaySound('coalOff', 500)) {
                        Sounds.coalOff().catch(() => {});
                    }
                    else if (text.includes('Корабль') && text.includes('создан') && canPlaySound('shipCreate', 500)) {
                        Sounds.shipCreate?.().catch(() => {});
                    }
                    else if (text.includes('отправлен') && canPlaySound('shipSend', 500)) {
                        Sounds.shipSend?.().catch(() => {});
                    }
                    else if (text.includes('вернулся') && canPlaySound('shipReturn', 500)) {
                        Sounds.shipReturn?.().catch(() => {});
                    }
                    else if (text.includes('КРИТ') && canPlaySound('critical', 500)) {
                        Sounds.critical().catch(() => {});
                    }
                }
            });
        });
    });
    observer.observe(logBox, { childList: true });
}

export function playSound(soundName) {
    if (Sounds[soundName]) {
        Sounds[soundName]().catch(() => {});
    }
}

export { Sounds };

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initButtonSounds);
    } else {
        initButtonSounds();
    }
}

export default { initButtonSounds, playSound, Sounds };