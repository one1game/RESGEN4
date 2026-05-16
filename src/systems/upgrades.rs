// ======== src/systems/upgrades.rs (ДОБАВЛЕНЫ НОВЫЕ МЕТОДЫ И ОГРАНИЧЕНИЕ POWER_TIER) ========

use crate::game::{GameState, GameEvent};

#[derive(Clone)]
pub struct UpgradeSystem {
    config: crate::game::config::UpgradeConfig,
}

impl UpgradeSystem {
    pub fn new(config: crate::game::config::UpgradeConfig) -> Self {
        Self { config }
    }
    
    pub fn upgrade_mining(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.upgrades.mining >= self.config.mining_max_level {
            events.push(GameEvent::LogMessage("Добыча уже максимально улучшена!".to_string()));
            return events;
        }
        
        let required_chips = self.config.mining_base_cost + 
            state.upgrades.mining * self.config.mining_cost_multiplier;
        
        if state.inventory.chips >= required_chips {
            state.inventory.chips -= required_chips;
            state.upgrades.mining += 1;
            
            events.push(GameEvent::UpgradePurchased {
                upgrade_type: "mining".to_string(),
                level: state.upgrades.mining,
            });
            events.push(GameEvent::LogMessage(
                format!("Улучшена добыча до уровня {}! (-{} чипов)", 
                    state.upgrades.mining, required_chips)
            ));
        } else {
            events.push(GameEvent::NotEnoughResources {
                resource: "Чипы".to_string(),
                required: required_chips,
                available: state.inventory.chips,
            });
        }
        
        events
    }
    
    pub fn activate_defense(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.upgrades.defense {
            events.push(GameEvent::LogMessage("Защита уже активирована".to_string()));
            return events;
        }
        
        if state.inventory.plasma >= self.config.defense_activation_cost {
            state.inventory.plasma -= self.config.defense_activation_cost;
            state.upgrades.defense = true;
            
            events.push(GameEvent::DefenseActivated);
            events.push(GameEvent::LogMessage(
                format!("Система защиты активирована! (-{} плазмы)", 
                    self.config.defense_activation_cost)
            ));
        } else {
            events.push(GameEvent::NotEnoughResources {
                resource: "Плазма".to_string(),
                required: self.config.defense_activation_cost,
                available: state.inventory.plasma,
            });
        }
        
        events
    }
    
    pub fn upgrade_defense(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if !state.upgrades.defense {
            events.push(GameEvent::LogMessage("Сначала активируйте защиту!".to_string()));
            return events;
        }
        
        if state.upgrades.defense_level >= self.config.defense_max_level {
            events.push(GameEvent::LogMessage("Защита уже максимально улучшена!".to_string()));
            return events;
        }
        
        let chips_cost = (state.upgrades.defense_level + 1) * 10;
        let plasma_cost = 1 + state.upgrades.defense_level / 2;
        
        if state.inventory.chips >= chips_cost && state.inventory.plasma >= plasma_cost {
            state.inventory.chips -= chips_cost;
            state.inventory.plasma -= plasma_cost;
            state.upgrades.defense_level += 1;
            
            events.push(GameEvent::UpgradePurchased {
                upgrade_type: "defense".to_string(),
                level: state.upgrades.defense_level,
            });
            events.push(GameEvent::LogMessage(
                format!("Улучшена защита до уровня {}! (-{} чипов, -{} плазмы)", 
                    state.upgrades.defense_level, chips_cost, plasma_cost)
            ));
        } else {
            if state.inventory.chips < chips_cost {
                events.push(GameEvent::NotEnoughResources {
                    resource: "Чипы".to_string(),
                    required: chips_cost,
                    available: state.inventory.chips,
                });
            }
            if state.inventory.plasma < plasma_cost {
                events.push(GameEvent::NotEnoughResources {
                    resource: "Плазма".to_string(),
                    required: plasma_cost,
                    available: state.inventory.plasma,
                });
            }
        }
        
        events
    }
    
    // ========== НОВЫЙ МЕТОД: КРИТ-МОДУЛЬ ==========
    
    pub fn upgrade_crit_module(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.crit_level;
        
        if lvl >= 10 {
            events.push(GameEvent::LogMessage("💥 Крит-модуль максимален!".to_string()));
            return events;
        }
        
        let cost = (lvl + 1) * 2 + 4;
        
        let inv = &state.inventory;
        if inv.coal >= cost && inv.ore >= cost && inv.chips >= cost 
            && inv.plasma >= cost && inv.trash >= cost {
            
            state.inventory.coal -= cost;
            state.inventory.ore -= cost;
            state.inventory.chips -= cost;
            state.inventory.plasma -= cost;
            state.inventory.trash -= cost;
            state.upgrades.crit_level += 1;
            
            events.push(GameEvent::LogMessage(format!(
                "💥 Крит-модуль прокачан до ур.{}! (-{} каждого ресурса)",
                state.upgrades.crit_level, cost
            )));
        } else {
            events.push(GameEvent::LogMessage(format!(
                "❌ Нужно по {} каждого ресурса (уголь, руда, чип, плазма, мусор)", cost
            )));
        }
        
        events
    }
    
    // ========== НОВЫЙ МЕТОД: ОХЛАЖДЕНИЕ ==========
    
    pub fn upgrade_cooling_module(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.cooling_level;
        
        if lvl >= 10 {
            events.push(GameEvent::LogMessage("❄️ Охлаждение максимально!".to_string()));
            return events;
        }
        
        let cost: u32 = 500 * (lvl + 1);
        
        if state.inventory.coal >= cost {
            state.inventory.coal -= cost;
            state.upgrades.cooling_level += 1;
            
            events.push(GameEvent::LogMessage(format!(
                "❄️ Охлаждение ур.{}! (-{} угля)",
                state.upgrades.cooling_level, cost
            )));
        } else {
            events.push(GameEvent::NotEnoughResources {
                resource: "Уголь".to_string(),
                required: cost,
                available: state.inventory.coal,
            });
        }
        
        events
    }
}