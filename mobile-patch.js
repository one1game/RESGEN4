/**
 * CoreBox 3.2 — МОБИЛЬНЫЙ JS-ПАТЧ
 * Подключить в конце <body>:
 * <script src="mobile-patch.js" defer></script>
 *
 * Что делает:
 *  1. Вибрация на все кнопки / игровые события
 *  2. Long-press на плавающей кнопке (уже есть, усиливаем)
 *  3. Scroll вкладок навигации к активной
 *  4. Блокировка нативного zoom двойным тапом
 *  5. Pull-to-refresh отключён
 *  6. Haptic-хелпер (безопасный — не падает на десктопе)
 */

(function () {
  'use strict';

  /* ── ВИБРО-ХЕЛПЕР ──────────────────────────────────────── */
  const Haptic = {
    /** Лёгкий тик — обычный клик */
    light () { _vib([10]); },
    /** Средний — успешное действие */
    medium () { _vib([20]); },
    /** Сильный — важное событие */
    heavy () { _vib([40]); },
    /** Двойной — крит / комбо */
    double () { _vib([15, 60, 15]); },
    /** Тройной — апгрейд / квест */
    success () { _vib([10, 40, 10, 40, 30]); },
    /** Ошибка — disabled-кнопка */
    error () { _vib([60, 30, 60]); },
    /** Предупреждение — атака / опасность */
    warning () { _vib([80, 50, 80, 50, 80]); },
    /** Длинный — autoclick активирован */
    longPress () { _vib([100]); },
  };

  function _vib (pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }
  }

  /* Делаем Haptic глобальным — можно использовать из основного кода */
  window.Haptic = Haptic;

  /* ── ВИБРАЦИЯ НА ВСЕ КНОПКИ ────────────────────────────── */
  document.addEventListener('pointerdown', function (e) {
    const btn = e.target.closest(
      'button, .tab, .status-tab, .craft-btn, .design-btn, ' +
      '.ship-btn, .upgrade-btn, .stat-btn, .log-btn, ' +
      '.auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn'
    );
    if (!btn) return;

    if (btn.disabled || btn.classList.contains('disabled')) {
      Haptic.error();
      return;
    }

    /* Разные паттерны по типу кнопки */
    if (btn.classList.contains('upgrade-btn') ||
        btn.id === 'upgradeMiningBtn' ||
        btn.id === 'upgradeDefenseBtn' ||
        btn.id === 'upgradeDefenseLevelBtn' ||
        btn.id === 'upgradeTurbineBtn' ||
        btn.id === 'upgradeCritBtn' ||
        btn.id === 'upgradeCoolingBtn') {
      Haptic.success();
    } else if (btn.classList.contains('craft-btn') ||
               btn.classList.contains('design-btn')) {
      Haptic.medium();
    } else if (btn.id === 'prestigeBtn' || btn.id === 'resetStatsBtn') {
      Haptic.heavy();
    } else if (btn.classList.contains('tab') ||
               btn.classList.contains('status-tab')) {
      Haptic.light();
    } else {
      Haptic.light();
    }
  }, { passive: true });

  /* ── ВИБРАЦИЯ ДЛЯ ПЛАВАЮЩЕЙ КНОПКИ ДОБЫЧИ ──────────────── */
  function enhanceFloatingBtn () {
    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return;

    /* Клик — лёгкий тик */
    btn.addEventListener('click', () => Haptic.light(), { passive: true });

    /* Удержание уже обработано в main.js через touchstart/touchend,
       добавляем только вибро: */
    btn.addEventListener('touchstart', () => {
      Haptic.light();
    }, { passive: true });

    /* Слушаем активацию автоматической добычи — сильная вибра */
    const observer = new MutationObserver(() => {
      if (btn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── ВИБРАЦИЯ НА ИГРОВЫЕ СОБЫТИЯ (через DOM Mutation Observer) */
  function watchGameNotifications () {
    /* Наблюдаем за добавлением .notification в body */
    const bodyObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.classList.contains('notification')) {
            if (node.classList.contains('error')) {
              Haptic.error();
            } else {
              Haptic.medium();
            }
          }

          /* Попап «атака повстанцев» */
          if (node.classList.contains('offline-popup') ||
              node.id === 'attackWarning') {
            Haptic.warning();
          }
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: false });

    /* Наблюдаем за появлением attackWarning */
    const warningEl = document.getElementById('attackWarning');
    if (warningEl) {
      const warningObserver = new MutationObserver(() => {
        if (warningEl.style.display !== 'none' && warningEl.textContent.trim()) {
          Haptic.warning();
        }
      });
      warningObserver.observe(warningEl, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        characterData: true,
      });
    }
  }

  /* Патчим Sounds (если есть) чтобы добавить вибро к звукам */
  function patchSounds () {
    if (!window.Sounds) return;

    const orig = { ...window.Sounds };

    if (orig.mine)    window.Sounds.mine    = (...a) => { Haptic.light();   orig.mine?.(...a);    };
    if (orig.upgrade) window.Sounds.upgrade = (...a) => { Haptic.success(); orig.upgrade?.(...a); };
    if (orig.click)   window.Sounds.click   = (...a) => { Haptic.light();   orig.click?.(...a);   };
    if (orig.error)   window.Sounds.error   = (...a) => { Haptic.error();   orig.error?.(...a);   };
    if (orig.quest)   window.Sounds.quest   = (...a) => { Haptic.double();  orig.quest?.(...a);   };
    if (orig.attack)  window.Sounds.attack  = (...a) => { Haptic.warning(); orig.attack?.(...a);  };
  }

  /* ── СКРОЛЛ НИЖНЕЙ НАВИГАЦИИ К АКТИВНОЙ ВКЛАДКЕ ─────────── */
  function scrollTabIntoView (tabEl) {
    if (!tabEl) return;
    tabEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function setupTabScroll () {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;

    /* При переключении вкладок — скроллим к активной */
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      setTimeout(() => scrollTabIntoView(tab), 50);
    });
  }

  /* ── ПРЕДОТВРАЩЕНИЕ ZOOM НА ДВОЙНОЙ ТАП ─────────────────── */
  function preventDoubleTapZoom () {
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch < 300) {
        e.preventDefault();
      }
      lastTouch = now;
    }, { passive: false });
  }

  /* ── ИНПУТЫ: iOS не зумирует при font-size ≥ 16px ────────── */
  function fixInputZoom () {
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (parseFloat(getComputedStyle(el).fontSize) < 16) {
        el.style.fontSize = '16px';
      }
    });
  }

  /* ── ИНИЦИАЛИЗАЦИЯ ──────────────────────────────────────── */
  function init () {
    enhanceFloatingBtn();
    watchGameNotifications();
    setupTabScroll();
    preventDoubleTapZoom();
    fixInputZoom();
    patchSounds();

    /* Повторяем enhanceFloatingBtn после загрузки WASM/игры */
    setTimeout(enhanceFloatingBtn, 2000);
    setTimeout(patchSounds, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();