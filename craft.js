// craft.js

import { designModule } from './design.js';

export const craftModule = {
    game: null, resources: { ore: 0, coal: 0, plasma: 0, trash: 0, chips: 0 },
    isDay: true, coalEnabled: false, aiProductionBonus: 0,
    computationalPower: 0,
    
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
    
    init(game) { this.game = game; },
    
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

        if (stats.computational_power !== undefined && window.designModule) {
            window.designModule.updateComputationalPower(stats.computational_power);
        } else if (this.game && typeof this.game.get_computational_power === 'function' && window.designModule) {
            window.designModule.updateComputationalPower(this.game.get_computational_power() || 0);
        }
    },
    
    getEffectiveCost(recipe) {
        const discount = 1 - this.aiProductionBonus / 100;
        if (recipe.cost.type === 'composite') {
            const result = {};
            for (const [res, amt] of Object.entries(recipe.cost.resources)) {
                result[res] = Math.max(1, Math.floor(amt * discount));
            }
            return result;
        }
        return Math.max(1, Math.floor(recipe.cost.amount * discount));
    },
    
    canCraft(recipe) {
        if (!this.isDay && !this.coalEnabled) return false;
        
        if (recipe.requiresBlueprint) {
            let hasBlueprint = false;
            
            if (designModule && typeof designModule.isBlueprintUnlocked === 'function') {
                hasBlueprint = designModule.isBlueprintUnlocked(recipe.blueprintId);
            } else {
                try {
                    const statsJson = this.game.get_statistics();
                    const stats = JSON.parse(statsJson);
                    if (recipe.blueprintId === 'cargo') {
                        hasBlueprint = stats.blueprint_cargo_unlocked === true;
                    } else if (recipe.blueprintId === 'scout') {
                        hasBlueprint = stats.blueprint_scout_unlocked === true;
                    } else if (recipe.blueprintId === 'combat') {
                        hasBlueprint = stats.blueprint_combat_unlocked === true;
                    }
                } catch(e) {}
            }
            
            if (!hasBlueprint) return false;
        }
        
        if (recipe.cost.type === 'composite') {
            const cost = this.getEffectiveCost(recipe);
            return Object.entries(cost).every(([res, amt]) => (this.resources[res] || 0) >= amt);
        }
        
        return (this.resources[recipe.cost.type] || 0) >= this.getEffectiveCost(recipe);
    },
    
    executeCraft(recipeId) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (!recipe) return { success: false, error: 'Рецепт не найден' };
        if (!this.canCraft(recipe)) return { success: false, error: 'Недостаточно ресурсов или чертежа' };
        
        try {
            if (typeof this.game[recipe.action] !== 'function') {
                return { success: false, error: `Системная ошибка: метод ${recipe.action} не найден` };
            }
            
            const result = this.game[recipe.action]();
            if (result === 'success') {
                setTimeout(() => {
                    if (window.fleetModule && recipe.result?.type === 'ship') {
                        window.fleetModule.addShip(recipe.result.subtype);
                    }
                    if (window._refreshFleetWithMissions) {
                        window._refreshFleetWithMissions();
                    }
                }, 100);
                return { success: true, message: `✅ Создан ${recipe.result.icon} ${recipe.name}`, recipe };
            }
            return { success: false, error: `Ошибка крафта: ${result}` };
        } catch(e) { 
            return { success: false, error: 'Системная ошибка' }; 
        }
    },
    
    setupEventListeners(container) {
        if (!container) return;
        container.onclick = null;
        container.onclick = (e) => {
            const btn = e.target.closest('.craft-btn:not(.disabled)');
            if (!btn) return;
            const recipeId = btn.dataset.recipe;
            if (!recipeId) return;
            btn.classList.add('processing');
            btn.innerHTML = '⏳...';
            
            setTimeout(() => {
                try {
                    const result = this.handleCraftClick(recipeId);
                    if (this.game && result.success) {
                        const j = this.game.get_statistics();
                        if (j) this.syncFromStats(JSON.parse(j));
                        if (window.updateDesignTab) window.updateDesignTab();
                    }
                } catch(e) {} finally {
                    this.refreshUI(container);
                }
            }, 300);
        };
        return container;
    },
    
    refreshUI(container) {
        if (!container) return;
        const oldScroll = container.scrollTop;
        container.innerHTML = this.renderCraftUI();
        container.scrollTop = oldScroll;
        this.setupEventListeners(container);
    },
    
    handleCraftClick(recipeId) {
        const result = this.executeCraft(recipeId);
        document.dispatchEvent(new CustomEvent('craftResult', { detail: result }));
        return result;
    },
    
    getResourceIcon(res) { return { ore: '⛏️', coal: '🪨', plasma: '⚡', chips: '🎛️', trash: '♻️' }[res] || '📦'; },
    
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
        const systemInactive = !this.isDay && !this.coalEnabled;
        const aiBonus = this.aiProductionBonus > 0 ? `<div class="ai-bonus-craft">🧠 Бонус ИИ: -${this.aiProductionBonus}% к стоимости</div>` : '';
        const powerDisplay = `<div class="power-display-craft" style="font-size:11px;opacity:0.7;margin-bottom:4px;">⚡ Мощность: ${this.computationalPower}</div>`;
        
        let html = `<div class="craft-compact"><div class="craft-header"><span>⚙️ СИСТЕМА КРАФТА</span>${systemInactive ? '<span class="system-offline-badge">⚫ СИСТЕМА НЕАКТИВНА</span>' : ''}</div>${powerDisplay}${aiBonus}<div class="craft-grid">`;
        
        this.recipes.forEach(recipe => {
            const can = this.canCraft(recipe);
            const hasBlueprint = !recipe.requiresBlueprint || (designModule && designModule.isBlueprintUnlocked(recipe.blueprintId));
            let costHtml = '';
            if (recipe.cost.type === 'composite') {
                const effCost = this.getEffectiveCost(recipe);
                costHtml = `<div class="cost-side">${Object.entries(recipe.cost.resources).map(([res, amt]) => {
                    const have = this.resources[res] || 0;
                    const need = effCost[res];
                    const icon = this.getResourceIcon(res);
                    const discountText = this.aiProductionBonus > 0 && need !== amt ? ` (было ${amt})` : '';
                    return `<div class="cost-item composite ${have < need ? 'insufficient' : ''}"><span class="cost-icon">${icon}</span><span class="cost-count">${have}/${need}${discountText}</span></div>`;
                }).join('')}</div>`;
            } else {
                const have = this.resources[recipe.cost.type] || 0;
                const need = this.getEffectiveCost(recipe);
                const discountText = this.aiProductionBonus > 0 && need !== recipe.cost.amount ? ` (было ${recipe.cost.amount})` : '';
                costHtml = `<div class="cost-side"><div class="cost-item ${have < need ? 'insufficient' : ''}"><span class="cost-icon">${recipe.cost.icon}</span><span class="cost-count">${have}/${need}${discountText}</span></div></div>`;
            }
            html += `<div class="recipe-card ${systemInactive ? 'system-offline' : can ? 'available' : 'locked'}"><div class="recipe-info"><div class="recipe-name">${recipe.name}</div><div class="recipe-desc">${recipe.desc}</div></div><div class="recipe-main">${costHtml}<div class="craft-arrow">⮕</div><div class="result-side"><div class="result-item"><span class="result-icon">${recipe.result.icon}</span><span class="result-count">×${recipe.result.amount}</span></div></div></div>`;
            if (systemInactive) html += `<div class="offline-msg">⚫ Крафт недоступен: система неактивна</div>`;
            else if (!hasBlueprint) html += `<div class="blueprint-required">📐 Требуется чертеж (вкладка "Разработка")</div>`;
            else html += `<button class="craft-btn ${can ? '' : 'disabled'}" data-recipe="${recipe.id}" ${can ? '' : 'disabled'}>${can ? '⚙️ СОЗДАТЬ' : '❌ НЕДОСТАТОЧНО'}</button>`;
            html += `</div>`;
        });
        
        html += `</div><div class="craft-footer"><div class="craft-hint">💡 Для создания кораблей нужны чертежи (вкладка "Разработка")</div><div class="resource-summary">${this.getResourceSummary()}</div></div></div>`;
        return html;
    }
};

export default craftModule;