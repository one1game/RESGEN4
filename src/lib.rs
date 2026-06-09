// ======== src/lib.rs (ИСПРАВЛЕННАЯ ВЕРСИЯ v4.3 - ДОБАВЛЕНЫ chips_unlocked/plasma_unlocked) ========
// ИСПРАВЛЕНИЯ:
// BUG-INV-09: добавлен лимит инвентаря max_inventory_stack в add_resource()
// BUG-INV-05: добавлены поля chips_unlocked и plasma_unlocked в get_statistics()

#![recursion_limit = "256"]

mod game;
mod systems;
mod web;

use wasm_bindgen::prelude::*;
use crate::game::GameEvent;
use crate::game::state::{GameState, Planet, PlanetMission, Inventory, FleetShip};
use crate::game::config::GameConfig;
use crate::systems::mining::MiningSystem;
use crate::systems::economy::EconomySystem;
use crate::systems::upgrades::UpgradeSystem;
use crate::systems::rebel::RebelSystem;
use crate::systems::neuro_ecosystem::NeuroEcosystem;
use crate::web::GameUI;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::cell::Cell;
use serde_json;
use uuid::Uuid;
use rand::Rng;

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

struct ShipInfo {
    id: String,
    name: String,
    on_mission: bool,
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
    last_save_time: u64,
    in_get_statistics: Cell<bool>,
    cached_statistics: Cell<String>,
    statistics_dirty: Cell<bool>,
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
    
    fn force_save_throttled(&mut self) {
        let now = js_sys::Date::now() as u64;
        if now - self.last_save_time > 5000 {
            self.last_save_time = now;
            self.force_save();
        }
    }
    
