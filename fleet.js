// fleet.js - ПОЛНАЯ ВЕРСИЯ С МУЛЬТИПЛЕЕРНЫМИ МЕТОДАМИ

export const fleetModule = {
    game: null,
    ships: [],
    maxFleetSize: 20,
    alertMultiplier: 1.0,
    aiMode: 'normal',
    lastDamageProcessedAttackId: null,
    lastProcessedAttackTime: 0,
    
    shipTypes: {
        cargo: {
            name: 'Грузовой корабль',
            icon: '🚚',
            capacity: 500,
            speed: 1.0,
            combat: 5
        },
        scout: {
            name: 'Разведывательный корабль',
            icon: '🔭',
            capacity: 100,
            speed: 3.0,
            combat: 15
        },
        combat: {
            name: 'Боевой корабль',
            icon: '⚔️',
            capacity: 200,
            speed: 2.0,
            combat: 50
        }
    },
    
    init(game) {
        this.game = game;
        this.loadFleet();
        this.lastDamageProcessedAttackId = null;
        this.lastProcessedAttackTime = 0;
        console.log('🚀 Модуль флота инициализирован');
    },
    
    loadFleet() {
        const saved = localStorage.getItem('corebox_fleet');
        if (saved) {
            try {
                this.ships = JSON.parse(saved);
            } catch (e) {
                console.error('Ошибка загрузки флота:', e);
                this.ships = [];
            }
        }
    },
    
    saveFleet() {
        localStorage.setItem('corebox_fleet', JSON.stringify(this.ships));
    },
    
    addShip(shipType, name = null) {
        if (this.ships.length >= this.maxFleetSize) {
            return { success: false, error: 'Достигнут максимальный размер флота' };
        }
        
        const typeConfig = this.shipTypes[shipType];
        if (!typeConfig) {
            return { success: false, error: 'Неизвестный тип корабля' };
        }
        
        const shipId = 'ship_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const shipName = name || `${typeConfig.name} #${this.ships.filter(s => s.type === shipType).length + 1}`;
        
        const newShip = {
            id: shipId,
            type: shipType,
            name: shipName,
            level: 1,
            health: 100,
            maxHealth: 100,
            experience: 0,
            created: new Date().toISOString(),
            missions: 0,
            onAlert: false,
            onMission: false,  // ← НОВОЕ ПОЛЕ ДЛЯ МУЛЬТИПЛЕЕРА
            ...typeConfig
        };
        
        this.ships.push(newShip);
        this.saveFleet();
        
        return {
            success: true,
            message: `✅ Создан ${typeConfig.icon} ${shipName}`,
            ship: newShip
        };
    },
    
    removeShip(shipId) {
        const index = this.ships.findIndex(ship => ship.id === shipId);
        if (index !== -1) {
            const removed = this.ships.splice(index, 1)[0];
            this.saveFleet();
            return { success: true, message: `Корабль "${removed.name}" удален`, ship: removed };
        }
        return { success: false, error: 'Корабль не найден' };
    },
    
    // НОВЫЙ МЕТОД: Найти свободный корабль нужного типа
    getAvailableShip(shipType) {
        return this.ships.find(s =>
            s.type === shipType &&
            s.health > 20 &&       // не на последнем дыхании
            !s.onMission           // не в миссии
        ) || null;
    },

    // НОВЫЙ МЕТОД: Пометить корабль занятым / свободным
    setShipMissionStatus(shipId, onMission) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return;
        ship.onMission = onMission;
        if (!onMission) {
            // Корабль вернулся — начисляем опыт и миссию
            ship.missions   = (ship.missions   || 0) + 1;
            ship.experience = (ship.experience || 0) + 10;
        }
        this.saveFleet();
    },
    
    getFleetDefenseContribution() {
        let total = this.ships
            .filter(s => s.type === 'combat')
            .reduce((total, ship) => total + Math.floor(ship.combat * (ship.health / ship.maxHealth)), 0);
        
        if (this.alertMultiplier > 1) {
            total = Math.floor(total * this.alertMultiplier);
        }
        return total;
    },
    
    getScoutReconBonus() {
        return this.ships
            .filter(s => s.type === 'scout')
            .reduce((total, ship) => total + Math.floor(ship.speed * 2 * (ship.health / ship.maxHealth)), 0);
    },
    
    getCargoMiningBonus() {
        const cargoCapacity = this.ships
            .filter(s => s.type === 'cargo')
            .reduce((total, ship) => total + Math.floor(ship.capacity * (ship.health / ship.maxHealth)), 0);
        return Math.floor(cargoCapacity / 500);
    },
    
    repairShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return { success: false, error: 'Корабль не найден' };
        if (ship.health >= ship.maxHealth) return { success: false, error: 'Корабль уже исправен' };
        
        const damage = ship.maxHealth - ship.health;
        const oreCost = Math.ceil(damage * 0.2);
        const chipsCost = Math.ceil(damage * 0.05);
        
        let success = false;
        try {
            if (this.game && typeof this.game.apply_fleet_repair === 'function') {
                success = this.game.apply_fleet_repair(oreCost, chipsCost);
            } else {
                const statsJson = this.game?.get_statistics();
                if (statsJson) {
                    const stats = JSON.parse(statsJson);
                    if (stats.ore_inventory >= oreCost && stats.chips_inventory >= chipsCost) {
                        success = true;
                    }
                }
            }
        } catch(e) {
            console.warn('Ошибка при ремонте через Rust:', e);
            return { success: false, error: 'Ошибка системы' };
        }
        
        if (success) {
            ship.health = ship.maxHealth;
            this.saveFleet();
            return { success: true, message: `✅ "${ship.name}" отремонтирован (-${oreCost} руды, -${chipsCost} чипов)` };
        } else {
            return { success: false, error: `❌ Нужно ${oreCost} руды и ${chipsCost} чипов` };
        }
    },
    
    upgradeShip(shipId) {
        const ship = this.ships.find(s => s.id === shipId);
        if (!ship) return { success: false, error: 'Корабль не найден' };
        
        const oreCost = ship.level * 80;
        const chipsCost = ship.level * 30;
        const plasmaCost = ship.level * 5;
        
        let success = false;
        try {
            if (this.game && typeof this.game.apply_fleet_upgrade === 'function') {
                success = this.game.apply_fleet_upgrade(oreCost, chipsCost, plasmaCost);
            } else {
                const statsJson = this.game?.get_statistics();
                if (statsJson) {
                    const stats = JSON.parse(statsJson);
                    if (stats.ore_inventory >= oreCost && stats.chips_inventory >= chipsCost && stats.plasma_inventory >= plasmaCost) {
                        success = true;
                    }
                }
            }
        } catch(e) {
            console.warn('Ошибка при улучшении через Rust:', e);
            return { success: false, error: 'Ошибка системы' };
        }
        
        if (success) {
            ship.level += 1;
            ship.maxHealth += 20;
            ship.health = ship.maxHealth;
            ship.combat = Math.floor(ship.combat * 1.15);
            ship.capacity = Math.floor(ship.capacity * 1.1);
            this.saveFleet();
            return { 
                success: true, 
                message: `⬆️ "${ship.name}" улучшен до ур.${ship.level} (-${oreCost}⛏️ -${chipsCost}🎛️ -${plasmaCost}⚡)` 
            };
        } else {
            return { 
                success: false, 
                error: `❌ Нужно: ${oreCost} руды, ${chipsCost} чипов, ${plasmaCost} плазмы` 
            };
        }
    },
    
    damageRandomCombatShip(attackType, attackId = null) {
        if (attackId && this.lastDamageProcessedAttackId === attackId) {
            return null;
        }
        
        const now = Date.now();
        if (now - this.lastProcessedAttackTime < 5000) {
            return null;
        }
        
        if (this.ships.length === 0) return null;
        
        const vulnerableShips = this.ships.filter(s => s.type !== 'cargo');
        if (vulnerableShips.length === 0) return null;
        
        const target = vulnerableShips[Math.floor(Math.random() * vulnerableShips.length)];
        const damage = Math.floor(10 + Math.random() * 20);
        const oldHealth = target.health;
        target.health = Math.max(1, target.health - damage);
        this.saveFleet();
        
        if (attackId) {
            this.lastDamageProcessedAttackId = attackId;
        }
        this.lastProcessedAttackTime = now;
        
        return {
            shipName: target.name,
            damage: oldHealth - target.health,
            newHealth: target.health,
            maxHealth: target.maxHealth
        };
    },
    
    resetDamageFlag() {
        this.lastDamageProcessedAttackId = null;
    },
    
    setAlertMode(enabled) {
        this.alertMultiplier = enabled ? 2.0 : 1.0;
        this.ships.forEach(ship => {
            ship.onAlert = enabled && ship.type === 'combat';
        });
        this.saveFleet();
    },
    
    renderFleetUI() {
        const defenseBonus = Math.floor(this.getFleetDefenseContribution() / 50);
        const reconBonus = this.getScoutReconBonus();
        const cargoBonus = this.getCargoMiningBonus();
        
        let html = `
            <div class="fleet-container">
                <div class="fleet-header">
                    <span>🚀 ФЛОТ</span>
                    <div class="fleet-stats">
                        <span>Кораблей: ${this.ships.length}/${this.maxFleetSize}</span>
                        <span>⚔️ Боевая мощь: ${this.getFleetDefenseContribution()}</span>
                        <span>📦 Грузоподъемность: ${this.getTotalCapacity()}</span>
                    </div>
                </div>
                <div class="fleet-bonuses">
                    <div class="bonus-item">🛡️ Бонус к защите: +${defenseBonus}</div>
                    <div class="bonus-item">🔭 Снижение заметности: ${Math.floor(reconBonus / 10)}</div>
                    <div class="bonus-item">⛏️ Бонус к добыче: +${cargoBonus}</div>
                    ${this.alertMultiplier > 1 ? '<div class="bonus-item alert-active">⚠️ РЕЖИМ ТРЕВОГИ: боевая мощь ×2</div>' : ''}
                </div>
                <div class="fleet-grid">
        `;
        
        if (this.ships.length === 0) {
            html += `
                <div class="empty-fleet">
                    <div class="empty-icon">🚀</div>
                    <div class="empty-text">Флот пуст</div>
                    <div class="empty-hint">Создайте корабли во вкладке "Крафт"</div>
                </div>
            `;
        } else {
            this.ships.forEach(ship => {
                const typeConfig = this.shipTypes[ship.type] || {};
                const healthPercent = (ship.health / ship.maxHealth) * 100;
                const isDamaged = ship.health < ship.maxHealth;
                const healthClass = healthPercent > 70 ? 'good' : healthPercent > 30 ? 'damaged' : 'critical';
                
                html += `
                    <div class="ship-card ${ship.onAlert ? 'alert-mode' : ''}" data-ship-id="${ship.id}">
                        <div class="ship-header">
                            <div class="ship-icon">${typeConfig.icon || '🚀'}</div>
                            <div class="ship-name">${ship.name}</div>
                            <div class="ship-level">Ур. ${ship.level}</div>
                            <div class="ship-status ${ship.onMission ? 'on-mission' : 'ready'}">
                                ${ship.onMission ? '🚀 В миссии' : '✅ Готов'}
                            </div>
                        </div>
                        
                        <div class="ship-stats">
                            <div class="stat-row">
                                <span>Здоровье:</span>
                                <div class="health-bar">
                                    <div class="health-fill ${healthClass}" style="width: ${healthPercent}%"></div>
                                </div>
                                <span>${ship.health}/${ship.maxHealth}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>⚡ Боевая мощь:</span>
                                <span>${Math.floor(ship.combat * (ship.onAlert ? 2 : 1))}</span>
                                ${ship.onAlert ? '<span class="alert-badge">×2</span>' : ''}
                            </div>
                            
                            <div class="stat-row">
                                <span>📦 Грузоподъемность:</span>
                                <span>${ship.capacity}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>🚀 Скорость:</span>
                                <span>${ship.speed}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>⭐ Опыт:</span>
                                <span>${ship.experience}</span>
                            </div>
                            
                            <div class="stat-row">
                                <span>🎯 Миссий:</span>
                                <span>${ship.missions}</span>
                            </div>
                        </div>
                        
                        <div class="ship-actions">
                            <button class="ship-btn repair-btn" data-action="repair" data-ship="${ship.id}" ${!isDamaged ? 'disabled' : ''}>
                                🔧 Ремонт
                            </button>
                            <button class="ship-btn upgrade-btn" data-action="upgrade" data-ship="${ship.id}">
                                ⬆ Улучшить
                            </button>
                            <button class="ship-btn delete-btn" data-action="delete" data-ship="${ship.id}">
                                🗑 Удалить
                            </button>
                        </div>
                    </div>
                `;
            });
        }
        
        html += `
                </div>
                <div class="fleet-summary">
                    <div class="summary-item">
                        <span>🚚 Грузовые:</span>
                        <span>${this.ships.filter(s => s.type === 'cargo').length}</span>
                    </div>
                    <div class="summary-item">
                        <span>🔭 Разведчики:</span>
                        <span>${this.ships.filter(s => s.type === 'scout').length}</span>
                    </div>
                    <div class="summary-item">
                        <span>⚔️ Боевые:</span>
                        <span>${this.ships.filter(s => s.type === 'combat').length}</span>
                    </div>
                </div>
            </div>
        `;
        
        return html;
    },
    
    setupEventListeners(container) {
        if (!container) return container;
        
        const newContainer = container.cloneNode(false);
        newContainer.innerHTML = container.innerHTML;
        container.parentNode.replaceChild(newContainer, container);
        
        newContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.ship-btn');
            if (!btn) return;
            if (btn.disabled) return;
            
            const action = btn.dataset.action;
            const shipId = btn.dataset.ship;
            let result = null;
            
            switch (action) {
                case 'repair':
                    result = this.repairShip(shipId);
                    break;
                case 'upgrade':
                    result = this.upgradeShip(shipId);
                    break;
                case 'delete':
                    if (confirm('Вы уверены, что хотите удалить этот корабль?')) {
                        result = this.removeShip(shipId);
                    }
                    break;
            }
            
            if (result) {
                const event = new CustomEvent('fleetAction', { detail: result });
                document.dispatchEvent(event);
            }
            
            setTimeout(() => {
                newContainer.innerHTML = this.renderFleetUI();
                this.setupEventListeners(newContainer);
            }, 300);
        });
        
        return newContainer;
    },
    
    getTotalCombatPower() {
        return this.ships.reduce((total, ship) => total + Math.floor(ship.combat * (ship.health / ship.maxHealth)), 0);
    },
    
    getTotalCapacity() {
        return this.ships.reduce((total, ship) => total + Math.floor(ship.capacity * (ship.health / ship.maxHealth)), 0);
    },
    
    getShipsByType(type) {
        return this.ships.filter(ship => ship.type === type);
    }
};