use crate::game::{GameState, GameEvent};
use crate::game::config::UpgradeConfig;

#[derive(Clone)]
pub struct UpgradeSystem {
    config: UpgradeConfig,
}

#[allow(dead_code)]
impl UpgradeSystem {
    pub fn new(config: UpgradeConfig) -> Self {
        Self { config }
    }

    pub fn upgrade_mining(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if state.upgrades.mining >= 15 {
            events.push(GameEvent::LogMessage("⛏️ Добыча уже максимально улучшена!".to_string()));
            return events;
        }

        let required_chips = 8 + (state.upgrades.mining as f64 * 2.5).floor() as u32;

        if state.inventory.chips >= required_chips {
            state.inventory.chips -= required_chips;
            state.upgrades.mining += 1;

            events.push(GameEvent::UpgradePurchased {
                upgrade_type: "mining".to_string(),
                level: state.upgrades.mining,
            });
            events.push(GameEvent::LogMessage(
                format!("⛏️ Улучшена добыча до уровня {}! (-{} чипов)",
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
            events.push(GameEvent::LogMessage("🛡️ Защита уже активирована".to_string()));
            return events;
        }

        if state.inventory.plasma >= self.config.defense_activation_cost {
            state.inventory.plasma -= self.config.defense_activation_cost;
            state.upgrades.defense = true;

            events.push(GameEvent::DefenseActivated);
            events.push(GameEvent::LogMessage(
                format!("🛡️ Система защиты активирована! (-{} плазмы)",
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
            events.push(GameEvent::LogMessage("🛡️ Сначала активируйте защиту!".to_string()));
            return events;
        }

        if state.upgrades.defense_level >= 8 {
            events.push(GameEvent::LogMessage("🛡️ Защита уже максимально улучшена!".to_string()));
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
                format!("🛡️ Улучшена защита до уровня {}! (-{} чипов, -{} плазмы)",
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

    pub fn upgrade_crit_module(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.crit_level;

        if lvl >= 15 {
            events.push(GameEvent::LogMessage("💥 Крит-модуль максимален!".to_string()));
            return events;
        }

        let chips_cost = (lvl + 1) * 8;
        let other_cost = (lvl + 1) * 2;

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

    pub fn upgrade_cooling_module(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.cooling_level;

        if lvl >= 15 {
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

    pub fn upgrade_turbine(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if state.turbine_upgrade_level >= 8 {
            events.push(GameEvent::LogMessage("⚙️ Турбина уже на максимальном уровне (8)!".to_string()));
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

    pub fn upgrade_consciousness(&self, state: &mut GameState, neuro_ecosystem: &mut crate::systems::neuro_ecosystem::NeuroEcosystem) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let lvl = state.upgrades.crit_level;

        if lvl >= 10 {
            events.push(GameEvent::LogMessage("🧠 Нейро-сознание уже максимально!".to_string()));
            return events;
        }

        let cost_chips = 50 + lvl * 25;
        let cost_plasma = 10 + lvl * 5;

        if state.inventory.chips >= cost_chips && state.inventory.plasma >= cost_plasma {
            state.inventory.chips -= cost_chips;
            state.inventory.plasma -= cost_plasma;
            state.upgrades.crit_level += 1;

            let evo_bonus = 0.02 * (neuro_ecosystem.evolution_level as f64);
            let defend_bonus = 0.01 * (state.attacks_defended as f64).min(10.0);
            let boost = evo_bonus + defend_bonus;

            neuro_ecosystem.system_consciousness = (neuro_ecosystem.system_consciousness + boost).min(1.0);

            events.push(GameEvent::LogMessage(format!(
                "🧠 Нейро-сознание увеличено до ур.{}! (+{:.0}% сознания, -{}🎛️, -{}⚡)",
                state.upgrades.crit_level, boost * 100.0, cost_chips, cost_plasma
            )));
        } else {
            events.push(GameEvent::LogMessage(format!(
                "❌ Нужно {} чипов и {} плазмы для апгрейда сознания",
                cost_chips, cost_plasma
            )));
        }

        events
    }
}
