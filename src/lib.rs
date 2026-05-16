// ======== src/lib.rs (ПОЛНОСТЬЮ ИСПРАВЛЕННЫЙ) ========

#![recursion_limit = "256"]

mod game;
mod systems;
mod web;

use wasm_bindgen::prelude::*;
use crate::game::GameEvent;
use crate::game::state::GameState;
use crate::game::config::GameConfig;
use crate::systems::mining::MiningSystem;
use crate::systems::economy::EconomySystem;
use crate::systems::upgrades::UpgradeSystem;
use crate::systems::rebel::RebelSystem;
use crate::systems::neuro_ecosystem::NeuroEcosystem;
use crate::web::GameUI;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use serde_json;

static CONFIG: Lazy<Mutex<GameConfig>> = Lazy::new(|| Mutex::new(GameConfig::default()));

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    log("CoreBox запущен");
}

#[wasm_bindgen]
pub struct CoreGame {
    state: GameState,
    mining_system: MiningSystem,
    economy_system: EconomySystem,
    upgrade_system: UpgradeSystem,
    rebel_system: RebelSystem,
    neuro_ecosystem: NeuroEcosystem,
    ui: GameUI,
}

#[wasm_bindgen]
pub fn apply_config_from_admin(config_json: String) -> String {
    console_error_panic_hook::set_once();
    match serde_json::from_str::<GameConfig>(&config_json) {
        Ok(config) => {
            if let Some(window) = web_sys::window() {
                if let Ok(Some(storage)) = window.local_storage() {
                    let _ = storage.set_item("corebox_config", &serde_json::to_string(&config).unwrap_or_default());
                }
            }
            *CONFIG.lock().unwrap() = config;
            "✅ Конфиг применен".to_string()
        }
        Err(e) => format!("❌ Ошибка: {}", e),
    }
}

impl CoreGame {
    fn load_config_from_storage() -> GameConfig {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                if let Ok(Some(json)) = storage.get_item("corebox_config") {
                    if let Ok(config) = serde_json::from_str(&json) { return config; }
                }
            }
        }
        GameConfig::default()
    }
    
    // Форсированное сохранение в localStorage
    fn force_save(&self) {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                let mut state = self.state.clone();
                state.neuro_evolution = self.neuro_ecosystem.evolution_level;
                state.neuro_consciousness = self.neuro_ecosystem.system_consciousness;
                state.neuro_score = self.neuro_ecosystem.get_evolution_score();
                if let Ok(json) = serde_json::to_string(&state) { 
                    let _ = storage.set_item("corebox_save", &json);
                    // Также сохраняем упрощённую версию для universal
                    let simple_save = serde_json::json!({
                        "inventory": {
                            "coal": state.inventory.coal,
                            "ore": state.inventory.ore,
                            "chips": state.inventory.chips,
                            "plasma": state.inventory.plasma,
                            "trash": state.inventory.trash,
                        },
                        "computational_power": state.computational_power,
                        "max_computational_power": state.max_computational_power,
                        "neuro_evolution": state.neuro_evolution,
                        "neuro_consciousness": state.neuro_consciousness,
                        "neuro_score": state.neuro_score,
                        "current_ai_mode": state.current_ai_mode,
                        "is_day": state.is_day,
                        "coal_enabled": state.coal_enabled,
                        "game_time": state.game_time,
                        "nights_survived": state.nights_survived,
                        "total_coal_burned": state.total_coal_burned,
                        "_savedAt": js_sys::Date::now()
                    });
                    let _ = storage.set_item("corebox_save_universal", &simple_save.to_string());
                }
            }
        }
    }
}

