// ======== sounds-handler.js (УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК ЗВУКОВ ДЛЯ ВСЕХ КНОПОК) ========
import { Sounds } from './sounds.js';

// Маппинг кнопок на типы звуков
const BUTTON_SOUND_MAP = [
    // Вкладки
    { selector: '.tab, .status-tab', sound: 'softClick' },
    
    // Крафт и разработка
    { selector: '.craft-btn', sound: 'craft' },
    { selector: '.design-btn', sound: 'design' },
    
    // Улучшения
    { selector: '.upgrade-btn', sound: 'upgrade' },
    { selector: '#upgradeMiningBtn, #upgradeDefenseBtn, #upgradeDefenseLevelBtn, #upgradeTurbineBtn, #upgradeCritBtn, #upgradeCoolingBtn', sound: 'upgrade' },
    
    // Защита
    { selector: '.protection-btn, .protection-buy-btn, .protection-toggle-btn', sound: 'defense' },
    { selector: '.cc-op-btn', sound: 'click' },
    
    // Торговля
    { selector: '.trade-card button, .trade-mode-btn', sound: 'trade' },
    
    // Флот
    { selector: '.ship-btn[data-action="repair"]', sound: 'click' },
    { selector: '.ship-btn[data-action="upgrade"]', sound: 'upgrade' },
    { selector: '.ship-btn[data-action="defense"]', sound: 'defense' },
    { selector: '.ship-btn[data-action="delete"]', sound: 'error' },
    { selector: '#pvp-combat-btn', sound: 'rebelAttack' },
    { selector: '#pvp-cargo-btn', sound: 'shipSend' },
    { selector: '#pvp-reset-target', sound: 'click' },
    
    // Карта
    { selector: '#space-research-btn', sound: 'evolution' },
    { selector: '.space-planet, .space-station, .other-player-marker', sound: 'softClick' },
    { selector: '#map-zoom-in, #map-zoom-out, #map-zoom-reset', sound: 'click' },
    
    // Квесты и престиж
    { selector: '#prestigeBtn', sound: 'evolution' },
    { selector: '#resetStatsBtn', sound: 'error' },
    
    // Общие кнопки
    { selector: '.log-btn, .stat-btn, #refreshLeaderboardBtn, #refreshStatsBtn', sound: 'click' },
    { selector: '#clearLogBtn', sound: 'click' },
    { selector: '#logoutBtn', sound: 'error' },
    { selector: '#autoScrollBtn', sound: 'click' },
    
    // Панели
    { selector: '.panel-title', sound: 'softClick' },
    
    // Авторизация
    { selector: '.auth-btn, .toggle-btn', sound: 'click' },
    
    // Модальные окна
    { selector: '.offline-popup button', sound: 'click' },
    
    // Станции
    { selector: '#station-btn-trade, #station-btn-close', sound: 'click' },
    
    // Планеты
    { selector: '#planet-btn-cargo, #planet-btn-close', sound: 'click' },
];

// Кэш для уже обработанных кнопок (чтобы не дублировать обработчики)
const processedButtons = new WeakSet();

// Функция для определения звука по кнопке
function getSoundForButton(button) {
    for (const mapping of BUTTON_SOUND_MAP) {
        if (button.matches(mapping.selector)) {
            return mapping.sound;
        }
    }
    
    // По ID
    const id = button.id || '';
    if (id.includes('craft')) return 'craft';
    if (id.includes('design')) return 'design';
    if (id.includes('upgrade')) return 'upgrade';
    if (id.includes('defense')) return 'defense';
    if (id.includes('trade')) return 'trade';
    if (id.includes('prestige')) return 'evolution';
    if (id.includes('reset')) return 'error';
    if (id.includes('logout')) return 'error';
    
    // По классу
    const className = button.className || '';
    if (className.includes('craft-btn')) return 'craft';
    if (className.includes('design-btn')) return 'design';
    if (className.includes('upgrade-btn')) return 'upgrade';
    if (className.includes('trade')) return 'trade';
    
    // По умолчанию
    return 'click';
}

