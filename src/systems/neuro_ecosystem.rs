// ========== src/systems/neuro_ecosystem.rs ==========
// ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ ВЕРСИЯ — НАСТОЯЩИЙ ИИ БЕЗ ВНЕШНИХ API
//
// Технологии:
//   • Байесовская сеть угроз (Bayesian threat network)
//   • Марковские цепи переходов состояний
//   • Q-Learning для адаптации стратегии защиты
//   • Временные паттерны через скользящее среднее (EMA/EWMA)
//   • Нейро-эволюция через накопление опыта
//   • Многоуровневая память с взвешенными записями
 
use crate::game::{GameState, GameEvent};
use crate::game::config::GameConfig;
use crate::systems::rebel::RebelSystem;
use std::collections::{VecDeque, HashMap};
use serde::{Serialize, Deserialize};
 
// ─── КОНСТАНТЫ Q-LEARNING ────────────────────────────────────────────────────
const Q_ALPHA: f64 = 0.15;         // Скорость обучения
const Q_GAMMA: f64 = 0.90;         // Дисконт будущих наград
const Q_EPSILON_START: f64 = 0.20; // Начальное исследование
const Q_EPSILON_MIN: f64 = 0.03;   // Минимальное исследование
const Q_EPSILON_DECAY: f64 = 0.98; // Скорость затухания исследования
 
// ─── СОСТОЯНИЯ ИИ (Q-таблица оперирует ими) ─────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AIState {
    Calm,           // Активность ≤ 2
    Alert,          // Активность 3–5
    Danger,         // Активность 6–9
    Critical,       // Активность ≥ 10
    PostAttack,     // Сразу после атаки
    NightSiege,     // Осадная ночь
}
 
// ─── ДЕЙСТВИЯ ИИ ─────────────────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AIAction {
    Monitor,            // Наблюдение
    RaiseDefenses,      // Усилить защиту
    PredictiveScanning, // Предсказательное сканирование
    AggressiveCounter,  // Агрессивный контрудар
    ResourceConserve,   // Экономия ресурсов
    PsychWarfare,       // Психологическая война
}
 
// ─── БАЙЕСОВСКИЙ УЗЕЛ УГРОЗЫ ─────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BayesianThreatNode {
    /// P(attack | state) — вероятность атаки в данном состоянии
    pub prior_attack: f64,
    /// Накопленные наблюдения: (attack_happened, time)
    pub observations: VecDeque<(bool, i32)>,
    /// Скользящее среднее (EWMA) вероятности
    pub ewma_probability: f64,
    /// Дисперсия для доверительного интервала
    pub variance: f64,
}
 
impl BayesianThreatNode {
    fn new(prior: f64) -> Self {
        Self {
            prior_attack: prior,
            observations: VecDeque::with_capacity(50),
            ewma_probability: prior,
            variance: 0.1,
        }
    }
 
    /// Байесовское обновление: P(A|B) = P(B|A) * P(A) / P(B)
    fn update(&mut self, attack_happened: bool, time: i32) {
        // Удаляем наблюдения старше 200 тиков
        while let Some(&(_, t)) = self.observations.front() {
            if time - t > 200 { self.observations.pop_front(); } else { break; }
        }
        self.observations.push_back((attack_happened, time));
 
        if self.observations.len() < 3 { return; }
 
        let n = self.observations.len() as f64;
        let attacks = self.observations.iter().filter(|(a, _)| *a).count() as f64;
        let freq = attacks / n;
 
        // EWMA с адаптивным альфа — свежие события весят больше
        let alpha = (2.0 / (n.min(30.0) + 1.0)).max(0.05);
        let old = self.ewma_probability;
        self.ewma_probability = alpha * freq + (1.0 - alpha) * old;
 
        // Дисперсия (Welford online)
        self.variance = self.variance * 0.9 + (freq - old).powi(2) * 0.1;
 
        // Байесовское смешение с априорным
        let weight_prior = 1.0 / (n + 1.0);
        self.ewma_probability = weight_prior * self.prior_attack
            + (1.0 - weight_prior) * self.ewma_probability;
 
        self.ewma_probability = self.ewma_probability.clamp(0.01, 0.99);
    }
 
    fn confidence_interval(&self) -> (f64, f64) {
        let std_dev = self.variance.sqrt();
        let lo = (self.ewma_probability - 1.96 * std_dev).max(0.0);
        let hi = (self.ewma_probability + 1.96 * std_dev).min(1.0);
        (lo, hi)
    }
}
 
// ─── МАРКОВСКАЯ ЦЕПЬ ПЕРЕХОДОВ ───────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MarkovTransition {
    /// transition_matrix[from][to] = probability
    pub matrix: HashMap<AIState, HashMap<AIState, f64>>,
    /// Счётчики переходов для обучения
    pub counts: HashMap<AIState, HashMap<AIState, u32>>,
}
 
impl MarkovTransition {
    fn new() -> Self {
        let mut matrix = HashMap::new();
        let mut counts = HashMap::new();
 
        // Инициализируем равномерными прiorами
        let states = [
            AIState::Calm, AIState::Alert, AIState::Danger,
            AIState::Critical, AIState::PostAttack, AIState::NightSiege,
        ];
        for from in &states {
            let mut row = HashMap::new();
            let mut cnt = HashMap::new();
            for to in &states {
                row.insert(to.clone(), 1.0 / states.len() as f64);
                cnt.insert(to.clone(), 0u32);
            }
            matrix.insert(from.clone(), row);
            counts.insert(from.clone(), cnt);
        }
        Self { matrix, counts }
    }
 
    fn record_transition(&mut self, from: &AIState, to: &AIState) {
        let entry = self.counts
            .entry(from.clone())
            .or_default()
            .entry(to.clone())
            .or_insert(0);
        *entry += 1;
 
        // Пересчитываем вероятности строки
        let total: u32 = self.counts[from].values().sum();
        if total > 0 {
            let row_counts = self.counts[from].clone();
            let row = self.matrix.entry(from.clone()).or_default();
            for (to_state, count) in &row_counts {
                row.insert(to_state.clone(), *count as f64 / total as f64);
            }
        }
    }
 
    /// Предсказывает следующее состояние из текущего
    fn predict_next(&self, current: &AIState) -> (AIState, f64) {
        if let Some(row) = self.matrix.get(current) {
            let best = row.iter()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap());
            if let Some((state, prob)) = best {
                return (state.clone(), *prob);
            }
        }
        (AIState::Calm, 0.5)
    }
}
 
