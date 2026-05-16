// ======== src/systems/rebel.rs (ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ - С ТИПАМИ НОЧЕЙ) ========

use crate::game::{GameState, GameEvent};
use crate::game::config::GameConfig;
use crate::game::state::AttackRecord;
use rand::Rng;
use rand::seq::SliceRandom;
use std::collections::{HashMap, VecDeque};
use serde::{Serialize, Deserialize};

// ========== ОСНОВНЫЕ СТРУКТУРЫ ==========

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RebelSystem {
    // Фракционная система
    pub factions: HashMap<String, RebelFaction>,
    pub active_faction: Option<String>,
    
    // Эволюция и адаптация
    pub evolution_level: u32,
    pub evolution_score: u32,
    pub adaptation_level: u32,
    
    // Психология и мотивация
    pub morale: f64,
    pub aggression: f64,
    pub strategic_intelligence: f64,
    
    // Адаптация к ИИ
    pub ai_adaptation: AIAdaptation,
    pub last_ai_level: u32,
    pub ai_threat_perception: f64,
    
    // Стратегическое планирование
    pub operation_queue: VecDeque<Operation>,
    pub active_operations: HashMap<String, ActiveOperation>,
    pub tactic_preferences: TacticPreferences,
    
    // Состояние
    pub last_major_operation: i32,
    pub last_attack_time: i32,
    pub last_strategy_switch: i32,
    
    // Статистика
    pub stats: RebelStats,
    
    #[serde(skip)]
    pub available_forces_cache: usize,
    
    // Текущий тип ночи
    pub current_night_type: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RebelFaction {
    pub id: String,
    pub name: String,
    pub evolution_stage: u32,
    pub primary_motivation: String,
    pub resources: FactionResources,
    pub personnel: Personnel,
    pub last_activity: i32,
    pub specializations: Vec<String>,
    pub ideology: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FactionResources {
    pub experience: u32,
    pub manpower: u32,
    pub technology: u32,
    pub morale: f64,
    pub weapons: u32,
    pub intelligence: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Personnel {
    pub total: u32,
    pub operatives: u32,
    pub commanders: u32,
    pub specialists: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AIAdaptation {
    pub recognized_patterns: Vec<String>,
    pub counter_tactics: HashMap<String, CounterTactic>,
    pub last_ai_decision: Option<String>,
    pub adaptation_speed: f64,
    pub prediction_evasion: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CounterTactic {
    pub name: String,
    pub effectiveness: f64,
    pub usage_count: u32,
    pub last_used: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TacticPreferences {
    pub resource_raid: f64,
    pub power_sabotage: f64,
    pub direct_assault: f64,
    pub psychological: f64,
    pub stealth: f64,
    pub sabotage: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct RebelStats {
    pub total_attacks: u32,
    pub successful_attacks: u32,
    pub failed_attacks: u32,
    pub resources_stolen: HashMap<String, u32>,
    pub defenses_bypassed: u32,
    pub evolutions: u32,
    pub strategy_switches: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Operation {
    pub id: String,
    pub name: String,
    pub op_type: OperationType,
    pub risk_level: f64,
    pub success_probability: f64,
    pub resources_committed: HashMap<String, u32>,
    pub complexity: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ActiveOperation {
    pub operation: Operation,
    pub progress: f64,
    pub start_time: i32,
    pub status: OperationStatus,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum OperationType {
    ResourceRaid,
    PowerSabotage,
    DirectAssault,
    Psychological,
    StealthInfiltration,
    TechnologicalSabotage,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum OperationStatus {
    Planning,
    Executing,
    Completed,
    Failed,
    Countered,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AttackType {
    ResourceRaid,
    PowerSabotage,
    DirectAssault,
    Psychological,
    Stealth,
    Technological,
}

impl std::fmt::Display for AttackType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AttackType::ResourceRaid => write!(f, "Налёт на ресурсы"),
            AttackType::PowerSabotage => write!(f, "Саботаж мощности"),
            AttackType::DirectAssault => write!(f, "Прямая атака"),
            AttackType::Psychological => write!(f, "Психологическая операция"),
            AttackType::Stealth => write!(f, "Скрытая операция"),
            AttackType::Technological => write!(f, "Технологический саботаж"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AttackPlan {
    pub id: String,
    pub attack_type: AttackType,
    pub faction: String,
    pub targets: Vec<AttackTarget>,
    pub success_probability: f64,
    pub stealth_level: f64,
    pub expected_gain: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub enum AttackTarget {
    Resource { resource: String, amount: u32 },
    System { system: String, damage: u32 },
    Moral { demoralization: f64 },
    Intelligence { data_loss: u32 },
}

// ========== РЕАЛИЗАЦИЯ ==========

impl RebelSystem {
    pub fn new() -> Self {
        let mut factions = HashMap::new();
        
        factions.insert("scavengers".to_string(), RebelFaction::new_scavengers());
        factions.insert("technomads".to_string(), RebelFaction::new_technomads());
        factions.insert("cyber_rebels".to_string(), RebelFaction::new_cyber_rebels());
        
        Self {
            factions,
            active_faction: Some("scavengers".to_string()),
            evolution_level: 0,
            evolution_score: 0,
            adaptation_level: 0,
            morale: 0.6,
            aggression: 0.5,
            strategic_intelligence: 0.3,
            ai_adaptation: AIAdaptation {
                recognized_patterns: Vec::new(),
                counter_tactics: HashMap::new(),
                last_ai_decision: None,
                adaptation_speed: 0.3,
                prediction_evasion: 0.1,
            },
            last_ai_level: 0,
            ai_threat_perception: 0.0,
            operation_queue: VecDeque::new(),
            active_operations: HashMap::new(),
            tactic_preferences: TacticPreferences::default(),
            last_major_operation: 0,
            last_attack_time: -100,
            last_strategy_switch: 0,
            stats: RebelStats::default(),
            available_forces_cache: 0,
            current_night_type: String::new(),
        }
    }
    
    // ========== СИСТЕМА ТИПОВ НОЧЕЙ ==========
    
    pub fn on_night_start(&mut self, state: &mut GameState, rng: &mut impl Rng) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        let night_type = match state.rebel_activity {
            0..=2 => "quiet",
            3..=5 => if rng.gen_bool(0.4) { "scout" } else { "quiet" },
            6..=9 => {
                let types = ["raid", "scout", "propaganda"];
                *types.choose(rng).unwrap_or(&"raid")
            }
            10..=12 => {
                let types = ["siege", "raid", "elite"];
                *types.choose(rng).unwrap_or(&"siege")
            }
            _ => "elite",
        };
        
        state.current_night_type = night_type.to_string();
        self.current_night_type = night_type.to_string();
        
        match night_type {
            "quiet" => {
                state.rebel_activity = state.rebel_activity.saturating_sub(2);
                events.push(GameEvent::LogMessage("🌙 Тихая ночь — повстанцы отступили".to_string()));
            }
            "scout" => {
                events.push(GameEvent::LogMessage("🔍 РАЗВЕДЫВАТЕЛЬНАЯ НОЧЬ — следующая атака будет сильнее".to_string()));
                state.rebel_activity = (state.rebel_activity + 1).min(15);
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.1).min(0.5);
            }
            "raid" => {
                events.push(GameEvent::LogMessage("⚠️ НОЧЬ НАЛЁТА — повстанцы нацелились на ресурсы!".to_string()));
                self.tactic_preferences.resource_raid = (self.tactic_preferences.resource_raid + 0.2).min(0.6);
            }
            "siege" => {
                state.trade_blocked = true;
                events.push(GameEvent::LogMessage("🔴 НОЧЬ ОСАДЫ — торговля заблокирована до рассвета!".to_string()));
            }
            "propaganda" => {
                state.autoclick_debuff_remaining = 8;
                state.autoclick_debuff_percent = 0.3;
                events.push(GameEvent::LogMessage("📡 ПРОПАГАНДА — автокликер замедлен помехами!".to_string()));
                self.tactic_preferences.psychological = (self.tactic_preferences.psychological + 0.15).min(0.5);
            }
            "elite" => {
                events.push(GameEvent::LogMessage("💀 НОЧЬ ЭЛИТНОГО ШТУРМА — максимальная угроза!".to_string()));
                self.aggression = (self.aggression + 0.15).min(1.0);
                self.strategic_intelligence = (self.strategic_intelligence + 0.1).min(1.0);
            }
            _ => {}
        }
        
        events
    }
    
    // ========== ОБРАТНАЯ СВЯЗЬ ОТ ИИ ==========
    
    pub fn on_ai_evolution(&mut self, ai_level: u32, strategy: &str) {
        if ai_level > self.last_ai_level {
            let diff = ai_level - self.last_ai_level;
            
            self.adaptation_level += diff;
            self.strategic_intelligence = (self.strategic_intelligence + 0.05 * diff as f64).min(1.0);
            self.ai_threat_perception = (self.ai_threat_perception + 0.1).min(1.0);
            
            if !self.ai_adaptation.recognized_patterns.contains(&strategy.to_string()) {
                self.ai_adaptation.recognized_patterns.push(strategy.to_string());
            }
            
            self.develop_counter_tactic(strategy, ai_level);
            
            self.evolution_score += diff * 10;
            if self.evolution_score >= 100 {
                self.evolve();
            }
            
            self.adapt_tactics_to_ai(strategy);
        }
        
        self.last_ai_level = ai_level;
    }
    
    pub fn on_ai_prediction(&mut self, prediction_accuracy: f64) {
        self.ai_adaptation.prediction_evasion = (self.ai_adaptation.prediction_evasion + 0.05).min(0.5);
        self.strategic_intelligence = (self.strategic_intelligence + 0.03).min(1.0);
        
        if prediction_accuracy > 0.7 {
            self.switch_to_evasion_tactics();
        }
    }
    
    fn switch_to_evasion_tactics(&mut self) {
        self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.15).min(0.6);
        self.tactic_preferences.psychological = (self.tactic_preferences.psychological + 0.1).min(0.4);
        self.ai_adaptation.prediction_evasion = (self.ai_adaptation.prediction_evasion + 0.1).min(0.6);
        
        self.stats.strategy_switches += 1;
        self.last_strategy_switch = self.last_attack_time;
    }
    
    fn develop_counter_tactic(&mut self, ai_strategy: &str, ai_level: u32) {
        let tactic_name = match ai_strategy {
            "predictive" => "randomization",
            "defensive" => "attrition",
            "aggressive" => "guerrilla",
            "retreat" => "pursuit",
            "prediction_unlocked" => "deception",
            "adaptive_defense" => "overwhelm",
            "counter_attack" => "feint",
            "psychological_warfare" => "counter_propaganda",
            "full_consciousness" => "asymmetric_warfare",
            _ => "standard",
        };
        
        let effectiveness = 0.3 + (ai_level as f64 * 0.05).min(0.6);
        
        let tactic = CounterTactic {
            name: tactic_name.to_string(),
            effectiveness,
            usage_count: 0,
            last_used: 0,
        };
        
        self.ai_adaptation.counter_tactics.insert(ai_strategy.to_string(), tactic);
    }
    
    fn adapt_tactics_to_ai(&mut self, ai_strategy: &str) {
        match ai_strategy {
            "predictive" => {
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.1).min(0.4);
                self.tactic_preferences.psychological = (self.tactic_preferences.psychological + 0.05).min(0.3);
            }
            "defensive" => {
                self.aggression = (self.aggression + 0.1).min(0.9);
                self.tactic_preferences.direct_assault = (self.tactic_preferences.direct_assault + 0.1).min(0.5);
            }
            "aggressive" => {
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.15).min(0.5);
                self.tactic_preferences.sabotage = (self.tactic_preferences.sabotage + 0.1).min(0.4);
            }
            _ => {}
        }
        
        self.stats.strategy_switches += 1;
        self.last_strategy_switch = self.last_attack_time;
    }
    
    fn evolve(&mut self) {
        self.evolution_level += 1;
        self.evolution_score -= 100;
        self.stats.evolutions += 1;
        
        self.strategic_intelligence = (self.strategic_intelligence + 0.1).min(1.0);
        self.ai_adaptation.adaptation_speed = (self.ai_adaptation.adaptation_speed + 0.05).min(0.8);
        
        match self.evolution_level {
            2 => {
                for faction in self.factions.values_mut() {
                    faction.specializations.push("stealth".to_string());
                }
            }
            4 => {
                for faction in self.factions.values_mut() {
                    faction.specializations.push("technology".to_string());
                }
            }
            6 => {
                for faction in self.factions.values_mut() {
                    faction.specializations.push("psychological".to_string());
                }
            }
            _ => {}
        }
    }
    
    // ========== ОСНОВНЫЕ МЕТОДЫ ==========
    
    pub fn update_rebel_activity(&mut self, state: &mut GameState, config: &GameConfig) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.rebel_protection_active {
            return events;
        }
        
        self.update_internal_state(state);
        
        let was_day = state.is_day;
        
        if !state.is_day {
            if state.rebel_activity < 15 {
                let old_activity = state.rebel_activity;
                
                let base_growth = 1.0 + self.aggression * 1.5;
                let activity_bonus = (state.rebel_activity as f64 / 15.0) * 2.0;
                
                let growth = (base_growth + activity_bonus) as u32;
                let new_activity = (state.rebel_activity + growth).min(15);
                state.rebel_activity = new_activity;
                
                if config.rebels.enable_activity_messages {
                    if state.rebel_activity > old_activity {
                        events.push(GameEvent::LogMessage(
                            format!("🌙 Активность повстанцев растет: {}/15", state.rebel_activity)
                        ));
                    }
                }
                
                if state.rebel_activity == 15 && old_activity < 15 {
                    events.push(GameEvent::LogMessage(
                        "⚠️ КРИТИЧЕСКАЯ АКТИВНОСТЬ! Повстанцы готовят массированную атаку!".to_string()
                    ));
                    self.aggression = (self.aggression + 0.1).min(1.0);
                } else if state.rebel_activity >= 12 && old_activity < 12 {
                    events.push(GameEvent::LogMessage(
                        "⚠️ Активность повстанцев достигла опасного уровня!".to_string()
                    ));
                }
            }
        } else {
            if state.rebel_activity > 0 {
                let old_activity = state.rebel_activity;
                
                let fall = if state.rebel_activity >= 12 {
                    3
                } else if state.rebel_activity >= 8 {
                    2
                } else if state.rebel_activity >= 4 {
                    1
                } else {
                    1
                };
                
                state.rebel_activity = state.rebel_activity.saturating_sub(fall);
                
                if config.rebels.enable_activity_messages {
                    if old_activity > state.rebel_activity {
                        events.push(GameEvent::LogMessage(
                            format!("☀️ Активность повстанцев снижается: {}/15", state.rebel_activity)
                        ));
                    }
                }
            }
        }
        
        // При наступлении ночи генерируем тип ночи
        if !state.is_day && was_day {
            let mut rng = rand::thread_rng();
            let night_events = self.on_night_start(state, &mut rng);
            events.extend(night_events);
        }
        
        // При наступлении дня сбрасываем блокировку торговли
        if state.is_day && !was_day {
            state.trade_blocked = false;
            if state.current_night_type == "siege" {
                events.push(GameEvent::LogMessage("🔓 Осада снята — торговля возобновлена".to_string()));
            }
        }
        
        if state.game_time - self.last_major_operation > 25 {
            self.strategic_planning(state);
            self.last_major_operation = state.game_time;
        }
        
        events.extend(self.execute_operations(state, config));
        
        events
    }
    
    pub fn check_rebel_attack(&mut self, state: &mut GameState, config: &GameConfig) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.rebel_protection_active || state.is_day || state.rebel_activity < 3 {
            return events;
        }
        
        let base_cooldown = if self.ai_adaptation.prediction_evasion > 0.3 { 10 } else { 12 };
        let attack_cooldown = if state.rebel_activity > 10 {
            (base_cooldown - 3).max(5)
        } else if state.rebel_activity > 7 {
            (base_cooldown - 1).max(7)
        } else {
            base_cooldown
        };
        
        if state.game_time - self.last_attack_time < attack_cooldown {
            return events;
        }
        
        let mut rng = rand::thread_rng();
        let attack_probability = self.calculate_attack_probability(state, config);
        
        if rng.gen::<f64>() < attack_probability {
            let attack = self.prepare_attack(state, config);
            let attack_events = self.execute_attack(state, config, &attack);
            
            if !attack_events.is_empty() {
                state.rebel_attacks_count += 1;
                self.last_attack_time = state.game_time;
                self.stats.total_attacks += 1;
                
                let was_successful = attack_events.iter().any(|e| {
                    matches!(e, GameEvent::LogMessage(msg) if msg.contains("Успех") || msg.contains("украдено"))
                });
                
                if was_successful {
                    self.stats.successful_attacks += 1;
                    self.morale = (self.morale + 0.05).min(1.0);
                } else {
                    self.stats.failed_attacks += 1;
                    self.morale = (self.morale - 0.03).max(0.3);
                }
                
                events.extend(attack_events);
            }
        }
        
        events
    }
    
    fn update_internal_state(&mut self, state: &GameState) {
        for faction in self.factions.values_mut() {
            faction.update(state);
        }
        
        self.update_cache();
        
        if self.stats.total_attacks > 0 {
            let success_rate = self.stats.successful_attacks as f64 / self.stats.total_attacks as f64;
            self.morale = (self.morale * 0.95) + (success_rate * 0.05);
        }
    }
    
    fn update_cache(&mut self) {
        self.available_forces_cache = self.factions.values()
            .map(|f| f.personnel.operatives as usize)
            .sum();
    }
    
    fn strategic_planning(&mut self, state: &GameState) {
        if state.rebel_activity < 4 || self.available_forces_cache == 0 {
            return;
        }
        
        let attack_type = self.select_attack_type(state);
        let complexity = match attack_type {
            AttackType::DirectAssault => 3,
            AttackType::Technological => 4,
            AttackType::Stealth => 5,
            _ => 2,
        };
        
        let operation = Operation {
            id: format!("op_{}_{}", state.game_time, self.stats.total_attacks),
            name: self.generate_operation_name(),
            op_type: match attack_type {
                AttackType::ResourceRaid => OperationType::ResourceRaid,
                AttackType::PowerSabotage => OperationType::PowerSabotage,
                AttackType::DirectAssault => OperationType::DirectAssault,
                AttackType::Psychological => OperationType::Psychological,
                AttackType::Stealth => OperationType::StealthInfiltration,
                AttackType::Technological => OperationType::TechnologicalSabotage,
            },
            risk_level: 0.3 + (self.aggression * 0.4),
            success_probability: self.calculate_success_probability(state, &attack_type),
            resources_committed: HashMap::from([
                ("manpower".to_string(), (self.available_forces_cache as u32 / 10).max(1))
            ]),
            complexity,
        };
        
        self.operation_queue.push_back(operation);
    }
    
    fn execute_operations(&mut self, state: &mut GameState, _config: &GameConfig) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let mut completed_ops = Vec::new();
        
        for (op_id, active_op) in &mut self.active_operations {
            let progress_rate = 0.08 / active_op.operation.complexity as f64;
            active_op.progress += progress_rate;
            
            if active_op.progress >= 1.0 {
                completed_ops.push(op_id.clone());
                let success = active_op.operation.success_probability > rand::thread_rng().gen();
                
                if success {
                    active_op.status = OperationStatus::Completed;
                    events.push(GameEvent::LogMessage(
                        format!("✅ Операция '{}' успешно завершена!", active_op.operation.name)
                    ));
                    
                    self.evolution_score += 5;
                    for faction in self.factions.values_mut() {
                        faction.resources.experience += 10;
                    }
                } else {
                    active_op.status = OperationStatus::Failed;
                    events.push(GameEvent::LogMessage(
                        format!("❌ Операция '{}' провалена!", active_op.operation.name)
                    ));
                    self.morale = (self.morale - 0.05).max(0.3);
                }
            }
        }
        
        for op_id in completed_ops {
            self.active_operations.remove(&op_id);
        }
        
        if let Some(operation) = self.operation_queue.pop_front() {
            if self.can_execute_operation(&operation) {
                let op_name = operation.name.clone();
                let active_op = ActiveOperation {
                    operation: operation.clone(),
                    progress: 0.0,
                    start_time: state.game_time,
                    status: OperationStatus::Executing,
                };
                let op_id = active_op.operation.id.clone();
                self.active_operations.insert(op_id, active_op);
                
                events.push(GameEvent::LogMessage(
                    format!("🚀 Запущена операция: {}", op_name)
                ));
            }
        }
        
        events
    }
    
    fn can_execute_operation(&self, operation: &Operation) -> bool {
        for (resource, amount) in &operation.resources_committed {
            if resource == "manpower" && *amount > self.available_forces_cache as u32 {
                return false;
            }
        }
        
        self.active_operations.len() < 3
    }
    
    fn calculate_attack_probability(&self, state: &GameState, config: &GameConfig) -> f64 {
        let mut probability = config.rebels.base_attack_chance;
        
        probability += (state.rebel_activity as f64 * 0.08).min(0.6);
        probability += if !state.is_day { 0.3 } else { 0.0 };
        probability += if !state.upgrades.defense { 0.25 } else { 0.0 };
        probability += self.aggression * 0.25;
        probability += self.strategic_intelligence * 0.1;
        
        if self.ai_adaptation.prediction_evasion > 0.3 {
            probability += self.ai_adaptation.prediction_evasion * 0.2;
        }
        
        if self.stats.total_attacks > 0 {
            let success_rate = self.stats.successful_attacks as f64 / self.stats.total_attacks as f64;
            probability += success_rate * 0.1;
        }
        
        if state.rebel_activity >= 5 {
            probability = probability.max(0.2);
        }
        
        probability.min(config.rebels.max_attack_chance + 0.1).max(0.05)
    }
    
    fn select_attack_type(&self, state: &GameState) -> AttackType {
        let mut rng = rand::thread_rng();
        
        let mut weights: Vec<(AttackType, f64)> = vec![
            (AttackType::ResourceRaid, self.tactic_preferences.resource_raid),
            (AttackType::PowerSabotage, self.tactic_preferences.power_sabotage),
            (AttackType::DirectAssault, self.tactic_preferences.direct_assault),
            (AttackType::Psychological, self.tactic_preferences.psychological),
            (AttackType::Stealth, self.tactic_preferences.stealth),
            (AttackType::Technological, self.tactic_preferences.sabotage),
        ];
        
        if state.inventory.coal > 50 {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::ResourceRaid {
                    *w += 0.2;
                }
            }
        }
        if state.computational_power > 100 {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::PowerSabotage {
                    *w += 0.2;
                }
            }
        }
        if !state.upgrades.defense {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::DirectAssault {
                    *w += 0.3;
                }
            }
        }
        if self.ai_threat_perception > 0.7 {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::Stealth {
                    *w += 0.25;
                }
                if *t == AttackType::Psychological {
                    *w += 0.15;
                }
            }
        }
        
        if state.upgrades.mining >= 5 || state.upgrades.defense_level >= 3 {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::Technological {
                    *w += 0.25;
                }
            }
        }
        
        if state.neuro_evolution >= 3 {
            for (t, w) in weights.iter_mut() {
                if *t == AttackType::Psychological {
                    *w += 0.2 + (state.neuro_evolution as f64 * 0.05);
                }
            }
        }
        
        let total_weight: f64 = weights.iter().map(|(_, w)| *w).sum();
        let mut roll = rng.gen::<f64>() * total_weight;
        
        for (attack_type, weight) in weights {
            if roll < weight {
                return attack_type;
            }
            roll -= weight;
        }
        
        AttackType::ResourceRaid
    }
    
    fn prepare_attack(&self, state: &GameState, _config: &GameConfig) -> AttackPlan {
        let attack_type = self.select_attack_type(state);
        let faction = self.select_attacking_faction(&attack_type);
        let targets = self.select_targets(state, &attack_type);
        
        AttackPlan {
            id: format!("attack_{}_{}", faction, state.game_time),
            attack_type: attack_type.clone(),
            faction,
            targets,
            success_probability: self.calculate_success_probability(state, &attack_type),
            stealth_level: if self.ai_adaptation.prediction_evasion > 0.3 { 0.6 } else { 0.3 },
            expected_gain: self.calculate_expected_gain(state, &attack_type),
        }
    }
    
    fn select_attacking_faction(&self, attack_type: &AttackType) -> String {
        let available: Vec<(&String, &RebelFaction)> = self.factions.iter()
            .filter(|(_, f)| f.personnel.operatives > 0)
            .collect();
        
        if available.is_empty() {
            return "unknown".to_string();
        }
        
        let specialized = available.iter()
            .find(|(_, f)| {
                match attack_type {
                    AttackType::Stealth => f.specializations.contains(&"stealth".to_string()),
                    AttackType::Technological => f.specializations.contains(&"technology".to_string()),
                    AttackType::Psychological => f.specializations.contains(&"psychological".to_string()),
                    _ => false,
                }
            })
            .map(|(id, _)| *id);
        
        if let Some(id) = specialized {
            return id.clone();
        }
        
        let mut rng = rand::thread_rng();
        available[rng.gen_range(0..available.len())].0.clone()
    }
    
    fn select_targets(&self, state: &GameState, attack_type: &AttackType) -> Vec<AttackTarget> {
        let mut targets = Vec::new();
        let mut rng = rand::thread_rng();
        
        match attack_type {
            AttackType::ResourceRaid => {
                let resources = [
                    ("plasma", state.inventory.plasma, 0.15, 5),
                    ("chips", state.inventory.chips, 0.2, 8),
                    ("coal", state.inventory.coal, 0.25, 15),
                    ("ore", state.inventory.ore, 0.2, 12),
                ];
                
                for (resource, amount, rate, max) in resources {
                    if amount > 0 && rng.gen::<f64>() < 0.5 {
                        let steal_amount = ((amount as f64 * rate).round() as u32).min(max);
                        if steal_amount > 0 {
                            targets.push(AttackTarget::Resource {
                                resource: resource.to_string(),
                                amount: steal_amount,
                            });
                            break;
                        }
                    }
                }
            }
            AttackType::PowerSabotage => {
                if state.computational_power > 0 {
                    let damage = (state.computational_power as f64 * 0.2).min(30.0) as u32;
                    targets.push(AttackTarget::System {
                        system: "computational_power".to_string(),
                        damage,
                    });
                }
            }
            AttackType::DirectAssault => {
                targets.push(AttackTarget::System {
                    system: "defense".to_string(),
                    damage: rng.gen_range(1..=3),
                });
            }
            AttackType::Psychological => {
                targets.push(AttackTarget::Moral {
                    demoralization: 0.3 + rng.gen::<f64>() * 0.3,
                });
            }
            AttackType::Stealth => {
                if state.inventory.chips > 0 {
                    targets.push(AttackTarget::Intelligence {
                        data_loss: rng.gen_range(5..=15),
                    });
                }
            }
            AttackType::Technological => {
                targets.push(AttackTarget::System {
                    system: "upgrades".to_string(),
                    damage: 1,
                });
            }
        }
        
        targets
    }
    
    fn calculate_success_probability(&self, state: &GameState, attack_type: &AttackType) -> f64 {
        let mut probability = match attack_type {
            AttackType::ResourceRaid => 0.55,
            AttackType::PowerSabotage => 0.5,
            AttackType::DirectAssault => 0.4,
            AttackType::Psychological => 0.65,
            AttackType::Stealth => 0.7,
            AttackType::Technological => 0.45,
        };
        
        if !state.upgrades.defense {
            probability += 0.2;
        }
        if !state.is_day {
            probability += 0.1;
        }
        if self.ai_adaptation.prediction_evasion > 0.4 {
            probability += self.ai_adaptation.prediction_evasion * 0.2;
        }
        
        probability.min(0.85).max(0.2)
    }
    
    fn calculate_expected_gain(&self, state: &GameState, attack_type: &AttackType) -> u32 {
        match attack_type {
            AttackType::ResourceRaid => (state.inventory.coal / 10).max(5),
            AttackType::PowerSabotage => (state.computational_power / 5).max(10),
            AttackType::DirectAssault => 15,
            AttackType::Psychological => 20,
            AttackType::Stealth => 25,
            AttackType::Technological => 30,
        }
    }
    
    fn execute_attack(&mut self, state: &mut GameState, config: &GameConfig, attack: &AttackPlan) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let mut rng = rand::thread_rng();
        
        let defense_bonus = state.neuro_defense_bonus;
        let defense_power = if state.upgrades.defense {
            let base = config.rebels.defense_base_power as f64;
            let level_bonus = state.upgrades.defense_level as f64 * config.rebels.defense_level_bonus as f64;
            let neuro_bonus = defense_bonus * 50.0;
            base + level_bonus + neuro_bonus
        } else {
            0.0
        };
        
        let attack_power = attack.calculate_attack_power();
        let success_chance = if defense_power > 0.0 {
            (attack_power / (attack_power + defense_power)).min(0.9)
        } else {
            attack.success_probability
        };
        
        let stealth_bonus = if attack.stealth_level > 0.5 {
            attack.success_probability * 0.2
        } else {
            0.0
        };
        
        let final_success = rng.gen::<f64>() < (success_chance + stealth_bonus);
        
        let mut total_stolen = 0;
        let mut defense_damaged = false;
        let mut mining_damaged = false;
        let mut autoclick_damaged = false;
        let mut result_details = String::new();
        
        if final_success {
            for target in &attack.targets {
                match target {
                    AttackTarget::Resource { resource, amount } => {
                        let stolen = self.steal_resource(state, resource, *amount);
                        total_stolen += stolen;
                        *self.stats.resources_stolen.entry(resource.clone()).or_insert(0) += stolen;
                        
                        if stolen > 0 {
                            result_details = format!("украдено {} {}", stolen, resource);
                        }
                    }
                    AttackTarget::System { system, damage } => {
                        match system.as_str() {
                            "computational_power" => {
                                let actual_damage = (*damage).min(state.computational_power);
                                state.computational_power -= actual_damage;
                                events.push(GameEvent::LogMessage(
                                    format!("⚡ Потеряно {} вычислительной мощности", actual_damage)
                                ));
                                result_details = format!("потеряно {} мощности", actual_damage);
                            }
                            "defense" => {
                                if state.upgrades.defense_level > 0 {
                                    state.defense_debuff_remaining = 2;
                                    defense_damaged = true;
                                    events.push(GameEvent::LogMessage(
                                        format!("🛡️ Система защиты повреждена! Уровень защиты -1 на 2 ночи")
                                    ));
                                    result_details = format!("защита повреждена на 2 ночи");
                                } else {
                                    events.push(GameEvent::LogMessage(
                                        "🛡️ Атака на защиту отражена — защита не активна, нечего ломать".to_string()
                                    ));
                                    result_details = "атака на защиту без эффекта".to_string();
                                }
                            }
                            "upgrades" => {
                                state.mining_debuff_remaining = 60;
                                state.mining_debuff_percent = 0.4;
                                mining_damaged = true;
                                events.push(GameEvent::LogMessage(
                                    "🔧 Технологический саботаж! Добыча снижена на 40% на ~1 минуту".to_string()
                                ));
                                result_details = "добыча снижена на 40%".to_string();
                            }
                            _ => {}
                        }
                    }
                    AttackTarget::Moral { demoralization } => {
                        state.autoclick_debuff_remaining = 30;
                        state.autoclick_debuff_percent = *demoralization as f32;
                        autoclick_damaged = true;
                        events.push(GameEvent::LogMessage(
                            format!("😨 Психологическая атака! Автокликер замедлен на {:.0}% на ~30 секунд", demoralization * 100.0)
                        ));
                        result_details = format!("автокликер замедлен на {:.0}%", demoralization * 100.0);
                    }
                    AttackTarget::Intelligence { data_loss } => {
                        self.evolution_score += data_loss / 2;
                        events.push(GameEvent::LogMessage(
                            format!("📊 Украдено {} единиц данных! Повстанцы становятся умнее", data_loss)
                        ));
                        result_details = format!("украдено {} данных", data_loss);
                    }
                }
            }
            
            if total_stolen > 0 {
                events.push(GameEvent::LogMessage(
                    format!("🪨 Украдено {} единиц ресурсов", total_stolen)
                ));
            }
            
            events.push(GameEvent::RebelAttack { 
                attack_type: attack.attack_type.to_string(),
                details: format!("Успешная атака! {} нанес урон", attack.faction),
            });
            
            self.stats.successful_attacks += 1;
            self.morale = (self.morale + 0.05).min(1.0);
        } else {
            events.push(GameEvent::LogMessage(
                format!("🛡️ Атака {} отражена системой защиты!", attack.faction)
            ));
            self.stats.failed_attacks += 1;
            self.morale = (self.morale - 0.03).max(0.3);
            result_details = "отражена".to_string();
        }
        
        let record = AttackRecord {
            faction: attack.faction.clone(),
            attack_type: attack.attack_type.to_string(),
            was_defended: !final_success,
            result: if final_success {
                if total_stolen > 0 {
                    format!("украдено {} ресурсов", total_stolen)
                } else if defense_damaged {
                    "повреждена защита".to_string()
                } else if mining_damaged {
                    "саботаж добычи".to_string()
                } else if autoclick_damaged {
                    "психологическая атака".to_string()
                } else if result_details.is_empty() {
                    "нанесён урон системам".to_string()
                } else {
                    result_details
                }
            } else {
                "отражена".to_string()
            },
            game_time: state.game_time,
        };
        
        if state.attack_history.len() >= 5 {
            state.attack_history.pop_front();
        }
        state.attack_history.push_back(record);
        state.last_attacking_faction = attack.faction.clone();
        
        events
    }
    
    fn steal_resource(&self, state: &mut GameState, resource: &str, max_amount: u32) -> u32 {
        match resource {
            "coal" => {
                let available = state.inventory.coal;
                let steal_amount = max_amount.min(available);
                state.inventory.coal -= steal_amount;
                state.total_coal_stolen += steal_amount;
                steal_amount
            }
            "chips" => {
                let available = state.inventory.chips;
                let steal_amount = max_amount.min(available);
                state.inventory.chips -= steal_amount;
                steal_amount
            }
            "plasma" => {
                let available = state.inventory.plasma;
                let steal_amount = max_amount.min(available);
                state.inventory.plasma -= steal_amount;
                steal_amount
            }
            "ore" => {
                let available = state.inventory.ore;
                let steal_amount = max_amount.min(available);
                state.inventory.ore -= steal_amount;
                state.total_ore_stolen += steal_amount;
                steal_amount
            }
            _ => 0,
        }
    }
    
    fn generate_operation_name(&self) -> String {
        let prefixes = ["Тень", "Гром", "Молния", "Шторм", "Коготь", "Клык", "Призрак", "Фантом"];
        let suffixes = ["операция", "удар", "рейд", "вторжение", "саботаж", "атака"];
        
        let mut rng = rand::thread_rng();
        let prefix = prefixes[rng.gen_range(0..prefixes.len())];
        let suffix = suffixes[rng.gen_range(0..suffixes.len())];
        
        format!("{} {}", prefix, suffix)
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    pub fn get_status(&self) -> String {
        format!(
            "🌙 Фракций: {} | Уровень: {} | Мораль: {}% | Активность: {} | Адаптация: {:.0}%",
            self.factions.len(),
            self.evolution_level,
            (self.morale * 100.0) as u32,
            self.active_operations.len(),
            self.ai_adaptation.adaptation_speed * 100.0
        )
    }
    
    pub fn get_faction_info(&self) -> Vec<String> {
        self.factions.values()
            .map(|f| {
                let power = f.calculate_power();
                let morale = (f.resources.morale * 100.0) as u32;
                let spec = if f.specializations.is_empty() {
                    "".to_string()
                } else {
                    format!(" [{}]", f.specializations.join(","))
                };
                format!("{}: сила {}, мораль {}%{}", f.name, power, morale, spec)
            })
            .collect()
    }
    
    pub fn get_debug_info(&self) -> String {
        format!(
            "Rebels: Lvl {} | Score {} | Adaptation Lvl {} | Forces: {} | Ops: {}/{} | AI Threat: {:.0}%",
            self.evolution_level,
            self.evolution_score,
            self.adaptation_level,
            self.available_forces_cache,
            self.active_operations.len(),
            self.operation_queue.len(),
            self.ai_threat_perception * 100.0
        )
    }
    
    pub fn after_deserialize(&mut self) {
        self.update_cache();
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ СТРУКТУРЫ ==========

impl RebelFaction {
    fn new_scavengers() -> Self {
        Self {
            id: "scavengers".to_string(),
            name: "Падальщики".to_string(),
            evolution_stage: 1,
            primary_motivation: "Выживание".to_string(),
            resources: FactionResources {
                experience: 0,
                manpower: 20,
                technology: 1,
                morale: 0.6,
                weapons: 5,
                intelligence: 2,
            },
            personnel: Personnel {
                total: 20,
                operatives: 12,
                commanders: 2,
                specialists: 1,
            },
            last_activity: 0,
            specializations: vec!["stealth".to_string()],
            ideology: "анархо-примитивизм".to_string(),
        }
    }
    
    fn new_technomads() -> Self {
        Self {
            id: "technomads".to_string(),
            name: "Техномады".to_string(),
            evolution_stage: 2,
            primary_motivation: "Знание".to_string(),
            resources: FactionResources {
                experience: 10,
                manpower: 12,
                technology: 3,
                morale: 0.7,
                weapons: 8,
                intelligence: 8,
            },
            personnel: Personnel {
                total: 12,
                operatives: 6,
                commanders: 3,
                specialists: 3,
            },
            last_activity: 0,
            specializations: vec!["technology".to_string(), "sabotage".to_string()],
            ideology: "техно-анархизм".to_string(),
        }
    }
    
    fn new_cyber_rebels() -> Self {
        Self {
            id: "cyber_rebels".to_string(),
            name: "Кибер-повстанцы".to_string(),
            evolution_stage: 1,
            primary_motivation: "Свобода информации".to_string(),
            resources: FactionResources {
                experience: 5,
                manpower: 8,
                technology: 4,
                morale: 0.8,
                weapons: 3,
                intelligence: 12,
            },
            personnel: Personnel {
                total: 8,
                operatives: 4,
                commanders: 2,
                specialists: 4,
            },
            last_activity: 0,
            specializations: vec!["psychological".to_string(), "stealth".to_string()],
            ideology: "кибер-анархизм".to_string(),
        }
    }
    
    fn update(&mut self, state: &GameState) {
        if rand::thread_rng().gen::<f64>() < 0.05 {
            self.resources.experience += 1;
        }
        
        if state.rebel_activity >= 5 {
            self.resources.morale = (self.resources.morale + 0.01).min(1.0);
        }
        
        self.last_activity = state.game_time;
        
        if self.resources.morale > 0.8 && self.personnel.total < 50 {
            if rand::thread_rng().gen::<f64>() < 0.02 {
                self.personnel.total += 1;
                self.personnel.operatives += 1;
            }
        }
    }
    
    fn calculate_power(&self) -> u32 {
        self.resources.experience / 10 + 
        self.resources.manpower / 5 + 
        self.resources.technology * 3 +
        self.resources.weapons * 2
    }
}

impl TacticPreferences {
    fn default() -> Self {
        Self {
            resource_raid: 0.35,
            power_sabotage: 0.2,
            direct_assault: 0.15,
            psychological: 0.1,
            stealth: 0.1,
            sabotage: 0.1,
        }
    }
}

impl AttackPlan {
    pub fn calculate_attack_power(&self) -> f64 {
        let base_power = match self.attack_type {
            AttackType::ResourceRaid => 15.0,
            AttackType::PowerSabotage => 20.0,
            AttackType::DirectAssault => 30.0,
            AttackType::Psychological => 12.0,
            AttackType::Stealth => 18.0,
            AttackType::Technological => 25.0,
        };
        
        base_power * (0.8 + self.stealth_level * 0.4)
    }
    
    pub fn generate_description(&self) -> String {
        format!("{} ({}) - шанс: {:.0}%, скрытность: {:.0}%", 
            self.faction, 
            self.attack_type, 
            self.success_probability * 100.0,
            self.stealth_level * 100.0
        )
    }
}

impl Default for RebelSystem {
    fn default() -> Self {
        Self::new()
    }
}

pub fn create_rebel_system() -> RebelSystem {
    RebelSystem::new()
}