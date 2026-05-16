// ======== src/systems/neuro_ecosystem.rs (ПОЛНАЯ ВЕРСИЯ С БОНУСАМИ СОЗНАНИЯ) ========

use crate::game::{GameState, GameEvent};
use crate::game::config::GameConfig;
use crate::systems::rebel::RebelSystem;
use std::collections::VecDeque;
use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeuroEcosystem {
    // Эволюция
    pub evolution_level: u32,
    pub evolution_score: u32,
    pub system_consciousness: f64,
    
    // Память угроз
    pub threat_memory: VecDeque<ThreatRecord>,
    pub learned_patterns: Vec<Pattern>,
    
    // Метрики эффективности
    pub defense_success_rate: f64,
    pub prediction_accuracy: f64,
    pub avg_reaction_time: f32,
    pub total_attacks_processed: u32,
    pub successful_predictions: u32,
    
    // Состояние
    pub last_processed_time: i32,
    pub cooldown: i32,
    pub reaction_cooldown: i32,
    pub attack_counter: u32,
    pub last_ai_decision: AIDecision,
    
    // Бонусы
    pub active_defense_bonus: f64,
    pub prediction_bonus: f64,
    
    // Статистика
    pub stats: NeuroStats,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ThreatRecord {
    pub timestamp: i32,
    pub threat_level: u32,
    pub threat_type: String,
    pub was_real_attack: bool,
    pub defense_level: u32,
    pub was_defended: bool,
    pub predicted: bool,
    pub outcome: Outcome,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Pattern {
    pub pattern_type: String,
    pub effectiveness: f64,
    pub usage_count: u32,
    pub last_used: i32,
    pub success_rate: f64,
    pub counter_strategy: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeuroStats {
    pub total_threats_processed: u32,
    pub real_attacks_encountered: u32,
    pub successful_defenses: u32,
    pub failed_defenses: u32,
    pub evolutions: u32,
    pub consciousness_gains: Vec<f64>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum AIDecision {
    Normal,
    PredictiveMode,
    DefensiveMode,
    AggressiveCounter,
    StrategicRetreat,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Outcome {
    Success,
    Failure,
    Neutral,
    Predicted,
    Countered,
}

#[derive(Debug)]
struct ThreatAnalysis {
    predicted: bool,
    confidence: f64,
    predicted_attack_type: Option<String>,
    risk_level: f64,
}

// ========== СТРУКТУРА БОНУСОВ СОЗНАНИЯ ==========

pub struct ConsciousnessBonus {
    pub mining_chance_bonus: f64,      // +% к шансу добычи
    pub heat_reduction: f64,           // % снижения нагрева
    pub crit_bonus: f64,               // +% к крит-шансу
    pub autoclick_speed: f64,          // множитель интервала (<1 = быстрее)
    pub defense_bonus: u32,            // плоский бонус к защите
    pub passive_multiplier: f64,       // ×N к пассивным шансам
    pub trade_discount_chance: f64,    // шанс ночной скидки
    pub power_bonus: u32,              // +N мощности за клик
    pub global_multiplier: f64,        // финальный множитель
}

impl NeuroEcosystem {
    pub fn new() -> Self {
        Self {
            evolution_level: 0,
            evolution_score: 0,
            system_consciousness: 0.05,
            threat_memory: VecDeque::with_capacity(100),
            learned_patterns: Vec::new(),
            defense_success_rate: 0.5,
            prediction_accuracy: 0.3,
            avg_reaction_time: 0.0,
            total_attacks_processed: 0,
            successful_predictions: 0,
            last_processed_time: -100,
            cooldown: 10,
            reaction_cooldown: 8,
            attack_counter: 0,
            last_ai_decision: AIDecision::Normal,
            active_defense_bonus: 0.0,
            prediction_bonus: 0.0,
            stats: NeuroStats {
                total_threats_processed: 0,
                real_attacks_encountered: 0,
                successful_defenses: 0,
                failed_defenses: 0,
                evolutions: 0,
                consciousness_gains: Vec::new(),
            },
        }
    }
    
    // ========== НОВЫЙ МЕТОД: БОНУСЫ СОЗНАНИЯ ==========
    
    pub fn get_consciousness_bonuses(&self) -> ConsciousnessBonus {
        let c = self.system_consciousness; // 0.0--1.0
        let lvl = self.evolution_level;
        let global = if lvl >= 10 { 1.25 } else if lvl >= 9 { 1.2 } else { 1.0 };
        
        ConsciousnessBonus {
            mining_chance_bonus: if lvl >= 1 { c * 0.05 } else { 0.0 },
            heat_reduction: if lvl >= 2 { c * 0.10 } else { 0.0 },
            crit_bonus: if lvl >= 3 { c * 0.03 } else { 0.0 },
            autoclick_speed: if lvl >= 4 { 1.0 - c * 0.10 } else { 1.0 },
            defense_bonus: if lvl >= 5 { (c * 10.0) as u32 } else { 0 },
            passive_multiplier: if lvl >= 6 { 1.0 + c * 0.5 } else { 1.0 },
            trade_discount_chance: if lvl >= 7 { 0.25 + c * 0.05 } else { 0.25 },
            power_bonus: if lvl >= 8 { 1 } else { 0 },
            global_multiplier: global,
        }
    }
    
    // ========== ГЛАВНЫЙ МЕТОД ОБРАБОТКИ УГРОЗ ==========
    
    pub fn process_threat(
        &mut self, 
        state: &mut GameState, 
        rebel_system: &mut RebelSystem,
        config: &GameConfig, 
        had_real_attack: bool,
        was_defended: bool
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        self.stats.total_threats_processed += 1;
        if had_real_attack {
            self.stats.real_attacks_encountered += 1;
            if was_defended {
                self.stats.successful_defenses += 1;
            } else {
                self.stats.failed_defenses += 1;
            }
        }
        
        // 1. РАСЧЕТ КУЛДАУНА
        let effective_cooldown = self.calculate_cooldown(had_real_attack, state.rebel_activity);
        
        if state.game_time - self.last_processed_time < effective_cooldown {
            return events;
        }
        
        self.last_processed_time = state.game_time;
        
        // 2. АНАЛИЗ УГРОЗЫ
        let threat_analysis = self.analyze_threat(state, rebel_system, had_real_attack);
        
        // 3. ЗАПИСЬ В ПАМЯТЬ
        self.record_threat(
            state.rebel_activity,
            had_real_attack,
            state.game_time,
            state.upgrades.defense_level,
            was_defended,
            threat_analysis.predicted
        );
        
        // 4. НАЧИСЛЕНИЕ ОЧКОВ ЭВОЛЮЦИИ ЗА АКТИВНОСТЬ
        let points_gained = self.calculate_evolution_points(
            had_real_attack, 
            state.rebel_activity,
            was_defended,
            threat_analysis.predicted
        );
        
        if points_gained > 0 {
            self.evolution_score += points_gained;
            let reason = if had_real_attack {
                "реальная атака"
            } else if state.rebel_activity >= 5 {
                "высокая активность"
            } else if threat_analysis.predicted {
                "успешное предсказание"
            } else {
                "анализ угрозы"
            };
            
            events.push(GameEvent::LogMessage(
                format!("🧠 {}: +{} очков эволюции (активность: {})", 
                    reason, points_gained, state.rebel_activity)
            ));
        }
        
        // 5. ОБУЧЕНИЕ ПАТТЕРНУ
        self.learn_pattern(state, rebel_system, had_real_attack, was_defended);
        
        // 6. ПРИНЯТИЕ РЕШЕНИЯ ИИ
        let ai_decision = self.make_ai_decision(state, rebel_system, had_real_attack);
        self.last_ai_decision = ai_decision.clone();
        
        // 7. ПРИМЕНЕНИЕ РЕШЕНИЯ
        let decision_events = self.apply_ai_decision(state, rebel_system, config, ai_decision);
        events.extend(decision_events);
        
        // 8. ОБНОВЛЕНИЕ МЕТРИК
        self.update_metrics(had_real_attack, was_defended, threat_analysis.predicted);
        
        // 9. БОНУС ЗА СЕРИЮ АТАК
        if had_real_attack {
            self.attack_counter += 1;
            if self.attack_counter >= 2 {
                let bonus = (self.attack_counter * 8) as u32;
                self.evolution_score += bonus;
                events.push(GameEvent::LogMessage(
                    format!("🔥 Серия из {} атак! +{} бонусных очков эволюции", 
                        self.attack_counter, bonus)
                ));
            }
        } else {
            self.attack_counter = 0;
        }
        
        // 10. ОЧИСТКА СТАРОЙ ПАМЯТИ
        self.cleanup_old_memory(state.game_time);
        
        // 11. ОБНОВЛЕНИЕ БОНУСОВ
        self.update_bonuses();
        
        events
    }
    
    // ========== ПУБЛИЧНЫЙ МЕТОД ДЛЯ ПРОВЕРКИ ЭВОЛЮЦИИ ==========
    
    pub fn check_evolution(&mut self, state: &mut GameState, rebel_system: &mut RebelSystem) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        let required_score = self.get_evolution_requirement();
        
        if self.evolution_score >= required_score {
            let old_level = self.evolution_level;
            self.evolution_level += 1;
            self.evolution_score -= required_score;
            self.stats.evolutions += 1;
            
            let consciousness_gain = 0.08;
            self.system_consciousness = (self.system_consciousness + consciousness_gain).min(1.0);
            self.stats.consciousness_gains.push(self.system_consciousness);
            
            self.cooldown = (self.cooldown - 1).max(5);
            self.reaction_cooldown = (self.reaction_cooldown - 1).max(3);
            
            // Обновляем состояние игры
            state.neuro_evolution = self.evolution_level;
            state.neuro_consciousness = self.system_consciousness;
            state.neuro_score = self.evolution_score;
            
            events.push(GameEvent::LogMessage(
                format!("🌟 НЕЙРО-ЭВОЛЮЦИЯ! Уровень {} → {} (Сознание: {}%)", 
                    old_level,
                    self.evolution_level, 
                    (self.system_consciousness * 100.0) as u32)
            ));
            
            match self.evolution_level {
                1 => {
                    events.push(GameEvent::LogMessage("🧠 Новая способность: Базовое предсказание угроз".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "prediction_unlocked");
                }
                3 => {
                    events.push(GameEvent::LogMessage("🧠 Новая способность: Адаптивная оборона".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "adaptive_defense");
                }
                5 => {
                    events.push(GameEvent::LogMessage("🧠 Новая способность: Контр-атака".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "counter_attack");
                }
                7 => {
                    events.push(GameEvent::LogMessage("🧠 Новая способность: Психологическое воздействие".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "psychological_warfare");
                }
                10 => {
                    events.push(GameEvent::LogMessage("🧠 Новая способность: Полное сознание системы".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "full_consciousness");
                }
                _ => {}
            }
            
            if self.evolution_level >= 3 {
                let defense_bonus = (self.evolution_level as f64 * 0.05).min(0.5);
                self.active_defense_bonus = defense_bonus.max(self.active_defense_bonus);
            }
        }
        
        events
    }
    
    // ========== АНАЛИЗ УГРОЗ ==========
    
    fn analyze_threat(&self, _state: &GameState, _rebel_system: &RebelSystem, _had_attack: bool) -> ThreatAnalysis {
        let mut predicted = false;
        let mut confidence = 0.0;
        let mut predicted_attack_type = None;
        
        // Анализ на основе памяти
        if !self.threat_memory.is_empty() {
            let recent: Vec<_> = self.threat_memory.iter().rev().take(20).collect();
            
            // Поиск похожих паттернов
            let similar_threats: Vec<_> = recent.iter()
                .filter(|r| {
                    let threat_level_diff = (r.threat_level as i32 - _state.rebel_activity as i32).abs();
                    threat_level_diff <= 2
                })
                .collect();
            
            if !similar_threats.is_empty() {
                let attack_ratio = similar_threats.iter()
                    .filter(|r| r.was_real_attack)
                    .count() as f64 / similar_threats.len() as f64;
                
                confidence = attack_ratio * self.system_consciousness;
                predicted = confidence > 0.6;
                
                if predicted && !similar_threats.is_empty() {
                    if let Some(last_attack) = similar_threats.iter().find(|r| r.was_real_attack) {
                        predicted_attack_type = Some(last_attack.threat_type.clone());
                    }
                }
            }
        }
        
        // Анализ на основе активности повстанцев
        let activity_risk = if _state.rebel_activity >= 7 {
            0.9
        } else if _state.rebel_activity >= 4 {
            0.6
        } else if _state.rebel_activity >= 2 {
            0.3
        } else {
            0.1
        };
        
        let final_confidence = (confidence + activity_risk) / 2.0;
        
        ThreatAnalysis {
            predicted,
            confidence: final_confidence,
            predicted_attack_type,
            risk_level: activity_risk,
        }
    }
    
    fn record_threat(
        &mut self, 
        threat_level: u32, 
        was_real_attack: bool, 
        timestamp: i32, 
        defense_level: u32,
        was_defended: bool,
        predicted: bool
    ) {
        let outcome = if was_defended {
            Outcome::Success
        } else if was_real_attack {
            Outcome::Failure
        } else {
            Outcome::Neutral
        };
        
        let record = ThreatRecord {
            timestamp,
            threat_level,
            threat_type: if was_real_attack { 
                "real_attack".to_string() 
            } else if predicted {
                "predicted".to_string()
            } else {
                "potential".to_string()
            },
            was_real_attack,
            defense_level,
            was_defended,
            predicted,
            outcome,
        };
        
        if self.threat_memory.len() >= 100 {
            self.threat_memory.pop_front();
        }
        self.threat_memory.push_back(record);
    }
    
    // ========== РАСЧЕТ ОЧКОВ ЭВОЛЮЦИИ ==========
    
    fn calculate_evolution_points(&self, had_real_attack: bool, rebel_activity: u32, was_defended: bool, predicted: bool) -> u32 {
        let base_points = if had_real_attack {
            30 + (rebel_activity * 5) as u32
        } else {
            15 + (rebel_activity * 2) as u32
        };
        
        let bonus = if was_defended {
            (self.defense_success_rate * 20.0) as u32
        } else if predicted && !had_real_attack {
            (self.prediction_accuracy * 15.0) as u32
        } else {
            0
        };
        
        let evolution_bonus = self.evolution_level * 2;
        
        base_points + bonus + evolution_bonus
    }
    
    // ========== ОБУЧЕНИЕ ПАТТЕРНАМ ==========
    
    fn learn_pattern(&mut self, state: &GameState, rebel_system: &RebelSystem, had_attack: bool, was_defended: bool) {
        let pattern_type = self.identify_pattern_type(state, rebel_system);
        let success = was_defended || (!had_attack && self.prediction_accuracy > 0.7);
        let pattern_type_clone = pattern_type.clone();
        
        let counter_strategy = if success {
            self.select_counter_strategy(&pattern_type_clone)
        } else {
            "observe".to_string()
        };
        
        // Находим индекс паттерна
        let pattern_index = self.learned_patterns.iter().position(|p| p.pattern_type == pattern_type);
        
        if let Some(idx) = pattern_index {
            let pattern = &mut self.learned_patterns[idx];
            pattern.usage_count += 1;
            pattern.last_used = state.game_time;
            
            let effectiveness_change = if success { 0.08 } else { -0.03 };
            pattern.effectiveness = (pattern.effectiveness + effectiveness_change).clamp(0.1, 1.0);
            pattern.success_rate = (pattern.success_rate * 0.9) + (if success { 0.1 } else { 0.0 });
            
            if pattern.effectiveness > 0.7 {
                pattern.counter_strategy = counter_strategy;
            }
        } else {
            let new_pattern = Pattern {
                pattern_type: pattern_type_clone,
                effectiveness: 0.5,
                usage_count: 1,
                last_used: state.game_time,
                success_rate: if success { 0.6 } else { 0.4 },
                counter_strategy: "observe".to_string(),
            };
            self.learned_patterns.push(new_pattern);
        }
    }
    
    fn identify_pattern_type(&self, state: &GameState, rebel_system: &RebelSystem) -> String {
        let activity_level = match state.rebel_activity {
            0..=2 => "dormant",
            3..=4 => "probing",
            5..=6 => "active",
            7..=8 => "aggressive",
            9..=15 => "desperate",
            _ => "unknown",
        };
        
        let rebel_info = rebel_system.get_faction_info();
        let default_faction = "unknown".to_string();
        let primary_faction = rebel_info.first().unwrap_or(&default_faction);
        
        format!("{}_{}", activity_level, primary_faction)
    }
    
    fn select_counter_strategy(&self, pattern_type: &str) -> String {
        if pattern_type.contains("aggressive") {
            "fortify_defense".to_string()
        } else if pattern_type.contains("probing") {
            "decoys".to_string()
        } else if pattern_type.contains("desperate") {
            "psychological_warfare".to_string()
        } else {
            "standard_defense".to_string()
        }
    }
    
    // ========== ПРИНЯТИЕ РЕШЕНИЙ ИИ ==========
    
    fn make_ai_decision(&self, state: &GameState, _rebel_system: &RebelSystem, had_attack: bool) -> AIDecision {
        let consciousness = self.system_consciousness;
        let threat_level = state.rebel_activity;
        let prediction_confidence = if self.threat_memory.is_empty() {
            0.0
        } else {
            let recent: Vec<_> = self.threat_memory.iter().rev().take(10).collect();
            let predicted_count = recent.iter().filter(|r| r.predicted && r.was_real_attack).count();
            predicted_count as f64 / recent.len() as f64
        };
        
        if consciousness > 0.8 && prediction_confidence > 0.7 {
            return AIDecision::PredictiveMode;
        }
        
        if had_attack || threat_level >= 7 {
            if state.upgrades.defense {
                if self.defense_success_rate > 0.7 {
                    return AIDecision::AggressiveCounter;
                } else {
                    return AIDecision::DefensiveMode;
                }
            } else {
                return AIDecision::StrategicRetreat;
            }
        }
        
        if threat_level >= 4 {
            return AIDecision::DefensiveMode;
        }
        
        AIDecision::Normal
    }
    
    fn apply_ai_decision(
        &mut self, 
        state: &mut GameState, 
        rebel_system: &mut RebelSystem,
        config: &GameConfig,
        decision: AIDecision
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        match decision {
            AIDecision::PredictiveMode => {
                self.prediction_bonus = 0.3;
                state.current_ai_mode = "🔮 Предсказание".to_string();
                
                events.push(GameEvent::LogMessage(
                    "🧠 Режим предсказания: ИИ анализирует будущие угрозы (+30% к точности)".to_string()
                ));
                rebel_system.on_ai_evolution(self.evolution_level, "predictive");
                
                if let Some((confidence, attack_type)) = self.get_attack_prediction() {
                    if confidence > 0.6 {
                        state.attack_warning = format!("⚠️ Вероятность атаки: {:.0}%", confidence * 100.0);
                        state.attack_warning_faction = attack_type;
                        events.push(GameEvent::LogMessage(
                            format!("🔮 ИИ предупреждает: высокая вероятность атаки от {} ({:.0}%)", 
                                state.attack_warning_faction, confidence * 100.0)
                        ));
                    }
                } else {
                    state.attack_warning = "🔍 Анализ угроз...".to_string();
                    state.attack_warning_faction = "неизвестно".to_string();
                }
            }
            
            AIDecision::DefensiveMode => {
                self.active_defense_bonus = 0.25;
                state.current_ai_mode = "🛡️ Защитный".to_string();
                state.attack_warning = String::new();
                state.attack_warning_faction = String::new();
                
                events.push(GameEvent::LogMessage(
                    "🛡️ Защитный режим: ИИ усиливает системы обороны (+25% к защите)".to_string()
                ));
                
                if !state.upgrades.defense && state.inventory.plasma >= config.upgrade_config.defense_activation_cost {
                    events.push(GameEvent::LogMessage(
                        "🤖 ИИ автоматически активировал систему защиты!".to_string()
                    ));
                }
                
                rebel_system.on_ai_evolution(self.evolution_level, "defensive");
            }
            
            AIDecision::AggressiveCounter => {
                self.active_defense_bonus = 0.15;
                state.current_ai_mode = "⚔️ Агрессивный".to_string();
                state.attack_warning = String::new();
                state.attack_warning_faction = String::new();
                
                events.push(GameEvent::LogMessage(
                    "⚔️ Агрессивные контрмеры: ИИ наносит упреждающие удары по повстанцам".to_string()
                ));
                
                if state.rebel_activity > 0 {
                    let reduction = (state.rebel_activity as f64 * 0.3) as u32;
                    state.rebel_activity = state.rebel_activity.saturating_sub(reduction);
                    events.push(GameEvent::LogMessage(
                        format!("⚔️ Упреждающий удар: активность повстанцев снижена на {}", reduction)
                    ));
                }
                
                rebel_system.on_ai_evolution(self.evolution_level, "aggressive");
            }
            
            AIDecision::StrategicRetreat => {
                self.active_defense_bonus = 0.4;
                state.current_ai_mode = "🏃 Отступление".to_string();
                state.attack_warning = String::new();
                state.attack_warning_faction = String::new();
                
                events.push(GameEvent::LogMessage(
                    "🏃 Стратегическое отступление: ИИ консервирует ресурсы для обороны (+40% к защите)".to_string()
                ));
                
                rebel_system.on_ai_evolution(self.evolution_level, "retreat");
            }
            
            AIDecision::Normal => {
                self.active_defense_bonus = 0.0;
                self.prediction_bonus = 0.0;
                state.current_ai_mode = "⚙️ Обычный".to_string();
                state.attack_warning = String::new();
                state.attack_warning_faction = String::new();
            }
        }
        
        events
    }
    
    // ========== МЕТРИКИ ==========
    
    fn update_metrics(&mut self, had_attack: bool, was_defended: bool, predicted: bool) {
        self.total_attacks_processed += 1;
        
        if predicted && had_attack {
            self.successful_predictions += 1;
        }
        
        if self.total_attacks_processed > 0 {
            self.prediction_accuracy = self.successful_predictions as f64 / self.total_attacks_processed as f64;
        }
        
        if had_attack {
            let success = if was_defended { 1.0 } else { 0.0 };
            self.defense_success_rate = (self.defense_success_rate * 0.9) + (success * 0.1);
        }
        
        self.avg_reaction_time = self.avg_reaction_time * 0.95 + (self.reaction_cooldown as f32 * 0.05);
    }
    
    fn update_bonuses(&mut self) {
        self.prediction_bonus = self.prediction_bonus.max(self.system_consciousness * 0.3);
        
        if self.evolution_level >= 3 {
            self.active_defense_bonus = self.active_defense_bonus.max(0.15 + (self.evolution_level as f64 * 0.02));
        }
    }
    
    fn calculate_cooldown(&self, had_real_attack: bool, rebel_activity: u32) -> i32 {
        if had_real_attack {
            4
        } else if rebel_activity >= 7 {
            5
        } else if rebel_activity >= 4 {
            7
        } else {
            10
        }
    }
    
    fn cleanup_old_memory(&mut self, current_time: i32) {
        while let Some(record) = self.threat_memory.front() {
            if current_time - record.timestamp > 600 {
                self.threat_memory.pop_front();
            } else {
                break;
            }
        }
        
        self.learned_patterns.retain(|p| {
            p.usage_count > 0 || current_time - p.last_used < 900
        });
    }
    
    fn get_evolution_requirement(&self) -> u32 {
        match self.evolution_level {
            0 => 60,
            1 => 100,
            2 => 150,
            3 => 220,
            4 => 300,
            5 => 400,
            6 => 500,
            7 => 650,
            8 => 800,
            9 => 1000,
            _ => 1200 + (self.evolution_level - 10) * 100,
        }
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ДЛЯ ВНЕШНЕГО ВЗАИМОДЕЙСТВИЯ ==========
    
    pub fn get_defense_bonus(&self) -> f64 {
        let base_bonus = self.active_defense_bonus;
        let consciousness_bonus = self.system_consciousness * 0.2;
        let evolution_bonus = (self.evolution_level as f64 * 0.03).min(0.3);
        
        (base_bonus + consciousness_bonus + evolution_bonus).min(0.7)
    }
    
    pub fn get_prediction_bonus(&self) -> f64 {
        let base_bonus = self.prediction_bonus;
        let accuracy_bonus = self.prediction_accuracy * 0.2;
        
        (base_bonus + accuracy_bonus).min(0.5)
    }
    
    pub fn get_attack_prediction(&self) -> Option<(f64, String)> {
        if self.threat_memory.is_empty() {
            return None;
        }
        
        let recent: Vec<_> = self.threat_memory.iter().rev().take(20).collect();
        let attack_probability = recent.iter()
            .filter(|r| r.was_real_attack)
            .count() as f64 / recent.len() as f64;
        
        let confidence = attack_probability * (0.5 + self.prediction_accuracy * 0.5);
        
        if confidence > 0.6 {
            let most_common_type = recent.iter()
                .filter(|r| r.was_real_attack)
                .map(|r| &r.threat_type)
                .fold(std::collections::HashMap::new(), |mut acc, t| {
                    *acc.entry(t).or_insert(0) += 1;
                    acc
                })
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(t, _)| t.clone())
                .unwrap_or_else(|| "unknown".to_string());
            
            Some((confidence, most_common_type))
        } else {
            None
        }
    }
    
    pub fn get_status(&self) -> String {
        let (next_score, _) = self.get_next_level_requirements();
        format!(
            "🧬 Уровень: {} | Очки: {}/{} | Сознание: {:.1}% | Точность: {:.0}% | Защита: +{:.0}%",
            self.evolution_level,
            self.evolution_score,
            next_score,
            self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0,
            self.get_defense_bonus() * 100.0
        )
    }
    
    pub fn get_next_level_requirements(&self) -> (u32, u32) {
        let score = self.get_evolution_requirement();
        let memory = 50 + (self.evolution_level * 5);
        (score, memory)
    }
    
    pub fn get_debug_info(&self) -> String {
        format!(
            "Neuro: Lvl {} | Score {} | Consc {:.0}% | PredAcc {:.0}% | DefBonus {:.0}% | Patterns {} | Cooldown {}s | Attack streak {}",
            self.evolution_level,
            self.evolution_score,
            self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0,
            self.get_defense_bonus() * 100.0,
            self.learned_patterns.len(),
            self.cooldown,
            self.attack_counter
        )
    }
    
    pub fn threat_memory_len(&self) -> usize {
        self.threat_memory.len()
    }
    
    pub fn get_evolution_score(&self) -> u32 {
        self.evolution_score
    }
    
    pub fn load_from_state(&mut self, evolution: u32, consciousness: f64, score: u32) {
        self.evolution_level = evolution;
        self.system_consciousness = if consciousness > 1.0 {
            (consciousness / 100.0).min(1.0)
        } else {
            consciousness.min(1.0)
        };
        self.evolution_score = score;
        
        self.last_processed_time = 0;
        self.cooldown = 10;
        self.reaction_cooldown = 8;
        self.attack_counter = 0;
        
        self.update_bonuses();
    }
}

impl Default for NeuroEcosystem {
    fn default() -> Self {
        Self::new()
    }
}

pub fn create_neuro_ecosystem() -> NeuroEcosystem {
    NeuroEcosystem::new()
}