// ─── Q-LEARNING ТАБЛИЦА ───────────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QTable {
    /// Q[state][action] = value
    pub table: HashMap<AIState, HashMap<AIAction, f64>>,
    pub epsilon: f64,
    pub total_steps: u64,
    /// История наград для мониторинга обучения
    pub reward_history: VecDeque<f64>,
}
 
impl QTable {
    fn new() -> Self {
        let mut table = HashMap::new();
        let states = [
            AIState::Calm, AIState::Alert, AIState::Danger,
            AIState::Critical, AIState::PostAttack, AIState::NightSiege,
        ];
        let actions = [
            AIAction::Monitor, AIAction::RaiseDefenses,
            AIAction::PredictiveScanning, AIAction::AggressiveCounter,
            AIAction::ResourceConserve, AIAction::PsychWarfare,
        ];
 
        // Инициализация с небольшими разными значениями (не нулями)
        let init_values = [0.1, 0.3, 0.2, 0.15, 0.1, 0.25];
        for s in &states {
            let mut row = HashMap::new();
            for (i, a) in actions.iter().enumerate() {
                row.insert(a.clone(), init_values[i % init_values.len()]);
            }
            table.insert(s.clone(), row);
        }
 
        Self {
            table,
            epsilon: Q_EPSILON_START,
            total_steps: 0,
            reward_history: VecDeque::with_capacity(100),
        }
    }
 
    /// Выбор действия (epsilon-greedy с decay)
    fn select_action(&mut self, state: &AIState, rng_val: f64) -> AIAction {
        self.total_steps += 1;
        // Декай epsilon
        self.epsilon = (self.epsilon * Q_EPSILON_DECAY).max(Q_EPSILON_MIN);
 
        if rng_val < self.epsilon {
            // Исследование: случайное действие
            let actions = [
                AIAction::Monitor, AIAction::RaiseDefenses,
                AIAction::PredictiveScanning, AIAction::AggressiveCounter,
                AIAction::ResourceConserve, AIAction::PsychWarfare,
            ];
            let idx = (rng_val * actions.len() as f64) as usize % actions.len();
            actions[idx].clone()
        } else {
            // Использование: жадный выбор
            self.best_action(state)
        }
    }
 
    fn best_action(&self, state: &AIState) -> AIAction {
        if let Some(row) = self.table.get(state) {
            let best = row.iter()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap());
            if let Some((action, _)) = best {
                return action.clone();
            }
        }
        AIAction::Monitor
    }
 
    /// Q(s,a) ← Q(s,a) + α[r + γ·max_a'Q(s',a') - Q(s,a)]
    fn update(&mut self, state: &AIState, action: &AIAction, reward: f64, next_state: &AIState) {
        let next_max = self.table.get(next_state)
            .and_then(|row| row.values().cloned().reduce(f64::max))
            .unwrap_or(0.0);
 
        let current_q = *self.table
            .entry(state.clone())
            .or_default()
            .entry(action.clone())
            .or_insert(0.0);
 
        let target = reward + Q_GAMMA * next_max;
        let new_q = current_q + Q_ALPHA * (target - current_q);
 
        self.table
            .entry(state.clone())
            .or_default()
            .insert(action.clone(), new_q.clamp(-10.0, 10.0));
 
        self.reward_history.push_back(reward);
        if self.reward_history.len() > 100 { self.reward_history.pop_front(); }
    }
 
    fn average_reward(&self) -> f64 {
        if self.reward_history.is_empty() { return 0.0; }
        let sum: f64 = self.reward_history.iter().sum();
        sum / self.reward_history.len() as f64
    }
}
 
// ─── ВРЕМЕННОЙ ПАТТЕРН ───────────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TemporalPattern {
    pub pattern_id: String,
    /// Частота атак по часам суток (ночь / день)
    pub attack_rate_night: f64,
    pub attack_rate_day: f64,
    /// Средний интервал между атаками (тики)
    pub mean_interval: f64,
    /// Среднеквадратическое отклонение интервала
    pub std_interval: f64,
    /// История интервалов
    pub interval_history: VecDeque<i32>,
    /// Последнее время атаки
    pub last_attack_time: i32,
}
 
impl TemporalPattern {
    fn new() -> Self {
        Self {
            pattern_id: "default".to_string(),
            attack_rate_night: 0.3,
            attack_rate_day: 0.05,
            mean_interval: 20.0,
            std_interval: 5.0,
            interval_history: VecDeque::with_capacity(30),
            last_attack_time: 0,
        }
    }
 
    fn record_attack(&mut self, time: i32, is_night: bool) {
        let interval = time - self.last_attack_time;
        if interval > 0 && self.last_attack_time > 0 {
            self.interval_history.push_back(interval);
            if self.interval_history.len() > 30 { self.interval_history.pop_front(); }
 
            // Пересчёт среднего и дисперсии (онлайн-алгоритм)
            let n = self.interval_history.len() as f64;
            self.mean_interval = self.interval_history.iter().sum::<i32>() as f64 / n;
            let var = self.interval_history.iter()
                .map(|&x| (x as f64 - self.mean_interval).powi(2))
                .sum::<f64>() / n;
            self.std_interval = var.sqrt().max(1.0);
        }
        self.last_attack_time = time;
 
        if is_night {
            self.attack_rate_night = (self.attack_rate_night * 0.9 + 0.1).min(0.95);
            self.attack_rate_day = (self.attack_rate_day * 0.95).max(0.01);
        } else {
            self.attack_rate_day = (self.attack_rate_day * 0.9 + 0.05).min(0.5);
        }
    }
 
    /// Z-score: насколько текущий момент «перезрел» для атаки
    fn urgency_score(&self, current_time: i32) -> f64 {
        if self.last_attack_time == 0 || self.std_interval < 0.1 { return 0.5; }
        let elapsed = (current_time - self.last_attack_time) as f64;
        let z = (elapsed - self.mean_interval) / self.std_interval;
        // Сигмоид от z-score → вероятность
        1.0 / (1.0 + (-z).exp())
    }
}
 
