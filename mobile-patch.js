(function () {
  'use strict';

  /* ============================================================
     HAPTIC FEEDBACK
     ============================================================ */
  const Haptic = {
    light () { _vib([10]); },
    medium () { _vib([20]); },
    heavy () { _vib([40]); },
    double () { _vib([15, 60, 15]); },
    success () { _vib([10, 40, 10, 40, 30]); },
    error () { _vib([60, 30, 60]); },
    warning () { _vib([80, 50, 80, 50, 80]); },
    longPress () { _vib([100]); },
  };

  function _vib (pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* noop */ }
    }
  }

  window.Haptic = Haptic;

  /* ============================================================
     TOUCH FEEDBACK ON BUTTONS
     ============================================================ */
  document.addEventListener('pointerdown', function (e) {
    const btn = e.target.closest(
      'button, .tab, .status-tab, .craft-btn, .design-btn, ' +
      '.ship-btn, .upgrade-btn, .stat-btn, .log-btn, ' +
      '.auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn, ' +
      '.cc-op-btn, .cc-panel-hdr, .op-btn'
    );
    if (!btn) return;

    if (btn.disabled || btn.classList.contains('disabled')) {
      Haptic.error();
      return;
    }

    if (btn.classList.contains('upgrade-btn') ||
        btn.classList.contains('craft-btn') ||
        btn.classList.contains('design-btn')) {
      Haptic.success();
    } else if (btn.id === 'resetStatsBtn') {
      Haptic.heavy();
    } else if (btn.classList.contains('tab') ||
               btn.classList.contains('status-tab')) {
      Haptic.light();
    } else {
      Haptic.light();
    }
  }, { passive: true });

  /* ============================================================
     FLOATING BUTTON PATCH (long-press auto-mining)
     ============================================================ */
  let _floatingButtonPatched = false;

  function patchFloatingButton() {
    const oldBtn = document.getElementById('floatingMineBtn');
    if (!oldBtn) return null;

    if (oldBtn.getAttribute('data-patched') === 'true') {
      return oldBtn;
    }

    const newBtn = document.createElement('div');
    newBtn.id = oldBtn.id;
    newBtn.className = oldBtn.className;

    for (let i = 0; i < oldBtn.attributes.length; i++) {
      const attr = oldBtn.attributes[i];
      newBtn.setAttribute(attr.name, attr.value);
    }

    newBtn.innerHTML = oldBtn.innerHTML;
    newBtn.setAttribute('data-patched', 'true');

    oldBtn.parentNode.replaceChild(newBtn, oldBtn);

    const btn = document.getElementById('floatingMineBtn');
    if (!btn) return null;

    let pressTimer = null;
    let isLongPress = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let clickProcessed = false;
    const LONG_PRESS_MS = window.gameConfig?.auto_click_config?.long_press_duration ?? 600;
    const MOVE_THRESHOLD = 10;

    const handlePointerDown = (e) => {
      e.preventDefault();
      isLongPress = false;
      clickProcessed = false;
      const touch = e.touches ? e.touches[0] : e;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      btn.style.transform = 'scale(0.94)';
      Haptic.light();

      pressTimer = setTimeout(() => {
        isLongPress = true;
        Haptic.longPress();
        btn.style.transform = '';
        // ⚠️ Проверяем перегрев перед запуском автокликера
        const heat = window.cachedRustStats?.turbine_heat ?? 0;
        if (heat >= 100) {
          if (typeof window.addToLog === 'function') {
            window.addToLog('🌡️ Перегрев! Охладите турбину перед запуском автокликов', 'warning');
          }
          return;
        }
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, LONG_PRESS_MS);
    };

    const handlePointerUp = (e) => {
      if (e) e.preventDefault();
      clearTimeout(pressTimer);
      const elapsed = Date.now() - touchStartTime;
      btn.style.transform = '';

      if (!isLongPress && !clickProcessed && elapsed < LONG_PRESS_MS) {
        clickProcessed = true;
        setTimeout(() => { clickProcessed = false; }, 200);
        if (typeof window.handleClick === 'function') {
          window.handleClick();
        }
      }
      isLongPress = false;
    };

    const handlePointerMove = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      const deltaX = Math.abs(touch.clientX - touchStartX);
      const deltaY = Math.abs(touch.clientY - touchStartY);
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        clearTimeout(pressTimer);
        isLongPress = false;
        btn.style.transform = '';
      }
    };

    btn.addEventListener('mousedown', handlePointerDown);
    btn.addEventListener('mouseup', handlePointerUp);
    btn.addEventListener('mouseleave', handlePointerUp);
    btn.addEventListener('mousemove', handlePointerMove);
    btn.addEventListener('touchstart', handlePointerDown, { passive: false });
    btn.addEventListener('touchend', handlePointerUp, { passive: false });
    btn.addEventListener('touchmove', handlePointerMove, { passive: true });
    btn.addEventListener('touchcancel', handlePointerUp, { passive: true });

    const observer = new MutationObserver(() => {
      if (btn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] });

    _floatingButtonPatched = true;
    return btn;
  }

  /* ============================================================
     OBSERVERS: уведомления, атаки, floating text
     ============================================================ */
  let _bodyObserver = null;
  let _warningObserver = null;
  let _floatObserver = null;
  let _domObserver = null;

  function watchGameNotifications () {
    if (_bodyObserver) _bodyObserver.disconnect();

    _bodyObserver = new MutationObserver((mutations) => {
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

          if ((node.classList && node.classList.contains('offline-popup')) ||
              node.id === 'attackWarning') {
            Haptic.warning();
          }
        }

        for (const node of m.removedNodes) {
          if (node instanceof HTMLElement && node.id === 'floatingMineBtn') {
            _floatingButtonPatched = false;
          }
        }
      }
    });
    _bodyObserver.observe(document.body, { childList: true, subtree: true });

    const warningEl = document.getElementById('attackWarning');
    if (warningEl) {
      if (_warningObserver) _warningObserver.disconnect();
      _warningObserver = new MutationObserver(() => {
        if (warningEl.style.display !== 'none' && warningEl.textContent.trim()) {
          Haptic.warning();
        }
      });
      _warningObserver.observe(warningEl, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        characterData: true,
      });
    }

    if (_floatObserver) _floatObserver.disconnect();
    _floatObserver = new MutationObserver((mutations) => {
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
    _floatObserver.observe(document.body, { childList: true, subtree: true });

    if (_domObserver) _domObserver.disconnect();
    _domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && node.id === 'floatingMineBtn') {
            if (!_floatingButtonPatched) {
              patchFloatingButton();
            }
          }
        }
      }
    });
    _domObserver.observe(document.body, { childList: true, subtree: true });
  }

  window._disconnectMobileObservers = function() {
    if (_bodyObserver) { _bodyObserver.disconnect(); _bodyObserver = null; }
    if (_warningObserver) { _warningObserver.disconnect(); _warningObserver = null; }
    if (_floatObserver) { _floatObserver.disconnect(); _floatObserver = null; }
    if (_domObserver) { _domObserver.disconnect(); _domObserver = null; }
    if (_inputZoomObserver) { _inputZoomObserver.disconnect(); _inputZoomObserver = null; }
  };

  /* ============================================================
     TAB SCROLL (авто-скролл активной вкладки в видимую область)
     ============================================================ */
  function scrollTabIntoView (tabEl) {
    if (!tabEl) return;
    tabEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function setupTabScroll () {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;

    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      setTimeout(() => scrollTabIntoView(tab), 50);
    });

    setTimeout(() => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab) scrollTabIntoView(activeTab);
    }, 100);
  }

  /* ============================================================
     SWIPE GESTURES: свайп влево/вправо по контенту = переключение вкладок
     ============================================================ */
  function setupSwipeNavigation() {
    const tabContentArea = document.querySelector('.main');
    if (!tabContentArea) return;

    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeActive = false;

    const TABS_ORDER = [
      'inventory', 'upgrades', 'trade', 'quests',
      'command', 'craft', 'design', 'fleet', 'space'
    ];

    tabContentArea.addEventListener('touchstart', (e) => {
      // Не свайпаем если тач на кнопке, input, или карте
      if (e.target.closest('button, input, textarea, select, #space-star-map, .star-map, #floatingMineBtn, canvas')) {
        swipeActive = false;
        return;
      }

      const touch = e.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeActive = true;
    }, { passive: true });

    tabContentArea.addEventListener('touchmove', (e) => {
      if (!swipeActive) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = touch.clientY - swipeStartY;

      // Только горизонтальный свайп (угол < 30 градусов)
      if (Math.abs(deltaX) > Math.abs(deltaY) * 2 && Math.abs(deltaX) > 60) {
        e.preventDefault();
      }
    }, { passive: false });

    tabContentArea.addEventListener('touchend', (e) => {
      if (!swipeActive) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = touch.clientY - swipeStartY;

      // Минимальная дистанция свайпа: 80px
      if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        const activeTab = document.querySelector('.tab.active');
        if (!activeTab) return;

        const currentTabId = activeTab.dataset.tab;
        const currentIndex = TABS_ORDER.indexOf(currentTabId);

        if (currentIndex === -1) return;

        const direction = deltaX > 0 ? -1 : 1; // свайп вправо = предыдущая, влево = следующая
        const newIndex = currentIndex + direction;

        if (newIndex >= 0 && newIndex < TABS_ORDER.length) {
          const newTab = document.querySelector(`.tab[data-tab="${TABS_ORDER[newIndex]}"]`);
          if (newTab) {
            newTab.click();
            Haptic.light();
          }
        }
      }

      swipeActive = false;
    });
  }

  /* ============================================================
     DOUBLE-TAP ZOOM PREVENTION
     ============================================================ */
  function preventDoubleTapZoom () {
    let lastTouch = 0;
    let lastTouchTarget = null;

    document.addEventListener('touchend', (e) => {
      if (e.target.closest('#floatingMineBtn')) return;

      const now = Date.now();
      const delta = now - lastTouch;

      const isSameElement = lastTouchTarget === e.target ||
                           (lastTouchTarget && lastTouchTarget.contains(e.target)) ||
                           (e.target && e.target.contains(lastTouchTarget));

      if (delta < 300 && delta > 0 && isSameElement) {
        if (e.target.closest('button, .tab, .status-tab, .craft-btn, .design-btn, .ship-btn, .upgrade-btn, .stat-btn, .log-btn, .auth-btn, .trade-mode-btn, .toggle-btn, .logout-btn')) {
          e.preventDefault();
        }
      }

      lastTouch = now;
      lastTouchTarget = e.target;
    }, { passive: false });

    const gameContent = document.getElementById('gameContent');
    if (gameContent) {
      gameContent.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
        }
      }, { passive: false });
    }
  }

  /* ============================================================
     PULL-TO-REFRESH DISABLE
     ============================================================ */
  function disablePullToRefresh() {
    let touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      const scrollTop = document.documentElement.scrollTop;
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - touchStartY;

      if (scrollTop <= 0 && deltaY > 10) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  /* ============================================================
     INPUT ZOOM FIX (iOS)
     ============================================================ */
  let _inputZoomObserver = null;

  function fixInputZoom () {
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (parseFloat(getComputedStyle(el).fontSize) < 16) {
        el.style.fontSize = '16px';
      }
    });

    if (_inputZoomObserver) {
      _inputZoomObserver.disconnect();
    }

    _inputZoomObserver = new MutationObserver(() => {
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (parseFloat(getComputedStyle(el).fontSize) < 16) {
          el.style.fontSize = '16px';
        }
      });
    });
    _inputZoomObserver.observe(document.body, { childList: true, subtree: true });
  }

  window._disconnectInputZoomObserver = function() {
    if (_inputZoomObserver) {
      _inputZoomObserver.disconnect();
      _inputZoomObserver = null;
    }
  };

  /* ============================================================
     ORIENTATION CHANGE HANDLER
     ============================================================ */
  function handleOrientationChange() {
    // Ре-скроллим активную вкладку при повороте
    setTimeout(() => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab) scrollTabIntoView(activeTab);
    }, 300);
  }

  /* ============================================================
     PERFORMANCE OPTIMIZATION
     ============================================================ */
  function optimizePerformance() {
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

    const scrollableElements = document.querySelectorAll('.tab-content, #logBox, .fleet-grid, .craft-grid, .design-grid');
    scrollableElements.forEach(el => {
      el.addEventListener('touchstart', () => {}, { passive: true });
      el.addEventListener('touchmove', () => {}, { passive: true });
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init () {
    watchGameNotifications();
    setupTabScroll();
    setupSwipeNavigation();
    preventDoubleTapZoom();
    disablePullToRefresh();
    fixInputZoom();
    optimizePerformance();

    window.addEventListener('orientationchange', handleOrientationChange);

    // Retry patching floating button
    let patchAttempts = 0;
    const maxAttempts = 30;

    function tryPatch() {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.parentNode && btn.getAttribute('data-patched') !== 'true') {
        patchFloatingButton();
      } else if (!btn && patchAttempts < maxAttempts) {
        patchAttempts++;
        setTimeout(tryPatch, 300);
      }
    }

    tryPatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
