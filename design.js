import { supabase } from './supabase.js';

export const designModule = {
    game: null,
    computationalPower: 0,
    maxComputationalPower: 1000,
    aiResearchBonus: 0,
    _userId: null,
    _userIdInitialized: false,

    blueprints: [
        { id: 'cargo', name: 'Грузовой корабль', desc: 'Перевозка ресурсов между колониями', designCost: 200, icon: '🚚', unlocked: false },
        { id: 'scout', name: 'Разведывательный корабль', desc: 'Исследование новых территорий', designCost: 50, icon: '🔭', unlocked: false },
        { id: 'combat', name: 'Боевой корабль', desc: 'Защита флота и атака угроз', designCost: 800, icon: '⚔️', unlocked: false }
    ],

    async initUserId() {
        if (this._userId) return this._userId;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
                this._userId = session.user.id;
                window.currentUser = { id: this._userId };
                return this._userId;
            }
        } catch (e) {
            console.warn('initUserId: нет сессии', e);
        }

        return new Promise((resolve) => {
            const { data: { subscription } } = supabase.auth.onAuthStateChange(
                (event, session) => {
                    if (session?.user?.id) {
                        this._userId = session.user.id;
                        window.currentUser = { id: this._userId };
                        subscription.unsubscribe();
                        resolve(this._userId);
                    } else if (event === 'INITIAL_SESSION' && !session) {
                        subscription.unsubscribe();
                        resolve(null);
                    }
                }
            );
            setTimeout(() => {
                subscription.unsubscribe();
                resolve(null);
            }, 5000);
        });
    },

    _getStorageKey() {
        const userId = this._userId || window.currentUser?.id;
        if (!userId) {
            console.warn('design: _getStorageKey — userId не получен, используем анонимный ключ');
            return 'corebox_ship_blueprints_anon';
        }
        return `corebox_ship_blueprints_${userId}`;
    },

    _getDefenseStorageKey() {
        const userId = this._userId || window.currentUser?.id;
        if (!userId) {
            return 'corebox_defense_ship_anon';
        }
        return `corebox_defense_ship_${userId}`;
    },

    _getUserId() {
        if (this._userId) return this._userId;
        if (window.currentUser?.id) {
            this._userId = window.currentUser.id;
            return this._userId;
        }
        if (this.currentUserId) {
            this._userId = this.currentUserId;
            return this._userId;
        }
        return null;
    },

    async init(game, userId = null) {
        this.game = game;
        this._userId = userId || window.currentUser?.id || null;
        this.currentUserId = this._userId;

        if (!this._userId) {
            const id = await this.initUserId();
            if (!id) {
                console.warn('design: userId не получен, модуль в режиме ожидания');
                return;
            }
            this._userId = id;
        }

        this.loadBlueprints();
        this.syncBlueprintsFromRust();

        if (game && typeof game.get_computational_power === 'function') {
            this.computationalPower = game.get_computational_power() || 0;
        }

        if (this._userId && this.computationalPower > 0) {
            console.log('📐 Модуль дизайна инициализирован');
        }
    },

    cleanup() {
        this.game = null;
        this._userId = null;
        this.currentUserId = null;
        this.computationalPower = 0;
        this.aiResearchBonus = 0;
        console.log('📐 Модуль дизайна очищен');
    },

    syncBlueprintsFromRust() {
        if (!this.game) return;

        try {
            const statsJson = this.game.get_statistics();
            if (!statsJson) return;

            const stats = JSON.parse(statsJson);

            this.blueprints.forEach(bp => {
                if (bp.id === 'cargo') bp.unlocked = stats.blueprint_cargo_unlocked === true;
                else if (bp.id === 'scout') bp.unlocked = stats.blueprint_scout_unlocked === true;
                else if (bp.id === 'combat') bp.unlocked = stats.blueprint_combat_unlocked === true;
            });

            const neuroConsc = stats.neuro_consciousness || 0;

            const normalized = neuroConsc > 1.5 ? neuroConsc / 100.0 : neuroConsc;
            this.aiResearchBonus = Math.floor(normalized * 100 / 20);
            this.computationalPower = stats.computational_power || 0;

            this.saveBlueprints();
        } catch(e) {}
    },

    isBlueprintUnlocked(blueprintId) {
        const bp = this.blueprints.find(b => b.id === blueprintId);
        if (bp) return bp.unlocked === true;

        if (!this.game) return false;

        try {
            const statsJson = this.game.get_statistics();
            if (!statsJson) return false;
            const stats = JSON.parse(statsJson);

            if (blueprintId === 'cargo') return stats.blueprint_cargo_unlocked === true;
            if (blueprintId === 'scout') return stats.blueprint_scout_unlocked === true;
            if (blueprintId === 'combat') return stats.blueprint_combat_unlocked === true;
        } catch(e) {}

        return false;
    },

    loadBlueprints() {
        const key = this._getStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.blueprints = this.blueprints.map(bp => {
                    const savedBp = parsed.find(s => s.id === bp.id);
                    return savedBp ? { ...bp, unlocked: savedBp.unlocked } : bp;
                });
            } catch (e) {}
        }
    },

    loadBlueprintsFromCloud(cloudBlueprints) {
        if (!cloudBlueprints) return;
        const userId = this._userId || window.currentUser?.id;
        if (!userId) {
            console.warn('design: loadBlueprintsFromCloud пропущен — нет userId');
            return;
        }
        if (typeof cloudBlueprints === 'object' && !Array.isArray(cloudBlueprints)) {
            this.blueprints.forEach(bp => {
                if (cloudBlueprints[bp.id] !== undefined) {
                    bp.unlocked = cloudBlueprints[bp.id] === true;
                }
            });
        } else if (Array.isArray(cloudBlueprints)) {
            cloudBlueprints.forEach(cb => {
                const bp = this.blueprints.find(b => b.id === cb.id);
                if (bp && cb.unlocked !== undefined) {
                    bp.unlocked = cb.unlocked;
                }
            });
        }

        this.saveBlueprints();
        this.syncBlueprintsToRust();
    },

    saveBlueprints() {
        const userId = this._userId || window.currentUser?.id;
        if (!userId) {
            console.warn('design: saveBlueprints пропущен — нет userId');
            return;
        }
        const toSave = this.blueprints.map(bp => ({ id: bp.id, unlocked: bp.unlocked }));
        localStorage.setItem(this._getStorageKey(), JSON.stringify(toSave));
        this.syncBlueprintsToRust();
    },

    syncBlueprintsToRust() {
        if (!this.game) return;

        try {
            if (typeof this.game.sync_blueprints === 'function') {
                this.game.sync_blueprints(
                    this.blueprints.find(b => b.id === 'cargo')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'scout')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'combat')?.unlocked || false
                );
            }
        } catch(e) {}
    },

    updateComputationalPower(power) {
        if (typeof power === 'object' && power !== null) {
            this.computationalPower = power.power || 0;
        } else {
            this.computationalPower = parseInt(power) || 0;
        }
    },

    getEffectiveCost(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return Infinity;
        const discountPercent = Math.min(0.30, this.aiResearchBonus * 0.03);
        return Math.max(1, Math.ceil(blueprint.designCost * (1 - discountPercent)));
    },

    canDesign(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return false;
        if (blueprint.unlocked) return false;

        if (this.game) {
            try {
                const stats = JSON.parse(this.game.get_statistics());
                if (stats.blueprint_locked && stats.locked_blueprint_id === blueprintId) {
                    return false;
                }
            } catch(e) {}
        }

        const effectiveCost = this.getEffectiveCost(blueprintId);
        return this.computationalPower >= effectiveCost;
    },

    designBlueprint(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return { success: false, error: 'Чертеж не найден' };
        if (blueprint.unlocked) return { success: false, error: 'Чертеж уже создан' };

        const effectiveCost = this.getEffectiveCost(blueprintId);
        if (this.computationalPower < effectiveCost) {
            return { success: false, error: `Недостаточно мощности (нужно: ${effectiveCost})` };
        }

        if (!this.game) {
            return { success: false, error: 'Игра не инициализирована' };
        }

        try {
            const result = this.game.design_ship(blueprintId);
            if (result === 'success') {
                blueprint.unlocked = true;
                this.saveBlueprints();
                this.syncBlueprintsToRust();

                if (this.game && typeof this.game.get_computational_power === 'function') {
                    this.computationalPower = this.game.get_computational_power();
                }

                if (window.craftModule && this.game) {
                    try {
                        const stats = JSON.parse(this.game.get_statistics());
                        window.craftModule.syncFromStats(stats);

                        const craftContainer = document.getElementById('craftContainer');
                        if (craftContainer && craftContainer.style.display !== 'none') {
                            if (window.updateCraftTab) window.updateCraftTab();
                        }
                    } catch(e) {}
                }

                if (window.fleetModule && window._refreshFleetWithMissions) {
                    window._refreshFleetWithMissions();
                }

                return { success: true, message: `✅ Чертеж "${blueprint.name}" создан!`, blueprint: blueprint };
            } else {
                return { success: false, error: 'Ошибка при создании чертежа' };
            }
        } catch (error) {
            console.error('❌ Ошибка создания чертежа:', error);
            return { success: false, error: 'Системная ошибка' };
        }
    },

    setupEventListeners(container) {
        if (!container) return;

        if (container._clickHandler) {
            container.removeEventListener('click', container._clickHandler);
            delete container._clickHandler;
        }

        const clickHandler = (e) => {
            const btn = e.target.closest('.design-btn:not(.disabled)');
            if (!btn) return;

            const blueprintId = btn.dataset.blueprint;
            if (!blueprintId) return;

            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('processing');
            btn.innerHTML = '⏳ РАЗРАБОТКА...';

            setTimeout(() => {
                try {
                    const result = this.handleDesignClick(blueprintId);
                    if (this.game && result.success) {
                        this.computationalPower = this.game.get_computational_power();
                        if (window.updateCraftTab) window.updateCraftTab();
                    } else if (!result.success && window.showNotif) {
                        window.showNotif(result.error, true);
                    }
                } catch (err) {
                    console.error('Design panic:', err);
                    if (window.showNotif) window.showNotif('Ошибка ядра при разработке', true);
                } finally {
                    const currentBtn = container.querySelector(`.design-btn[data-blueprint="${blueprintId}"]`);
                    if (currentBtn) {
                        currentBtn.disabled = false;
                        currentBtn.classList.remove('processing');
                        const canDesignNow = this.canDesign(blueprintId);
                        currentBtn.innerHTML = canDesignNow ? '📐 СОЗДАТЬ ЧЕРТЕЖ' : '❌ НЕДОСТАТОЧНО МОЩНОСТИ';
                    }
                    this.refreshUI(container);
                }
            }, 300);
        };

        container.addEventListener('click', clickHandler);
        container._clickHandler = clickHandler;

        return container;
    },

    refreshUI(container) {
        if (!container) return;
        const oldScroll = container.scrollTop;
        container.innerHTML = this.renderDesignUI();
        container.scrollTop = oldScroll;
        this.setupEventListeners(container);
    },

    handleDesignClick(blueprintId) {
        const result = this.designBlueprint(blueprintId);
        document.dispatchEvent(new CustomEvent('designResult', { detail: result }));
        return result;
    },

    renderDesignUI() {
        if (this.game && typeof this.game.get_computational_power === 'function') {
            const livePower = this.game.get_computational_power();
            this.computationalPower = livePower;
        }

        let lockedBlueprintId = null;
        let lockedRemaining = 0;
        if (this.game) {
            try {
                const stats = JSON.parse(this.game.get_statistics());
                if (stats.blueprint_locked) {
                    lockedBlueprintId = stats.locked_blueprint_id;
                    lockedRemaining = stats.blueprint_lock_remaining || 0;
                }
            } catch(e) {}
        }

        const aiBonusText = this.aiResearchBonus > 0
            ? `<div class="ai-bonus-design">🧠 ИИ ускоряет разработку: -${this.aiResearchBonus * 0.03 * 100}% к стоимости</div>`
            : '';

        let html = `<div class="design-compact">
            <div class="design-header">
                <span>📐 РАЗРАБОТКА ЧЕРТЕЖЕЙ</span>
                <div class="power-display">
                    <span>⚡ Вычислительная мощность:</span>
                    <span class="power-value ${this.computationalPower === 0 ? 'power-zero' : ''}">${this.computationalPower}</span>
                </div>
            </div>
            ${aiBonusText}
            <div class="design-grid">`;

        this.blueprints.forEach(blueprint => {
            const canDesign = this.canDesign(blueprint.id);
            const hasBlueprint = blueprint.unlocked;
            const effectiveCost = this.getEffectiveCost(blueprint.id);
            const hasEnoughPower = this.computationalPower >= effectiveCost;

            const isLocked = lockedBlueprintId === blueprint.id;
            const lockBadge = isLocked
                ? `<div style="background:rgba(255,74,74,0.2);border:1px solid #ff4444;border-radius:4px;padding:6px;margin-bottom:8px;font-size:11px;color:#ff6644;">
                    🔒 ЧЕРТЁЖ УКРАДЕН! Подождите ${lockedRemaining} тиков.
                   </div>`
                : '';

            const originalCost = blueprint.designCost;
            const discountPct = Math.min(0.30, this.aiResearchBonus * 0.03);
            const discountText = discountPct > 0.01 ? ` (было ${originalCost}, -${Math.round(discountPct * 100)}%)` : '';

            html += `<div class="blueprint-card ${hasBlueprint ? 'unlocked' : 'locked'}">
                <div class="blueprint-icon">${blueprint.icon}</div>
                <div class="blueprint-info">
                    <div class="blueprint-name">${blueprint.name}</div>
                    <div class="blueprint-desc">${blueprint.desc}</div>
                </div>
                ${lockBadge}
                <div class="blueprint-cost">
                    <div class="cost-label">СТОИМОСТЬ ЧЕРТЕЖА:</div>
                    <div class="cost-value">
                        <span class="cost-icon">⚡</span>
                        <span class="cost-amount ${!hasEnoughPower && !hasBlueprint ? 'insufficient' : ''}">
                            ${effectiveCost}${discountText}
                        </span>
                    </div>
                </div>
                <div class="blueprint-status">`;

            if (hasBlueprint) {
                html += `<div class="status-unlocked">✅ ЧЕРТЕЖ СОЗДАН</div>`;
            } else if (isLocked) {
                html += `<button class="design-btn disabled" disabled>🔒 УКРАДЕН</button>`;
            } else {
                html += `<button class="design-btn ${canDesign ? '' : 'disabled'}" data-blueprint="${blueprint.id}" data-can-design="${canDesign}" ${canDesign ? '' : 'disabled'}>
                    ${canDesign ? '📐 СОЗДАТЬ ЧЕРТЕЖ' : '❌ НЕДОСТАТОЧНО МОЩНОСТИ'}
                </button>`;
            }

            html += `</div></div>`;
        });

        html += `</div>
            <div class="design-footer">
                <div class="design-hint">💡 Вычислительная мощность добывается кликами по кнопке "Добыча"</div>
                <div class="blueprint-summary">Создано чертежей: ${this.blueprints.filter(bp => bp.unlocked).length}/${this.blueprints.length}</div>
            </div>
        </div>`;

        return html;
    }
};

export default designModule;