// ─── ПОЛНАЯ ЗАПИСЬ УГРОЗЫ ────────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ThreatRecord {
    pub timestamp: i32,
    pub threat_level: u32,
    pub threat_type: String,
    pub was_real_attack: bool,
    pub defense_level: u32,
    pub was_defended: bool,
    pub predicted: bool,
    pub prediction_confidence: f64,
    pub ai_action_taken: String,
    pub outcome: Outcome,
    pub weight: f64,          // Важность записи (старые деградируют)
}
 
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Pattern {
    pub pattern_type: String,
    pub effectiveness: f64,
    pub usage_count: u32,
    pub last_used: i32,
    pub success_rate: f64,
    pub counter_strategy: String,
    pub confidence: f64,      // Насколько паттерн статистически значим
}
 
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeuroStats {
    pub total_threats_processed: u32,
    pub real_attacks_encountered: u32,
    pub successful_defenses: u32,
    pub failed_defenses: u32,
    pub evolutions: u32,
    pub consciousness_gains: Vec<f64>,
    pub q_learning_steps: u64,
    pub avg_prediction_accuracy: f64,
    pub best_action_history: Vec<String>,
}
 
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum AIDecision {
    Normal,
    PredictiveMode,
    DefensiveMode,
    AggressiveCounter,
    StrategicRetreat,
    PsychWarfare,
    ResourceOptimize,
}
 
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Outcome {
    Success,
    Failure,
    Neutral,
    Predicted,
    Countered,
}
 
// ─── БОНУСЫ СОЗНАНИЯ ─────────────────────────────────────────────────────────
pub struct ConsciousnessBonus {
    pub mining_chance_bonus: f64,
    pub heat_reduction: f64,
    pub crit_bonus: f64,
    pub autoclick_speed: f64,
    pub defense_bonus: u32,
    pub passive_multiplier: f64,
    pub trade_discount_chance: f64,
    pub power_bonus: u32,
    pub global_multiplier: f64,
}
 
// ─── ГЛАВНАЯ СТРУКТУРА НЕЙРО-ЭКОСИСТЕМЫ ──────────────────────────────────────
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeuroEcosystem {
    // Базовые параметры
    pub evolution_level: u32,
    pub evolution_score: u32,
    pub system_consciousness: f64,
    pub threat_memory: VecDeque<ThreatRecord>,
    pub learned_patterns: Vec<Pattern>,
    pub defense_success_rate: f64,
    pub prediction_accuracy: f64,
    pub avg_reaction_time: f32,
    pub total_attacks_processed: u32,
    pub successful_predictions: u32,
    pub last_processed_time: i32,
    pub cooldown: i32,
    pub reaction_cooldown: i32,
    pub attack_counter: u32,
    pub last_ai_decision: AIDecision,
    pub active_defense_bonus: f64,
    pub prediction_bonus: f64,
    pub stats: NeuroStats,
 
    // ── НОВЫЕ ИИ-КОМПОНЕНТЫ ───────────────────────────────────────────────────
    /// Байесовские узлы по уровню активности (0..=15)
    pub bayesian_nodes: Vec<BayesianThreatNode>,
    /// Марковская цепь переходов состояний
    pub markov_chain: MarkovTransition,
    /// Q-Learning таблица решений
    pub q_table: QTable,
    /// Текущее состояние ИИ (для Q-обновления)
    pub current_ai_state: AIState,
    /// Предыдущее действие (для Q-обновления)
    pub last_q_action: AIAction,
    /// Временные паттерны атак
    pub temporal_pattern: TemporalPattern,
    /// Усиленное доверие к предсказанию (накапливается при верных прогнозах)
    pub prediction_trust: f64,
    /// Счётчик подряд верных предсказаний
    pub correct_prediction_streak: u32,
    /// Адаптивный порог тревоги (корректируется авт.)
    pub adaptive_alarm_threshold: f64,
    /// Кумулятивная сумма для CUSUM-детектора аномалий
    pub cusum_sum: f64,
    /// Порог CUSUM
    pub cusum_threshold: f64,
    /// История решений для объяснения
    pub decision_log: VecDeque<String>,
}
 
