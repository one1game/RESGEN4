use super::config::GameConfig;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AttackRecord {
    pub faction: String,
    pub attack_type: String,
    pub was_defended: bool,
    pub result: String,
    pub game_time: i32,
    pub stolen: HashMap<String, u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FleetShip {
    pub id: String,
    #[serde(alias = "type")]
    pub ship_type: String,
    pub name: String,
    pub level: u32,
    pub health: u32,
    #[serde(alias = "maxHealth")]
    pub max_health: u32,
    pub experience: u32,
    #[serde(alias = "missions")]
    pub missions_completed: u32,
    #[serde(alias = "onMission")]
    pub on_mission: bool,
    #[serde(alias = "onDefense")]
    pub on_defense: bool,
    #[serde(alias = "currentMissionId")]
    pub current_mission_id: Option<String>,
    #[serde(alias = "targetPlanetId")]
    pub target_planet_id: Option<String>,
    #[serde(alias = "targetUserId")]
    pub target_user_id: Option<String>,
    #[serde(alias = "missionReturnsAt")]
    pub mission_returns_at: Option<i64>,
    #[serde(alias = "createdAt")]
    pub created_at: i64,
    pub speed: u32,
}

#[allow(dead_code)]
impl FleetShip {
    pub fn new(ship_type: &str, _ship_index: usize) -> Self {
        let (name, max_health, speed) = match ship_type {
            "cargo" => (format!("Грузовой"), 100, 1),
            "scout" => (format!("Разведчик"), 80, 3),
            "combat" => (format!("Боевой"), 120, 2),
            _ => (format!("Корабль"), 100, 1),
        };
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            ship_type: ship_type.to_string(),
            name,
            level: 0,
            health: max_health,
            max_health,
            experience: 0,
            missions_completed: 0,
            on_mission: false,
            on_defense: false,
            current_mission_id: None,
            target_planet_id: None,
            target_user_id: None,
            mission_returns_at: None,
            created_at: js_sys::Date::now() as i64,
            speed,
        }
    }

    pub fn new_with_id(ship_type: &str, id: String) -> Self {
        let (name, max_health, speed) = match ship_type {
            "cargo" => (format!("Грузовой"), 100, 1),
            "scout" => (format!("Разведчик"), 80, 3),
            "combat" => (format!("Боевой"), 120, 2),
            _ => (format!("Корабль"), 100, 1),
        };
        Self {
            id,
            ship_type: ship_type.to_string(),
            name,
            level: 0,
            health: max_health,
            max_health,
            experience: 0,
            missions_completed: 0,
            on_mission: false,
            on_defense: false,
            current_mission_id: None,
            target_planet_id: None,
            target_user_id: None,
            mission_returns_at: None,
            created_at: js_sys::Date::now() as i64,
            speed,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Planet {
    pub id: String,
    pub name: String,
    pub planet_type: String,
    pub x: f64,
    pub y: f64,
    pub resources: Inventory,
    pub resources_remaining: Inventory,
    pub discovered_by: String,
    pub discovered_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct PlanetMission {
    pub id: String,
    pub ship_id: String,
    pub ship_name: String,
    pub planet_id: String,
    pub planet_name: String,
    pub arrives_at: i64,
    pub returns_at: i64,
    pub resources_taken: Inventory,
    pub status: String,
    pub resources_already_deducted: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Inventory {
    pub coal: u32,
    pub trash: u32,
    pub chips: u32,
    pub plasma: u32,
    pub ore: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Upgrades {
    pub mining: u32,
    pub defense: bool,
    pub defense_level: u32,
    pub crit_level: u32,
    pub cooling_level: u32,
}

impl Default for Upgrades {
    fn default() -> Self {
        Self {
            mining: 0,
            defense: false,
            defense_level: 0,
            crit_level: 0,
            cooling_level: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Quest {
    pub id: String,
    pub title: String,
    pub description: String,
    pub quest_type: QuestType,
    pub target: u32,
    pub reward: u32,
    pub enabled: bool,
    pub order: u32,
    pub completed: bool,
    pub unlocks: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuestProgress {
    pub id: String,
    pub completed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum QuestType {
    MineAny,
    SurviveNight,
    MineResource(String),
    ActivateDefense,
    SurviveAttack,
    ReachEvolutionLevel,
    BlueprintUnlocked,
    CollectResource(String),
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct GameState {
    pub game_time: i32,
    pub is_day: bool,
    pub time_changed: bool,
    pub coal_enabled: bool,

    pub coal_unlocked: bool,
    pub trash_unlocked: bool,
    pub chips_unlocked: bool,
    pub plasma_unlocked: bool,
    pub ore_unlocked: bool,

    pub total_mined: u32,
    pub nights_survived: u32,
    pub rebel_activity: u32,

    pub turbine_heat: u32,
    pub turbine_heat_fraction: f64,
    pub turbine_upgrade_level: u32,
    pub turbine_cooling: bool,

    pub last_click_time: u64,
    pub current_quest: usize,
    pub inventory: Inventory,
    pub upgrades: Upgrades,
    pub quests: Vec<Quest>,

    pub total_coal_burned: u64,
    pub plasma_from_coal: u64,

    pub auto_clicking: bool,
    #[serde(default)]
    pub auto_click_stop_reason: String,
    pub computational_power: u32,
    pub max_computational_power: u32,
    pub last_auto_click_time: i32,
    pub manual_clicks: u32,
    pub total_manual_clicks: u32,

    pub rebel_protection_nights: u32,
    pub rebel_protection_active: bool,

    pub total_coal_mined: u32,
    pub total_trash_mined: u32,
    pub total_plasma_mined: u32,
    pub total_ore_mined: u32,
    pub total_coal_stolen: u32,
    pub total_ore_stolen: u32,

    pub attacks_defended: u32,
    pub rebel_attacks_count: u32,

    pub neuro_evolution: u32,
    pub neuro_consciousness: f64,
    pub neuro_score: u32,
    pub neuro_defense_bonus: f64,
    pub neuro_prediction_bonus: f64,

    pub last_rebel_attack_time: i32,
    pub last_rebel_attack_type: String,
    pub last_attack_was_defended: bool,
    pub consecutive_successful_defenses: u32,
    pub consecutive_failed_defenses: u32,
    pub total_defense_activations: u32,

    pub temporary_mining_bonus: u32,
    pub temporary_defense_bonus: u32,
    pub fleet_power_bonus: u32,
    pub temporary_bonus_remaining: i32,

    pub highest_rebel_activity: u32,
    pub longest_defense_streak: u32,
    pub total_evolution_points_earned: u32,

    pub neuro_passive_timer: i32,
    pub neuro_evolution_timer: i32,

    pub defense_debuff_remaining: i32,
    pub mining_debuff_remaining: i32,
    pub mining_debuff_percent: f32,
    pub autoclick_debuff_remaining: i32,
    pub autoclick_debuff_percent: f32,

    pub attack_history: VecDeque<AttackRecord>,
    pub last_attacking_faction: String,
    pub current_ai_mode: String,
    pub attack_warning: String,
    pub attack_warning_faction: String,

    pub blueprint_cargo_unlocked: bool,
    pub blueprint_scout_unlocked: bool,
    pub blueprint_combat_unlocked: bool,
    pub blueprint_research_progress: u32,

    pub current_night_type: String,
    pub trade_blocked: bool,
    pub power_tier: u32,
    pub last_ai_coal_threshold: u32,

    pub fleet_ships: Vec<FleetShip>,
    pub total_ships_built: u32,

    pub planets: Vec<Planet>,
    pub active_planet_missions: Vec<PlanetMission>,

    pub quests_progress: Vec<QuestProgress>,

    pub last_intercept_text: String,
    pub last_warning_issued_at: i32,
    pub arms_race_level: u32,
    pub fake_depot_active: bool,
    pub propaganda_active: bool,
    pub current_vulnerability: String,
    pub faction_personality_hints: Vec<String>,
    pub counter_op_cooldown_remaining: i32,
    pub multiphase_warning: bool,
    pub had_attack_last_night: bool,

    pub max_inventory_stack: u32,

    pub map_x: Option<f64>,
    pub map_y: Option<f64>,

    pub background_sabotage_cooldown_remaining: i32,
    pub last_fleet_attack_time: i32,
    pub last_blueprint_steal_time: i32,
    pub last_planet_harass_time: i32,
    pub last_tec_sabotage_time: i32,

    pub blueprint_locked_until: i64,
    pub locked_blueprint_id: String,

    pub fleet_under_attack: bool,
    pub fleet_attack_target_id: String,
    pub fleet_attack_damage: u32,

    pub planet_under_harass: bool,
    pub harassed_planet_id: String,

    pub tec_sabotaged: bool,
    pub tec_sabotage_remaining: i32,

    pub protection_breached_this_night: bool,
    pub total_breaches: u32,

    pub fear_level: u32,
    pub last_fear_event_time: i32,

    pub fleet_shield_active: bool,
    pub fleet_shield_expires_at: i64,

    pub blueprints_encrypted: bool,
    pub blueprint_encryption_expires_at: i64,

    pub planets_fortified: bool,
    pub planet_fortification_expires_at: i64,

    pub craft_blocked_until: i64,

    pub tick_count: i64,
}

#[allow(dead_code)]
impl GameState {
    pub fn new(config: &GameConfig) -> Self {
        let mut state = Self::default();
        state.game_time = config.time_config.initial_time;
        state.is_day = config.time_config.start_at_day;
        state.max_computational_power = config.auto_click_config.max_computational_power;
        state.max_inventory_stack = config.game_balance_config.max_inventory_stack;
        state.inventory.ore = config.game_balance_config.initial_ore;
        state.inventory.coal = config.game_balance_config.initial_coal;
        state.inventory.trash = config.game_balance_config.initial_trash;
        state.inventory.chips = config.game_balance_config.initial_chips;
        state.inventory.plasma = config.game_balance_config.initial_plasma;
        state.planets = Vec::new();
        state.active_planet_missions = Vec::new();
        state.quests_progress = Vec::new();
        state.fleet_ships = Vec::new();
        state.total_ships_built = 0;
        state.load_quests(config);

        state.last_intercept_text = String::new();
        state.last_warning_issued_at = 0;
        state.arms_race_level = 0;
        state.fake_depot_active = false;
        state.propaganda_active = false;
        state.current_vulnerability = String::new();
        state.faction_personality_hints = Vec::new();
        state.counter_op_cooldown_remaining = 0;
        state.multiphase_warning = false;
        state.had_attack_last_night = false;

        state.map_x = None;
        state.map_y = None;

        state.background_sabotage_cooldown_remaining = 0;
        state.last_fleet_attack_time = -999;
        state.last_blueprint_steal_time = -999;
        state.last_planet_harass_time = -999;
        state.last_tec_sabotage_time = -999;

        state.blueprint_locked_until = 0;
        state.locked_blueprint_id = String::new();

        state.fleet_under_attack = false;
        state.fleet_attack_target_id = String::new();
        state.fleet_attack_damage = 0;

        state.planet_under_harass = false;
        state.harassed_planet_id = String::new();

        state.tec_sabotaged = false;
        state.tec_sabotage_remaining = 0;

        state.protection_breached_this_night = false;
        state.total_breaches = 0;

        state.fear_level = 0;
        state.last_fear_event_time = 0;

        state.fleet_shield_active = false;
        state.fleet_shield_expires_at = 0;

        state.blueprints_encrypted = false;
        state.blueprint_encryption_expires_at = 0;

        state.planets_fortified = false;
        state.planet_fortification_expires_at = 0;

        state.craft_blocked_until = 0;

        state.tick_count = 0;

        state
    }

    pub fn load_quests(&mut self, config: &GameConfig) {
        self.quests.clear();
        for q in &config.quests {
            if !q.enabled {
                continue;
            }
            let qtype = match q.quest_type.as_str() {
                "MineAny" => QuestType::MineAny,
                "SurviveNight" => QuestType::SurviveNight,
                "ActivateDefense" => QuestType::ActivateDefense,
                "SurviveAttack" => QuestType::SurviveAttack,
                "ReachEvolutionLevel" => QuestType::ReachEvolutionLevel,
                "BlueprintUnlocked" => QuestType::BlueprintUnlocked,
                t if t.starts_with("Collect") => QuestType::CollectResource(t[7..].to_lowercase()),
                t if t.starts_with("Mine") => QuestType::MineResource(t[4..].to_lowercase()),
                _ => QuestType::MineAny,
            };
            self.quests.push(Quest {
                id: q.id.clone(),
                title: q.title.clone(),
                description: q.description.clone(),
                quest_type: qtype,
                target: q.target,
                reward: q.reward,
                enabled: q.enabled,
                order: q.order,
                completed: false,
                unlocks: q.unlocks.clone(),
            });
        }
        self.quests.sort_by(|a, b| a.order.cmp(&b.order));
        self.current_quest = 0;
        while self.current_quest < self.quests.len() && self.quests[self.current_quest].completed {
            self.current_quest += 1;
        }
    }

    pub fn update_time(
        &mut self,
        delta: i32,
        config: &GameConfig,
    ) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
        let mut events = Vec::new();

        self.tick_count += 1;

        if self.fear_level > 0 && (self.tick_count) - self.last_fear_event_time as i64 > 30 {
            self.fear_level = self.fear_level.saturating_sub(1);
            self.last_fear_event_time = self.tick_count as i32;
        }

        // Базовое 1.5, +0.25 за уровень турбины, +0.30 за уровень охлаждения
        // При ур.3+3: 1.5 + 0.75 + 0.9 = 3.15 → 4 в секунду
        // При ур.8+8: 1.5 + 2.0 + 2.4 = 5.9 → 6 в секунду (максимум)
        let cooling_f = 1.5
            + (self.turbine_upgrade_level as f64 * 0.25)
            + (self.upgrades.cooling_level as f64 * 0.30);
        let cooling = (cooling_f.ceil() as u32).max(1);
        if self.turbine_heat > 0 {
            self.turbine_heat = self.turbine_heat.saturating_sub(cooling);
            if self.turbine_heat == 0 && self.turbine_cooling {
                self.turbine_cooling = false;
                events.push(GameEvent::LogMessage("🌡️ Турбина остыла".to_string()));
            }
        }

        let was_day = self.is_day;
        self.time_changed = false;
        self.game_time -= delta;

        // Transparent low-rate recovery: energy returns only while the outpost is powered.
        // It is intentionally slower than automation drain, so recovery enables relaunches
        // but never makes continuous automation free.
        if self.is_ai_active()
            && self.computational_power < self.max_computational_power
            && self.tick_count % 10 == 0
        {
            self.computational_power =
                (self.computational_power + 1).min(self.max_computational_power);
        }

        if self.mining_debuff_remaining > 0 {
            self.mining_debuff_remaining -= 1;
            if self.mining_debuff_remaining == 0 {
                self.mining_debuff_percent = 0.0;
                events.push(GameEvent::LogMessage("🔧 Саботаж устранён".to_string()));
            }
        }

        if self.autoclick_debuff_remaining > 0 {
            self.autoclick_debuff_remaining -= 1;
            if self.autoclick_debuff_remaining == 0 {
                self.autoclick_debuff_percent = 0.0;
                events.push(GameEvent::LogMessage("🧠 Воздействие ослабло".to_string()));
            }
        }

        if self.background_sabotage_cooldown_remaining > 0 {
            self.background_sabotage_cooldown_remaining -= 1;
        }

        if self.tec_sabotage_remaining > 0 {
            self.tec_sabotage_remaining -= 1;
            if self.tec_sabotage_remaining == 0 {
                self.tec_sabotaged = false;
                events.push(GameEvent::LogMessage(
                    "🔧 Саботаж ТЭЦ устранён — можно снова включить".to_string(),
                ));
            }
        }

        if self.blueprint_locked_until > 0 && (self.tick_count) > self.blueprint_locked_until {
            self.locked_blueprint_id = String::new();
            self.blueprint_locked_until = 0;
            events.push(GameEvent::LogMessage(
                "📐 Чертеж восстановлен — можно снова крафтить".to_string(),
            ));
        }

        if self.fleet_shield_active && self.tick_count >= self.fleet_shield_expires_at {
            self.fleet_shield_active = false;
            events.push(GameEvent::LogMessage("🛡️ Защита флота истекла".to_string()));
        }

        if self.blueprints_encrypted && self.tick_count >= self.blueprint_encryption_expires_at {
            self.blueprints_encrypted = false;
            events.push(GameEvent::LogMessage(
                "🔐 Шифрование чертежей истекло".to_string(),
            ));
        }

        if self.planets_fortified && self.tick_count >= self.planet_fortification_expires_at {
            self.planets_fortified = false;
            events.push(GameEvent::LogMessage(
                "🏰 Укрепление планет истекло".to_string(),
            ));
        }

        if self.game_time <= 0 {
            self.is_day = !self.is_day;
            self.game_time = if self.is_day {
                config.time_config.day_duration
            } else {
                config.time_config.night_duration
            };
            self.time_changed = true;

            if self.defense_debuff_remaining > 0 && !self.is_day && was_day {
                self.defense_debuff_remaining -= 1;
                if self.defense_debuff_remaining == 0 {
                    events.push(GameEvent::LogMessage("🛡️ Защита восстановлена".to_string()));
                }
            }

            if self.coal_enabled && self.inventory.coal > 0 {
                let mut rng = rand::thread_rng();
                let cost = if self.is_day {
                    rng.gen_range(
                        config.coal_consumption_config.day_coal_min
                            ..=config.coal_consumption_config.day_coal_max,
                    )
                } else {
                    rng.gen_range(
                        config.coal_consumption_config.night_coal_min
                            ..=config.coal_consumption_config.night_coal_max,
                    )
                };
                let actual = cost.min(self.inventory.coal);
                if actual > 0 {
                    self.inventory.coal -= actual;
                    self.total_coal_burned = self.total_coal_burned.saturating_add(actual as u64);
                    let plasma_gen = self.total_coal_burned
                        / config.coal_consumption_config.plasma_conversion_rate as u64;
                    if plasma_gen > self.plasma_from_coal {
                        let new = (plasma_gen - self.plasma_from_coal) as u32;
                        self.inventory.plasma =
                            (self.inventory.plasma + new).min(self.max_inventory_stack);
                        self.plasma_from_coal = plasma_gen;
                        self.total_plasma_mined += new;
                        events.push(GameEvent::ResourceMined {
                            resource: "plasma".to_string(),
                            amount: new,
                            critical: false,
                        });
                    }
                    if self.inventory.coal == 0 {
                        self.coal_enabled = false;
                        events.push(GameEvent::CoalDepleted);
                    }
                } else {
                    self.coal_enabled = false;
                    events.push(GameEvent::CoalDepleted);
                }
            }

            if !self.is_day && was_day {
                events.push(GameEvent::NightStarted);

                if self.rebel_protection_active && self.rebel_protection_nights > 0 {
                    self.rebel_protection_nights -= 1;
                    if self.rebel_protection_nights == 0 {
                        self.rebel_protection_active = false;
                        events.push(GameEvent::LogMessage("🛡️ Защита истекла".to_string()));
                    }
                }

                self.protection_breached_this_night = false;
            } else if self.is_day && !was_day {
                self.nights_survived += 1;
                events.push(GameEvent::DayStarted);
                self.trade_blocked = false;
            }
        }
        events
    }

    pub fn is_ai_active(&self) -> bool {
        self.is_day || (self.coal_enabled && self.inventory.coal > 0)
    }

    pub fn is_passive_mining_active(&self) -> bool {
        (self.coal_enabled && self.inventory.coal > 0) || self.is_day
    }

    pub fn can_auto_click(&self) -> bool {
        self.computational_power > 0 && self.is_ai_active()
    }

    pub fn get_power_percentage(&self) -> f32 {
        (self.computational_power as f32 / self.max_computational_power as f32) * 100.0
    }

    pub fn restore_power(&mut self, saved_power: u32, saved_max_power: u32) {
        self.computational_power = saved_power;
        if saved_max_power > self.max_computational_power {
            self.max_computational_power = saved_max_power;
        }
    }

    pub fn buy_rebel_protection(&mut self) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
        if self.inventory.trash >= 100 {
            self.inventory.trash -= 100;
            self.rebel_protection_nights += 1;
            if !self.rebel_protection_active {
                self.rebel_protection_active = true;
                return vec![GameEvent::LogMessage(format!(
                    "🛡️ Защита куплена и АКТИВИРОВАНА на 1 ночь! Осталось: {}",
                    self.rebel_protection_nights
                ))];
            }
            vec![GameEvent::LogMessage(format!(
                "🛡️ Куплена защита на 1 ночь! Осталось: {}",
                self.rebel_protection_nights
            ))]
        } else {
            vec![GameEvent::LogMessage(
                "❌ Недостаточно мусора (нужно 100)".to_string(),
            )]
        }
    }

    pub fn toggle_rebel_protection(&mut self) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
        if self.rebel_protection_active {
            self.rebel_protection_active = false;
            vec![GameEvent::LogMessage(
                "🛡️ Защита деактивирована".to_string(),
            )]
        } else if self.rebel_protection_nights > 0 {
            self.rebel_protection_active = true;
            vec![GameEvent::LogMessage(format!(
                "🛡️ Защита активирована! Осталось ночей: {}",
                self.rebel_protection_nights
            ))]
        } else {
            vec![GameEvent::LogMessage(
                "❌ Нет доступных ночей защиты".to_string(),
            )]
        }
    }

    pub fn toggle_coal(&mut self) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;

        if self.tec_sabotaged {
            return vec![GameEvent::LogMessage(format!(
                "🔥 ТЭЦ САБОТИРОВАНА! Повторное включение невозможно. Подождите {} тиков.",
                self.tec_sabotage_remaining
            ))];
        }

        if self.coal_enabled {
            self.coal_enabled = false;
            vec![GameEvent::LogMessage("ТЭЦ отключена".to_string())]
        } else if self.inventory.coal >= 1 {
            self.coal_enabled = true;
            vec![GameEvent::LogMessage("ТЭЦ активирована".to_string())]
        } else {
            vec![GameEvent::LogMessage("Нет угля для активации".to_string())]
        }
    }

    pub fn record_defense_result(&mut self, was_successful: bool) {
        self.total_defense_activations += 1;
        if was_successful {
            self.consecutive_successful_defenses += 1;
            self.consecutive_failed_defenses = 0;
            self.attacks_defended += 1;
            if self.consecutive_successful_defenses > self.longest_defense_streak {
                self.longest_defense_streak = self.consecutive_successful_defenses;
            }
        } else {
            self.consecutive_successful_defenses = 0;
            self.consecutive_failed_defenses += 1;
        }
    }

    pub fn add_planet(&mut self, planet: Planet) {
        self.planets.push(planet);
    }

    pub fn remove_planet(&mut self, planet_id: &str) -> Option<Planet> {
        let index = self.planets.iter().position(|p| p.id == planet_id);
        if let Some(idx) = index {
            Some(self.planets.remove(idx))
        } else {
            None
        }
    }

    pub fn get_planet(&self, planet_id: &str) -> Option<&Planet> {
        self.planets.iter().find(|p| p.id == planet_id)
    }

    pub fn get_planet_mut(&mut self, planet_id: &str) -> Option<&mut Planet> {
        self.planets.iter_mut().find(|p| p.id == planet_id)
    }

    pub fn add_fleet_ship(&mut self, ship_type: &str) -> &FleetShip {
        self.total_ships_built += 1;
        let timestamp = js_sys::Date::now() as u64;
        let ship_id = format!("ship_{}_{}", self.total_ships_built, timestamp);
        let new_ship = FleetShip::new_with_id(ship_type, ship_id);
        self.fleet_ships.push(new_ship);
        self.fleet_ships.last().unwrap()
    }

    pub fn get_fleet_ship(&self, ship_id: &str) -> Option<&FleetShip> {
        self.fleet_ships.iter().find(|s| s.id == ship_id)
    }

    pub fn get_fleet_ship_mut(&mut self, ship_id: &str) -> Option<&mut FleetShip> {
        self.fleet_ships.iter_mut().find(|s| s.id == ship_id)
    }

    pub fn remove_fleet_ship(&mut self, ship_id: &str) -> Option<FleetShip> {
        let index = self.fleet_ships.iter().position(|s| s.id == ship_id);
        if let Some(idx) = index {
            Some(self.fleet_ships.remove(idx))
        } else {
            None
        }
    }

    pub fn get_available_ship(&self, ship_type: &str) -> Option<&FleetShip> {
        self.fleet_ships
            .iter()
            .find(|s| s.ship_type == ship_type && !s.on_mission && !s.on_defense && s.health > 20)
    }

    pub fn add_planet_mission(&mut self, mission: PlanetMission) {
        self.active_planet_missions
            .retain(|m| m.ship_id != mission.ship_id);
        self.active_planet_missions.push(mission);
    }

    pub fn remove_planet_mission(&mut self, mission_id: &str) -> Option<PlanetMission> {
        let index = self
            .active_planet_missions
            .iter()
            .position(|m| m.id == mission_id);
        if let Some(idx) = index {
            Some(self.active_planet_missions.remove(idx))
        } else {
            None
        }
    }

    pub fn get_active_planet_missions(&self) -> Vec<&PlanetMission> {
        self.active_planet_missions
            .iter()
            .filter(|m| m.status == "flying" || m.status == "returning" || m.status == "arrived")
            .collect()
    }
}

impl Quest {
    pub fn check_completion(&self, state: &GameState) -> bool {
        match &self.quest_type {
            QuestType::MineAny => state.total_mined >= self.target,
            QuestType::SurviveNight => state.nights_survived >= self.target,
            QuestType::MineResource(r) => match r.as_str() {
                "coal" => state.total_coal_mined >= self.target,
                "chips" => state.inventory.chips >= self.target,
                "plasma" => state.total_plasma_mined >= self.target,
                "ore" => state.total_ore_mined >= self.target,
                _ => false,
            },
            QuestType::ActivateDefense => state.upgrades.defense,
            QuestType::SurviveAttack => state.rebel_attacks_count >= self.target,
            QuestType::ReachEvolutionLevel => state.neuro_evolution >= self.target,
            QuestType::BlueprintUnlocked => {
                state.blueprint_cargo_unlocked
                    || state.blueprint_scout_unlocked
                    || state.blueprint_combat_unlocked
            }
            QuestType::CollectResource(r) => match r.as_str() {
                "coal" => state.inventory.coal >= self.target,
                "ore" => state.inventory.ore >= self.target,
                "plasma" => state.inventory.plasma >= self.target,
                "chips" => state.inventory.chips >= self.target,
                _ => false,
            },
        }
    }
}

impl Default for GameState {
    fn default() -> Self {
        Self {
            game_time: 0,
            is_day: true,
            time_changed: false,
            coal_enabled: false,
            coal_unlocked: true,
            trash_unlocked: true,
            chips_unlocked: false,
            plasma_unlocked: false,
            ore_unlocked: false,
            total_mined: 0,
            nights_survived: 0,
            rebel_activity: 0,
            turbine_heat: 0,
            turbine_heat_fraction: 0.0,
            turbine_upgrade_level: 0,
            turbine_cooling: false,
            last_click_time: 0,
            current_quest: 0,
            inventory: Inventory::default(),
            upgrades: Upgrades::default(),
            quests: Vec::new(),
            total_coal_burned: 0,
            plasma_from_coal: 0,
            auto_clicking: false,
            auto_click_stop_reason: String::new(),
            computational_power: 0,
            max_computational_power: 1000,
            last_auto_click_time: 0,
            manual_clicks: 0,
            total_manual_clicks: 0,
            rebel_protection_nights: 0,
            rebel_protection_active: false,
            total_coal_mined: 0,
            total_trash_mined: 0,
            total_plasma_mined: 0,
            total_ore_mined: 0,
            total_coal_stolen: 0,
            total_ore_stolen: 0,
            attacks_defended: 0,
            rebel_attacks_count: 0,
            neuro_evolution: 0,
            neuro_consciousness: 0.0,
            neuro_score: 0,
            neuro_defense_bonus: 0.0,
            neuro_prediction_bonus: 0.0,
            last_rebel_attack_time: 0,
            last_rebel_attack_type: String::new(),
            last_attack_was_defended: false,
            consecutive_successful_defenses: 0,
            consecutive_failed_defenses: 0,
            total_defense_activations: 0,
            temporary_mining_bonus: 0,
            temporary_defense_bonus: 0,
            fleet_power_bonus: 0,
            temporary_bonus_remaining: 0,
            highest_rebel_activity: 0,
            longest_defense_streak: 0,
            total_evolution_points_earned: 0,
            neuro_passive_timer: 0,
            neuro_evolution_timer: 0,
            defense_debuff_remaining: 0,
            mining_debuff_remaining: 0,
            mining_debuff_percent: 0.0,
            autoclick_debuff_remaining: 0,
            autoclick_debuff_percent: 0.0,
            attack_history: VecDeque::new(),
            last_attacking_faction: String::new(),
            current_ai_mode: String::new(),
            attack_warning: String::new(),
            attack_warning_faction: String::new(),
            blueprint_cargo_unlocked: false,
            blueprint_scout_unlocked: false,
            blueprint_combat_unlocked: false,
            blueprint_research_progress: 0,
            current_night_type: String::new(),
            trade_blocked: false,
            power_tier: 0,
            last_ai_coal_threshold: 0,

            fleet_ships: Vec::new(),
            total_ships_built: 0,
            planets: Vec::new(),
            active_planet_missions: Vec::new(),
            quests_progress: Vec::new(),
            last_intercept_text: String::new(),
            last_warning_issued_at: 0,
            arms_race_level: 0,
            fake_depot_active: false,
            propaganda_active: false,
            current_vulnerability: String::new(),
            faction_personality_hints: Vec::new(),
            counter_op_cooldown_remaining: 0,
            multiphase_warning: false,
            had_attack_last_night: false,
            max_inventory_stack: 9999,
            map_x: None,
            map_y: None,

            background_sabotage_cooldown_remaining: 0,
            last_fleet_attack_time: -999,
            last_blueprint_steal_time: -999,
            last_planet_harass_time: -999,
            last_tec_sabotage_time: -999,

            blueprint_locked_until: 0,
            locked_blueprint_id: String::new(),

            fleet_under_attack: false,
            fleet_attack_target_id: String::new(),
            fleet_attack_damage: 0,

            planet_under_harass: false,
            harassed_planet_id: String::new(),

            tec_sabotaged: false,
            tec_sabotage_remaining: 0,

            protection_breached_this_night: false,
            total_breaches: 0,

            fear_level: 0,
            last_fear_event_time: 0,

            fleet_shield_active: false,
            fleet_shield_expires_at: 0,

            blueprints_encrypted: false,
            blueprint_encryption_expires_at: 0,

            planets_fortified: false,
            planet_fortification_expires_at: 0,

            craft_blocked_until: 0,

            tick_count: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FleetShip, GameState, Quest, QuestType};

    #[test]
    fn blueprint_quest_requires_an_unlocked_blueprint() {
        let mut state = GameState::default();
        state.inventory.ore = 1000;
        let quest = Quest {
            id: "quest_fleet_blueprint".to_string(),
            title: "Первый чертёж".to_string(),
            description: String::new(),
            quest_type: QuestType::BlueprintUnlocked,
            target: 1,
            reward: 0,
            enabled: true,
            order: 7,
            completed: false,
            unlocks: Vec::new(),
        };

        assert!(!quest.check_completion(&state));
        state.blueprint_cargo_unlocked = true;
        assert!(quest.check_completion(&state));
    }

    #[test]
    fn fleet_ship_accepts_js_camel_case_dto() {
        let raw = r#"{
            "id":"ship-1","type":"cargo","name":"Cargo","level":2,
            "health":90,"maxHealth":100,"experience":4,"missions":3,
            "onMission":true,"onDefense":false,"currentMissionId":"m-1",
            "targetPlanetId":"p-1","targetUserId":"u-1",
            "missionReturnsAt":123,"createdAt":456,"speed":1
        }"#;
        let ship: FleetShip = serde_json::from_str(raw).expect("JS fleet DTO must deserialize");
        assert_eq!(ship.ship_type, "cargo");
        assert_eq!(ship.max_health, 100);
        assert_eq!(ship.missions_completed, 3);
        assert!(ship.on_mission);
        assert_eq!(ship.current_mission_id.as_deref(), Some("m-1"));
    }
}
