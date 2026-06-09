// src/systems/mining.rs (ИСПРАВЛЕННАЯ ВЕРСИЯ)
// БАГ #M1: убран turbine_cooling = false из mine_resources_common
// БАГ #M3: mining_chance_bonus применяется как мультипликатор
// БАГ #M4: автокликер не добывает руду без ore_unlocked
// БАГ #M5: critical_chance рассчитывается после heat_penalty
// БАГ #4: total_mined обновляется при любом добывающем событии
// БАГ #2: day_no_coal_penalty — днём без ТЭЦ штраф ×0.5

use rand::Rng;
use crate::game::{GameState, GameEvent};
use crate::systems::neuro_ecosystem::NeuroEcosystem;

#[derive(Clone)]
pub struct MiningSystem {
    config: crate::game::config::MiningConfig,
}

impl MiningSystem {
    pub fn new(config: crate::game::config::MiningConfig) -> Self {
        Self { config }
    }

    fn mine_resources_common(
        &self, 
        state: &mut GameState, 
        neuro: &NeuroEcosystem,
        is_auto: bool
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if !state.is_ai_active() {
            if !is_auto {
                events.push(GameEvent::LogMessage(
                    "❌ Система неактивна! Включите ТЭЦ или дождитесь дня".to_string(),
                ));
            }
            return events;
        }

        if state.turbine_heat >= 100 {
            return events;
        }

        let mut rng = rand::thread_rng();
        
        let bonuses = neuro.get_consciousness_bonuses();

        let base_heat: f64 = if is_auto { 0.8 } else { 1.8 };
        let overheat_multiplier = 1.0 + (state.turbine_heat as f64 / 120.0);
        let upgrade_reduction = 1.0 - (state.turbine_upgrade_level as f64 * 0.10).min(0.50);
        
        let cooling_module_reduction = 1.0 - (state.upgrades.cooling_level as f64 * 0.15).min(0.75);
        let consciousness_cooling = 1.0 - bonuses.heat_reduction;
        
        let jitter = 0.88 + rng.gen::<f64>() * 0.24;
        
        let heat_increase = base_heat 
            * overheat_multiplier 
            * upgrade_reduction 
            * cooling_module_reduction
            * consciousness_cooling
            * jitter;

        let old_heat = state.turbine_heat;
        let new_heat = ((state.turbine_heat as f64 + heat_increase).min(100.0)) as u32;
        state.turbine_heat = new_heat;

        if new_heat >= 100 && old_heat < 100 {
            state.turbine_cooling = true;
        }

        let heat_penalty = if new_heat > 80 {
            1.0 - ((new_heat - 80) as f64 / 20.0).min(1.0)
        } else {
            1.0
        };

        let mining_lvl = state.upgrades.mining as f64;

        let mut coal_chance = (self.config.base_chances.coal
            + if state.coal_enabled { self.config.coal_bonus } else { 0.0 }
            + mining_lvl * self.config.upgrade_bonus)
            * heat_penalty;

        let mut trash_chance =
            (self.config.base_chances.trash + mining_lvl * 0.005) * heat_penalty;

        let mut ore_chance =
            (self.config.base_chances.ore + mining_lvl * 0.003) * heat_penalty;

        // БАГ #M3: mining_chance_bonus как мультипликатор
        coal_chance = (coal_chance) * (1.0 + bonuses.mining_chance_bonus) * bonuses.global_multiplier;
        trash_chance = (trash_chance) * (1.0 + bonuses.mining_chance_bonus) * bonuses.global_multiplier;
        ore_chance = (ore_chance) * (1.0 + bonuses.mining_chance_bonus) * bonuses.global_multiplier;

        let mining_debuff = if state.mining_debuff_remaining > 0 {
            1.0 - state.mining_debuff_percent as f64
        } else {
            1.0
        };

        let auto_debuff = if is_auto && state.autoclick_debuff_remaining > 0 {
            1.0 - state.autoclick_debuff_percent as f64
        } else {
            1.0
        };

        coal_chance *= mining_debuff * auto_debuff;
        trash_chance *= mining_debuff * auto_debuff;
        ore_chance *= mining_debuff * auto_debuff;

        // БАГ #2: днём без ТЭЦ штраф ×0.5
        let day_no_coal_penalty = if state.is_day && !state.coal_enabled { 0.5 } else { 1.0 };
        coal_chance *= day_no_coal_penalty;
        trash_chance *= day_no_coal_penalty;
        ore_chance *= day_no_coal_penalty;

        let crit_module_bonus = state.upgrades.crit_level as f64 * 0.02;
        let consciousness_crit_bonus = bonuses.crit_bonus;
        
        // БАГ #M5: critical_chance рассчитывается ПОСЛЕ heat_penalty
        let mut critical_chance = (self.config.critical_chance 
            + crit_module_bonus 
            + consciousness_crit_bonus) 
            * (1.0 - new_heat as f64 / 200.0);
        
        if critical_chance > 0.25 {
            critical_chance = 0.25;
        }
        
        let is_critical = rng.gen::<f64>() < critical_chance;
        let multiplier = if is_critical { self.config.critical_multiplier } else { 1 };

        // БАГ #4: total_mined обновляется при любом ресурсе
        if rng.gen::<f64>() < coal_chance {
            let amount = multiplier;
            state.inventory.coal = (state.inventory.coal + amount).min(state.max_inventory_stack);
            state.total_mined      += amount;
            state.total_coal_mined += amount;
            state.coal_unlocked     = true;

            if !is_auto {
                events.push(GameEvent::ResourceMined {
                    resource: "coal".to_string(),
                    amount,
                    critical: is_critical,
                });
            }
        }

        if rng.gen::<f64>() < trash_chance {
            let amount = multiplier;
            state.inventory.trash = (state.inventory.trash + amount).min(state.max_inventory_stack);
            state.total_mined       += amount;
            state.total_trash_mined += amount;
            state.trash_unlocked     = true;

            if !is_auto {
                events.push(GameEvent::ResourceMined {
                    resource: "trash".to_string(),
                    amount,
                    critical: is_critical,
                });
            }
        }

        // БАГ #M4: руда добывается ТОЛЬКО если разблокирована
        if rng.gen::<f64>() < ore_chance && state.ore_unlocked {
            let amount = multiplier;
            state.inventory.ore = (state.inventory.ore + amount).min(state.max_inventory_stack);
            state.total_mined      += amount;
            state.total_ore_mined  += amount;

            if !is_auto {
                events.push(GameEvent::ResourceMined {
                    resource: "ore".to_string(),
                    amount,
                    critical: is_critical,
                });
            }
        }

        events
    }