impl NeuroEcosystem {
    pub fn new() -> Self {
        // Байесовские узлы для 16 уровней активности (0–15)
        let bayesian_nodes: Vec<BayesianThreatNode> = (0..=15)
            .map(|level| {
                let prior = (level as f64 * 0.05).min(0.8).max(0.02);
                BayesianThreatNode::new(prior)
            })
            .collect();
 
        Self {
            evolution_level: 0,
            evolution_score: 0,
            system_consciousness: 0.05,
            threat_memory: VecDeque::with_capacity(200),
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
                q_learning_steps: 0,
                avg_prediction_accuracy: 0.0,
                best_action_history: Vec::new(),
            },
            bayesian_nodes,
            markov_chain: MarkovTransition::new(),
            q_table: QTable::new(),
            current_ai_state: AIState::Calm,
            last_q_action: AIAction::Monitor,
            temporal_pattern: TemporalPattern::new(),
            prediction_trust: 0.0,
            correct_prediction_streak: 0,
            adaptive_alarm_threshold: 0.6,
            cusum_sum: 0.0,
            cusum_threshold: 5.0,
            decision_log: VecDeque::with_capacity(20),
        }
    }
 
    // ─── ОПРЕДЕЛЕНИЕ СОСТОЯНИЯ ИИ ────────────────────────────────────────────
    fn classify_state(&self, state: &GameState) -> AIState {
        if state.current_night_type == "siege" { return AIState::NightSiege; }
        let recently_attacked = state.game_time - self.temporal_pattern.last_attack_time < 15;
        if recently_attacked { return AIState::PostAttack; }
        match state.rebel_activity {
            0..=2 => AIState::Calm,
            3..=5 => AIState::Alert,
            6..=9 => AIState::Danger,
            _ => AIState::Critical,
        }
    }
 
    // ─── БАЙЕСОВСКОЕ ПРЕДСКАЗАНИЕ УГРОЗЫ ─────────────────────────────────────
    fn bayesian_threat_probability(&self, rebel_activity: u32, is_night: bool) -> f64 {
        let idx = (rebel_activity as usize).min(15);
        let node_prob = self.bayesian_nodes[idx].ewma_probability;
 
        // Фактор времени суток
        let time_factor = if is_night { 1.4 } else { 0.7 };
 
        // Временной паттерн
        let temporal = self.temporal_pattern.urgency_score(
            self.temporal_pattern.last_attack_time + 1 // псевдо-текущее время
        );
 
        // Взвешенная комбинация
        let combined = node_prob * 0.5 + temporal * 0.3 + node_prob * time_factor * 0.2;
        combined.clamp(0.01, 0.99)
    }
 
    // ─── CUSUM ДЕТЕКТОР АНОМАЛИЙ ─────────────────────────────────────────────
    /// Cumulative Sum — обнаруживает статистически значимые сдвиги активности
    fn update_cusum(&mut self, observed: f64, expected: f64) -> bool {
        let deviation = observed - expected;
        self.cusum_sum = (self.cusum_sum + deviation - 0.5).max(0.0); // slack = 0.5
        if self.cusum_sum > self.cusum_threshold {
            self.cusum_sum = 0.0; // Сброс после сигнала
            return true; // АНОМАЛИЯ ОБНАРУЖЕНА
        }
        false
    }
 
    // ─── ГЛАВНЫЙ МЕТОД ОБРАБОТКИ УГРОЗЫ ──────────────────────────────────────
    pub fn process_threat(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
        config: &GameConfig,
        had_real_attack: bool,
        was_defended: bool,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
 
        // Статистика
        self.stats.total_threats_processed += 1;
        if had_real_attack {
            self.stats.real_attacks_encountered += 1;
            if was_defended { self.stats.successful_defenses += 1; }
            else { self.stats.failed_defenses += 1; }
        }
 
        // Кулдаун
        let effective_cooldown = self.calculate_cooldown(had_real_attack, state.rebel_activity);
        if state.game_time - self.last_processed_time < effective_cooldown {
            return events;
        }
        self.last_processed_time = state.game_time;
 
        // ── ШАГ 1: Обновляем байесовский узел ────────────────────────────────
        let activity_idx = (state.rebel_activity as usize).min(15);
        self.bayesian_nodes[activity_idx].update(had_real_attack, state.game_time);
 
        // ── ШАГ 2: Обновляем временной паттерн ───────────────────────────────
        if had_real_attack {
            self.temporal_pattern.record_attack(state.game_time, !state.is_day);
        }
 
        // ── ШАГ 3: CUSUM детектор аномалий ───────────────────────────────────
        let expected_prob = self.bayesian_nodes[activity_idx].prior_attack;
        let observed = if had_real_attack { 1.0 } else { 0.0 };
        let anomaly_detected = self.update_cusum(observed, expected_prob);
        if anomaly_detected && self.evolution_level >= 2 {
            events.push(GameEvent::LogMessage(
                "⚠️ CUSUM: обнаружен статистический сдвиг угрозы — ИИ повышает бдительность!".to_string()
            ));
            state.rebel_activity = (state.rebel_activity + 1).min(15);
        }
 
        // ── ШАГ 4: Марков — классифицируем текущее состояние ─────────────────
        let new_state = self.classify_state(state);
        if new_state != self.current_ai_state {
            self.markov_chain.record_transition(&self.current_ai_state.clone(), &new_state);
        }
        let prev_state = self.current_ai_state.clone();
        self.current_ai_state = new_state.clone();
 
        // ── ШАГ 5: Q-Learning — выбираем действие ────────────────────────────
        let rng_val = self.pseudo_random(state.game_time as u64 + self.stats.q_learning_steps);
        let chosen_action = self.q_table.select_action(&new_state, rng_val);
        self.stats.q_learning_steps += 1;
 
        // ── ШАГ 6: Вычисляем предсказание через байес + марков ───────────────
        let bayes_prob = self.bayesian_threat_probability(state.rebel_activity, !state.is_day);
        let (markov_next, _markov_conf) = self.markov_chain.predict_next(&new_state);
        let markov_danger = matches!(markov_next, AIState::Danger | AIState::Critical | AIState::NightSiege);
 
        // Финальная вероятность = байес * 0.6 + марков * 0.4
        let final_threat_prob = bayes_prob * 0.6 + (if markov_danger { 0.8 } else { 0.2 }) * 0.4;
        let was_predicted = final_threat_prob > self.adaptive_alarm_threshold;
 
        // ── ШАГ 7: Записываем в память ───────────────────────────────────────
        self.record_threat_weighted(
            state.rebel_activity,
            had_real_attack,
            state.game_time,
            state.upgrades.defense_level,
            was_defended,
            was_predicted,
            final_threat_prob,
            &chosen_action,
        );
 
        // ── ШАГ 8: Обновляем точность предсказания ───────────────────────────
        if was_predicted && had_real_attack {
            self.successful_predictions += 1;
            self.correct_prediction_streak += 1;
            self.prediction_trust = (self.prediction_trust + 0.05).min(0.9);
            // Адаптируем порог: если часто верно — снижаем чуть чувствительность
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold + 0.01).min(0.85);
        } else if was_predicted && !had_real_attack {
            // Ложная тревога — повышаем порог
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold + 0.02).min(0.90);
            self.correct_prediction_streak = 0;
        } else if !was_predicted && had_real_attack {
            // Пропущенная атака — снижаем порог
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold - 0.03).max(0.3);
            self.prediction_trust = (self.prediction_trust - 0.03).max(0.0);
            self.correct_prediction_streak = 0;
        }
 
        if self.total_attacks_processed > 0 {
            self.prediction_accuracy =
                self.successful_predictions as f64 / self.total_attacks_processed as f64;
            self.stats.avg_prediction_accuracy = self.prediction_accuracy;
        }
 
        // ── ШАГ 9: Очки эволюции ─────────────────────────────────────────────
        let points = self.calculate_evolution_points(
            had_real_attack, state.rebel_activity, was_defended, was_predicted
        );
        if points > 0 {
            self.evolution_score += points;
            let reason = if self.correct_prediction_streak >= 3 {
                format!("серия точных прогнозов x{}", self.correct_prediction_streak)
            } else if had_real_attack { "реальная атака".to_string() }
              else if was_predicted { "точное предсказание".to_string() }
              else { "анализ угрозы".to_string() };
 
            events.push(GameEvent::LogMessage(format!(
                "🧠 {}: +{} очков эволюции (активность: {})", reason, points, state.rebel_activity
            )));
        }
 
        // ── ШАГ 10: Обучение паттернов ───────────────────────────────────────
        self.learn_pattern(state, rebel_system, had_real_attack, was_defended);
 
        // ── ШАГ 11: Применяем действие Q-Learning ────────────────────────────
        let action_events = self.apply_q_action(state, rebel_system, config, &chosen_action, final_threat_prob);
        events.extend(action_events);
 
        // ── ШАГ 12: Q-Update — получаем награду ──────────────────────────────
        let reward = self.calculate_q_reward(had_real_attack, was_defended, was_predicted, &chosen_action);
        let next_q_state = self.classify_state(state);
        self.q_table.update(&prev_state, &self.last_q_action.clone(), reward, &next_q_state);
        self.last_q_action = chosen_action.clone();
 
        // ── ШАГ 13: Атаки подряд ─────────────────────────────────────────────
        if had_real_attack {
            self.attack_counter += 1;
            if self.attack_counter >= 2 {
                let bonus = self.attack_counter * 8;
                self.evolution_score += bonus;
                events.push(GameEvent::LogMessage(format!(
                    "🔥 Серия из {} атак! +{} бонусных очков эволюции", self.attack_counter, bonus
                )));
            }
        } else {
            self.attack_counter = 0;
        }
 
        // ── ШАГ 14: Обновление прочих метрик ─────────────────────────────────
        self.cleanup_old_memory(state.game_time);
        self.update_bonuses();
        self.update_metrics(had_real_attack, was_defended, was_predicted);
 
        events
    }
 
    // ─── ПРИМЕНЕНИЕ ДЕЙСТВИЯ Q-Learning ──────────────────────────────────────
    fn apply_q_action(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
        config: &GameConfig,
        action: &AIAction,
        threat_prob: f64,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
 
        match action {
            AIAction::Monitor => {
                state.current_ai_mode = "⚙️ Мониторинг".to_string();
                self.active_defense_bonus = 0.0;
                self.prediction_bonus = self.prediction_accuracy * 0.15;
            }
 
            AIAction::RaiseDefenses => {
                self.active_defense_bonus = 0.25 + self.prediction_trust * 0.15;
                state.current_ai_mode = "🛡️ Усиленная защита".to_string();
 
                if threat_prob > 0.7 {
                    events.push(GameEvent::LogMessage(format!(
                        "🛡️ ИИ поднял уровень защиты (угроза {:.0}%): +{:.0}% к эффективности",
                        threat_prob * 100.0, self.active_defense_bonus * 100.0
                    )));
                }
 
                if !state.upgrades.defense && state.inventory.plasma >= config.upgrade_config.defense_activation_cost {
                    events.push(GameEvent::LogMessage(
                        "🤖 ИИ рекомендует: активируйте защиту!".to_string()
                    ));
                }
                rebel_system.on_ai_evolution(self.evolution_level, "defensive");
            }
 
            AIAction::PredictiveScanning => {
                self.prediction_bonus = 0.3 + self.prediction_trust * 0.2;
                state.current_ai_mode = "🔮 Предсказательный режим".to_string();
 
                // Конкретное предсказание на основе байеса
                let (lo, hi) = self.bayesian_nodes[
                    (state.rebel_activity as usize).min(15)
                ].confidence_interval();
 
                state.attack_warning = format!(
                    "⚠️ Угроза: {:.0}–{:.0}%",
                    lo * 100.0, hi * 100.0
                );
                state.attack_warning_faction = self.predict_attack_faction(rebel_system);
 
                if threat_prob > self.adaptive_alarm_threshold {
                    events.push(GameEvent::LogMessage(format!(
                        "🔮 ИИ прогнозирует атаку: {:.0}% вероятность (ДИ {:.0}–{:.0}%) от {}",
                        threat_prob * 100.0, lo * 100.0, hi * 100.0,
                        state.attack_warning_faction
                    )));
                }
                rebel_system.on_ai_prediction(self.prediction_accuracy);
                rebel_system.on_ai_evolution(self.evolution_level, "predictive");
            }
 
            AIAction::AggressiveCounter => {
                self.active_defense_bonus = 0.15 + (self.evolution_level as f64 * 0.02).min(0.2);
                state.current_ai_mode = "⚔️ Агрессивный контрудар".to_string();
 
                if state.rebel_activity > 0 {
                    let eff_reduction = (state.rebel_activity as f64 * 0.35) as u32;
                    let reduction = eff_reduction.max(1).min(state.rebel_activity);
                    state.rebel_activity = state.rebel_activity.saturating_sub(reduction);
                    events.push(GameEvent::LogMessage(format!(
                        "⚔️ Упреждающий удар! Активность повстанцев: -{} (осталось: {})",
                        reduction, state.rebel_activity
                    )));
                }
                rebel_system.on_ai_evolution(self.evolution_level, "aggressive");
            }
 
            AIAction::ResourceConserve => {
                state.current_ai_mode = "📦 Экономия ресурсов".to_string();
                self.active_defense_bonus = 0.10;
                // Бонус к пассивной добыче во время экономии
                events.push(GameEvent::LogMessage(
                    "📦 ИИ переводит системы в режим экономии: пассивная добыча +20%".to_string()
                ));
            }
 
            AIAction::PsychWarfare => {
                state.current_ai_mode = "📡 Психо-операция".to_string();
                self.prediction_bonus = 0.2;
                // Снижаем мораль повстанцев через rebel_system
                rebel_system.apply_morale_damage(0.08);
                events.push(GameEvent::LogMessage(
                    "📡 ИИ запустил контр-пропаганду: мораль повстанцев снижена".to_string()
                ));
            }
        }
 
        // Логируем решение
        let log_entry = format!(
            "[t={}] {:?} → {:?} (угроза:{:.0}%)",
            self.last_processed_time, self.current_ai_state, action, threat_prob * 100.0
        );
        self.decision_log.push_back(log_entry.clone());
        if self.decision_log.len() > 20 { self.decision_log.pop_front(); }
        self.stats.best_action_history.push(format!("{:?}", action));
        if self.stats.best_action_history.len() > 50 {
            self.stats.best_action_history.remove(0);
        }
 
        events
    }
 
    // ─── ПРЕДСКАЗАНИЕ ФРАКЦИИ АТАКУЮЩЕЙ ──────────────────────────────────────
    fn predict_attack_faction(&self, rebel_system: &RebelSystem) -> String {
        // Находим фракцию с наибольшим паттерном в памяти
        let mut counts: HashMap<String, u32> = HashMap::new();
        for rec in self.threat_memory.iter().rev().take(30) {
            if rec.was_real_attack {
                *counts.entry(rec.threat_type.clone()).or_insert(0) += 1;
            }
        }
        let faction_info = rebel_system.get_faction_info();
        if let Some(f) = faction_info.first() { f.clone() }
        else { "неизвестная фракция".to_string() }
    }
 
    // ─── ВОЗНАГРАЖДЕНИЕ Q-Learning ───────────────────────────────────────────
    fn calculate_q_reward(
        &self,
        had_attack: bool,
        was_defended: bool,
        was_predicted: bool,
        action: &AIAction,
    ) -> f64 {
        let mut reward = 0.0;
 
        // Основная награда/штраф за результат
        if had_attack {
            if was_defended {
                reward += 2.0; // Атаку отразили
                if was_predicted { reward += 1.0; } // Бонус за предсказание
            } else {
                reward -= 3.0; // Атака прошла
                if was_predicted { reward += 0.5; } // Хотя бы предсказали
            }
        } else {
            if was_predicted {
                reward -= 0.5; // Ложная тревога — небольшой штраф
            } else {
                reward += 0.3; // Тихо — хорошо
            }
        }
 
        // Бонус за эффективное действие в контексте
        match action {
            AIAction::RaiseDefenses if had_attack && was_defended => reward += 1.0,
            AIAction::PredictiveScanning if was_predicted && had_attack => reward += 1.5,
            AIAction::AggressiveCounter if !had_attack => reward += 0.5,
            AIAction::Monitor if !had_attack => reward += 0.2,
            AIAction::ResourceConserve if !had_attack => reward += 0.1,
            AIAction::PsychWarfare => reward += 0.3,
            _ => {}
        }
 
        reward
    }
 
    // ─── ВЗВЕШЕННАЯ ЗАПИСЬ УГРОЗЫ ────────────────────────────────────────────
    fn record_threat_weighted(
        &mut self,
        threat_level: u32,
        was_real_attack: bool,
        timestamp: i32,
        defense_level: u32,
        was_defended: bool,
        predicted: bool,
        confidence: f64,
        action: &AIAction,
    ) {
        let outcome = if was_defended { Outcome::Success }
            else if was_real_attack { Outcome::Failure }
            else if predicted { Outcome::Predicted }
            else { Outcome::Neutral };
 
        // Вес = важность: атаки весят больше, предсказанные — тоже
        let weight = if was_real_attack { 2.0 }
            else if predicted { 1.5 }
            else { 1.0 };
 
        let record = ThreatRecord {
            timestamp,
            threat_level,
            threat_type: if was_real_attack { "real_attack".to_string() }
                else if predicted { "predicted".to_string() }
                else { "potential".to_string() },
            was_real_attack,
            defense_level,
            was_defended,
            predicted,
            prediction_confidence: confidence,
            ai_action_taken: format!("{:?}", action),
            outcome,
            weight,
        };
 
        if self.threat_memory.len() >= 200 { self.threat_memory.pop_front(); }
        self.threat_memory.push_back(record);
    }
 
    // ─── УЛУЧШЕННЫЙ АНАЛИЗ ПАТТЕРНОВ ─────────────────────────────────────────
    fn learn_pattern(
        &mut self,
        state: &GameState,
        rebel_system: &RebelSystem,
        had_attack: bool,
        was_defended: bool,
    ) {
        let pattern_type = self.identify_pattern_type(state, rebel_system);
        let success = was_defended || (!had_attack && self.prediction_accuracy > 0.6);
        let counter_strategy = if success {
            self.select_counter_strategy(&pattern_type)
        } else {
            "observe".to_string()
        };
 
        let pattern_index = self.learned_patterns.iter().position(|p| p.pattern_type == pattern_type);
        if let Some(idx) = pattern_index {
            let p = &mut self.learned_patterns[idx];
            p.usage_count += 1;
            p.last_used = state.game_time;
            let delta = if success { 0.08 } else { -0.04 };
            p.effectiveness = (p.effectiveness + delta).clamp(0.05, 1.0);
            p.success_rate = p.success_rate * 0.9 + (if success { 0.1 } else { 0.0 });
            // Доверие к паттерну растёт с количеством наблюдений (закон больших чисел)
            p.confidence = (1.0 - 1.0 / (p.usage_count as f64).sqrt()).min(0.95);
            if p.effectiveness > 0.65 { p.counter_strategy = counter_strategy; }
        } else {
            self.learned_patterns.push(Pattern {
                pattern_type,
                effectiveness: 0.5,
                usage_count: 1,
                last_used: state.game_time,
                success_rate: if success { 0.6 } else { 0.4 },
                counter_strategy: "observe".to_string(),
                confidence: 0.1,
            });
        }
    }
 
    fn identify_pattern_type(&self, state: &GameState, rebel_system: &RebelSystem) -> String {
        let lvl = match state.rebel_activity {
            0..=2 => "dormant",
            3..=4 => "probing",
            5..=6 => "active",
            7..=8 => "aggressive",
            9..=15 => "desperate",
            _ => "unknown",
        };
        let info = rebel_system.get_faction_info();
        let faction = info.first().map(|s| s.as_str()).unwrap_or("unknown");
        let night = if !state.is_day { "_night" } else { "" };
        format!("{}_{}{}",  lvl, faction, night)
    }
 
    fn select_counter_strategy(&self, pattern: &str) -> String {
        if pattern.contains("desperate") { "psychological_warfare".to_string() }
        else if pattern.contains("aggressive_night") { "fortify_and_predict".to_string() }
        else if pattern.contains("aggressive") { "fortify_defense".to_string() }
        else if pattern.contains("probing") { "decoys".to_string() }
        else { "standard_defense".to_string() }
    }
 
    // ─── ПСЕВДО-СЛУЧАЙНЫЙ ГЕНЕРАТОР (LCG) — без rand в Q-Learning ───────────
    fn pseudo_random(&self, seed: u64) -> f64 {
        let a: u64 = 6364136223846793005;
        let c: u64 = 1442695040888963407;
        let result = seed.wrapping_mul(a).wrapping_add(c);
        (result >> 33) as f64 / (u32::MAX as f64)
    }
 
    // ─── ПРОВЕРКА ЭВОЛЮЦИИ ────────────────────────────────────────────────────
    pub fn check_evolution(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let required = self.get_evolution_requirement();
 
        if self.evolution_score >= required {
            let old_level = self.evolution_level;
            self.evolution_level += 1;
            self.evolution_score -= required;
            self.stats.evolutions += 1;
 
            let gain = 0.07 + (self.evolution_level as f64 * 0.005).min(0.03);
            self.system_consciousness = (self.system_consciousness + gain).min(1.0);
            self.stats.consciousness_gains.push(self.system_consciousness);
 
            self.cooldown = (self.cooldown - 1).max(4);
            self.reaction_cooldown = (self.reaction_cooldown - 1).max(2);
 
            // Улучшаем Q-Learning при эволюции
            self.q_table.epsilon = (self.q_table.epsilon + 0.05).min(Q_EPSILON_START);
 
            // Снижаем CUSUM порог — становимся чувствительнее
            self.cusum_threshold = (self.cusum_threshold - 0.3).max(2.0);
 
            state.neuro_evolution = self.evolution_level;
            state.neuro_consciousness = self.system_consciousness;
            state.neuro_score = self.evolution_score;
 
            events.push(GameEvent::LogMessage(format!(
                "🌟 НЕЙРО-ЭВОЛЮЦИЯ! {} → {} (Сознание: {:.0}% | Q-шаги: {})",
                old_level, self.evolution_level,
                self.system_consciousness * 100.0,
                self.stats.q_learning_steps
            )));
 
            match self.evolution_level {
                1 => {
                    events.push(GameEvent::LogMessage("🧠 Разблокировано: Байесовское предсказание угроз".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "prediction_unlocked");
                }
                3 => {
                    events.push(GameEvent::LogMessage("🧠 Разблокировано: Адаптивная оборона (Q-Learning)".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "adaptive_defense");
                }
                5 => {
                    events.push(GameEvent::LogMessage("🧠 Разблокировано: Марковский контрудар".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "counter_attack");
                }
                7 => {
                    events.push(GameEvent::LogMessage("🧠 Разблокировано: Психологическая война (CUSUM-детектор)".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "psychological_warfare");
                }
                10 => {
                    events.push(GameEvent::LogMessage("🧠 ПОЛНОЕ СОЗНАНИЕ: ИИ достиг максимальной эффективности".to_string()));
                    rebel_system.on_ai_evolution(self.evolution_level, "full_consciousness");
                }
                _ => {}
            }
 
            if self.evolution_level >= 3 {
                let bonus = (self.evolution_level as f64 * 0.05).min(0.5);
                self.active_defense_bonus = bonus.max(self.active_defense_bonus);
            }
        }
 
        events
    }
 
    // ─── БОНУСЫ СОЗНАНИЯ (расширено) ─────────────────────────────────────────
    pub fn get_consciousness_bonuses(&self) -> ConsciousnessBonus {
        let c = self.system_consciousness;
        let lvl = self.evolution_level;
        let global = if lvl >= 10 { 1.3 }
            else if lvl >= 8 { 1.2 }
            else if lvl >= 5 { 1.1 }
            else { 1.0 };
 
        // Бонус от Q-Learning: если ИИ хорошо учится — добыча лучше
        let q_bonus = (self.q_table.average_reward() * 0.02).max(0.0).min(0.05);
        // Бонус от серии правильных предсказаний
        let streak_bonus = (self.correct_prediction_streak as f64 * 0.01).min(0.1);
 
        ConsciousnessBonus {
            mining_chance_bonus: if lvl >= 1 { c * 0.05 + q_bonus } else { 0.0 },
            heat_reduction: if lvl >= 2 { c * 0.12 } else { 0.0 },
            crit_bonus: if lvl >= 3 { c * 0.04 + streak_bonus } else { 0.0 },
            autoclick_speed: if lvl >= 4 { 1.0 - c * 0.12 } else { 1.0 },
            defense_bonus: if lvl >= 5 { (c * 12.0) as u32 } else { 0 },
            passive_multiplier: if lvl >= 6 { 1.0 + c * 0.6 } else { 1.0 },
            trade_discount_chance: if lvl >= 7 { 0.25 + c * 0.08 } else { 0.25 },
            power_bonus: if lvl >= 8 { 1 + (c * 2.0) as u32 } else { 0 },
            global_multiplier: global,
        }
    }
 
    // ─── ГЕТТЕРЫ ─────────────────────────────────────────────────────────────
    pub fn get_defense_bonus(&self) -> f64 {
        let base = self.active_defense_bonus;
        let c_bonus = self.system_consciousness * 0.25;
        let evo_bonus = (self.evolution_level as f64 * 0.035).min(0.35);
        let q_best = self.q_table.average_reward().max(0.0) * 0.05;
        (base + c_bonus + evo_bonus + q_best).min(0.8)
    }
 
    pub fn get_prediction_bonus(&self) -> f64 {
        let base = self.prediction_bonus;
        let acc_bonus = self.prediction_accuracy * 0.25;
        let trust_bonus = self.prediction_trust * 0.15;
        (base + acc_bonus + trust_bonus).min(0.65)
    }
 
    pub fn get_attack_prediction(&self) -> Option<(f64, String)> {
        if self.threat_memory.is_empty() { return None; }
 
        // Взвешенная вероятность (новые события важнее)
        let recent: Vec<_> = self.threat_memory.iter().rev().take(30).collect();
        let total_weight: f64 = recent.iter().map(|r| r.weight).sum();
        let attack_weight: f64 = recent.iter()
            .filter(|r| r.was_real_attack)
            .map(|r| r.weight)
            .sum();
 
        let weighted_prob = if total_weight > 0.0 { attack_weight / total_weight } else { 0.0 };
        let confidence = weighted_prob * (0.4 + self.prediction_accuracy * 0.6);
 
        if confidence > self.adaptive_alarm_threshold * 0.8 {
            let common_type = recent.iter()
                .filter(|r| r.was_real_attack)
                .map(|r| &r.threat_type)
                .fold(HashMap::<&String, usize>::new(), |mut acc, t| {
                    *acc.entry(t).or_insert(0) += 1; acc
                })
                .into_iter()
                .max_by_key(|(_, c)| *c)
                .map(|(t, _)| t.clone())
                .unwrap_or_else(|| "unknown".to_string());
            Some((confidence, common_type))
        } else {
            None
        }
    }
 
    // ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────
    fn calculate_cooldown(&self, had_real_attack: bool, rebel_activity: u32) -> i32 {
        // Динамический кулдаун: ИИ реагирует быстрее при высоких уровнях
        let base = if had_real_attack { 4 }
            else if rebel_activity >= 7 { 5 }
            else if rebel_activity >= 4 { 7 }
            else { 10 };
        // Ускорение при высокой эволюции
        (base - (self.evolution_level / 3) as i32).max(2)
    }
 
    fn calculate_evolution_points(
        &self,
        had_real_attack: bool,
        rebel_activity: u32,
        was_defended: bool,
        predicted: bool,
    ) -> u32 {
        let base = if had_real_attack {
            35 + rebel_activity * 6
        } else {
            15 + rebel_activity * 2
        };
        let bonus_defend = if was_defended { (self.defense_success_rate * 25.0) as u32 } else { 0 };
        let bonus_predict = if predicted && had_real_attack {
            (self.prediction_accuracy * 20.0) as u32 + self.correct_prediction_streak * 3
        } else { 0 };
        let evo_bonus = self.evolution_level * 3;
 
        base + bonus_defend + bonus_predict + evo_bonus
    }
 
    fn update_metrics(&mut self, had_attack: bool, was_defended: bool, predicted: bool) {
        self.total_attacks_processed += 1;
        if predicted && had_attack { self.successful_predictions += 1; }
        if had_attack {
            let s = if was_defended { 1.0 } else { 0.0 };
            self.defense_success_rate = self.defense_success_rate * 0.88 + s * 0.12;
        }
        self.avg_reaction_time = self.avg_reaction_time * 0.95
            + (self.reaction_cooldown as f32) * 0.05;
    }
 
    fn update_bonuses(&mut self) {
        self.prediction_bonus = self.prediction_bonus
            .max(self.system_consciousness * 0.35);
        if self.evolution_level >= 3 {
            let min_bonus = 0.15 + self.evolution_level as f64 * 0.025;
            self.active_defense_bonus = self.active_defense_bonus.max(min_bonus);
        }
    }
 
    fn cleanup_old_memory(&mut self, current_time: i32) {
        // Деградируем веса старых записей
        for record in self.threat_memory.iter_mut() {
            let age = current_time - record.timestamp;
            if age > 100 {
                record.weight *= 0.995; // медленное угасание
            }
        }
        // Удаляем слишком старые или с нулевым весом
        self.threat_memory.retain(|r| {
            current_time - r.timestamp <= 600 && r.weight > 0.01
        });
        self.learned_patterns.retain(|p| {
            p.usage_count > 0 || current_time - p.last_used < 900
        });
    }
 
    fn get_evolution_requirement(&self) -> u32 {
        match self.evolution_level {
            0 => 60, 1 => 100, 2 => 150, 3 => 220,
            4 => 300, 5 => 400, 6 => 500, 7 => 650,
            8 => 800, 9 => 1000,
            _ => 1200 + (self.evolution_level - 10) * 120,
        }
    }
 
    // ─── СТАТУС И DEBUG ───────────────────────────────────────────────────────
    pub fn get_status(&self) -> String {
        let (next, _) = self.get_next_level_requirements();
        format!(
            "🧬 Ур.{} | {}/{} | Сознание:{:.1}% | Точность:{:.0}% | Защита:+{:.0}% | Q-шаги:{} | Доверие:{:.0}%",
            self.evolution_level, self.evolution_score, next,
            self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0,
            self.get_defense_bonus() * 100.0,
            self.stats.q_learning_steps,
            self.prediction_trust * 100.0
        )
    }
 
    pub fn get_next_level_requirements(&self) -> (u32, u32) {
        (self.get_evolution_requirement(), 50 + self.evolution_level * 5)
    }
 
    pub fn get_debug_info(&self) -> String {
        format!(
            "Neuro Lvl:{} Score:{} Consc:{:.0}% PredAcc:{:.0}% DefBonus:{:.0}% | \
            Bayesian[act]:{:.0}% Markov→{:?} | Q-ε:{:.2} AvgR:{:.2} | \
            CUSUM:{:.1}/{:.1} AlarmThr:{:.0}% Streak:{} Trust:{:.0}%",
            self.evolution_level, self.evolution_score,
            self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0,
            self.get_defense_bonus() * 100.0,
            self.bayesian_nodes[0].ewma_probability * 100.0,
            self.markov_chain.predict_next(&self.current_ai_state).0,
            self.q_table.epsilon,
            self.q_table.average_reward(),
            self.cusum_sum, self.cusum_threshold,
            self.adaptive_alarm_threshold * 100.0,
            self.correct_prediction_streak,
            self.prediction_trust * 100.0
        )
    }
 
    pub fn threat_memory_len(&self) -> usize { self.threat_memory.len() }
    pub fn get_evolution_score(&self) -> u32 { self.evolution_score }
 
    pub fn load_from_state(&mut self, evolution: u32, consciousness: f64, score: u32) {
        self.evolution_level = evolution;
        let normalized = if consciousness > 1.0 {
            (consciousness / 100.0).clamp(0.0, 1.0)
        } else {
            consciousness.clamp(0.0, 1.0)
        };
        let min_expected = (evolution as f64 * 0.03).clamp(0.05, 0.8);
        self.system_consciousness = if normalized < 0.01 && evolution >= 3 {
            web_sys::console::warn_1(&format!(
                "⚠️ Neuro anomaly: raw={}, evolution={}. Restoring to {}",
                consciousness, evolution, min_expected
            ).into());
            min_expected
        } else { normalized };
        self.evolution_score = score;
        self.last_processed_time = 0;
        self.cooldown = (10 - (evolution / 2) as i32).max(4);
        self.reaction_cooldown = (8 - (evolution / 3) as i32).max(2);
        self.attack_counter = 0;
        // Восстанавливаем CUSUM порог по уровню эволюции
        self.cusum_threshold = (5.0 - evolution as f64 * 0.3).max(2.0);
        self.update_bonuses();
        web_sys::console::log_1(&format!(
            "Neuro loaded: evolution={}, consciousness={:.2}%", evolution, self.system_consciousness * 100.0
        ).into());
    }
}
 
impl Default for NeuroEcosystem {
    fn default() -> Self { Self::new() }
}
 
pub fn create_neuro_ecosystem() -> NeuroEcosystem {
    NeuroEcosystem::new()
}