    fn force_save(&self) {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                let mut state = self.state.clone();
                state.neuro_evolution = self.neuro_ecosystem.evolution_level;
                state.neuro_consciousness = self.neuro_ecosystem.system_consciousness;
                state.neuro_score = self.neuro_ecosystem.get_evolution_score();
                if let Ok(json) = serde_json::to_string(&state) { 
                    let _ = storage.set_item("corebox_save", &json);
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
                        "trade_blocked": state.trade_blocked,
                        "current_night_type": state.current_night_type,
                        "power_tier": state.power_tier,
                        "active_planet_missions": &state.active_planet_missions,
                        "planets": &state.planets,
                        "total_mined": state.total_mined,
                        "_savedAt": js_sys::Date::now()
                    });
                    let _ = storage.set_item("corebox_save_universal", &simple_save.to_string());
                }
            }
        }
    }
    
    fn log_to_js(&self, msg: &str) {
        if let Some(window) = web_sys::window() {
            if let Ok(add_to_log) = js_sys::Reflect::get(&window, &JsValue::from_str("addToLog")) {
                if add_to_log.is_function() {
                    let _ = js_sys::Function::from(add_to_log).call1(&JsValue::NULL, &JsValue::from_str(msg));
                }
            }
        }
    }
    
    fn generate_random_planet(&self) -> Planet {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        
        let planet_types = vec!["earth", "volcanic", "ice", "gas", "desert", "ocean"];
        let planet_names = vec![
            "Арктур", "Сириус", "Вега", "Проксима", "Антарес", 
            "Поллукс", "Кастор", "Альтаир", "Денеб", "Регул"
        ];
        
        let planet_type = planet_types[rng.gen_range(0..planet_types.len())].to_string();
        let name = planet_names[rng.gen_range(0..planet_names.len())].to_string();
        
        let angle = rng.gen::<f64>() * std::f64::consts::PI * 2.0;
        let r = 15.0 + rng.gen::<f64>() * 30.0;
        let x = 50.0 + angle.cos() * r;
        let y = 50.0 + angle.sin() * r;
        
        let total_resources = 300 + rng.gen_range(0..301);
        let coal_part = if total_resources > 0 { rng.gen_range(0..total_resources / 2 + 1) } else { 0 };
        let remaining = total_resources - coal_part;
        let plasma_part = if remaining > 0 { rng.gen_range(0..remaining / 2 + 1) } else { 0 };
        let ore_part = remaining - plasma_part;
        
        let resources = Inventory {
            coal: coal_part,
            plasma: plasma_part,
            ore: ore_part,
            trash: 0,
            chips: 0,
        };
        
        Planet {
            id: Uuid::new_v4().to_string(),
            name,
            planet_type,
            x,
            y,
            resources: resources.clone(),
            resources_remaining: resources,
            discovered_by: "".to_string(),
            discovered_at: js_sys::Date::now() as i64,
        }
    }
    
    fn get_ship_info(&self, ship_id: &str) -> Option<ShipInfo> {
        if let Some(window) = web_sys::window() {
            let result = js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule"))
                .and_then(|module| js_sys::Reflect::get(&module, &JsValue::from_str("getShipInfo")))
                .and_then(|func| {
                    if func.is_function() {
                        js_sys::Function::from(func).call1(&JsValue::NULL, &JsValue::from_str(ship_id))
                    } else {
                        Ok(JsValue::NULL)
                    }
                });
            
            if let Ok(info) = result {
                if !info.is_null() && !info.is_undefined() {
                    let id = js_sys::Reflect::get(&info, &JsValue::from_str("id")).ok()?.as_string()?;
                    let name = js_sys::Reflect::get(&info, &JsValue::from_str("name")).ok()?.as_string()?;
                    let on_mission = js_sys::Reflect::get(&info, &JsValue::from_str("onMission"))
                        .ok()?.as_bool().unwrap_or(false);
                    return Some(ShipInfo { id, name, on_mission });
                }
            }
        }
        Some(ShipInfo {
            id: ship_id.to_string(),
            name: "Корабль".to_string(),
            on_mission: false,
        })
    }
    
    fn set_ship_mission_status(&self, ship_id: &str, on_mission: bool, mission_id: Option<String>, returns_at: Option<i64>) {
        if let Some(window) = web_sys::window() {
            let _ = js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule"))
                .and_then(|module| js_sys::Reflect::get(&module, &JsValue::from_str("setShipMissionStatusFromRust")))
                .and_then(|func| {
                    if func.is_function() {
                        let _ = js_sys::Function::from(func).call4(
                            &JsValue::NULL,
                            &JsValue::from_str(ship_id),
                            &JsValue::from_bool(on_mission),
                            &mission_id.map(|id| JsValue::from_str(&id)).unwrap_or(JsValue::NULL),
                            &returns_at.map(|t| JsValue::from_f64(t as f64)).unwrap_or(JsValue::NULL)
                        );
                    }
                    Ok(JsValue::NULL)
                });
        }
    }
    
    fn update_planet_missions(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let now = js_sys::Date::now() as i64;
        let mut completed_missions = Vec::new();
        
        for mission in &self.state.active_planet_missions {
            if mission.status == "flying" && now >= mission.returns_at {
                completed_missions.push(mission.clone());
            }
        }
        
        for mission in completed_missions {
            if let Some(idx) = self.state.active_planet_missions.iter().position(|m| m.id == mission.id) {
                self.state.active_planet_missions[idx].status = "completed".to_string();
            }
            
            if mission.resources_taken.coal > 0 {
                self.state.inventory.coal += mission.resources_taken.coal;
                self.state.total_coal_mined += mission.resources_taken.coal;
                self.state.total_mined += mission.resources_taken.coal;
                events.push(GameEvent::LogMessage(
                    format!("📦 +{} угля с планеты {}", mission.resources_taken.coal, mission.planet_name)
                ));
            }
            if mission.resources_taken.ore > 0 {
                self.state.inventory.ore += mission.resources_taken.ore;
                self.state.total_ore_mined += mission.resources_taken.ore;
                self.state.total_mined += mission.resources_taken.ore;
                events.push(GameEvent::LogMessage(
                    format!("📦 +{} руды с планеты {}", mission.resources_taken.ore, mission.planet_name)
                ));
            }
            if mission.resources_taken.plasma > 0 {
                self.state.inventory.plasma += mission.resources_taken.plasma;
                self.state.total_plasma_mined += mission.resources_taken.plasma;
                self.state.total_mined += mission.resources_taken.plasma;
                events.push(GameEvent::LogMessage(
                    format!("📦 +{} плазмы с планеты {}", mission.resources_taken.plasma, mission.planet_name)
                ));
            }
            
            events.push(GameEvent::LogMessage(
                format!("✅ Корабль {} вернулся с планеты {}!", mission.ship_name, mission.planet_name)
            ));
            
            self.set_ship_mission_status(&mission.ship_id, false, None, None);
            
            if let Some(planet) = self.state.get_planet(&mission.planet_id) {
                let rem = &planet.resources_remaining;
                if mission.resources_already_deducted && rem.coal == 0 && rem.plasma == 0 && rem.ore == 0 {
                    events.push(GameEvent::LogMessage(
                        format!("🪐 Планета {} полностью исчерпана и исчезла!", planet.name)
                    ));
                    self.state.remove_planet(&mission.planet_id);
                    
                    if let Some(window) = web_sys::window() {
                        if let Ok(space_mod) = js_sys::Reflect::get(&window, &JsValue::from_str("spaceModule")) {
                            if let Ok(load_fn) = js_sys::Reflect::get(&space_mod, &JsValue::from_str("loadPlanetsFromRust")) {
                                if load_fn.is_function() {
                                    let _ = js_sys::Function::from(load_fn).call0(&space_mod);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        self.state.active_planet_missions.retain(|m| m.status != "completed");
        
        events
    }
    
    fn handle_events(&mut self, events: Vec<GameEvent>) {
        for event in events {
            let _ = self.ui.handle_event(&event);
        }
        let _ = self.ui.render(&self.state);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    fn load(&mut self) {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                if let Ok(Some(saved)) = storage.get_item("corebox_save") {
                    if let Ok(mut state) = serde_json::from_str::<GameState>(&saved) {
                        let cfg = CONFIG.lock().unwrap();
                        let saved_power = state.computational_power;
                        let saved_max_power = state.max_computational_power;
                        
                        state.max_computational_power = cfg.auto_click_config.max_computational_power.max(saved_max_power);
                        self.neuro_ecosystem.load_from_state(state.neuro_evolution, state.neuro_consciousness, state.neuro_score);
                        self.neuro_ecosystem.last_processed_time = state.game_time;
                        state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
                        state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
                        self.rebel_system.after_deserialize();
                        if state.game_time <= 0 {
                            state.game_time = if state.is_day { cfg.time_config.day_duration } else { cfg.time_config.night_duration };
                        }
                        
                        self.state = state;
                        if saved_power > 0 {
                            self.state.computational_power = saved_power.min(self.state.max_computational_power);
                        }
                        if saved_max_power > self.state.max_computational_power {
                            self.state.max_computational_power = saved_max_power;
                        }
                        
                        if !self.state.active_planet_missions.is_empty() {
                            web_sys::console::log_1(&format!("🪐 Восстановлено {} планетарных миссий из localStorage", 
                                self.state.active_planet_missions.len()).into());
                        }
                    }
                }
            }
        }
        self.statistics_dirty.set(true);
    }
    
    fn update_config(&mut self, new_config: GameConfig) {
        let saved_power = self.state.computational_power;
        let saved_max = self.state.max_computational_power;
        let saved_tier = self.state.power_tier;
        
        self.mining_system = MiningSystem::new(new_config.mining_config.clone());
        self.economy_system = EconomySystem::new(new_config.economy_config.clone());
        self.upgrade_system = UpgradeSystem::new(new_config.upgrade_config.clone());
        
        let config_max = new_config.auto_click_config.max_computational_power;
        let real_max = config_max.max(saved_max);
        self.state.max_computational_power = real_max;
        self.state.computational_power = saved_power.min(real_max);
        self.state.power_tier = saved_tier;
        
        let old_quests = std::mem::take(&mut self.state.quests);
        self.state.load_quests(&new_config);
        for old in old_quests {
            if let Some(new) = self.state.quests.iter_mut().find(|q| q.id == old.id) { 
                new.completed = old.completed; 
            }
        }
        *CONFIG.lock().unwrap() = new_config;
        let _ = self.ui.render(&self.state);
        self.statistics_dirty.set(true);
    }
    
    fn add_manual_click_internal(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if !self.state.is_ai_active() {
            events.push(GameEvent::LogMessage("❌ Система неактивна!".to_string()));
            return events;
        }
        
        if self.state.last_warning_issued_at > 0 
           && self.state.game_time - self.state.last_warning_issued_at < 60 
        {
            self.rebel_system.record_player_reaction(
                self.state.last_warning_issued_at,
                self.state.game_time
            );
            self.state.last_warning_issued_at = 0;
        }
        
        self.state.manual_clicks += 1;
        let cfg = CONFIG.lock().unwrap();
        if self.state.manual_clicks >= cfg.auto_click_config.clicks_per_power {
            let base = cfg.auto_click_config.power_per_manual_click;
            let tier = self.state.power_tier;
            let power = (base + tier + (tier * tier) / 5).min(100);
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
    
    fn toggle_coal_internal(&mut self) -> Vec<GameEvent> {
        self.state.toggle_coal()
    }
    
    fn upgrade_mining_internal(&mut self) -> Vec<GameEvent> {
        self.upgrade_system.upgrade_mining(&mut self.state)
    }
    
    fn activate_defense_internal(&mut self) -> Vec<GameEvent> {
        self.upgrade_system.activate_defense(&mut self.state)
    }
    
    fn upgrade_defense_internal(&mut self) -> Vec<GameEvent> {
        self.upgrade_system.upgrade_defense(&mut self.state)
    }
    
    fn buy_resource_internal(&mut self, r: &str) -> Vec<GameEvent> {
        self.economy_system.buy_resource(&mut self.state, r, 1)
    }
    
    fn sell_resource_internal(&mut self, r: &str) -> Vec<GameEvent> {
        self.economy_system.sell_resource(&mut self.state, r, 1)
    }
    
    fn buy_rebel_protection_internal(&mut self) -> Vec<GameEvent> {
        self.state.buy_rebel_protection()
    }
    
    fn toggle_rebel_protection_internal(&mut self) -> Vec<GameEvent> {
        self.state.toggle_rebel_protection()
    }
    
    fn mine_resources_internal(&mut self) -> Vec<GameEvent> {
        self.mining_system.mine_resources(&mut self.state, &self.neuro_ecosystem)
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
        
        let was_day = self.state.is_day;
        
        events.extend(self.state.update_time(1, &cfg));
        
        let _night_just_started = !self.state.is_day && was_day;
        let day_just_started   =  self.state.is_day && !was_day;
        
        self.state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
        self.state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
        
        let mut had_attack = false;
        let mut was_defended = false;
        if !self.state.rebel_protection_active {
            events.extend(self.rebel_system.update_rebel_activity(&mut self.state, &cfg));
            let rebel_events = self.rebel_system.check_rebel_attack(&mut self.state, &cfg);
            had_attack = !rebel_events.is_empty();
            was_defended = rebel_events.iter().any(|e| matches!(e, GameEvent::LogMessage(m) if m.contains("отражена")));
            if had_attack { 
                self.state.last_rebel_attack_time = self.state.game_time; 
                self.state.record_defense_result(was_defended); 
                if !self.state.is_day {
                    self.state.had_attack_last_night = true;
                }
            }
            events.extend(rebel_events);
        }
        
        if day_just_started {
            self.rebel_system.update_quiet_nights(self.state.had_attack_last_night);
            self.state.had_attack_last_night = false;
        }
        
        let attacking_faction = self.rebel_system.active_faction
            .clone()
            .unwrap_or_else(|| "scavengers".to_string());
        
        if had_attack {
            let quiet_nights = self.rebel_system.factions
                .get(&attacking_faction)
                .map(|f| f.consecutive_quiet_nights)
                .unwrap_or(0);
            
            if let Some(pattern_event) = self.neuro_ecosystem.analyze_commander_behavior(
                &attacking_faction, quiet_nights, true
            ) {
                events.push(pattern_event);
            }
            
            if was_defended {
                let defeat_events = self.rebel_system.record_commander_defeat(
                    &attacking_faction, self.state.game_time
                );
                events.extend(defeat_events);
            } else {
                self.rebel_system.record_commander_victory(&attacking_faction);
            }
        }
        
        events.extend(self.rebel_system.tick_multiphase(&mut self.state, &cfg));
        events.extend(self.rebel_system.try_launch_multiphase(&self.state, &cfg));
        
        self.state.arms_race_level = self.rebel_system.arms_race_level;
        self.state.fake_depot_active = self.neuro_ecosystem.fake_depot_active;
        self.state.propaganda_active = self.neuro_ecosystem.propaganda_active;
        self.state.current_vulnerability = self.rebel_system.current_vulnerability
            .clone()
            .unwrap_or_default();
        self.state.multiphase_warning = self.rebel_system.multiphase_active;
        self.state.counter_op_cooldown_remaining = (self.neuro_ecosystem.counter_op_cooldown
            - (self.state.game_time - self.neuro_ecosystem.last_counter_op_at))
            .max(0);
        
        self.state.faction_personality_hints = ["scavengers", "technomads", "cyber_rebels"]
            .iter()
            .map(|id| self.rebel_system.get_faction_personality_hint(id))
            .filter(|s| !s.is_empty())
            .collect();
        
        if self.state.is_ai_active() {
            self.state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
            self.state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
        } else {
            self.state.neuro_defense_bonus = 0.0;
            self.state.neuro_prediction_bonus = 0.0;
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
        
        if self.state.current_quest < self.state.quests.len() {
            let idx = self.state.current_quest;
            let completed = { 
                let q = &self.state.quests[idx]; 
                !q.completed && q.check_completion(&self.state) 
            };
            if completed {
                let q = &mut self.state.quests[idx];
                if q.reward > 0 { 
                    self.state.inventory.trash += (q.reward / 10).max(1);
                }
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
    
    fn check_ai_coal_passive(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let saved = self.state.total_coal_mined.saturating_sub(self.state.total_coal_burned as u32);
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
            last_save_time: 0,
            in_get_statistics: Cell::new(false),
            cached_statistics: Cell::new(String::new()),
            statistics_dirty: Cell::new(true),
        }
    }

    pub fn init(&mut self) {
        self.load();
        let _ = self.ui.render(&self.state);
        self.force_save();
        self.statistics_dirty.set(true);
    }

    #[wasm_bindgen]
    pub fn load_game_state(&mut self, state_json: String) -> Result<(), JsValue> {
        match serde_json::from_str::<GameState>(&state_json) {
            Ok(mut loaded) => {
                let old_max = self.state.max_computational_power;
                let old_prestige = self.state.prestige_level;
                let old_power_tier = self.state.power_tier;
                
                let saved_power = loaded.computational_power;
                let saved_max_power = loaded.max_computational_power;
                let saved_power_tier = loaded.power_tier;
                
                let loaded_prestige = loaded.prestige_level;
                let loaded_neuro_evolution = loaded.neuro_evolution;
                let loaded_neuro_consciousness = loaded.neuro_consciousness;
                let loaded_neuro_score = loaded.neuro_score;
                
                let saved_planet_missions = loaded.active_planet_missions.clone();
                let saved_planets = loaded.planets.clone();
                let saved_quests_progress = loaded.quests_progress.clone();
                
                if loaded.last_ai_coal_threshold == 0 {
                    let saved_coal = loaded.total_coal_mined.saturating_sub(loaded.total_coal_burned as u32);
                    loaded.last_ai_coal_threshold = [1000, 600, 300, 100].iter()
                        .find(|&&t| saved_coal >= t).copied().unwrap_or(0);
                }
                
                self.state = loaded;
                self.state.active_planet_missions = saved_planet_missions;
                self.state.planets = saved_planets;
                
                self.state.max_computational_power = old_max.max(saved_max_power);
                self.state.prestige_level = loaded_prestige.max(old_prestige);
                self.state.power_tier = saved_power_tier.max(old_power_tier);
                
                if saved_power > 0 {
                    self.state.computational_power = saved_power.min(self.state.max_computational_power);
                }
                if saved_max_power > self.state.max_computational_power {
                    self.state.max_computational_power = saved_max_power;
                }
                
                self.neuro_ecosystem.load_from_state(
                    loaded_neuro_evolution, 
                    loaded_neuro_consciousness, 
                    loaded_neuro_score
                );
                self.state.neuro_defense_bonus = self.neuro_ecosystem.get_defense_bonus();
                self.state.neuro_prediction_bonus = self.neuro_ecosystem.get_prediction_bonus();
                
                for saved_q in saved_quests_progress {
                    if let Some(quest) = self.state.quests.iter_mut().find(|q| q.id == saved_q.id) {
                        quest.completed = saved_q.completed;
                    }
                }
                
                let _ = self.ui.render(&self.state);
                
                self.log_to_js(&format!("💾 Состояние загружено (мощность: {}/{})", 
                    self.state.computational_power, self.state.max_computational_power));
                
                if !self.state.active_planet_missions.is_empty() {
                    self.log_to_js(&format!("🪐 Восстановлено {} планетарных миссий", 
                        self.state.active_planet_missions.len()));
                }
                
                self.force_save();
                self.statistics_dirty.set(true);
                Ok(())
            }
            Err(e) => Err(JsValue::from_str(&format!("Ошибка: {}", e)))
        }
    }
    
    #[wasm_bindgen]
    pub fn save_current_state(&mut self) {
        self.force_save();
    }
    
    #[wasm_bindgen]
    pub fn set_max_power(&mut self, max: u32) {
        self.state.max_computational_power = max;
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn set_neuro_consciousness(&mut self, consciousness: f64) {
        let normalized = if consciousness > 1.0 {
            (consciousness / 100.0).clamp(0.0, 1.0)
        } else {
            consciousness.clamp(0.0, 1.0)
        };
        self.neuro_ecosystem.system_consciousness = normalized;
        self.state.neuro_consciousness = normalized;
        self.statistics_dirty.set(true);
        self.log_to_js(&format!("🧠 Нейро-сознание установлено на {:.1}%", normalized * 100.0));
    }
    
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
            "trade_blocked": self.state.trade_blocked,
            "current_night_type": self.state.current_night_type,
            "power_tier": self.state.power_tier,
            "active_planet_missions": &self.state.active_planet_missions,
            "planets": &self.state.planets,
            "total_mined": self.state.total_mined,
            "timestamp": js_sys::Date::now()
        });
        simple_save.to_string()
    }

    #[wasm_bindgen]
    pub fn add_manual_click(&mut self) { 
        let events = self.add_manual_click_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn start_auto_clicking(&mut self) { 
        let events = self.start_auto_clicking_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn stop_auto_clicking(&mut self) { 
        let events = self.stop_auto_clicking_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
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
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn upgrade_mining(&mut self) { 
        let events = self.upgrade_mining_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn activate_defense(&mut self) { 
        let events = self.activate_defense_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn upgrade_defense(&mut self) { 
        let events = self.upgrade_defense_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn upgrade_crit_module(&mut self) { 
        let events = self.upgrade_system.upgrade_crit_module(&mut self.state);
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn upgrade_cooling_module(&mut self) { 
        let events = self.upgrade_system.upgrade_cooling_module(&mut self.state);
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn buy_resource(&mut self, resource: String) { 
        let events = self.buy_resource_internal(&resource);
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn sell_resource(&mut self, resource: String) { 
        let events = self.sell_resource_internal(&resource);
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn buy_rebel_protection(&mut self) { 
        let events = self.buy_rebel_protection_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn toggle_rebel_protection(&mut self) { 
        let events = self.toggle_rebel_protection_internal();
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn reload_config(&mut self) {
        let config = Self::load_config_from_storage();
        self.update_config(config);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn clear_log(&self) { self.ui.clear_log(); }

    // BUG-INV-05: добавлены поля chips_unlocked и plasma_unlocked в get_statistics
    #[wasm_bindgen]
    pub fn get_statistics(&self) -> String {
        if self.in_get_statistics.get() {
            let cached = self.cached_statistics.take();
            if !cached.is_empty() {
                self.cached_statistics.set(cached.clone());
                return cached;
            }
            return "{}".to_string();
        }
        
        self.in_get_statistics.set(true);
        
        if !self.statistics_dirty.get() {
            let cached = self.cached_statistics.take();
            if !cached.is_empty() {
                self.cached_statistics.set(cached.clone());
                self.in_get_statistics.set(false);
                return cached;
            }
        }
        
        let blueprints = format!(r#"{{"cargo":{},"scout":{},"combat":{}}}"#,
            self.state.blueprint_cargo_unlocked,
            self.state.blueprint_scout_unlocked,
            self.state.blueprint_combat_unlocked
        );
        
        let ai_research_bonus = (self.neuro_ecosystem.system_consciousness * 0.5) as u32;
        
        let planets_json = serde_json::to_string(&self.state.planets).unwrap_or_else(|_| "[]".to_string());
        let missions_json = serde_json::to_string(&self.state.active_planet_missions).unwrap_or_else(|_| "[]".to_string());
        let attack_history_json = serde_json::to_string(&self.state.attack_history.iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string());
        
        let result = format!(r#"{{"total_clicks":{},"total_mined":{},"nights_survived":{},"rebel_attacks_count":{},"attacks_defended":{},"total_coal_mined":{},"total_trash_mined":{},"total_plasma_mined":{},"total_ore_mined":{},"total_coal_burned":{},"total_coal_stolen":{},"ore_inventory":{},"chips_inventory":{},"plasma_inventory":{},"coal_inventory":{},"trash_inventory":{},"neuro_evolution":{},"neuro_consciousness":{},"neuro_score":{},"current_ai_mode":"{}","is_day":{},"coal_enabled":{},"game_time":{},"turbine_heat":{},"turbine_upgrade_level":{},"computational_power":{},"max_computational_power":{},"mining_level":{},"defense_active":{},"defense_level":{},"crit_level":{},"cooling_level":{},"power_tier":{},"prestige_level":{},"blueprint_cargo_unlocked":{},"blueprint_scout_unlocked":{},"blueprint_combat_unlocked":{},"blueprints_unlocked":{},"ai_research_bonus":{},"chips_unlocked":{},"plasma_unlocked":{},"planets":{},"active_planet_missions":{},"arms_race_level":{},"fake_depot_active":{},"propaganda_active":{},"current_vulnerability":"{}","counter_op_cooldown":{},"multiphase_warning":{},"rebel_activity":{},"rebel_protection_nights":{},"rebel_protection_active":{},"neuro_defense_bonus":{:.4},"neuro_prediction_bonus":{:.4},"attack_warning":"{}","attack_warning_faction":"{}","attack_history":{},"defense_debuff_remaining":{},"longest_defense_streak":{},"consecutive_successful_defenses":{},"auto_clicking":{},"multiphase_phase":{},"multiphase_timer":{}}}"#,
            self.state.manual_clicks,
            self.state.total_mined,
            self.state.nights_survived,
            self.state.rebel_attacks_count,
            self.state.attacks_defended,
            self.state.total_coal_mined,
            self.state.total_trash_mined,
            self.state.total_plasma_mined,
            self.state.total_ore_mined,
            self.state.total_coal_burned,
            self.state.total_coal_stolen,
            self.state.inventory.ore,
            self.state.inventory.chips,
            self.state.inventory.plasma,
            self.state.inventory.coal,
            self.state.inventory.trash,
            self.neuro_ecosystem.evolution_level,
            self.neuro_ecosystem.system_consciousness,
            self.neuro_ecosystem.get_evolution_score(),
            self.state.current_ai_mode,
            self.state.is_day,
            self.state.coal_enabled,
            self.state.game_time,
            self.state.turbine_heat,
            self.state.turbine_upgrade_level,
            self.state.computational_power,
            self.state.max_computational_power,
            self.state.upgrades.mining,
            self.state.upgrades.defense,
            self.state.upgrades.defense_level,
            self.state.upgrades.crit_level,
            self.state.upgrades.cooling_level,
            self.state.power_tier,
            self.state.prestige_level,
            self.state.blueprint_cargo_unlocked,
            self.state.blueprint_scout_unlocked,
            self.state.blueprint_combat_unlocked,
            blueprints,
            ai_research_bonus,
            self.state.chips_unlocked,
            self.state.plasma_unlocked,
            planets_json,
            missions_json,
            self.state.arms_race_level,
            self.neuro_ecosystem.fake_depot_active,
            self.neuro_ecosystem.propaganda_active,
            self.rebel_system.current_vulnerability
                .as_deref()
                .unwrap_or(""),
            self.state.counter_op_cooldown_remaining,
            self.rebel_system.multiphase_active,
            self.state.rebel_activity,
            self.state.rebel_protection_nights,
            self.state.rebel_protection_active,
            self.state.neuro_defense_bonus,
            self.state.neuro_prediction_bonus,
            self.state.attack_warning,
            self.state.attack_warning_faction,
            attack_history_json,
            self.state.defense_debuff_remaining,
            self.state.longest_defense_streak,
            self.state.consecutive_successful_defenses,
            self.state.auto_clicking,
            self.rebel_system.multiphase_phase,
            self.rebel_system.multiphase_timer,
        );
        
        self.cached_statistics.set(result.clone());
        self.statistics_dirty.set(false);
        self.in_get_statistics.set(false);
        
        result
    }
    
    #[wasm_bindgen]
    pub fn get_neuro_score_needed(&self) -> u32 {
        self.neuro_ecosystem.get_evolution_requirement()
    }
    
    // ========== КРАФТ ==========
    
    #[wasm_bindgen]
    pub fn craft_chips_from_ore(&mut self) -> String {
        if self.state.inventory.ore >= 100 {
            self.state.inventory.ore -= 100;
            self.state.inventory.chips += 1;
            self.log_to_js("⚙️ Крафт: создан 1 чип из 100 руды!");
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen]
    pub fn craft_plasma_from_coal(&mut self) -> String {
        if self.state.inventory.coal >= 50 {
            self.state.inventory.coal -= 50;
            self.state.inventory.plasma += 1;
            self.state.total_plasma_mined += 1;
            self.state.total_mined += 1;
            self.log_to_js("⚡ Крафт: создана плазма из 50 угля!");
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            "success".to_string()
        } else { "error".to_string() }
    }
    
    #[wasm_bindgen]
    pub fn design_ship(&mut self, ship_type: String) -> String {
        let cost = match ship_type.as_str() { 
            "cargo" => 200,
            "scout" => 50,
            "combat" => 800, 
            _ => return "error".to_string() 
        };
        
        if self.state.computational_power >= cost {
            self.state.computational_power -= cost;
            match ship_type.as_str() {
                "cargo" => self.state.blueprint_cargo_unlocked = true,
                "scout" => self.state.blueprint_scout_unlocked = true,
                "combat" => self.state.blueprint_combat_unlocked = true,
                _ => {}
            }
            self.log_to_js(&format!("📐 Создан чертеж {} корабля!", ship_type));
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            "success".to_string()
        } else { 
            "error".to_string() 
        }
    }
    
    #[wasm_bindgen] 
    pub fn craft_cargo_ship(&mut self) -> String { 
        let result = self.craft_ship_internal("cargo");
        if result == "success" {
            self.add_ship_to_fleet("cargo");
        }
        self.statistics_dirty.set(true);
        result
    }
    
    #[wasm_bindgen] 
    pub fn craft_scout_ship(&mut self) -> String { 
        let result = self.craft_ship_internal("scout");
        if result == "success" {
            self.add_ship_to_fleet("scout");
        }
        self.statistics_dirty.set(true);
        result
    }
    
    #[wasm_bindgen] 
    pub fn craft_combat_ship(&mut self) -> String { 
        let result = self.craft_ship_internal("combat");
        if result == "success" {
            self.add_ship_to_fleet("combat");
        }
        self.statistics_dirty.set(true);
        result
    }
    
    fn craft_ship_internal(&mut self, ship_type: &str) -> String {
        let (base_ore, base_chips, base_plasma, unlocked) = match ship_type {
            "cargo" => (200, 50, 10, self.state.blueprint_cargo_unlocked),
            "scout" => (100, 100, 20, self.state.blueprint_scout_unlocked),
            "combat" => (300, 150, 30, self.state.blueprint_combat_unlocked),
            _ => return "error".to_string()
        };
        
        if !unlocked {
            self.log_to_js("❌ Сначала создайте чертеж во вкладке РАЗРАБОТКА!");
            return "error".to_string();
        }
        
        let discount = (self.neuro_ecosystem.evolution_level as f64 * 0.015).min(0.3);
        let ore = (base_ore as f64 * (1.0 - discount)).max(1.0) as u32;
        let chips = (base_chips as f64 * (1.0 - discount)).max(1.0) as u32;
        let plasma = (base_plasma as f64 * (1.0 - discount)).max(1.0) as u32;
        
        if self.state.inventory.ore >= ore && 
           self.state.inventory.chips >= chips && 
           self.state.inventory.plasma >= plasma {
            
            self.state.inventory.ore -= ore; 
            self.state.inventory.chips -= chips; 
            self.state.inventory.plasma -= plasma;
            
            let discount_text = if discount > 0.0 {
                format!(" (скидка ИИ: -{}%)", (discount * 100.0) as u32)
            } else {
                String::new()
            };
            
            self.log_to_js(&format!("🚀 Создан {} корабль!{} (потрачено: {}⛏️, {}🎛️, {}⚡)", 
                ship_type, discount_text, ore, chips, plasma));
            
            self.force_save_throttled();
            "success".to_string()
        } else {
            self.log_to_js(&format!(
                "❌ Недостаточно ресурсов для {} корабля! Нужно: {}⛏️, {}🎛️, {}⚡ (со скидкой ИИ)", 
                ship_type, ore, chips, plasma));
            "error".to_string()
        }
    }
    
    fn add_ship_to_fleet(&mut self, ship_type: &str) {
        if let Some(window) = web_sys::window() {
            if let Ok(fleet_module) = js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule")) {
                if let Ok(add_fn) = js_sys::Reflect::get(&fleet_module, &JsValue::from_str("addShip")) {
                    if add_fn.is_function() {
                        let _ = js_sys::Function::from(add_fn).call1(&fleet_module, &JsValue::from_str(ship_type));
                        self.log_to_js("🚢 Корабль добавлен во флот!");
                    }
                }
            }
        }
    }
    
    #[wasm_bindgen]
    pub fn get_blueprint_status(&self) -> String {
        format!(r#"{{"blueprints_unlocked":{{"cargo":{},"scout":{},"combat":{}}},"ai_research_bonus":{}}}"#,
            self.state.blueprint_cargo_unlocked, 
            self.state.blueprint_scout_unlocked, 
            self.state.blueprint_combat_unlocked,
            (self.neuro_ecosystem.system_consciousness * 0.5) as u32)
    }
    
    #[wasm_bindgen]
    pub fn sync_blueprints(&mut self, cargo: bool, scout: bool, combat: bool) {
        self.state.blueprint_cargo_unlocked = cargo;
        self.state.blueprint_scout_unlocked = scout;
        self.state.blueprint_combat_unlocked = combat;
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    // ========== ФЛОТ ==========
    
    #[wasm_bindgen]
    pub fn apply_fleet_repair(&mut self, ore_cost: u32, chips_cost: u32) -> bool {
        if self.state.inventory.ore >= ore_cost && self.state.inventory.chips >= chips_cost {
            self.state.inventory.ore -= ore_cost; 
            self.state.inventory.chips -= chips_cost;
            self.log_to_js(&format!("🔧 Флот отремонтирован (-{} руды, -{} чипов)", ore_cost, chips_cost));
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            true
        } else { false }
    }
    
    #[wasm_bindgen]
    pub fn apply_fleet_upgrade(&mut self, ore: u32, chips: u32, plasma: u32) -> bool {
        if self.state.inventory.ore >= ore && self.state.inventory.chips >= chips && self.state.inventory.plasma >= plasma {
            self.state.inventory.ore -= ore; 
            self.state.inventory.chips -= chips; 
            self.state.inventory.plasma -= plasma;
            self.log_to_js(&format!("⬆️ Корабль улучшен (-{} руды, -{} чипов, -{} плазмы)", ore, chips, plasma));
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            true
        } else { false }
    }
    
    #[wasm_bindgen]
    pub fn set_fleet_defense_bonus(&mut self, _bonus: u32) {
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn set_fleet_cargo_bonus(&mut self, bonus: u32) { 
        self.state.temporary_mining_bonus = self.state.temporary_mining_bonus.max(bonus).min(100);
        self.statistics_dirty.set(true);
    }
    
    // ========== ТУРБИНА ==========
    
    #[wasm_bindgen]
    pub fn upgrade_turbine(&mut self) -> bool {
        let cost_ore = 30 + self.state.turbine_upgrade_level * 20;
        let cost_chips = 5 + self.state.turbine_upgrade_level * 3;
        if self.state.turbine_upgrade_level >= 5 {
            self.log_to_js("⚙️ Турбина уже на максимальном уровне!");
            return false;
        }
        if self.state.inventory.ore >= cost_ore && self.state.inventory.chips >= cost_chips {
            self.state.inventory.ore -= cost_ore; 
            self.state.inventory.chips -= cost_chips;
            self.state.turbine_upgrade_level += 1;
            self.log_to_js(&format!("⚙️ Турбина улучшена до уровня {}!", self.state.turbine_upgrade_level));
            self.force_save_throttled();
            self.statistics_dirty.set(true);
            true
        } else { false }
    }
    
    #[wasm_bindgen] 
    pub fn get_turbine_heat(&self) -> u32 { self.state.turbine_heat }
    
    #[wasm_bindgen] 
    pub fn get_turbine_upgrade_level(&self) -> u32 { self.state.turbine_upgrade_level }
    
    #[wasm_bindgen] 
    pub fn is_turbine_cooling(&self) -> bool { self.state.turbine_cooling }
    
    // ========== РЕСУРСЫ И МОЩНОСТЬ ==========
    
    // BUG-INV-09: добавлен лимит инвентаря max_inventory_stack
    #[wasm_bindgen]
    pub fn add_resource(&mut self, resource: String, amount: u32) {
        let cap = self.state.max_inventory_stack;
        match resource.as_str() {
            "coal" => { 
                self.state.inventory.coal = (self.state.inventory.coal + amount).min(cap);
                self.state.total_coal_mined += amount; 
                self.state.total_mined += amount; 
            }
            "ore" => { 
                self.state.inventory.ore = (self.state.inventory.ore + amount).min(cap);
                self.state.total_ore_mined += amount; 
                self.state.total_mined += amount; 
            }
            "chips" => { 
                self.state.inventory.chips = (self.state.inventory.chips + amount).min(cap);
                self.state.total_mined += amount; 
            }
            "plasma" => { 
                self.state.inventory.plasma = (self.state.inventory.plasma + amount).min(cap);
                self.state.total_plasma_mined += amount; 
                self.state.total_mined += amount; 
            }
            "trash" => { 
                self.state.inventory.trash = (self.state.inventory.trash + amount).min(cap);
                self.state.total_trash_mined += amount; 
                self.state.total_mined += amount; 
            }
            _ => {}
        }
        let _ = self.ui.render(&self.state);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
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
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen] 
    pub fn add_power(&mut self, amount: u32) {
        self.state.computational_power = (self.state.computational_power + amount).min(self.state.max_computational_power);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen] 
    pub fn subtract_power(&mut self, amount: u32) {
        self.state.computational_power = self.state.computational_power.saturating_sub(amount);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn repair_systems(&mut self) {
        self.state.mining_debuff_remaining = 0; 
        self.state.mining_debuff_percent = 0.0;
        self.state.autoclick_debuff_remaining = 0; 
        self.state.autoclick_debuff_percent = 0.0;
        self.state.defense_debuff_remaining = 0;
        self.log_to_js("🔧 Все системы восстановлены!");
        self.force_save_throttled();
        self.statistics_dirty.set(true);
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
        self.log_to_js("🔄 Прогресс сброшен!");
        
        if let Some(window) = web_sys::window() {
            if let Ok(fleet) = js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule")) {
                if let Ok(cleanup) = js_sys::Reflect::get(&fleet, &JsValue::from_str("cleanup")) {
                    if cleanup.is_function() {
                        let _ = js_sys::Function::from(cleanup).call0(&fleet);
                    }
                }
            }
        }
        
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen] 
    pub fn get_neuro_evolution(&self) -> u32 { self.neuro_ecosystem.evolution_level }
    
    #[wasm_bindgen] 
    pub fn get_resource(&self, resource: String) -> u32 {
        match resource.as_str() {
            "coal" => self.state.inventory.coal, 
            "ore" => self.state.inventory.ore,
            "chips" => self.state.inventory.chips, 
            "plasma" => self.state.inventory.plasma,
            "trash" => self.state.inventory.trash, 
            _ => 0
        }
    }
    
    // ========== ПЛАНЕТАРНЫЕ МИССИИ ==========
    
    #[wasm_bindgen]
    pub fn get_planets(&self) -> String {
        serde_json::to_string(&self.state.planets).unwrap_or_else(|_| "[]".to_string())
    }
    
    #[wasm_bindgen]
    pub fn get_active_planet_missions(&self) -> String {
        let now = js_sys::Date::now() as i64;
        let missions: Vec<_> = self.state.active_planet_missions.iter()
            .map(|m| {
                serde_json::json!({
                    "id": m.id,
                    "ship_id": m.ship_id,
                    "ship_name": m.ship_name,
                    "planet_id": m.planet_id,
                    "planet_name": m.planet_name,
                    "arrives_at": m.arrives_at,
                    "returns_at": m.returns_at,
                    "remaining_ms": (m.returns_at - now).max(0),
                    "coal_taken": m.resources_taken.coal,
                    "plasma_taken": m.resources_taken.plasma,
                    "ore_taken": m.resources_taken.ore,
                    "status": &m.status
                })
            })
            .collect();
        
        serde_json::to_string(&missions).unwrap_or_else(|_| "[]".to_string())
    }
    
    #[wasm_bindgen]
    pub fn research_planet(&mut self) -> String {
        let power = self.state.computational_power;
        
        if power < 100 {
            return serde_json::json!({
                "success": false,
                "error": "Недостаточно мощности (нужно 100)"
            }).to_string();
        }
        
        if self.state.planets.len() >= 3 {
            return serde_json::json!({
                "success": false,
                "error": "Максимум 3 планеты"
            }).to_string();
        }
        
        let planet = self.generate_random_planet();
        self.state.computational_power -= 100;
        self.state.planets.push(planet.clone());
        self.force_save();
        self.statistics_dirty.set(true);
        
        serde_json::json!({
            "success": true,
            "planet": planet
        }).to_string()
    }
    
    #[wasm_bindgen]
    pub fn complete_planet_mission(&mut self, mission_id: String) -> String {
        let mission_index = self.state.active_planet_missions.iter().position(|m| m.id == mission_id);
        
        if let Some(idx) = mission_index {
            let mission = self.state.active_planet_missions[idx].clone();
            
            if mission.status != "flying" {
                return serde_json::json!({
                    "success": false,
                    "error": "Миссия уже завершена"
                }).to_string();
            }
            
            let now = js_sys::Date::now() as i64;
            if mission.returns_at > now {
                return serde_json::json!({
                    "success": false,
                    "error": "Корабль ещё не вернулся"
                }).to_string();
            }
            
            let resources = serde_json::json!({
                "coal": mission.resources_taken.coal,
                "plasma": mission.resources_taken.plasma,
                "ore": mission.resources_taken.ore
            });
            
            if mission.resources_taken.coal > 0 {
                self.state.inventory.coal += mission.resources_taken.coal;
                self.state.total_coal_mined += mission.resources_taken.coal;
                self.state.total_mined += mission.resources_taken.coal;
            }
            if mission.resources_taken.plasma > 0 {
                self.state.inventory.plasma += mission.resources_taken.plasma;
                self.state.total_plasma_mined += mission.resources_taken.plasma;
                self.state.total_mined += mission.resources_taken.plasma;
            }
            if mission.resources_taken.ore > 0 {
                self.state.inventory.ore += mission.resources_taken.ore;
                self.state.total_ore_mined += mission.resources_taken.ore;
                self.state.total_mined += mission.resources_taken.ore;
            }
            
            self.state.active_planet_missions.remove(idx);
            
            self.force_save();
            self.statistics_dirty.set(true);
            
            return serde_json::json!({
                "success": true,
                "resources": resources
            }).to_string();
        }
        
        serde_json::json!({
            "success": false,
            "error": "Миссия не найдена"
        }).to_string()
    }
    
    #[wasm_bindgen]
    pub fn send_ship_to_planet(&mut self, ship_id: String, planet_id: String) -> String {
        let ship_info = self.get_ship_info(&ship_id);
        if ship_info.is_none() {
            return serde_json::json!({
                "success": false,
                "error": "Корабль не найден"
            }).to_string();
        }
        let ship_info = ship_info.unwrap();
        
        if ship_info.on_mission {
            return serde_json::json!({
                "success": false,
                "error": "Корабль уже в миссии"
            }).to_string();
        }
        
        let planet_index = self.state.planets.iter().position(|p| p.id == planet_id);
        let planet_index = match planet_index {
            Some(idx) => idx,
            None => {
                return serde_json::json!({
                    "success": false,
                    "error": "Планета не найдена"
                }).to_string();
            }
        };
        
        let planet = self.state.planets[planet_index].clone();
        
        let cargo_capacity = 100;
        let mut coal = planet.resources_remaining.coal.min(cargo_capacity);
        let mut plasma = planet.resources_remaining.plasma.min(cargo_capacity);
        let mut ore = planet.resources_remaining.ore.min(cargo_capacity);
        
        let mut remaining = cargo_capacity;
        if coal > remaining { coal = remaining; }
        remaining -= coal;
        if plasma > remaining { plasma = remaining; }
        remaining -= plasma;
        if ore > remaining { ore = remaining; }
        
        let mut new_remaining = planet.resources_remaining.clone();
        new_remaining.coal = new_remaining.coal.saturating_sub(coal);
        new_remaining.plasma = new_remaining.plasma.saturating_sub(plasma);
        new_remaining.ore = new_remaining.ore.saturating_sub(ore);
        
        self.state.planets[planet_index].resources_remaining = new_remaining;
        
        let travel_sec = 60 + rand::thread_rng().gen_range(0..61);
        let now = js_sys::Date::now() as i64;
        let arrives_at = now + (travel_sec as i64 * 1000);
        let returns_at = now + (travel_sec as i64 * 2 * 1000);
        
        let mission = PlanetMission {
            id: Uuid::new_v4().to_string(),
            ship_id: ship_id.clone(),
            ship_name: ship_info.name.clone(),
            planet_id: planet_id.clone(),
            planet_name: planet.name.clone(),
            arrives_at,
            returns_at,
            resources_taken: Inventory {
                coal,
                plasma,
                ore,
                trash: 0,
                chips: 0,
            },
            status: "flying".to_string(),
            resources_already_deducted: true,
        };
        
        self.state.active_planet_missions.push(mission.clone());
        self.set_ship_mission_status(&ship_id, true, Some(mission.id.clone()), Some(returns_at));
        self.force_save();
        self.statistics_dirty.set(true);
        
        self.log_to_js(&format!("🚀 Корабль {} отправлен к планете {}! Забрано: {}🪨 {}⚡ {}⛏️",
            ship_info.name, planet.name, coal, plasma, ore));
        
        serde_json::json!({
            "success": true,
            "mission": {
                "id": mission.id,
                "arrives_at": arrives_at,
                "returns_at": returns_at,
                "ship_type": "cargo",
                "resources_taken": {
                    "coal": coal,
                    "plasma": plasma,
                    "ore": ore
                }
            }
        }).to_string()
    }
    
    #[wasm_bindgen]
    pub fn sync_fleet_from_js(&mut self, fleet_json: &str) -> String {
        match serde_json::from_str::<Vec<FleetShip>>(fleet_json) {
            Ok(ships) => {
                self.state.fleet_ships = ships;
                self.force_save_throttled();
                self.statistics_dirty.set(true);
                "ok".to_string()
            }
            Err(e) => format!("error: {}", e)
        }
    }
    
    #[wasm_bindgen]
    pub fn game_loop(&mut self) {
        let mut events = self.game_loop_internal();
        
        events.extend(self.update_planet_missions());
        
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    // ========== НОВЫЕ WASM-ФУНКЦИИ ДЛЯ ВОЙНЫ УМОВ ==========
    
    #[wasm_bindgen]
    pub fn neuro_propaganda(&mut self) {
        let events = self.neuro_ecosystem.launch_propaganda(
            &mut self.state, &mut self.rebel_system
        );
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn neuro_fake_depot(&mut self) {
        let events = self.neuro_ecosystem.deploy_fake_depot(
            &mut self.state, &mut self.rebel_system
        );
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn neuro_close_vulnerability(&mut self) {
        let events = self.neuro_ecosystem.close_vulnerability(
            &mut self.state, &mut self.rebel_system
        );
        self.handle_events(events);
        self.force_save_throttled();
        self.statistics_dirty.set(true);
    }
    
    #[wasm_bindgen]
    pub fn get_intercepted_messages(&self) -> String {
        let messages: Vec<serde_json::Value> = self.neuro_ecosystem.intercepted_messages
            .iter()
            .map(|m| serde_json::json!({
                "content": m.content,
                "target_hint": m.target_hint,
                "eta_ticks": m.eta_ticks,
                "reliability": m.reliability,
                "age": self.state.game_time - m.intercepted_at,
            }))
            .collect();
        serde_json::to_string(&messages).unwrap_or_else(|_| "[]".to_string())
    }
    
    #[wasm_bindgen]
    pub fn get_neuro_analytics(&self) -> String {
        let node = &self.neuro_ecosystem.bayesian_nodes[
            (self.state.rebel_activity as usize).min(15)
        ];
        let (lo, hi) = node.confidence_interval();
        let (markov_next, markov_conf) = self.neuro_ecosystem.markov_chain
            .predict_next(&self.neuro_ecosystem.current_ai_state);
        
        serde_json::json!({
            "prediction_accuracy": (self.neuro_ecosystem.prediction_accuracy * 100.0) as u32,
            "prediction_trust": (self.neuro_ecosystem.prediction_trust * 100.0) as u32,
            "prediction_streak": self.neuro_ecosystem.correct_prediction_streak,
            "defense_success_rate": (self.neuro_ecosystem.defense_success_rate * 100.0) as u32,
            "bayesian_prob": (node.ewma_probability * 100.0) as u32,
            "bayesian_lo": (lo * 100.0) as u32,
            "bayesian_hi": (hi * 100.0) as u32,
            "q_reward": (self.neuro_ecosystem.q_table.average_reward() * 100.0) as i32,
            "cusum_ratio": if self.neuro_ecosystem.cusum_threshold > 0.0 {
                (self.neuro_ecosystem.cusum_sum / self.neuro_ecosystem.cusum_threshold * 100.0) as u32
            } else { 0 },
            "alarm_threshold": (self.neuro_ecosystem.adaptive_alarm_threshold * 100.0) as u32,
            "enemy_encryption": self.neuro_ecosystem.enemy_encryption_level,
            "total_attacks_processed": self.neuro_ecosystem.total_attacks_processed,
            "markov_next_state": format!("{:?}", markov_next),
            "markov_confidence": (markov_conf * 100.0) as u32,
        }).to_string()
    }
    
    #[wasm_bindgen]
    pub fn get_rebel_intel(&self) -> String {
        let factions: Vec<serde_json::Value> = ["scavengers", "technomads", "cyber_rebels"]
            .iter()
            .filter_map(|id| self.rebel_system.factions.get(*id).map(|f| {
                let profile = self.neuro_ecosystem.commander_profiles.get(*id);
                serde_json::json!({
                    "id": f.id,
                    "name": f.name,
                    "personality": format!("{:?}", f.personality),
                    "commander": f.commander.name,
                    "consecutive_losses": f.commander.consecutive_losses,
                    "is_frustrated": f.commander.is_frustrated,
                    "quiet_nights": f.consecutive_quiet_nights,
                    "quiet_nights_accumulated": f.commander.quiet_nights_accumulated,
                    "hint": self.rebel_system.get_faction_personality_hint(id),
                    "decoy_ignored": f.decoy_ignored_by_player,
                    "predicted_attack_after": profile.map(|p| p.predicted_quiet_threshold).unwrap_or(0),
                    "pattern_revealed": profile.map(|p| p.signature_revealed).unwrap_or(false),
                    "attacks_observed": profile.map(|p| p.attacks_observed).unwrap_or(0),
                })
            }))
            .collect();
        serde_json::to_string(&factions).unwrap_or_else(|_| "[]".to_string())
    }
}

#[wasm_bindgen]
pub fn start_game() -> CoreGame {
    console_error_panic_hook::set_once();
    let mut game = CoreGame::new();
    game.init();
    game
}