// Главная функция активации звуков
export function initButtonSounds() {
    console.log('🔊 Активация звуков для всех кнопок...');
    
    // Обработчик для всех кликов по кнопкам
    document.body.addEventListener('click', (e) => {
        const button = e.target.closest('button, .tab, .status-tab, .craft-btn, .design-btn, .ship-btn, .upgrade-btn, .stat-btn, .log-btn, .auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn, .protection-btn, .cc-op-btn, .space-planet, .space-station, .other-player-marker, .panel-title');
        if (!button) return;
        
        // Пропускаем уже обработанные кнопки (чтобы не было двойных звуков)
        if (processedButtons.has(button)) return;
        
        const soundName = getSoundForButton(button);
        
        // Воспроизводим звук
        if (Sounds[soundName]) {
            Sounds[soundName]().catch(() => {});
        }
        
        // Визуальный фидбек (легкое сжатие)
        if (!button.classList.contains('no-feedback')) {
            const originalTransform = button.style.transform;
            button.style.transform = 'scale(0.97)';
            setTimeout(() => {
                button.style.transform = originalTransform;
            }, 100);
        }
        
        // Добавляем в кэш
        processedButtons.add(button);
        
        // Удаляем из кэша через 5 минут (на случай если кнопка пересоздастся в DOM)
        setTimeout(() => {
            processedButtons.delete(button);
        }, 300000);
    }, true);
    
    // Специальная обработка для плавающей кнопки добычи
    setupMineButton();
    
    // Специальная обработка для кнопки автокликера
    setupAutoClickObserver();
    
    // Специальная обработка для лога (события)
    setupLogObserver();
}

// Отдельный обработчик для кнопки добычи
function setupMineButton() {
    const mineBtn = document.getElementById('floatingMineBtn');
    if (!mineBtn) return;
    
    // Обычный клик
    mineBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        Sounds.mine().catch(() => {});
    });
    
    // Визуальный фидбек
    mineBtn.addEventListener('mousedown', () => {
        mineBtn.style.transform = 'scale(0.94)';
    });
    
    mineBtn.addEventListener('mouseup', () => {
        mineBtn.style.transform = '';
    });
    
    mineBtn.addEventListener('mouseleave', () => {
        mineBtn.style.transform = '';
    });
    
    // Touch для мобильных
    mineBtn.addEventListener('touchstart', () => {
        mineBtn.style.transform = 'scale(0.94)';
    });
    
    mineBtn.addEventListener('touchend', () => {
        mineBtn.style.transform = '';
    });
}

// Наблюдатель за состоянием автокликера
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

// Наблюдатель за логом (квесты, эволюция, атаки)
function setupLogObserver() {
    const logBox = document.getElementById('logBox');
    if (!logBox) return;
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList && node.classList.contains('log-entry')) {
                    const text = node.textContent || '';
                    
                    if (text.includes('Квест') && text.includes('выполнен')) {
                        Sounds.questDone().catch(() => {});
                    }
                    else if (text.includes('НЕЙРО-ЭВОЛЮЦИЯ')) {
                        Sounds.evolution().catch(() => {});
                    }
                    else if (text.includes('Атака') && text.includes('повстанцев') && !text.includes('отражена')) {
                        Sounds.rebelAttack().catch(() => {});
                    }
                    else if (text.includes('отражена')) {
                        Sounds.attackReflected?.().catch(() => {});
                    }
                    else if (text.includes('ТЭЦ активирована')) {
                        Sounds.coalOn().catch(() => {});
                    }
                    else if (text.includes('ТЭЦ деактивирована')) {
                        Sounds.coalOff().catch(() => {});
                    }
                    else if (text.includes('Наступила ночь')) {
                        Sounds.nightStart().catch(() => {});
                    }
                    else if (text.includes('Наступил день')) {
                        Sounds.dayStart?.().catch(() => {});
                    }
                    else if (text.includes('Обмен')) {
                        Sounds.trade().catch(() => {});
                    }
                    else if (text.includes('Улучшена')) {
                        Sounds.upgrade().catch(() => {});
                    }
                    else if (text.includes('Корабль') && text.includes('создан')) {
                        Sounds.shipCreate?.().catch(() => {});
                    }
                    else if (text.includes('отправлен')) {
                        Sounds.shipSend?.().catch(() => {});
                    }
                    else if (text.includes('вернулся')) {
                        Sounds.shipReturn?.().catch(() => {});
                    }
                    else if (text.includes('КРИТ')) {
                        Sounds.critical().catch(() => {});
                    }
                }
            });
        });
    });
    
    observer.observe(logBox, { childList: true });
}

// Функция для ручного воспроизведения звука (можно вызывать из кода)
export function playSound(soundName) {
    if (Sounds[soundName]) {
        Sounds[soundName]().catch(() => {});
    }
}

// Экспорт всех звуков для удобства
export { Sounds };

// Автозапуск при загрузке страницы
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initButtonSounds);
    } else {
        initButtonSounds();
    }
}

export default { initButtonSounds, playSound, Sounds };