// ========== mobile-patch.js (ИСПРАВЛЕННАЯ ВЕРСИЯ) ==========

/**
 * CoreBox 3.2 — МОБИЛЬНЫЙ JS-ПАТЧ
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
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }
  }

  window.Haptic = Haptic;

  // Вибрация на кнопки
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

  // Плавающая кнопка с long-press
  function patchFloatingButton() {
    const oldBtn = document.getElementById('floatingMineBtn');
    if (!oldBtn) return null;
    
    if (oldBtn.getAttribute('data-patched') === 'true') {
      console.log('✅ Плавающая кнопка уже пропатчена');
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
    const LONG_PRESS_MS = 600;
    const MOVE_THRESHOLD = 10;
    
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
    
    btn.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      isLongPress = false;
      clickProcessed = false;
      
      btn.style.transform = 'scale(0.92)';
      Haptic.light();
      
      pressTimer = setTimeout(() => {
        isLongPress = true;
        Haptic.longPress();
        btn.style.transform = '';
        if (typeof window.toggleAutoClicking === 'function') {
          window.toggleAutoClicking();
        }
      }, LONG_PRESS_MS);
    }, { passive: true });
    
    btn.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartX);
      const deltaY = Math.abs(touch.clientY - touchStartY);
      
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        clearTimeout(pressTimer);
        isLongPress = false;
      }
    }, { passive: true });
    
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
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
    });
    
    btn.addEventListener('touchcancel', () => {
      clearTimeout(pressTimer);
      isLongPress = false;
      btn.style.transform = '';
      clickProcessed = false;
    });
    
    const observer = new MutationObserver(() => {
      if (btn.classList.contains('auto-clicking')) {
        Haptic.longPress();
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    
    console.log('✅ Плавающая кнопка пропатчена для мобильных устройств');
    return btn;
  }

  function watchGameNotifications () {
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

          if ((node.classList && node.classList.contains('offline-popup')) ||
              node.id === 'attackWarning') {
            Haptic.warning();
          }
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: false });

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

  // ИСПРАВЛЕНО: убрана попытка патча Sounds (ES-модули не кладут экспорты в window)
  // Звуки и так работают через Haptic при кликах

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

  function preventDoubleTapZoom () {
    let lastTouch = 0;
    let lastTouchTarget = null;
    
    document.addEventListener('touchend', (e) => {
      if (e.target.closest('#floatingMineBtn')) return;
      
      const now = Date.now();
      const delta = now - lastTouch;
      
      if (delta < 300 && delta > 0 && lastTouchTarget === e.target) {
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

  function fixInputZoom () {
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (parseFloat(getComputedStyle(el).fontSize) < 16) {
        el.style.fontSize = '16px';
      }
    });
    
    const observer = new MutationObserver(() => {
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (parseFloat(getComputedStyle(el).fontSize) < 16) {
          el.style.fontSize = '16px';
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

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

  function init () {
    watchGameNotifications();
    setupTabScroll();
    preventDoubleTapZoom();
    disablePullToRefresh();
    fixInputZoom();
    optimizePerformance();

    let patchAttempts = 0;
    const maxAttempts = 30;
    
    function tryPatch() {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.parentNode && btn.getAttribute('data-patched') !== 'true') {
        patchFloatingButton();
        console.log('✅ Mobile patch: плавающая кнопка исправлена');
      } else if (!btn && patchAttempts < maxAttempts) {
        patchAttempts++;
        setTimeout(tryPatch, 300);
      }
    }
    
    tryPatch();
    
    const observer = new MutationObserver(() => {
      const btn = document.getElementById('floatingMineBtn');
      if (btn && btn.getAttribute('data-patched') !== 'true') {
        patchFloatingButton();
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