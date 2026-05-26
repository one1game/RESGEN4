// ========== src/systems/upgrades.rs (ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ) ==========
// БАГ #54: турбина может быть улучшена до 5 уровня (0→5, всего 5 уровней)
// БАГ #55: критический модуль требует в основном чипы, остальные в 1/4 количества

use crate::game::{GameState, GameEvent};
use crate::game::config::UpgradeConfig;

#[derive(Clone)]
pub struct UpgradeSystem {
    config: UpgradeConfig,
}

impl UpgradeSystem {
    pub fn new(config: UpgradeConfig) -> Self {
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
    
    // ========== КРИТ-МОДУЛЬ (БАГ #55) ==========
    // Требует в основном чипы, остальные ресурсы — дополнительные
    pub fn upgrade_crit_module(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.crit_level;
        
        if lvl >= 10 {
            events.push(GameEvent::LogMessage("💥 Крит-модуль максимален!".to_string()));
            return events;
        }
        
        // БАГ #55: критический модуль требует в основном чипы, остальные в 1/4 количества
        let chips_cost = (lvl + 1) * 8;      // 8, 16, 24, ..., 80
        let other_cost = (lvl + 1) * 2;      // 2, 4, 6, ..., 20
        
        let inv = &state.inventory;
        if inv.chips >= chips_cost && inv.ore >= other_cost 
            && inv.coal >= other_cost && inv.plasma >= other_cost && inv.trash >= other_cost {
            
            state.inventory.chips -= chips_cost;
            state.inventory.ore -= other_cost;
            state.inventory.coal -= other_cost;
            state.inventory.plasma -= other_cost;
            state.inventory.trash -= other_cost;
            state.upgrades.crit_level += 1;
            
            events.push(GameEvent::LogMessage(format!(
                "💥 Крит-модуль прокачан до ур.{}! (-{}🎛️, -{}⛏️🪨⚡♻️)",
                state.upgrades.crit_level, chips_cost, other_cost
            )));
        } else {
            events.push(GameEvent::LogMessage(format!(
                "❌ Нужно {} чипов и по {} остальных ресурсов (уголь, руда, плазма, мусор)",
                chips_cost, other_cost
            )));
        }
        
        events
    }
    
    // ========== ОХЛАЖДЕНИЕ ==========
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
    
    // ========== ТУРБИНА (БАГ #54) ==========
    // БАГ #54: турбина может быть улучшена до 5 уровня (0→5, всего 5 уровней)
    pub fn upgrade_turbine(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.turbine_upgrade_level >= 5 {
            events.push(GameEvent::LogMessage("⚙️ Турбина уже на максимальном уровне (5)!".to_string()));
            return events;
        }
        
        let cost_ore = 30 + state.turbine_upgrade_level * 20;
        let cost_chips = 5 + state.turbine_upgrade_level * 3;
        
        if state.inventory.ore >= cost_ore && state.inventory.chips >= cost_chips {
            state.inventory.ore -= cost_ore;
            state.inventory.chips -= cost_chips;
            state.turbine_upgrade_level += 1;
            
            events.push(GameEvent::LogMessage(format!(
                "⚙️ Турбина улучшена до уровня {}! (-{} руды, -{} чипов)",
                state.turbine_upgrade_level, cost_ore, cost_chips
            )));
        } else {
            let mut missing = Vec::new();
            if state.inventory.ore < cost_ore {
                missing.push(format!("руды ({}/{})", state.inventory.ore, cost_ore));
            }
            if state.inventory.chips < cost_chips {
                missing.push(format!("чипов ({}/{})", state.inventory.chips, cost_chips));
            }
            events.push(GameEvent::LogMessage(format!(
                "❌ Недостаточно ресурсов: {}", missing.join(", ")
            )));
        }
        
        events
    }
}