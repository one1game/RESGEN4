// design.js - СИСТЕМА ЧЕРТЕЖЕЙ КОРАБЛЕЙ
// БАГ №3 ИСПРАВЛЕН: стоимости приведены в соответствие с lib.rs

export const designModule = {
    game: null,
    computationalPower: 0,
    maxComputationalPower: 1000,
    aiResearchBonus: 0,
    
    blueprints: [
        { id: 'cargo', name: 'Грузовой корабль', desc: 'Перевозка ресурсов между колониями', designCost: 500, icon: '🚚', unlocked: false },
        { id: 'scout', name: 'Разведывательный корабль', desc: 'Исследование новых территорий', designCost: 10, icon: '🔭', unlocked: false },
        { id: 'combat', name: 'Боевой корабль', desc: 'Защита флота и атака угроз', designCost: 800, icon: '⚔️', unlocked: false }
    ],
    
    init(game) {
        this.game = game;
        this.loadBlueprints();
        try {
            const status = JSON.parse(game.get_blueprint_status());
            this.blueprints.forEach(bp => {
                if (status.blueprints_unlocked?.[bp.id] === true) {
                    bp.unlocked = true;
                }
            });
            this.aiResearchBonus = status.ai_research_bonus || 0;
        } catch(e) {
            console.warn('Не удалось синхронизировать чертежи с Rust:', e);
        }
        this.saveBlueprints();
        console.log('📐 Модуль дизайна инициализирован');
    },
    
    loadBlueprints() {
        const saved = localStorage.getItem('corebox_ship_blueprints');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.blueprints = this.blueprints.map(bp => {
                    const savedBp = parsed.find(s => s.id === bp.id);
                    return savedBp ? { ...bp, unlocked: savedBp.unlocked } : bp;
                });
            } catch (e) { console.error('Ошибка загрузки чертежей:', e); }
        }
    },
    
    saveBlueprints() {
        const toSave = this.blueprints.map(bp => ({ id: bp.id, unlocked: bp.unlocked }));
        localStorage.setItem('corebox_ship_blueprints', JSON.stringify(toSave));
        try {
            if (this.game && typeof this.game.sync_blueprints === 'function') {
                this.game.sync_blueprints(
                    this.blueprints.find(b => b.id === 'cargo')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'scout')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'combat')?.unlocked || false
                );
            }
        } catch(e) {}
    },
    
    updateComputationalPower(power) {
        if (typeof power === 'object' && power !== null) this.computationalPower = power.power || 0;
        else this.computationalPower = parseInt(power) || 0;
    },
    
    getEffectiveCost(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return Infinity;
        return Math.max(1, blueprint.designCost - (this.aiResearchBonus || 0));
    },
    
    canDesign(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return false;
        if (blueprint.unlocked) return false;
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
        
        try {
            const result = this.game.design_ship(blueprintId);
            if (result === 'success') {
                blueprint.unlocked = true;
                this.saveBlueprints();
                if (this.game) this.computationalPower = this.game.get_computational_power();
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
        container.onclick = null;
        container.onclick = (e) => {
            const btn = e.target.closest('.design-btn:not(.disabled)');
            if (!btn) return;
            const blueprintId = btn.dataset.blueprint;
            if (!blueprintId) return;
            btn.classList.add('processing');
            btn.innerHTML = '⏳ РАЗРАБОТКА...';
            setTimeout(() => {
                const result = this.handleDesignClick(blueprintId);
                if (this.game && result.success) this.computationalPower = this.game.get_computational_power();
                this.refreshUI(container);
            }, 300);
        };
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
        const aiBonusText = this.aiResearchBonus > 0 
            ? `<div class="ai-bonus-design">🧠 ИИ ускоряет разработку: -${this.aiResearchBonus} мощности к стоимости</div>` 
            : '';
        
        let html = `<div class="design-compact">
            <div class="design-header">
                <span>📐 РАЗРАБОТКА ЧЕРТЕЖЕЙ</span>
                <div class="power-display">
                    <span>⚡ Вычислительная мощность:</span>
                    <span class="power-value">${this.computationalPower}</span>
                </div>
            </div>
            ${aiBonusText}
            <div class="design-grid">`;
        
        this.blueprints.forEach(blueprint => {
            const canDesign = this.canDesign(blueprint.id);
            const hasBlueprint = blueprint.unlocked;
            const effectiveCost = this.getEffectiveCost(blueprint.id);
            const hasEnoughPower = this.computationalPower >= effectiveCost;
            
            html += `<div class="blueprint-card ${hasBlueprint ? 'unlocked' : 'locked'}">
                <div class="blueprint-icon">${blueprint.icon}</div>
                <div class="blueprint-info">
                    <div class="blueprint-name">${blueprint.name}</div>
                    <div class="blueprint-desc">${blueprint.desc}</div>
                </div>
                <div class="blueprint-cost">
                    <div class="cost-label">СТОИМОСТЬ ЧЕРТЕЖА:</div>
                    <div class="cost-value">
                        <span class="cost-icon">⚡</span>
                        <span class="cost-amount ${!hasEnoughPower && !hasBlueprint ? 'insufficient' : ''}">
                            ${effectiveCost}${effectiveCost !== blueprint.designCost ? ` (было ${blueprint.designCost})` : ''}
                        </span>
                    </div>
                </div>
                <div class="blueprint-status">`;
            
            if (hasBlueprint) {
                html += `<div class="status-unlocked">✅ ЧЕРТЕЖ СОЗДАН</div>`;
            } else {
                html += `<button class="design-btn ${canDesign ? '' : 'disabled'}" data-blueprint="${blueprint.id}" ${canDesign ? '' : 'disabled'}>
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