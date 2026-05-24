// ========== src/game/state.rs (ИСПРАВЛЕННАЯ ВЕРСИЯ) ==========
// БАГ #4: load_quests теперь обрабатывает CollectResource тип
// БАГ #11: defense_debuff_remaining уменьшается при начале ночи (а не рассвете)
// БАГ #24: add_fleet_ship использует глобальный счётчик
// БАГ #39: get_active_planet_missions возвращает и "returning"
// БАГ #44: add_planet_mission проверяет активные миссии
// БАГ #45: record_defense_result обновляет total_defense_activations

use serde::{Serialize, Deserialize};
use super::config::GameConfig;
use rand::Rng;
use std::collections::VecDeque;

// ========== СТРУКТУРА ДЛЯ ЗАПИСЕЙ АТАК ==========
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AttackRecord {
    pub faction: String,
    pub attack_type: String,
    pub was_defended: bool,
    pub result: String,
    pub game_time: i32,
}

// ========== СТРУКТУРА ДЛЯ КОРАБЛЕЙ ФЛОТА ==========
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FleetShip {
    pub id: String,
    pub ship_type: String,
    pub name: String,
    pub level: u32,
    pub health: u32,
    pub max_health: u32,
    pub experience: u32,
    pub missions_completed: u32,
    pub on_mission: bool,
    pub on_defense: bool,
    pub current_mission_id: Option<String>,
    pub target_planet_id: Option<String>,
    pub target_user_id: Option<String>,
    pub mission_returns_at: Option<i64>,
    pub created_at: i64,
    pub speed: u32,  // БАГ #47: добавлено поле speed
}

impl FleetShip {
    // БАГ #24: ship_index больше не используется, используем глобальный счётчик
    // Но для совместимости оставляем параметр, но игнорируем его
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
            speed,  // БАГ #47: инициализация speed
        }
    }
}

// ========== СТРУКТУРА ДЛЯ ПЛАНЕТ ==========
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

// ========== СТРУКТУРА ДЛЯ ПЛАНЕТАРНЫХ МИССИЙ ==========
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
    CollectResource(String),  // тип для квестов на накопление ресурсов
}

// ========== ОСНОВНОЙ GAME STATE ==========
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct GameState {
    // Время и циклы
    pub game_time: i32,
    pub is_day: bool,
    pub time_changed: bool,
    pub coal_enabled: bool,
    
    // Разблокировки
    pub coal_unlocked: bool,
    pub trash_unlocked: bool,
    pub chips_unlocked: bool,
    pub plasma_unlocked: bool,
    pub ore_unlocked: bool,
    
    // Статистика
    pub total_mined: u32,
    pub nights_survived: u32,
    pub rebel_activity: u32,
    
    // Турбина
    pub turbine_heat: u32,
    pub turbine_upgrade_level: u32,
    pub turbine_cooling: bool,
    
    // Клики и мощность
    pub last_click_time: u64,
    pub current_quest: usize,
    pub inventory: Inventory,
    pub upgrades: Upgrades,
    pub quests: Vec<Quest>,
    
    // Уголь и плазма
    pub total_coal_burned: u32,
    pub plasma_from_coal: u32,
    
    // Автокликер
    pub auto_clicking: bool,
    pub computational_power: u32,
    pub max_computational_power: u32,
    pub last_auto_click_time: i32,
    pub manual_clicks: u32,
    
    // Защита от повстанцев
    pub rebel_protection_nights: u32,
    pub rebel_protection_active: bool,
    
    // Добытые ресурсы
    pub total_coal_mined: u32,
    pub total_trash_mined: u32,
    pub total_plasma_mined: u32,
    pub total_ore_mined: u32,
    pub total_coal_stolen: u32,
    pub total_ore_stolen: u32,
    
    // Атаки и защита
    pub attacks_defended: u32,
    pub rebel_attacks_count: u32,
    
    // Нейро-система
    pub neuro_evolution: u32,
    pub neuro_consciousness: f64,
    pub neuro_score: u32,
    pub neuro_defense_bonus: f64,
    pub neuro_prediction_bonus: f64,
    
    // История атак
    pub last_rebel_attack_time: i32,
    pub last_rebel_attack_type: String,
    pub last_attack_was_defended: bool,
    pub consecutive_successful_defenses: u32,
    pub consecutive_failed_defenses: u32,
    pub total_defense_activations: u32,  // БАГ #45: добавлено поле
    
    // Временные бонусы
    pub temporary_mining_bonus: u32,
    pub temporary_defense_bonus: u32,
    pub temporary_bonus_remaining: i32,
    
    // Рекорды
    pub highest_rebel_activity: u32,
    pub longest_defense_streak: u32,
    pub total_evolution_points_earned: u32,
    
    // Таймеры эволюции
    pub neuro_passive_timer: i32,
    pub neuro_evolution_timer: i32,
    
    // Дебаффы
    pub defense_debuff_remaining: i32,
    pub mining_debuff_remaining: i32,
    pub mining_debuff_percent: f32,
    pub autoclick_debuff_remaining: i32,
    pub autoclick_debuff_percent: f32,
    
    // История и предупреждения
    pub attack_history: VecDeque<AttackRecord>,
    pub last_attacking_faction: String,
    pub current_ai_mode: String,
    pub attack_warning: String,
    pub attack_warning_faction: String,
    
    // Чертежи
    pub blueprint_cargo_unlocked: bool,
    pub blueprint_scout_unlocked: bool,
    pub blueprint_combat_unlocked: bool,
    pub blueprint_research_progress: u32,
    
    // Состояние игры
    pub current_night_type: String,
    pub trade_blocked: bool,
    pub power_tier: u32,
    pub last_ai_coal_threshold: u32,
    pub prestige_level: u32,
    
    // ФЛОТ
    pub fleet_ships: Vec<FleetShip>,
    pub total_ships_built: u32,  // БАГ #24: глобальный счётчик кораблей
    
    // ПЛАНЕТЫ И МИССИИ
    pub planets: Vec<Planet>,
    pub active_planet_missions: Vec<PlanetMission>,
    
    // Прогресс квестов
    pub quests_progress: Vec<QuestProgress>,
}

