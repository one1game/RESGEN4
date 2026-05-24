// design.js - СИСТЕМА ЧЕРТЕЖЕЙ КОРАБЛЕЙ (ИСПРАВЛЕНА - ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ)

export const designModule = {
    game: null,
    computationalPower: 0,
    maxComputationalPower: 1000,
    aiResearchBonus: 0,
    
    blueprints: [
        { id: 'cargo', name: 'Грузовой корабль', desc: 'Перевозка ресурсов между колониями', designCost: 200, icon: '🚚', unlocked: false },
        { id: 'scout', name: 'Разведывательный корабль', desc: 'Исследование новых территорий', designCost: 50, icon: '🔭', unlocked: false },
        { id: 'combat', name: 'Боевой корабль', desc: 'Защита флота и атака угроз', designCost: 800, icon: '⚔️', unlocked: false }
    ],
    
    // БАГ #7 ИСПРАВЛЕНИЕ: единый метод получения ключа localStorage с userId
    _getStorageKey() {
        const userId = window.currentUser?.id;
        return userId ? `corebox_ship_blueprints_${userId}` : 'corebox_ship_blueprints';
    },
    
    init(game) {
        this.game = game;
        this.loadBlueprints();
        if (game && typeof game.get_computational_power === 'function') {
            this.computationalPower = game.get_computational_power() || 0;
        }
        this.syncBlueprintsFromRust();
        console.log('📐 Модуль дизайна инициализирован, мощность:', this.computationalPower);
    },
    
    // ИСПРАВЛЕНИЕ БАГА #1: единый метод синхронизации из Rust
    syncBlueprintsFromRust() {
        try {
            const statsJson = this.game.get_statistics();
            const stats = JSON.parse(statsJson);
            
            this.blueprints.forEach(bp => {
                if (bp.id === 'cargo') bp.unlocked = stats.blueprint_cargo_unlocked === true;
                else if (bp.id === 'scout') bp.unlocked = stats.blueprint_scout_unlocked === true;
                else if (bp.id === 'combat') bp.unlocked = stats.blueprint_combat_unlocked === true;
            });
            
            // БАГ #13 ИСПРАВЛЕНИЕ: читаем ai_research_bonus из статистики
            this.aiResearchBonus = stats.ai_research_bonus || Math.floor((stats.neuro_consciousness || 0) / 20);
            this.computationalPower = stats.computational_power || 0;
            
            this.saveBlueprints();
            console.log('📐 Чертежи синхронизированы из Rust:', this.blueprints.map(b => `${b.id}:${b.unlocked}`).join(', '));
        } catch(e) {
            console.warn('Не удалось синхронизировать чертежи с Rust:', e);
        }
    },
    
    // ИСПРАВЛЕНИЕ БАГА #1: публичный метод проверки статуса чертежа
    isBlueprintUnlocked(blueprintId) {
        const bp = this.blueprints.find(b => b.id === blueprintId);
        if (bp) return bp.unlocked === true;
        
        // Fallback: пробуем из Rust напрямую
        try {
            const statsJson = this.game.get_statistics();
            const stats = JSON.parse(statsJson);
            if (blueprintId === 'cargo') return stats.blueprint_cargo_unlocked === true;
            if (blueprintId === 'scout') return stats.blueprint_scout_unlocked === true;
            if (blueprintId === 'combat') return stats.blueprint_combat_unlocked === true;
        } catch(e) {}
        
        return false;
    },
    
    loadBlueprints() {
        const saved = localStorage.getItem(this._getStorageKey());
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
    
    // БАГ #10 ИСПРАВЛЕНИЕ: поддержка формата объекта и массива
    loadBlueprintsFromCloud(cloudBlueprints) {
        if (!cloudBlueprints) return;
        
        // Формат: {cargo: true, scout: false, combat: false}
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
        console.log('📐 Чертежи загружены из облака');
    },
    
    saveBlueprints() {
        const toSave = this.blueprints.map(bp => ({ id: bp.id, unlocked: bp.unlocked }));
        localStorage.setItem(this._getStorageKey(), JSON.stringify(toSave));
        this.syncBlueprintsToRust();
    },
    
    // ИСПРАВЛЕНИЕ: единый метод синхронизации в Rust
    syncBlueprintsToRust() {
        try {
            if (this.game && typeof this.game.sync_blueprints === 'function') {
                this.game.sync_blueprints(
                    this.blueprints.find(b => b.id === 'cargo')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'scout')?.unlocked || false,
                    this.blueprints.find(b => b.id === 'combat')?.unlocked || false
                );
            }
        } catch(e) {
            console.warn('Ошибка синхронизации чертежей в Rust:', e);
        }
    },
    
    updateComputationalPower(power) {
        if (typeof power === 'object' && power !== null) this.computationalPower = power.power || 0;
        else this.computationalPower = parseInt(power) || 0;
        if (this.computationalPower === 0) {
            console.warn('⚠️ computationalPower = 0 в designModule, возможно проблема загрузки');
        }
    },
    
    // БАГ #5 ИСПРАВЛЕНИЕ: убираем скидку ИИ для чертежей (оставляем только для крафта)
    getEffectiveCost(blueprintId) {
        const blueprint = this.blueprints.find(bp => bp.id === blueprintId);
        if (!blueprint) return Infinity;
        // Убираем скидку ИИ на чертежи - только полная стоимость
        return blueprint.designCost;
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
                
                // ИСПРАВЛЕНИЕ БАГА #3: принудительная синхронизация ВСЕХ систем
                this.syncBlueprintsToRust();
                
                // Обновляем мощность
                this.computationalPower = this.game.get_computational_power();
                
                // ИСПРАВЛЕНИЕ БАГА #3: обновляем craftModule
                if (window.craftModule) {
                    const stats = JSON.parse(this.game.get_statistics());
                    window.craftModule.syncFromStats(stats);
                    
                    // Перерисовываем вкладку крафта, если она открыта
                    const craftContainer = document.getElementById('craftContainer');
                    if (craftContainer && craftContainer.style.display !== 'none') {
                        if (window.updateCraftTab) window.updateCraftTab();
                    }
                }
                
                // ИСПРАВЛЕНИЕ БАГА #3: обновляем fleetModule (на случай если корабли уже есть)
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
                if (this.game && result.success) {
                    this.computationalPower = this.game.get_computational_power();
                    if (window.updateCraftTab) window.updateCraftTab();
                }
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
        if (this.game && typeof this.game.get_computational_power === 'function') {
            const livePower = this.game.get_computational_power();
            if (livePower > 0 || this.computationalPower === 0) {
                this.computationalPower = livePower;
            }
        }
        
        const aiBonusText = this.aiResearchBonus > 0 
            ? `<div class="ai-bonus-design">🧠 ИИ ускоряет разработку: -${this.aiResearchBonus} мощности к стоимости</div>` 
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

export default designModule;