/**
 * CoreBox 3.2 — МОБИЛЬНЫЙ JS-ПАТЧ (ИСПРАВЛЕННАЯ ВЕРСИЯ)
 * Подключить в конце <body>:
 * <script src="mobile-patch.js" defer></script>
 *
 * Что делает:
 *  1. Вибрация на все кнопки / игровые события
 *  2. Long-press на плавающей кнопке (исправлен для мобильных)
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

  /* ── ПОЛНОСТЬЮ ПЕРЕЗАПИСЫВАЕМ ОБРАБОТЧИКИ ПЛАВАЮЩЕЙ КНОПКИ ──
   *
   * Проблема: оригинальный setupLongPressHandlers вешает touchstart
   * с e.preventDefault() — это блокирует цепочку touch → click.
   * На мобиле handleClick никогда не вызывается.
   *
   * Решение: полностью заменяем обработчики, убираем preventDefault
   * из touchstart, добавляем обработку короткого тапа в touchend.
   * ────────────────────────────────────────────────────────── */
  function patchFloatingButton() {
    const oldBtn = document.getElementById('floatingMineBtn');
    if (!oldBtn) return null;
    
    // Создаём новый элемент, копируя все атрибуты и содержимое
    const newBtn = document.createElement('div');
    newBtn.id = oldBtn.id;
    newBtn.className = oldBtn.className;
    
    // Копируем все атрибуты
    for (let i = 0; i < oldBtn.attributes.length; i++) {
      const attr = oldBtn.attributes[i];
      newBtn.setAttribute(attr.name, attr.value);
    }
    
    // Копируем содержимое
    newBtn.innerHTML = oldBtn.innerHTML;
    
    // Ставим атрибут ДО вставки в DOM
    newBtn.setAttribute('data-patched', 'true');
    
    // Заменяем старую кнопку новой
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    
    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return null;
    
    let pressTimer = null;
    let isLongPress = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    const LONG_PRESS_MS = 600;
    const MOVE_THRESHOLD = 10;
    
    // ========== ДЕСКТОП (мышь) ==========
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        Haptic.longPress();
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, LONG_PRESS_MS);
    });
    
    btn.addEventListener('mouseup', () => {
      clearTimeout(pressTimer);
      if (!isLongPress && typeof window.handleClick === 'function') {
        window.handleClick();
      }
      isLongPress = false;
      btn.style.transform = '';
    });
    
    btn.addEventListener('mouseleave', () => {
      clearTimeout(pressTimer);
      isLongPress = false;
      btn.style.transform = '';
    });
    
    // ========== МОБИЛЬНЫЕ (touch) — ОДИН ОБРАБОТЧИК ==========
    btn.addEventListener('touchstart', (e) => {
      // ❌ НЕ ВЫЗЫВАЕМ e.preventDefault() — это убивает click на мобильных!
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      isLongPress = false;
      
      // Визуальный фидбек
      btn.style.transform = 'scale(0.92)';
      
      // Лёгкая вибрация при касании
      Haptic.light();
      
      pressTimer = setTimeout(() => {
        isLongPress = true;
        Haptic.longPress();
        btn.style.transform = '';  // сбрасываем при long-press
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, LONG_PRESS_MS);
    }, { passive: true }); // passive: true — ключевой момент!
    
    btn.addEventListener('touchmove', (e) => {
      // Если палец сильно сдвинулся — отменяем long-press
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartX);
      const deltaY = Math.abs(touch.clientY - touchStartY);
      
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        clearTimeout(pressTimer);
        isLongPress = false;
      }
    }, { passive: true });
    
    btn.addEventListener('touchend', (e) => {
      // preventDefault тут БЕЗОПАСЕН — только на touchend
      e.preventDefault();
      clearTimeout(pressTimer);
      
      const elapsed = Date.now() - touchStartTime;
      btn.style.transform = '';
      
      // Если это был короткий тап (не long-press и не движение)
      if (!isLongPress && elapsed < LONG_PRESS_MS) {
        if (typeof window.handleClick === 'function') {
          window.handleClick();
        }
      }
      isLongPress = false;
    });
    
    btn.addEventListener('touchcancel', () => {
      clearTimeout(pressTimer);
      isLongPress = false;
      btn.style.transform = '';
    });
    
    // Отслеживаем класс auto-clicking для вибрации
    const observer = new MutationObserver(() => {
      if (btn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    
    console.log('✅ Плавающая кнопка перезаписана для мобильных устройств');
    return btn;
  }

  /* ── ВИБРАЦИЯ НА ИГРОВЫЕ СОБЫТИЯ (через DOM Mutation Observer) */
  function watchGameNotifications () {
    /* Наблюдаем за добавлением .notification в body */
    const bodyObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.classList && node.classList.contains('notification')) {
            if (node.classList.contains('error')) {
              Haptic.error();
            } else {
              Haptic.medium();
            }
          }

          /* Попап «атака повстанцев» или офлайн-попап */
          if ((node.classList && node.classList.contains('offline-popup')) ||
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
    
    /* Наблюдаем за флоатинг текстом (криты, комбо) */
    const floatObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && node.classList && node.classList.contains('floating-text')) {
            const text = node.textContent || '';
            if (text.includes('CRIT') || text.includes('КРИТ')) {
              Haptic.double();
            } else if (text.includes('x') && text.length < 10) {
              Haptic.light();
            }
          }
        }
      }
    });
    floatObserver.observe(document.body, { childList: true, subtree: true });
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
    if (orig.critical) window.Sounds.critical = (...a) => { Haptic.double(); orig.critical?.(...a); };
    if (orig.combo)   window.Sounds.combo   = (...a) => { Haptic.light();   orig.combo?.(...a);   };
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
    
    /* При загрузке страницы — скроллим к активной вкладке */
    setTimeout(() => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab) scrollTabIntoView(activeTab);
    }, 100);
  }

  /* ── ПРЕДОТВРАЩЕНИЕ ZOOM НА ДВОЙНОЙ ТАП ─────────────────── */
  function preventDoubleTapZoom () {
    let lastTouch = 0;
    let lastTouchTarget = null;
    
    document.addEventListener('touchend', (e) => {
      /* Пропускаем плавающую кнопку — у неё своя логика */
      if (e.target.closest('#floatingMineBtn')) return;
      
      const now = Date.now();
      const delta = now - lastTouch;
      
      /* Двойной тап на интерактивных элементах — предотвращаем zoom */
      if (delta < 300 && delta > 0 && lastTouchTarget === e.target) {
        if (e.target.closest('button, .tab, .status-tab, .craft-btn, .design-btn, .ship-btn, .upgrade-btn, .stat-btn, .log-btn, .auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn')) {
          e.preventDefault();
        }
      }
      
      lastTouch = now;
      lastTouchTarget = e.target;
    }, { passive: false });
    
    /* Также блокируем жест масштабирования двумя пальцами на игровой области */
    const gameContent = document.getElementById('gameContent');
    if (gameContent) {
      gameContent.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
        }
      }, { passive: false });
    }
  }

  /* ── ОТКЛЮЧАЕМ PULL-TO-REFRESH ─────────────────────────── */
  function disablePullToRefresh() {
    let touchStartY = 0;
    
    document.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    document.addEventListener('touchmove', (e) => {
      const scrollTop = document.documentElement.scrollTop;
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - touchStartY;
      
      // Если мы вверху страницы и пытаемся потянуть вниз
      if (scrollTop <= 0 && deltaY > 10) {
        e.preventDefault();
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
    
    /* Также следим за новыми инпутами */
    const observer = new MutationObserver(() => {
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (parseFloat(getComputedStyle(el).fontSize) < 16) {
          el.style.fontSize = '16px';
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ── УЛУЧШЕНИЕ ПРОИЗВОДИТЕЛЬНОСТИ НА МОБИЛЬНЫХ ─────────── */
  function optimizePerformance() {
    /* Отключаем ненужные анимации на слабых устройствах */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    /* Используем passive event listeners для скролла */
    const scrollableElements = document.querySelectorAll('.tab-content, #logBox, .fleet-grid, .craft-grid, .design-grid');
    scrollableElements.forEach(el => {
      el.addEventListener('touchstart', () => {}, { passive: true });
      el.addEventListener('touchmove', () => {}, { passive: true });
    });
  }

  /* ── ИНИЦИАЛИЗАЦИЯ ──────────────────────────────────────── */
  function init () {
    watchGameNotifications();
    setupTabScroll();
    preventDoubleTapZoom();
    disablePullToRefresh();
    fixInputZoom();
    patchSounds();
    optimizePerformance();

    /* Плавающую кнопку патчим после загрузки WASM/игры */
    let patchAttempts = 0;
    const maxAttempts = 30;
    
    function tryPatch() {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.parentNode && btn.getAttribute('data-patched') !== 'true') {
        patchFloatingButton();
        patchSounds();
        console.log('✅ Mobile patch: плавающая кнопка исправлена');
      } else if (!btn && patchAttempts < maxAttempts) {
        patchAttempts++;
        setTimeout(tryPatch, 300);
      } else {
        console.log('⚠️ Mobile patch: плавающая кнопка уже пропатчена или не найдена');
      }
    }
    
    tryPatch();
    
    /* Также добавляем обработчик для динамически создаваемых кнопок */
    const observer = new MutationObserver(() => {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.getAttribute('data-patched') !== 'true') {
        patchFloatingButton();  // внутри уже ставит data-patched на новый узел
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();