#[wasm_bindgen]
impl CoreGame {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        let config = Self::load_config_from_storage();
        let state = GameState::new(&config);
        Self {
            state,
            mining_system: MiningSystem::new(config.mining_config.clone()),
            economy_system: EconomySystem::new(config.economy_config.clone()),
            upgrade_system: UpgradeSystem::new(config.upgrade_config.clone()),
            rebel_system: RebelSystem::new(),
            neuro_ecosystem: NeuroEcosystem::new(),
            ui: GameUI::new(),
        }
    }

    pub fn init(&mut self) {
        self.load();
        let _ = self.ui.render(&self.state);
        self.force_save();
    }

    #[wasm_bindgen]
    pub fn load_game_state(&mut self, state_json: String) -> Result<(), JsValue> {
        match serde_json::from_str::<GameState>(&state_json) {
            Ok(mut loaded) => {
                let old_max = self.state.max_computational_power;
                let old_prestige = self.state.prestige_level;
                if loaded.last_ai_coal_threshold == 0 {
                    let saved_coal = loaded.total_coal_mined.saturating_sub(loaded.total_coal_burned);
                    loaded.last_ai_coal_threshold = [1000, 600, 300, 100].iter().find(|&&t| saved_coal >= t).copied().unwrap_or(0);
                }
                self.state = loaded;
                self.state.max_computational_power = old_max;
                self.state.prestige_level = old_prestige;
                self.neuro_ecosystem.load_from_state(self.state.neuro_evolution, self.state.neuro_consciousness, self.state.neuro_score);
                self.state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
                self.state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
                let _ = self.ui.render(&self.state);
                self.ui.add_log_entry("💾 Состояние загружено");
                self.force_save();
                Ok(())
            }
            Err(e) => Err(JsValue::from_str(&format!("Ошибка: {}", e)))
        }
    }
    
    // Сохранить текущее состояние
    #[wasm_bindgen]
    pub fn save_current_state(&mut self) {
        self.force_save();
    }
    
    // Получить сохранение для universal
    #[wasm_bindgen]
    pub fn get_universal_save(&self) -> String {
        let simple_save = serde_json::json!({
            "inventory": {
                "coal": self.state.inventory.coal,
                "ore": self.state.inventory.ore,
                "chips": self.state.inventory.chips,
                "plasma": self.state.inventory.plasma,
                "trash": self.state.inventory.trash,
            },
            "computational_power": self.state.computational_power,
            "max_computational_power": self.state.max_computational_power,
            "neuro_evolution": self.neuro_ecosystem.evolution_level,
            "neuro_consciousness": self.neuro_ecosystem.system_consciousness,
            "neuro_score": self.neuro_ecosystem.get_evolution_score(),
            "current_ai_mode": self.state.current_ai_mode,
            "is_day": self.state.is_day,
            "coal_enabled": self.state.coal_enabled,
            "game_time": self.state.game_time,
            "nights_survived": self.state.nights_survived,
            "total_coal_burned": self.state.total_coal_burned,
            "timestamp": js_sys::Date::now()
        });
        simple_save.to_string()
    }

    #[wasm_bindgen]
    pub fn add_manual_click(&mut self) { 
        let events = self.add_manual_click_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn start_auto_clicking(&mut self) { 
        let events = self.start_auto_clicking_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn stop_auto_clicking(&mut self) { 
        let events = self.stop_auto_clicking_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn get_computational_power(&self) -> u32 { self.state.computational_power }
    
    #[wasm_bindgen]
    pub fn get_max_computational_power(&self) -> u32 { self.state.max_computational_power }
    
    #[wasm_bindgen]
    pub fn is_auto_clicking(&self) -> bool { self.state.auto_clicking }
    
    #[wasm_bindgen]
    pub fn toggle_coal(&mut self) { 
        let events = self.toggle_coal_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn upgrade_mining(&mut self) { 
        let events = self.upgrade_mining_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn activate_defense(&mut self) { 
        let events = self.activate_defense_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn upgrade_defense(&mut self) { 
        let events = self.upgrade_defense_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn upgrade_crit_module(&mut self) { 
        let events = self.upgrade_system.upgrade_crit_module(&mut self.state);
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn upgrade_cooling_module(&mut self) { 
        let events = self.upgrade_system.upgrade_cooling_module(&mut self.state);
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn buy_resource(&mut self, resource: String) { 
        let events = self.buy_resource_internal(&resource);
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn sell_resource(&mut self, resource: String) { 
        let events = self.sell_resource_internal(&resource);
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn buy_rebel_protection(&mut self) { 
        let events = self.buy_rebel_protection_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn toggle_rebel_protection(&mut self) { 
        let events = self.toggle_rebel_protection_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn reload_config(&mut self) {
        let config = Self::load_config_from_storage();
        self.update_config(config);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn clear_log(&self) { self.ui.clear_log(); }

    #[wasm_bindgen]
    pub fn get_statistics(&self) -> String {
        let blueprints = format!(r#"{{"cargo":{},"scout":{},"combat":{}}}"#,
            self.state.blueprint_cargo_unlocked, self.state.blueprint_scout_unlocked, self.state.blueprint_combat_unlocked);
        let attack_history = serde_json::to_string(&self.state.attack_history).unwrap_or_else(|_| "[]".to_string());
        let rebel_factions = serde_json::to_string(&self.rebel_system.get_faction_info()).unwrap_or_else(|_| "[]".to_string());
        format!(r#"{{"total_clicks":{},"nights_survived":{},"rebel_attacks_count":{},"attacks_defended":{},"coal_mined":{},"trash_mined":{},"plasma_mined":{},"ore_mined":{},"ore_inventory":{},"chips_inventory":{},"plasma_inventory":{},"coal_inventory":{},"trash_inventory":{},"neuro_evolution":{},"neuro_consciousness":{},"neuro_score":{},"current_ai_mode":"{}","attack_warning":"{}","attack_warning_faction":"{}","last_attacking_faction":"{}","mining_debuff_remaining":{},"autoclick_debuff_remaining":{},"defense_debuff_remaining":{},"rebel_factions":{},"attack_history":{},"is_day":{},"coal_enabled":{},"game_time":{},"turbine_heat":{},"turbine_upgrade_level":{},"turbine_cooling":{},"coal_burned":{},"coal_stolen":{},"crit_level":{},"cooling_level":{},"power_tier":{},"prestige_level":{},"last_ai_coal_threshold":{},"blueprints_unlocked":{},"blueprint_research_progress":{}}}"#,
            self.state.manual_clicks, self.state.nights_survived, self.state.rebel_attacks_count, self.state.attacks_defended,
            self.state.total_coal_mined, self.state.total_trash_mined, self.state.total_plasma_mined, self.state.total_ore_mined,
            self.state.inventory.ore, self.state.inventory.chips, self.state.inventory.plasma, self.state.inventory.coal, self.state.inventory.trash,
            self.neuro_ecosystem.evolution_level, (self.neuro_ecosystem.system_consciousness * 100.0).round(), self.neuro_ecosystem.get_evolution_score(),
            self.state.current_ai_mode, self.state.attack_warning, self.state.attack_warning_faction, self.state.last_attacking_faction,
            self.state.mining_debuff_remaining, self.state.autoclick_debuff_remaining, self.state.defense_debuff_remaining,
            rebel_factions, attack_history, self.state.is_day, self.state.coal_enabled, self.state.game_time,
            self.state.turbine_heat, self.state.turbine_upgrade_level, self.state.turbine_cooling,
            self.state.total_coal_burned, self.state.total_coal_stolen, self.state.upgrades.crit_level,
            self.state.upgrades.cooling_level, self.state.power_tier, self.state.prestige_level, self.state.last_ai_coal_threshold,
            blueprints, self.state.blueprint_research_progress)
    }
    
    // Крафт
    #[wasm_bindgen]
    pub fn craft_chips_from_ore(&mut self) -> String {
        if self.state.inventory.ore >= 100 {
            self.state.inventory.ore -= 100;
            self.state.inventory.chips += 1;
            self.ui.add_log_entry("⚙️ Крафт: создан 1 чип из 100 руды!");
            self.force_save();
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen]
    pub fn craft_plasma_from_coal(&mut self) -> String {
        if self.state.inventory.coal >= 50 {
            self.state.inventory.coal -= 50;
            self.state.inventory.plasma += 1;
            self.state.total_plasma_mined += 1;
            self.ui.add_log_entry("⚡ Крафт: создана плазма из 50 угля!");
            self.force_save();
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen]
    pub fn design_ship(&mut self, ship_type: String) -> String {
        let cost = match ship_type.as_str() { "cargo" => 500, "scout" => 10, "combat" => 800, _ => return "error".to_string() };
        if self.state.computational_power >= cost {
            self.state.computational_power -= cost;
            match ship_type.as_str() {
                "cargo" => self.state.blueprint_cargo_unlocked = true,
                "scout" => self.state.blueprint_scout_unlocked = true,
                "combat" => self.state.blueprint_combat_unlocked = true,
                _ => {}
            }
            self.ui.add_log_entry(&format!("📐 Создан чертеж {} корабля!", ship_type));
            self.force_save();
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen] pub fn craft_cargo_ship(&mut self) -> String { self.craft_ship_internal("cargo") }
    #[wasm_bindgen] pub fn craft_scout_ship(&mut self) -> String { self.craft_ship_internal("scout") }
    #[wasm_bindgen] pub fn craft_combat_ship(&mut self) -> String { self.craft_ship_internal("combat") }
    
    fn craft_ship_internal(&mut self, ship_type: &str) -> String {
        let (ore, chips, plasma, unlocked) = match ship_type {
            "cargo" => (200, 50, 10, self.state.blueprint_cargo_unlocked),
            "scout" => (100, 100, 20, self.state.blueprint_scout_unlocked),
            "combat" => (300, 150, 30, self.state.blueprint_combat_unlocked),
            _ => return "error".to_string()
        };
        if !unlocked {
            self.ui.add_log_entry("❌ Сначала создайте чертеж во вкладке РАЗРАБОТКА!");
            return "error".to_string();
        }
        if self.state.inventory.ore >= ore && self.state.inventory.chips >= chips && self.state.inventory.plasma >= plasma {
            self.state.inventory.ore -= ore; 
            self.state.inventory.chips -= chips; 
            self.state.inventory.plasma -= plasma;
            self.ui.add_log_entry(&format!("🚀 Создан {} корабль!", ship_type));
            self.force_save();
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen]
    pub fn get_blueprint_status(&self) -> String {
        format!(r#"{{"blueprints_unlocked":{{"cargo":{},"scout":{},"combat":{}}},"ai_research_bonus":{}}}"#,
            self.state.blueprint_cargo_unlocked, self.state.blueprint_scout_unlocked, self.state.blueprint_combat_unlocked,
            (self.neuro_ecosystem.system_consciousness * 0.5) as u32)
    }
    
    #[wasm_bindgen]
    pub fn sync_blueprints(&mut self, cargo: bool, scout: bool, combat: bool) {
        self.state.blueprint_cargo_unlocked = cargo;
        self.state.blueprint_scout_unlocked = scout;
        self.state.blueprint_combat_unlocked = combat;
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn apply_fleet_repair(&mut self, ore_cost: u32, chips_cost: u32) -> bool {
        if self.state.inventory.ore >= ore_cost && self.state.inventory.chips >= chips_cost {
            self.state.inventory.ore -= ore_cost; 
            self.state.inventory.chips -= chips_cost;
            self.ui.add_log_entry(&format!("🔧 Флот отремонтирован (-{} руды, -{} чипов)", ore_cost, chips_cost));
            self.force_save();
            true
        } else { false }
    }
    
    #[wasm_bindgen]
    pub fn apply_fleet_upgrade(&mut self, ore: u32, chips: u32, plasma: u32) -> bool {
        if self.state.inventory.ore >= ore && self.state.inventory.chips >= chips && self.state.inventory.plasma >= plasma {
            self.state.inventory.ore -= ore; 
            self.state.inventory.chips -= chips; 
            self.state.inventory.plasma -= plasma;
            self.ui.add_log_entry(&format!("⬆️ Корабль улучшен (-{} руды, -{} чипов, -{} плазмы)", ore, chips, plasma));
            self.force_save();
            true
        } else { false }
    }
    
    #[wasm_bindgen]
    pub fn set_fleet_defense_bonus(&mut self, bonus: u32) { self.state.temporary_defense_bonus = bonus; }
    
    #[wasm_bindgen]
    pub fn set_fleet_cargo_bonus(&mut self, bonus: u32) { self.state.temporary_mining_bonus = self.state.temporary_mining_bonus.max(bonus); }
    
    #[wasm_bindgen]
    pub fn upgrade_turbine(&mut self) -> bool {
        let cost_ore = 30 + self.state.turbine_upgrade_level * 20;
        let cost_chips = 5 + self.state.turbine_upgrade_level * 3;
        if self.state.turbine_upgrade_level >= 5 {
            self.ui.add_log_entry("⚙️ Турбина уже на максимальном уровне!");
            return false;
        }
        if self.state.inventory.ore >= cost_ore && self.state.inventory.chips >= cost_chips {
            self.state.inventory.ore -= cost_ore; 
            self.state.inventory.chips -= cost_chips;
            self.state.turbine_upgrade_level += 1;
            self.ui.add_log_entry(&format!("⚙️ Турбина улучшена до уровня {}!", self.state.turbine_upgrade_level));
            self.force_save();
            true
        } else { false }
    }
    
    #[wasm_bindgen] pub fn get_turbine_heat(&self) -> u32 { self.state.turbine_heat }
    #[wasm_bindgen] pub fn get_turbine_upgrade_level(&self) -> u32 { self.state.turbine_upgrade_level }
    #[wasm_bindgen] pub fn is_turbine_cooling(&self) -> bool { self.state.turbine_cooling }
    
    #[wasm_bindgen]
    pub fn add_resource(&mut self, resource: String, amount: u32) {
        match resource.as_str() {
            "coal" => { self.state.inventory.coal += amount; self.state.total_coal_mined += amount; self.state.total_mined += amount; }
            "ore" => { self.state.inventory.ore += amount; self.state.total_ore_mined += amount; self.state.total_mined += amount; }
            "chips" => { self.state.inventory.chips += amount; self.state.total_mined += amount; }
            "plasma" => { self.state.inventory.plasma += amount; self.state.total_plasma_mined += amount; self.state.total_mined += amount; }
            "trash" => { self.state.inventory.trash += amount; self.state.total_trash_mined += amount; self.state.total_mined += amount; }
            _ => {}
        }
        let _ = self.ui.render(&self.state);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn subtract_resource(&mut self, resource: String, amount: u32) {
        match resource.as_str() {
            "coal" => self.state.inventory.coal = self.state.inventory.coal.saturating_sub(amount),
            "ore" => self.state.inventory.ore = self.state.inventory.ore.saturating_sub(amount),
            "chips" => self.state.inventory.chips = self.state.inventory.chips.saturating_sub(amount),
            "plasma" => self.state.inventory.plasma = self.state.inventory.plasma.saturating_sub(amount),
            "trash" => self.state.inventory.trash = self.state.inventory.trash.saturating_sub(amount),
            _ => {}
        }
        let _ = self.ui.render(&self.state);
        self.force_save();
    }
    
    #[wasm_bindgen] pub fn add_power(&mut self, amount: u32) {
        self.state.computational_power = (self.state.computational_power + amount).min(self.state.max_computational_power);
        self.force_save();
    }
    
    #[wasm_bindgen] pub fn subtract_power(&mut self, amount: u32) {
        self.state.computational_power = self.state.computational_power.saturating_sub(amount);
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn repair_systems(&mut self) {
        self.state.mining_debuff_remaining = 0; self.state.mining_debuff_percent = 0.0;
        self.state.autoclick_debuff_remaining = 0; self.state.autoclick_debuff_percent = 0.0;
        self.state.defense_debuff_remaining = 0;
        self.ui.add_log_entry("🔧 Все системы восстановлены!");
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn reset_progress(&mut self) {
        let config = Self::load_config_from_storage();
        let mut new_state = GameState::new(&config);
        new_state.blueprint_cargo_unlocked = self.state.blueprint_cargo_unlocked;
        new_state.blueprint_scout_unlocked = self.state.blueprint_scout_unlocked;
        new_state.blueprint_combat_unlocked = self.state.blueprint_combat_unlocked;
        new_state.prestige_level = self.state.prestige_level;
        self.state = new_state;
        self.neuro_ecosystem = NeuroEcosystem::new();
        self.rebel_system = RebelSystem::new();
        self.ui.add_log_entry("🔄 Прогресс сброшен!");
        self.force_save();
    }
    
    #[wasm_bindgen] pub fn get_neuro_evolution(&self) -> u32 { self.neuro_ecosystem.evolution_level }
    #[wasm_bindgen] pub fn get_resource(&self, resource: String) -> u32 {
        match resource.as_str() {
            "coal" => self.state.inventory.coal, "ore" => self.state.inventory.ore,
            "chips" => self.state.inventory.chips, "plasma" => self.state.inventory.plasma,
            "trash" => self.state.inventory.trash, _ => 0
        }
    }
    
    #[wasm_bindgen]
    pub fn game_loop(&mut self) { 
        let events = self.game_loop_internal();
        self.handle_events(events);
        self.force_save();
    }
    
    // Внутренние методы
    fn handle_events(&mut self, events: Vec<GameEvent>) {
        for event in events { let _ = self.ui.handle_event(&event); }
        let _ = self.ui.render(&self.state);
        self.force_save();
    }
    
    fn load(&mut self) {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                // Используем corebox_save (а не corebox_game_state)
                if let Ok(Some(saved)) = storage.get_item("corebox_save") {
                    if let Ok(mut state) = serde_json::from_str::<GameState>(&saved) {
                        let cfg = CONFIG.lock().unwrap();
                        state.max_computational_power = cfg.auto_click_config.max_computational_power;
                        self.neuro_ecosystem.load_from_state(state.neuro_evolution, state.neuro_consciousness, state.neuro_score);
                        self.neuro_ecosystem.last_processed_time = state.game_time;
                        state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
                        state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
                        self.rebel_system.after_deserialize();
                        if state.game_time <= 0 {
                            state.game_time = if state.is_day { cfg.time_config.day_duration } else { cfg.time_config.night_duration };
                        }
                        self.state = state;
                    }
                }
            }
        }
    }
    
    fn save(&self) {
        self.force_save();
    }
    
    fn update_config(&mut self, new_config: GameConfig) {
        self.mining_system = MiningSystem::new(new_config.mining_config.clone());
        self.economy_system = EconomySystem::new(new_config.economy_config.clone());
        self.upgrade_system = UpgradeSystem::new(new_config.upgrade_config.clone());
        self.state.max_computational_power = new_config.auto_click_config.max_computational_power;
        let old_quests = std::mem::take(&mut self.state.quests);
        self.state.load_quests(&new_config);
        for old in old_quests {
            if let Some(new) = self.state.quests.iter_mut().find(|q| q.id == old.id) { new.completed = old.completed; }
        }
        *CONFIG.lock().unwrap() = new_config;
        let _ = self.ui.render(&self.state);
    }
    
    // Основные механики
    fn add_manual_click_internal(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if !self.state.is_ai_active() {
            events.push(GameEvent::LogMessage("❌ Система неактивна!".to_string()));
            return events;
        }
        self.state.manual_clicks += 1;
        let cfg = CONFIG.lock().unwrap();
        if self.state.manual_clicks >= cfg.auto_click_config.clicks_per_power {
            let power = cfg.auto_click_config.power_per_manual_click + self.state.power_tier;
            self.state.manual_clicks = 0;
            self.state.computational_power = (self.state.computational_power + power).min(self.state.max_computational_power);
            events.push(GameEvent::ComputationalPowerAdded { amount: power, total: self.state.computational_power });
            events.extend(self.check_power_tier());
        }
        events.extend(self.mine_resources_internal());
        events
    }
    
    fn start_auto_clicking_internal(&mut self) -> Vec<GameEvent> {
        if !self.state.auto_clicking && self.state.computational_power > 0 {
            self.state.auto_clicking = true;
            self.state.last_auto_click_time = 0;
            vec![GameEvent::AutoClickingStarted, GameEvent::LogMessage("🤖 Автоклики активированы!".to_string())]
        } else if self.state.computational_power == 0 {
            vec![GameEvent::LogMessage("❌ Недостаточно мощности".to_string())]
        } else { vec![] }
    }
    
    fn stop_auto_clicking_internal(&mut self) -> Vec<GameEvent> {
        if self.state.auto_clicking {
            self.state.auto_clicking = false;
            vec![GameEvent::AutoClickingStopped, GameEvent::LogMessage("⏹️ Автоклики остановлены".to_string())]
        } else { vec![] }
    }
    
    fn buy_rebel_protection_internal(&mut self) -> Vec<GameEvent> { self.state.buy_rebel_protection() }
    fn toggle_rebel_protection_internal(&mut self) -> Vec<GameEvent> { self.state.toggle_rebel_protection() }
    fn toggle_coal_internal(&mut self) -> Vec<GameEvent> { self.state.toggle_coal() }
    fn mine_resources_internal(&mut self) -> Vec<GameEvent> { self.mining_system.mine_resources(&mut self.state, &self.neuro_ecosystem) }
    fn upgrade_mining_internal(&mut self) -> Vec<GameEvent> { self.upgrade_system.upgrade_mining(&mut self.state) }
    fn activate_defense_internal(&mut self) -> Vec<GameEvent> { self.upgrade_system.activate_defense(&mut self.state) }
    fn upgrade_defense_internal(&mut self) -> Vec<GameEvent> { self.upgrade_system.upgrade_defense(&mut self.state) }
    fn buy_resource_internal(&mut self, r: &str) -> Vec<GameEvent> { self.economy_system.buy_resource(&mut self.state, r) }
    fn sell_resource_internal(&mut self, r: &str) -> Vec<GameEvent> { self.economy_system.sell_resource(&mut self.state, r) }
    
    fn check_ai_coal_passive(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let saved = self.state.total_coal_mined.saturating_sub(self.state.total_coal_burned);
        let thresholds = [(100, 15), (300, 25), (600, 40), (1000, 60)];
        for &(thr, pts) in &thresholds {
            if saved >= thr && self.state.last_ai_coal_threshold < thr {
                self.state.last_ai_coal_threshold = thr;
                self.neuro_ecosystem.evolution_score += pts;
                self.state.neuro_score = self.neuro_ecosystem.get_evolution_score();
                events.push(GameEvent::LogMessage(format!("🧠 ИИ-пассив: {} угля → +{} очков", thr, pts)));
            }
        }
        events
    }
    
    fn check_power_tier(&mut self) -> Vec<GameEvent> {
        if self.state.power_tier >= 20 {
            return vec![];
        }
        if self.state.computational_power >= self.state.max_computational_power {
            self.state.power_tier += 1;
            self.state.max_computational_power = 1000 * (self.state.power_tier + 1);
            vec![GameEvent::LogMessage(format!("⚡ Мощность расширена до {} | +{}/клик", self.state.max_computational_power, self.state.power_tier + 1))]
        } else {
            vec![]
        }
    }
    
    fn game_loop_internal(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let cfg = CONFIG.lock().unwrap();
        events.extend(self.state.update_time(1, &cfg));
        
        let mut had_attack = false;
        let mut was_defended = false;
        if !self.state.rebel_protection_active {
            events.extend(self.rebel_system.update_rebel_activity(&mut self.state, &cfg));
            let rebel_events = self.rebel_system.check_rebel_attack(&mut self.state, &cfg);
            had_attack = !rebel_events.is_empty();
            was_defended = rebel_events.iter().any(|e| matches!(e, GameEvent::LogMessage(m) if m.contains("отражена")));
            if had_attack { self.state.last_rebel_attack_time = self.state.game_time; self.state.record_defense_result(was_defended); }
            events.extend(rebel_events);
        }
        
        if self.state.is_ai_active() {
            self.state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
            self.state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
        }
        
        events.extend(self.check_ai_coal_passive());
        
        if self.state.is_ai_active() {
            self.state.neuro_evolution_timer += 1;
            if self.state.neuro_evolution_timer >= 15 {
                self.state.neuro_evolution_timer = 0;
                events.extend(self.neuro_ecosystem.check_evolution(&mut self.state, &mut self.rebel_system));
            }
            events.extend(self.neuro_ecosystem.process_threat(&mut self.state, &mut self.rebel_system, &cfg, had_attack, was_defended));
        }
        
        events.extend(self.mining_system.passive_mining(&mut self.state, &self.neuro_ecosystem));
        
        if self.state.auto_clicking {
            self.state.last_auto_click_time += 1;
            let interval = if self.state.autoclick_debuff_remaining > 0 {
                (cfg.auto_click_config.auto_click_interval as f64 * (1.0 + self.state.autoclick_debuff_percent as f64)) as i32
            } else { cfg.auto_click_config.auto_click_interval };
            if self.state.last_auto_click_time >= interval {
                let cost = cfg.auto_click_config.power_per_auto_click + self.state.power_tier;
                if self.state.computational_power >= cost {
                    self.state.computational_power -= cost;
                    self.state.last_auto_click_time = 0;
                    events.extend(self.mining_system.auto_mine_resources(&mut self.state, &self.neuro_ecosystem));
                    events.extend(self.check_power_tier());
                } else {
                    self.state.auto_clicking = false;
                    events.push(GameEvent::ComputationalPowerDepleted);
                    events.push(GameEvent::LogMessage("❌ Недостаточно мощности! Автоклики отключены".to_string()));
                }
            }
        }
        
        // Квесты
        if self.state.current_quest < self.state.quests.len() {
            let idx = self.state.current_quest;
            let completed = { let q = &self.state.quests[idx]; !q.completed && q.check_completion(&self.state) };
            if completed {
                let q = &mut self.state.quests[idx];
                if q.reward > 0 { self.state.inventory.trash += q.reward / 10; }
                events.push(GameEvent::QuestCompleted { title: q.title.clone(), reward: q.reward });
                for unlock in &q.unlocks {
                    match unlock.as_str() {
                        "chips" if !self.state.chips_unlocked => {
                            self.state.chips_unlocked = true;
                            events.push(GameEvent::LogMessage("🔓 Разблокированы чипы!".to_string()));
                        }
                        "plasma" if !self.state.plasma_unlocked => {
                            self.state.plasma_unlocked = true;
                            events.push(GameEvent::LogMessage("🔓 Разблокирована плазма!".to_string()));
                        }
                        "coal_trade" => {
                            events.push(GameEvent::LogMessage("🔓 Разблокирована торговля углем!".to_string()));
                        }
                        "ore" if !self.state.ore_unlocked => {
                            self.state.ore_unlocked = true;
                            events.push(GameEvent::LogMessage("🔓 Разблокирована добыча руды!".to_string()));
                        }
                        _ => {}
                    }
                }
                q.completed = true;
                self.state.current_quest += 1;
            }
        }
        events
    }
}

#[wasm_bindgen]
pub fn start_game() -> CoreGame {
    console_error_panic_hook::set_once();
    let mut game = CoreGame::new();
    game.init();
    game
}