    pub fn mine_resources(&self, state: &mut GameState, neuro: &NeuroEcosystem) -> Vec<GameEvent> {
        self.mine_resources_common(state, neuro, false)
    }

    pub fn auto_mine_resources(&self, state: &mut GameState, neuro: &NeuroEcosystem) -> Vec<GameEvent> {
        self.mine_resources_common(state, neuro, true)
    }

    pub fn passive_mining(&self, state: &mut GameState, neuro: &NeuroEcosystem) -> Vec<GameEvent> {
        if !state.is_passive_mining_active() {
            return Vec::new();
        }

        let mut rng = rand::thread_rng();
        
        let bonuses = neuro.get_consciousness_bonuses();
        let passive_multiplier = bonuses.passive_multiplier;

        let debuff = if state.mining_debuff_remaining > 0 {
            1.0 - state.mining_debuff_percent as f64
        } else {
            1.0
        };

        // БАГ #2: днём без ТЭЦ штраф ×0.5 для пассивной добычи
        let day_no_coal_penalty = if state.is_day && !state.coal_enabled { 0.5 } else { 1.0 };

        if rng.gen::<f64>() < self.config.passive_chances.coal * debuff * passive_multiplier * day_no_coal_penalty {
            state.inventory.coal = (state.inventory.coal + 1).min(state.max_inventory_stack);
            state.total_mined      += 1;
            state.total_coal_mined += 1;
            state.coal_unlocked     = true;
        }

        if rng.gen::<f64>() < self.config.passive_chances.trash * debuff * passive_multiplier * day_no_coal_penalty {
            state.inventory.trash = (state.inventory.trash + 1).min(state.max_inventory_stack);
            state.total_mined       += 1;
            state.total_trash_mined += 1;
            state.trash_unlocked     = true;
        }

        if state.ore_unlocked && rng.gen::<f64>() < self.config.passive_chances.ore * debuff * passive_multiplier * day_no_coal_penalty {
            state.inventory.ore = (state.inventory.ore + 1).min(state.max_inventory_stack);
            state.total_mined      += 1;
            state.total_ore_mined  += 1;
        }

        Vec::new()
    }
}