impl GameState {
    pub fn new(config: &GameConfig) -> Self {
        let mut state = Self::default();
        state.game_time = config.time_config.initial_time;
        state.is_day = config.time_config.start_at_day;
        state.max_computational_power = config.auto_click_config.max_computational_power;
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
        state
    }

    // БАГ #4: исправленный load_quests с поддержкой CollectResource
    pub fn load_quests(&mut self, config: &GameConfig) {
        self.quests.clear();
        for q in &config.quests {
            if !q.enabled { continue; }
            let qtype = match q.quest_type.as_str() {
                "MineAny" => QuestType::MineAny,
                "SurviveNight" => QuestType::SurviveNight,
                "ActivateDefense" => QuestType::ActivateDefense,
                "SurviveAttack" => QuestType::SurviveAttack,
                "ReachEvolutionLevel" => QuestType::ReachEvolutionLevel,
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

    // БАГ #11: исправленный update_time (defense_debuff уменьшается при начале ночи)
    pub fn update_time(&mut self, delta: i32, config: &GameConfig) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
        let mut events = Vec::new();
        
        let cooling = 2 + self.turbine_upgrade_level;
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

        if self.game_time <= 0 {
            self.is_day = !self.is_day;
            self.game_time = if self.is_day {
                config.time_config.day_duration
            } else {
                config.time_config.night_duration
            };
            self.time_changed = true;
            
            // БАГ #11: defense_debuff уменьшается при начале ночи (ДЕНЬ → НОЧЬ)
            if self.defense_debuff_remaining > 0 && !self.is_day && was_day {
                self.defense_debuff_remaining -= 1;
                if self.defense_debuff_remaining == 0 {
                    events.push(GameEvent::LogMessage("🛡️ Защита восстановлена".to_string()));
                }
            }

            if self.coal_enabled && self.inventory.coal > 0 {
                let mut rng = rand::thread_rng();
                let cost = if self.is_day {
                    rng.gen_range(config.coal_consumption_config.day_coal_min..=config.coal_consumption_config.day_coal_max)
                } else {
                    rng.gen_range(config.coal_consumption_config.night_coal_min..=config.coal_consumption_config.night_coal_max)
                };
                let actual = cost.min(self.inventory.coal);
                if actual > 0 {
                    self.inventory.coal -= actual;
                    // БАГ #38: saturating_add
                    self.total_coal_burned = self.total_coal_burned.saturating_add(actual);
                    let plasma_gen = self.total_coal_burned / config.coal_consumption_config.plasma_conversion_rate;
                    if plasma_gen > self.plasma_from_coal {
                        let new = plasma_gen - self.plasma_from_coal;
                        self.inventory.plasma += new;
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
                self.nights_survived += 1;
                events.push(GameEvent::NightStarted);
                if self.rebel_protection_active && self.rebel_protection_nights > 0 {
                    self.rebel_protection_nights -= 1;
                    if self.rebel_protection_nights == 0 {
                        self.rebel_protection_active = false;
                    }
                }
            } else if self.is_day && !was_day {
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
            vec![GameEvent::LogMessage("❌ Недостаточно мусора (нужно 100)".to_string())]
        }
    }

    pub fn toggle_rebel_protection(&mut self) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
        if self.rebel_protection_active {
            self.rebel_protection_active = false;
            vec![GameEvent::LogMessage("🛡️ Защита деактивирована".to_string())]
        } else if self.rebel_protection_nights > 0 {
            self.rebel_protection_active = true;
            vec![GameEvent::LogMessage(format!(
                "🛡️ Защита активирована! Осталось ночей: {}",
                self.rebel_protection_nights
            ))]
        } else {
            vec![GameEvent::LogMessage("❌ Нет доступных ночей защиты".to_string())]
        }
    }

    pub fn toggle_coal(&mut self) -> Vec<super::events::GameEvent> {
        use super::events::GameEvent;
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

    // БАГ #45: record_defense_result обновляет total_defense_activations
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
    
    // ========== МЕТОДЫ ДЛЯ ПЛАНЕТ ==========
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
    
    // ========== МЕТОДЫ ДЛЯ ФЛОТА ==========
    // БАГ #24: add_fleet_ship использует глобальный счётчик
    pub fn add_fleet_ship(&mut self, ship_type: &str) -> &FleetShip {
        self.total_ships_built += 1;
        let new_ship = FleetShip::new(ship_type, self.total_ships_built as usize);
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
        self.fleet_ships.iter()
            .find(|s| s.ship_type == ship_type && !s.on_mission && !s.on_defense && s.health > 20)
    }
    
    // ========== МЕТОДЫ ДЛЯ ПЛАНЕТАРНЫХ МИССИЙ ==========
    // БАГ #44: add_planet_mission с проверкой активных миссий
    pub fn add_planet_mission(&mut self, mission: PlanetMission) {
        // Удалять только завершённые/отменённые миссии этого корабля
        self.active_planet_missions.retain(|m| {
            m.ship_id != mission.ship_id || m.status == "flying" || m.status == "returning"
        });
        // Если активная миссия уже есть — не добавлять
        if self.active_planet_missions.iter().any(|m| m.ship_id == mission.ship_id) {
            return;
        }
        self.active_planet_missions.push(mission);
    }
    
    pub fn remove_planet_mission(&mut self, mission_id: &str) -> Option<PlanetMission> {
        let index = self.active_planet_missions.iter().position(|m| m.id == mission_id);
        if let Some(idx) = index {
            Some(self.active_planet_missions.remove(idx))
        } else {
            None
        }
    }
    
    // БАГ #39: get_active_planet_missions возвращает и "flying", и "returning"
    pub fn get_active_planet_missions(&self) -> Vec<&PlanetMission> {
        self.active_planet_missions.iter()
            .filter(|m| m.status == "flying" || m.status == "returning")
            .collect()
    }
}

// ========== IMPL QUEST С ИСПРАВЛЕННЫМ CollectResource ==========
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
            // ===== ИСПРАВЛЕНИЕ: CollectResource = сколько СЕЙЧАС в инвентаре =====
            QuestType::CollectResource(r) => match r.as_str() {
                "coal"   => state.inventory.coal   >= self.target,
                "ore"    => state.inventory.ore    >= self.target,
                "plasma" => state.inventory.plasma >= self.target,
                "chips"  => state.inventory.chips  >= self.target,
                _ => false,
            },
        }
    }
}