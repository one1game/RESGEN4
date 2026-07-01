import { designModule } from './design.js';
import { GameBus, EVENTS } from './game-events.js';

export const craftModule = {
    game: null,
    resources: { ore: 0, coal: 0, plasma: 0, trash: 0, chips: 0 },
    isDay: true, coalEnabled: false, aiProductionBonus: 0,
    computationalPower: 0,
    _isProcessing: false,
    _craftAmount: 1,

    get isSystemActive() {
        if (!this.game) return false;
        try {
            const stats = JSON.parse(this.game.get_statistics());
            return stats.is_day || (stats.coal_enabled && stats.coal_inventory > 0);
        } catch {
            return this.isDay || this.coalEnabled;
        }
    },

    recipes: [
        { id: 'chips', name: 'Чип', desc: 'Электронный компонент из руды',
          cost: { type: 'ore', amount: 100, icon: '⛏️' }, result: { type: 'chips', amount: 1, icon: '🎛️' },
          action: 'craft_chips_from_ore', requiresBlueprint: false },
        { id: 'plasma', name: 'Плазма', desc: 'Энергия из угля',
          cost: { type: 'coal', amount: 50, icon: '🪨' }, result: { type: 'plasma', amount: 1, icon: '⚡' },
          action: 'craft_plasma_from_coal', requiresBlueprint: false },
        { id: 'cargo_ship', name: 'Грузовой корабль', desc: 'Перевозка ресурсов между колониями',
          cost: { type: 'composite', resources: { ore: 200, chips: 50, plasma: 10 }, icon: '🚚' },
          result: { type: 'ship', subtype: 'cargo', amount: 1, icon: '🚚' }, action: 'craft_cargo_ship',
          requiresBlueprint: true, blueprintId: 'cargo' },
        { id: 'scout_ship', name: 'Разведывательный корабль', desc: 'Исследование новых территорий',
          cost: { type: 'composite', resources: { ore: 100, chips: 100, plasma: 20 }, icon: '🔭' },
          result: { type: 'ship', subtype: 'scout', amount: 1, icon: '🔭' }, action: 'craft_scout_ship',
          requiresBlueprint: true, blueprintId: 'scout' },
        { id: 'combat_ship', name: 'Боевой корабль', desc: 'Защита флота и атака угроз',
          cost: { type: 'composite', resources: { ore: 300, chips: 150, plasma: 30 }, icon: '⚔️' },
          result: { type: 'ship', subtype: 'combat', amount: 1, icon: '⚔️' }, action: 'craft_combat_ship',
          requiresBlueprint: true, blueprintId: 'combat' }
    ],

    init(game) {
        this.game = game;
        GameBus.on(EVENTS.STATS_UPDATED, (stats) => this.syncFromStats(stats));
        GameBus.on(EVENTS.INVENTORY_CHANGED, () => {
            if (document.getElementById('craftContainer')?.style.display !== 'none') {
                this.refreshUI(document.getElementById('craftContainer'));
            }
        });
    },

    cleanup() {
        this.game = null;
        this.resources = { ore: 0, coal: 0, plasma: 0, trash: 0, chips: 0 };
        this.isDay = true;
        this.coalEnabled = false;
        this.aiProductionBonus = 0;
        this.computationalPower = 0;
        this._isProcessing = false;
        this._craftAmount = 1;
    },

    syncFromStats(stats) {
        if (!stats) return;
        this.resources = {
            ore: stats.ore_inventory || 0, coal: stats.coal_inventory || 0,
            plasma: stats.plasma_inventory || 0, trash: stats.trash_inventory || 0,
            chips: stats.chips_inventory || 0
        };
        this.isDay = stats.is_day !== undefined ? stats.is_day : true;
        this.coalEnabled = stats.coal_enabled !== undefined ? stats.coal_enabled : true;
        this.aiProductionBonus = Math.min(30, (stats.neuro_evolution || 0) * 1.5);
        this.computationalPower = stats.computational_power || 0;
    },

    getEffectiveCost(recipe, amount = 1) {
        const discount = 1 - (this.aiProductionBonus / 100);
        if (recipe.cost.type === 'composite') {
            const result = {};
            for (const [res, amt] of Object.entries(recipe.cost.resources)) {
                result[res] = Math.max(1, Math.ceil((amt * amount) * discount));
            }
            return result;
        }
        return Math.max(1, Math.ceil((recipe.cost.amount * amount) * discount));
    },

    canCraft(recipe, amount = 1) {
        if (!this.game) return { can: false, reason: '⏳ Игра инициализируется...' };

        if (recipe.requiresBlueprint && recipe.blueprintId) {
            try {
                const stats = JSON.parse(this.game.get_statistics());
                if (stats.blueprint_locked && stats.locked_blueprint_id === recipe.blueprintId) {
                    const remaining = stats.blueprint_lock_remaining || 0;
                    return {
                        can: false,
                        reason: `🔒 Чертёж "${recipe.blueprintId}" УКРАДЕН повстанцами! Подождите ${remaining} тиков.`
                    };
                }
            } catch(e) {}
        }

        const systemInactive = !this.isSystemActive;
        if (systemInactive) return { can: false, reason: '⚫ Система неактивна: ночь без ТЭЦ' };

        if (recipe.result?.type === 'ship') {
            const fleetSize = window.fleetModule?.ships?.length || 0;
            const maxSize = window.fleetModule?.maxFleetSize || 20;
            if (fleetSize >= maxSize) {
                return { can: false, reason: `❌ Флот переполнен (${fleetSize}/${maxSize}). Удалите старые корабли.` };
            }
        }

        if (recipe.requiresBlueprint) {
            let hasBlueprint = false;
            if (window.designModule && typeof window.designModule.isBlueprintUnlocked === 'function') {
                hasBlueprint = window.designModule.isBlueprintUnlocked(recipe.blueprintId);
            } else {
                try {
                    const stats = JSON.parse(this.game.get_statistics());
                    hasBlueprint = stats[`blueprint_${recipe.blueprintId}_unlocked`] === true;
                } catch(e) {}
            }
            if (!hasBlueprint) {
                return { can: false, reason: '📐 Требуется чертеж', isGhost: true };
            }
        }

        const totalCost = this.getEffectiveCost(recipe, amount);
        const missing = [];
        const hints = [];

        if (recipe.cost.type === 'composite') {
            for (const [res, amt] of Object.entries(totalCost)) {
                const have = this.resources[res] || 0;
                if (have < amt) {
                    missing.push(`${this.getResourceIcon(res)} ${res}: ${have}/${amt}`);
                    if (res === 'chips' && this.resources.ore >= (100 * amount)) hints.push('💡 Скрафтите чипы из руды во вкладке Крафт!');
                    if (res === 'plasma' && this.resources.coal >= (50 * amount)) hints.push('💡 Скрафтите плазму из угля во вкладке Крафт!');
                }
            }
        } else {
            const have = this.resources[recipe.cost.type] || 0;
            const need = totalCost;
            if (have < need) {
                missing.push(`${this.getResourceIcon(recipe.cost.type)} ${recipe.cost.type}: ${have}/${need}`);
            }
        }

        if (missing.length > 0) {
            let reason = `❌ Недостаточно: ${missing.join(', ')}`;
            if (hints.length > 0) reason += `\n${hints.join('\n')}`;
            return { can: false, reason, hints };
        }

        return { can: true, reason: null };
    },

    executeCraft(recipeId, amount = 1) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (!recipe) return { success: false, error: 'Рецепт не найден' };

        const check = this.canCraft(recipe, amount);
        if (!check.can) return { success: false, error: check.reason };

        if (this._isProcessing) return { success: false, error: 'Уже выполняется крафт...' };

        this._isProcessing = true;
        try {
            if (typeof this.game[recipe.action] !== 'function') {
                this._isProcessing = false;
                return { success: false, error: `Системная ошибка: метод ${recipe.action} не найден` };
            }

            let result = 'error';
            for (let i = 0; i < amount; i++) {
                try {
                    result = this.game[recipe.action]();
                    if (result !== 'success' && !result.startsWith('success')) break;
                } catch (e) {
                    console.error(`Крафт ${recipe.action} упал:`, e);
                    result = 'error';
                    break;
                }
            }

            if (result === 'success' || result.startsWith('success')) {
                this._isProcessing = false;

                setTimeout(() => {
                    try {
                        if (window.fleetModule && recipe.result?.type === 'ship') {
                            const statsJson = this.game.get_statistics();
                            if (statsJson) {
                                const stats = JSON.parse(statsJson);
                                if (stats.fleet && Array.isArray(stats.fleet)) {
                                    window.fleetModule.ships = stats.fleet;
                                }
                            }
                            window.fleetModule.saveFleet();
                            if (window.cloudSaveNow) window.cloudSaveNow(true);
                            GameBus.emit(EVENTS.FLEET_UPDATED, { ships: window.fleetModule.ships });
                        }
                        GameBus.emit(EVENTS.CRAFT_DONE, { recipe, success: true, amount });
                    } catch(e) {
                        console.error('Ошибка в post-craft обработке:', e);
                    }
                }, 100);
                return { success: true, message: `✅ Создано: ${recipe.result.icon} ${recipe.name} x${amount}`, recipe };
            }

            this._isProcessing = false;
            return { success: false, error: `Ошибка крафта: ${result}` };
        } catch(e) {
            this._isProcessing = false;
            console.error('Ошибка крафта:', e);
            return { success: false, error: 'Системная ошибка' };
        }
    },

    setupEventListeners(container) {
        if (!container) return;
        if (container._clickHandler) container.removeEventListener('click', container._clickHandler);

        container._clickHandler = (e) => {
            const amountBtn = e.target.closest('.craft-amount-btn');
            if (amountBtn) {
                this._craftAmount = parseInt(amountBtn.dataset.amount);
                this.refreshUI(container);
                return;
            }

            const btn = e.target.closest('.craft-btn');
            if (!btn) return;

            if (btn.disabled || btn.classList.contains('disabled') || btn.classList.contains('processing')) {
                if (window.showNotif) window.showNotif('❌ Недостаточно ресурсов или система неактивна', true);
                return;
            }

            const recipeId = btn.dataset.recipe;
            if (!recipeId) return;

            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('processing');
            btn.innerHTML = '⏳...';

            setTimeout(() => {
                try {
                    const result = this.executeCraft(recipeId, this._craftAmount);
                    if (this.game && result.success) {
                        const j = this.game.get_statistics();
                        if (j) this.syncFromStats(JSON.parse(j));
                        GameBus.emit(EVENTS.INVENTORY_CHANGED, { resources: this.resources });
                    } else if (!result.success && window.showNotif) {
                        window.showNotif(result.error, true);
                    }
                } catch(e) {
                    console.error(e);
                } finally {
                    const currentBtn = container.querySelector(`.craft-btn[data-recipe="${recipeId}"]`);
                    if (currentBtn) {
                        currentBtn.disabled = false;
                        currentBtn.classList.remove('processing');
                        currentBtn.innerHTML = originalText;
                    }
                    this.refreshUI(container);
                }
            }, 500);
        };
        container.addEventListener('click', container._clickHandler);
        return container;
    },

    refreshUI(container) {
        if (!container) return;
        const oldScroll = container.scrollTop;
        container.innerHTML = this.renderCraftUI();
        container.scrollTop = oldScroll;
        this.setupEventListeners(container);
    },

    getResourceIcon(res) {
        return { ore: '⛏️', coal: '🪨', plasma: '⚡', chips: '🎛️', trash: '♻️' }[res] || '📦';
    },

    getResourceSummary() {
        const items = [];
        if (this.resources.ore) items.push(`⛏️: ${this.resources.ore}`);
        if (this.resources.coal) items.push(`🪨: ${this.resources.coal}`);
        if (this.resources.plasma) items.push(`⚡: ${this.resources.plasma}`);
        if (this.resources.trash) items.push(`♻️: ${this.resources.trash}`);
        if (this.resources.chips) items.push(`🎛️: ${this.resources.chips}`);
        return items.length ? `Ресурсы: ${items.join(', ')}` : 'Ресурсов нет';
    },

    renderCraftUI() {
        const systemInactive = !this.isSystemActive;
        const aiBonus = this.aiProductionBonus > 0 ? `<div class="ai-bonus-craft">🧠 Бонус ИИ: -${this.aiProductionBonus}% к стоимости</div>` : '';

        const amountSelector = `
            <div class="craft-amount-selector">
                <button class="craft-amount-btn ${this._craftAmount === 1 ? 'active' : ''}" data-amount="1">x1</button>
                <button class="craft-amount-btn ${this._craftAmount === 10 ? 'active' : ''}" data-amount="10">x10</button>
                <button class="craft-amount-btn ${this._craftAmount === 999 ? 'active' : ''}" data-amount="999">МАКС</button>
            </div>
        `;

        let html = `<div class="craft-compact">
            <div class="craft-header"><span>⚙️ СИСТЕМА КРАФТА</span>${systemInactive ? '<span class="system-offline-badge">⚫ СИСТЕМА НЕАКТИВНА</span>' : ''}</div>
            ${amountSelector}
            ${aiBonus}
            <div class="craft-grid">`;

        this.recipes.forEach(recipe => {
            const check = this.canCraft(recipe, this._craftAmount);
            const can = check.can;
            const isGhost = check.isGhost;
            const blockReason = check.reason;

            let costHtml = '';
            const effCost = this.getEffectiveCost(recipe, this._craftAmount);

            if (recipe.cost.type === 'composite') {
                costHtml = `<div class="cost-side">${Object.entries(recipe.cost.resources).map(([res, amt]) => {
                    const have = this.resources[res] || 0;
                    const need = effCost[res];
                    const icon = this.getResourceIcon(res);
                    const discountText = this.aiProductionBonus > 0 && need !== (amt * this._craftAmount) ? ` (было ${amt * this._craftAmount})` : '';
                    return `<div class="cost-item composite ${have < need ? 'insufficient' : ''}"><span class="cost-icon">${icon}</span><span class="cost-count">${have}/${need}${discountText}</span></div>`;
                }).join('')}</div>`;
            } else {
                const have = this.resources[recipe.cost.type] || 0;
                const need = effCost;
                const baseNeed = recipe.cost.amount * this._craftAmount;
                const discountText = this.aiProductionBonus > 0 && need !== baseNeed ? ` (было ${baseNeed})` : '';
                costHtml = `<div class="cost-side"><div class="cost-item ${have < need ? 'insufficient' : ''}"><span class="cost-icon">${recipe.cost.icon}</span><span class="cost-count">${have}/${need}${discountText}</span></div></div>`;
            }

            const ghostClass = isGhost ? 'ghost-preview' : '';
            const ghostOverlay = isGhost ? '<div class="ghost-overlay">🔒 Требуется чертеж</div>' : '';

            html += `<div class="recipe-card ${systemInactive ? 'system-offline' : can ? 'available' : 'locked'} ${ghostClass}">
                ${ghostOverlay}
                <div class="recipe-info">
                    <div class="recipe-name">${recipe.name}</div>
                    <div class="recipe-desc">${recipe.desc}</div>
                </div>
                <div class="recipe-main">
                    ${costHtml}
                    <div class="craft-arrow">⮕</div>
                    <div class="result-side">
                        <div class="result-item">
                            <span class="result-icon">${recipe.result.icon}</span>
                            <span class="result-count">×${recipe.result.amount * this._craftAmount}</span>
                        </div>
                    </div>
                </div>`;

            if (systemInactive) {
                html += `<div class="offline-msg">⚫ Крафт недоступен: система неактивна</div>`;
            } else if (!can && blockReason) {
                const hintsHtml = check.hints ? `<div class="smart-hint">${check.hints.join('<br>')}</div>` : '';
                html += `${hintsHtml}<button class="craft-btn disabled" disabled>❌ НЕДОСТАТОЧНО</button>`;
            } else {
                html += `<button class="craft-btn" data-recipe="${recipe.id}">⚙️ СОЗДАТЬ</button>`;
            }
            html += `</div>`;
        });

        html += `</div><div class="craft-footer"><div class="craft-hint">💡 Для создания кораблей нужны чертежи (вкладка "Разработка")</div><div class="resource-summary">${this.getResourceSummary()}</div></div></div>`;
        return html;
    }
};

export default craftModule;