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

  /* ── ИСПРАВЛЕНИЕ ПЛАВАЮЩЕЙ КНОПКИ ДОБЫЧИ ───────────────────
   *
   * Проблема: оригинальный setupLongPressHandlers вешает touchstart
   * с e.preventDefault() — это блокирует цепочку touch → click.
   * На мобиле handleClick никогда не вызывается.
   *
   * Решение: перехватываем touchend и вручную вызываем handleClick,
   * если это был короткий тап (не long-press).
   * ────────────────────────────────────────────────────────── */
  function enhanceFloatingBtn () {
    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return;

    let touchStartTime = 0;
    let touchMoved = false;
    const LONG_PRESS_MS = 600; // должно совпадать с оригинальным таймером

    btn.addEventListener('touchstart', (e) => {
      touchStartTime = Date.now();
      touchMoved = false;
      Haptic.light();
      /* НЕ вызываем e.preventDefault() здесь — пусть браузер
         генерирует click сам. Оригинальный обработчик уже вешает
         e.preventDefault в своём touchstart — патчим его ниже. */
    }, { passive: true });

    btn.addEventListener('touchmove', () => {
      touchMoved = true; // палец сдвинулся — не считаем тапом
    }, { passive: true });

    btn.addEventListener('touchend', (e) => {
      const elapsed = Date.now() - touchStartTime;
      if (!touchMoved && elapsed < LONG_PRESS_MS) {
        /* Короткий тап — вызываем handleClick напрямую,
           потому что оригинальный touchstart с preventDefault
           мог уже убить синтетический click */
        if (typeof window.handleClick === 'function') {
          window.handleClick();
        }
      }
    }, { passive: true });

    /* Вибро при активации автоматической добычи */
    const observer = new MutationObserver(() => {
      if (btn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  /* Патчим setupLongPressHandlers — убираем e.preventDefault()
     чтобы не блокировать click-события.
     Вместо него используем touchend-логику выше. */
  function patchLongPressHandlers () {
    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return;

    /* Клонируем элемент — это удалит ВСЕ старые обработчики */
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    let timer;
    const newBtn = document.getElementById('floatingMineBtn');

    /* Long-press → автодобыча */
    newBtn.addEventListener('touchstart', (e) => {
      /* НЕ вызываем preventDefault — браузер сгенерирует click */
      timer = setTimeout(() => {
        Haptic.longPress();
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, 600);
    }, { passive: true }); // passive: true = нет preventDefault

    newBtn.addEventListener('touchend', () => {
      clearTimeout(timer);
    }, { passive: true });

    newBtn.addEventListener('touchcancel', () => {
      clearTimeout(timer);
    }, { passive: true });

    /* Мышь (десктоп) */
    newBtn.addEventListener('mousedown', () => {
      timer = setTimeout(() => {
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, 600);
    });
    newBtn.addEventListener('mouseup', () => clearTimeout(timer));
    newBtn.addEventListener('mouseleave', () => clearTimeout(timer));

    /* Click → добыча */
    newBtn.addEventListener('click', () => {
      Haptic.light();
      if (typeof window.handleClick === 'function') {
        window.handleClick();
      }
    });

    /* Вибро при автодобыче */
    const observer = new MutationObserver(() => {
      if (newBtn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(newBtn, { attributes: true, attributeFilter: ['class'] });
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
  /* Блокируем zoom только на элементах UI, НЕ глобально —
     иначе убиваем одиночные клики по плавающей кнопке */
  function preventDoubleTapZoom () {
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      /* Пропускаем плавающую кнопку — у неё своя логика */
      if (e.target.closest('#floatingMineBtn')) return;
      const now = Date.now();
      const delta = now - lastTouch;
      lastTouch = now;
      if (delta < 300 && delta > 0) {
        if (e.target.closest('button, .tab, .status-tab, .craft-btn, .design-btn')) {
          e.preventDefault();
        }
      }
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
    watchGameNotifications();
    setupTabScroll();
    preventDoubleTapZoom();
    fixInputZoom();
    patchSounds();

    /* Плавающую кнопку патчим после загрузки WASM/игры */
    function tryPatch (attempt) {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.parentNode) {
        patchLongPressHandlers();
        patchSounds();
      } else if (attempt < 20) {
        setTimeout(() => tryPatch(attempt + 1), 300);
      }
    }
    tryPatch(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();