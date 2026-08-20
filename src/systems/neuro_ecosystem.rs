use crate::game::config::GameConfig;
use crate::game::{GameEvent, GameState};
use crate::systems::rebel::RebelSystem;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

const Q_ALPHA: f64 = 0.15;
const Q_GAMMA: f64 = 0.90;
const Q_EPSILON_START: f64 = 0.20;
const Q_EPSILON_MIN: f64 = 0.03;
const Q_EPSILON_DECAY: f64 = 0.98;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AIState {
    Calm,
    Alert,
    Danger,
    Critical,
    PostAttack,
    NightSiege,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AIAction {
    Monitor,
    RaiseDefenses,
    PredictiveScanning,
    AggressiveCounter,
    ResourceConserve,
    PsychWarfare,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct InterceptedMessage {
    pub content: String,
    pub target_hint: String,
    pub eta_ticks: i32,
    pub intercepted_at: i64,
    pub reliability: f64,
    pub is_read: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct CommanderProfile {
    pub faction_id: String,
    pub attacks_observed: u32,
    pub quiet_nights_before_attack: VecDeque<u32>,
    pub predicted_quiet_threshold: u32,
    pub signature_revealed: bool,
    pub times_frustrated: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BayesianThreatNode {
    pub prior_attack: f64,
    pub observations: VecDeque<(bool, i64)>,
    pub ewma_probability: f64,
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
    fn update(&mut self, attack_happened: bool, time: i64) {
        while let Some(&(_, t)) = self.observations.front() {
            if time - t > 200 {
                self.observations.pop_front();
            } else {
                break;
            }
        }
        self.observations.push_back((attack_happened, time));
        if self.observations.len() < 3 {
            return;
        }
        let n = self.observations.len() as f64;
        let attacks = self.observations.iter().filter(|(a, _)| *a).count() as f64;
        let freq = attacks / n;
        let alpha = (2.0 / (n.min(30.0) + 1.0)).max(0.05);
        let old = self.ewma_probability;
        self.ewma_probability = alpha * freq + (1.0 - alpha) * old;
        self.variance = self.variance * 0.9 + (freq - old).powi(2) * 0.1;
        let weight_prior = 1.0 / (n + 1.0);
        self.ewma_probability =
            weight_prior * self.prior_attack + (1.0 - weight_prior) * self.ewma_probability;
        self.ewma_probability = self.ewma_probability.clamp(0.01, 0.99);
    }
    pub fn confidence_interval(&self) -> (f64, f64) {
        let std_dev = self.variance.sqrt();
        let lo = (self.ewma_probability - 1.96 * std_dev).max(0.0);
        let hi = (self.ewma_probability + 1.96 * std_dev).min(1.0);
        (lo, hi)
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MarkovTransition {
    pub matrix: HashMap<AIState, HashMap<AIState, f64>>,
    pub counts: HashMap<AIState, HashMap<AIState, u32>>,
}

impl MarkovTransition {
    fn new() -> Self {
        let mut matrix = HashMap::new();
        let mut counts = HashMap::new();
        let states = [
            AIState::Calm,
            AIState::Alert,
            AIState::Danger,
            AIState::Critical,
            AIState::PostAttack,
            AIState::NightSiege,
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
        let entry = self
            .counts
            .entry(from.clone())
            .or_default()
            .entry(to.clone())
            .or_insert(0);
        *entry += 1;
        let total: u32 = self.counts[from].values().sum();
        if total > 0 {
            let row_counts = self.counts[from].clone();
            let row = self.matrix.entry(from.clone()).or_default();
            for (to_state, count) in &row_counts {
                row.insert(to_state.clone(), *count as f64 / total as f64);
            }
        }
    }
    pub fn predict_next(&self, current: &AIState) -> (AIState, f64) {
        if let Some(row) = self.matrix.get(current) {
            let best = row.iter().max_by(|a, b| a.1.partial_cmp(b.1).unwrap());
            if let Some((state, prob)) = best {
                return (state.clone(), *prob);
            }
        }
        (AIState::Calm, 0.5)
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QTable {
    pub table: HashMap<AIState, HashMap<AIAction, f64>>,
    pub epsilon: f64,
    pub total_steps: u64,
    pub reward_history: VecDeque<f64>,
}

impl QTable {
    fn new() -> Self {
        let mut table = HashMap::new();
        let states = [
            AIState::Calm,
            AIState::Alert,
            AIState::Danger,
            AIState::Critical,
            AIState::PostAttack,
            AIState::NightSiege,
        ];
        let actions = [
            AIAction::Monitor,
            AIAction::RaiseDefenses,
            AIAction::PredictiveScanning,
            AIAction::AggressiveCounter,
            AIAction::ResourceConserve,
            AIAction::PsychWarfare,
        ];
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
    fn select_action(&mut self, state: &AIState, rng_val: f64) -> AIAction {
        self.total_steps += 1;
        self.epsilon = (self.epsilon * Q_EPSILON_DECAY).max(Q_EPSILON_MIN);
        if rng_val < self.epsilon {
            let actions = [
                AIAction::Monitor,
                AIAction::RaiseDefenses,
                AIAction::PredictiveScanning,
                AIAction::AggressiveCounter,
                AIAction::ResourceConserve,
                AIAction::PsychWarfare,
            ];
            let idx = (rng_val * actions.len() as f64) as usize % actions.len();
            actions[idx].clone()
        } else {
            self.best_action(state)
        }
    }
    fn best_action(&self, state: &AIState) -> AIAction {
        if let Some(row) = self.table.get(state) {
            let best = row.iter().max_by(|a, b| a.1.partial_cmp(b.1).unwrap());
            if let Some((action, _)) = best {
                return action.clone();
            }
        }
        AIAction::Monitor
    }
    fn update(&mut self, state: &AIState, action: &AIAction, reward: f64, next_state: &AIState) {
        let next_max = self
            .table
            .get(next_state)
            .and_then(|row| row.values().cloned().reduce(f64::max))
            .unwrap_or(0.0);
        let current_q = *self
            .table
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
        if self.reward_history.len() > 100 {
            self.reward_history.pop_front();
        }
    }
    pub fn average_reward(&self) -> f64 {
        if self.reward_history.is_empty() {
            return 0.0;
        }
        self.reward_history.iter().sum::<f64>() / self.reward_history.len() as f64
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TemporalPattern {
    pub pattern_id: String,
    pub attack_rate_night: f64,
    pub attack_rate_day: f64,
    pub mean_interval: f64,
    pub std_interval: f64,
    pub interval_history: VecDeque<i64>,
    pub last_attack_time: i64,
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
    fn record_attack(&mut self, time: i64, is_night: bool) {
        let interval = time - self.last_attack_time;
        if interval > 0 && self.last_attack_time > 0 {
            self.interval_history.push_back(interval);
            if self.interval_history.len() > 30 {
                self.interval_history.pop_front();
            }
            let n = self.interval_history.len() as f64;
            self.mean_interval = self.interval_history.iter().sum::<i64>() as f64 / n;
            let var = self
                .interval_history
                .iter()
                .map(|&x| (x as f64 - self.mean_interval).powi(2))
                .sum::<f64>()
                / n;
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
    fn urgency_score(&self, current_time: i64) -> f64 {
        if self.last_attack_time == 0 || self.std_interval < 0.1 {
            return 0.5;
        }
        let elapsed = (current_time - self.last_attack_time) as f64;
        let z = (elapsed - self.mean_interval) / self.std_interval;
        1.0 / (1.0 + (-z).exp())
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ThreatRecord {
    pub timestamp: i64,
    pub threat_level: u32,
    pub threat_type: String,
    pub was_real_attack: bool,
    pub defense_level: u32,
    pub was_defended: bool,
    pub predicted: bool,
    pub prediction_confidence: f64,
    pub ai_action_taken: String,
    pub outcome: Outcome,
    pub weight: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Outcome {
    Success,
    Failure,
    Neutral,
    Predicted,
    Countered,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Pattern {
    pub pattern_type: String,
    pub effectiveness: f64,
    pub usage_count: u32,
    pub last_used: i64,
    pub success_rate: f64,
    pub counter_strategy: String,
    pub confidence: f64,
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

#[allow(dead_code)]
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

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct NeuroEcosystem {
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
    pub last_processed_time: i64,
    pub cooldown: i32,
    pub reaction_cooldown: i32,
    pub attack_counter: u32,
    pub last_ai_decision: AIDecision,
    pub active_defense_bonus: f64,
    pub prediction_bonus: f64,
    pub stats: NeuroStats,
    pub bayesian_nodes: Vec<BayesianThreatNode>,
    pub markov_chain: MarkovTransition,
    pub q_table: QTable,
    pub current_ai_state: AIState,
    pub last_q_action: AIAction,
    pub temporal_pattern: TemporalPattern,
    pub prediction_trust: f64,
    pub correct_prediction_streak: u32,
    pub adaptive_alarm_threshold: f64,
    pub cusum_sum: f64,
    pub cusum_threshold: f64,
    pub decision_log: VecDeque<String>,
    pub prng_counter: u64,

    pub intercepted_messages: VecDeque<InterceptedMessage>,
    pub last_intercept_at: i64,
    pub intercept_cooldown: i32,
    pub commander_profiles: HashMap<String, CommanderProfile>,
    pub propaganda_active: bool,
    pub propaganda_expires_at: i64,
    pub fake_depot_active: bool,
    pub fake_depot_expires_at: i64,
    pub fake_depot_ttl: i32,
    pub pending_vulnerability: Option<String>,
    pub counter_op_cooldowns: HashMap<String, (i64, i32)>,
    pub last_counter_op_at: i64,
    pub avg_player_reaction: f64,
    pub last_warning_time: i64,
    pub enemy_encryption_level: u32,
    pub last_log_time: i64,
    pub last_mode_log_at: i64,
}

impl Default for NeuroEcosystem {
    fn default() -> Self {
        Self::new()
    }
}

impl NeuroEcosystem {
    fn restore_effect_cooldown(
        &mut self,
        effect_key: &str,
        current_tick: i64,
        expires_at: i64,
        active_duration: i64,
        cooldown_duration: i32,
    ) {
        if self.get_cooldown_remaining(effect_key, current_tick) > 0 {
            return;
        }

        let remaining = (expires_at - current_tick - active_duration).max(0) as i32;
        if remaining > 0 {
            self.counter_op_cooldowns.insert(
                effect_key.to_string(),
                (
                    current_tick - (cooldown_duration - remaining) as i64,
                    cooldown_duration,
                ),
            );
        }
    }

    fn restore_timed_counter_op(
        &mut self,
        effect_key: &str,
        current_tick: i64,
        is_active: bool,
        expires_at: i64,
        active_duration: i64,
        cooldown_duration: i32,
    ) -> i64 {
        if !is_active {
            return 0;
        }

        let normalized_expires_at = if expires_at <= current_tick {
            current_tick + active_duration
        } else {
            expires_at
        };

        if self.get_cooldown_remaining(effect_key, current_tick) == 0 {
            self.set_cooldown(effect_key, current_tick, cooldown_duration);
        }

        normalized_expires_at
    }

    pub fn new() -> Self {
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
            prng_counter: 0,
            intercepted_messages: VecDeque::with_capacity(10),
            last_intercept_at: -100,
            intercept_cooldown: 20,
            commander_profiles: HashMap::new(),
            propaganda_active: false,
            propaganda_expires_at: 0,
            fake_depot_active: false,
            fake_depot_expires_at: 0,
            fake_depot_ttl: 0,
            pending_vulnerability: None,
            counter_op_cooldowns: HashMap::new(),
            last_counter_op_at: -999,
            avg_player_reaction: 15.0,
            last_warning_time: 0,
            enemy_encryption_level: 0,
            last_log_time: -100,
            last_mode_log_at: -100,
        }
    }

    fn prng(&mut self, seed: u64) -> f64 {
        self.prng_counter += 1;
        let a: u64 = 2862933555777941757;
        let c: u64 = 3037000493;
        let r = seed
            .wrapping_mul(a)
            .wrapping_add(c)
            .wrapping_add(self.prng_counter);
        (r >> 32) as f64 / u32::MAX as f64
    }

    fn classify_state(&self, state: &GameState) -> AIState {
        if state.current_night_type == "siege" {
            return AIState::NightSiege;
        }
        let recently_attacked = state.tick_count - self.temporal_pattern.last_attack_time < 15;
        if recently_attacked {
            return AIState::PostAttack;
        }
        match state.rebel_activity {
            0..=2 => AIState::Calm,
            3..=5 => AIState::Alert,
            6..=9 => AIState::Danger,
            _ => AIState::Critical,
        }
    }

    fn bayesian_threat_probability(&self, rebel_activity: u32, is_night: bool) -> f64 {
        let idx = (rebel_activity as usize).min(15);
        let node_prob = self.bayesian_nodes[idx].ewma_probability;
        let time_factor = if is_night { 1.4 } else { 0.7 };
        let temporal = self
            .temporal_pattern
            .urgency_score(self.temporal_pattern.last_attack_time + 1);
        let combined = node_prob * 0.5 + temporal * 0.3 + node_prob * time_factor * 0.2;
        combined.clamp(0.01, 0.99)
    }

    fn update_cusum(&mut self, observed: f64, expected: f64) -> bool {
        let deviation = observed - expected;
        self.cusum_sum = (self.cusum_sum + deviation - 0.5).max(0.0);
        if self.cusum_sum > self.cusum_threshold {
            self.cusum_sum = 0.0;
            return true;
        }
        false
    }

    pub fn sync_to_state(&self, state: &mut GameState) {
        state.neuro_evolution = self.evolution_level;
        state.neuro_consciousness = self.system_consciousness;
        state.neuro_score = self.evolution_score;
        state.neuro_defense_bonus = self.get_defense_bonus();
        state.neuro_prediction_bonus = self.get_prediction_bonus();
    }

    pub fn restore_runtime_from_state(&mut self, state: &GameState) {
        self.evolution_level = state.neuro_evolution;
        self.system_consciousness = state.neuro_consciousness;
        self.evolution_score = state.neuro_score;

        self.fake_depot_active = state.fake_depot_active;
        if self.fake_depot_active {
            if self.fake_depot_ttl <= 0 {
                self.fake_depot_ttl = 70;
            }
        } else {
            self.fake_depot_ttl = 0;
        }
        self.fake_depot_expires_at = self.restore_timed_counter_op(
            "fake_depot",
            state.tick_count,
            self.fake_depot_active,
            self.fake_depot_expires_at,
            self.fake_depot_ttl as i64,
            45,
        );

        self.propaganda_active = state.propaganda_active;
        self.propaganda_expires_at = self.restore_timed_counter_op(
            "propaganda",
            state.tick_count,
            self.propaganda_active,
            self.propaganda_expires_at,
            40,
            35,
        );

        if state.fleet_shield_active {
            self.restore_effect_cooldown(
                "fleet_shield",
                state.tick_count,
                state.fleet_shield_expires_at,
                10,
                50,
            );
        }

        if state.blueprints_encrypted {
            self.restore_effect_cooldown(
                "encrypt_blueprints",
                state.tick_count,
                state.blueprint_encryption_expires_at,
                30,
                60,
            );
        }

        if state.planets_fortified {
            self.restore_effect_cooldown(
                "fortify_planets",
                state.tick_count,
                state.planet_fortification_expires_at,
                40,
                80,
            );
        }
    }

    pub fn tick_passive(&mut self, _efficiency: f64) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.fake_depot_active {
            self.fake_depot_ttl -= 1;
            if self.fake_depot_ttl <= 0 {
                self.fake_depot_active = false;
                events.push(GameEvent::LogMessage(
                    "💨 Фальшивый склад рассеялся (время вышло)".to_string(),
                ));
            }
        }

        if self.propaganda_active {}

        events
    }

    pub fn emergency_process(
        &mut self,
        _state: &mut GameState,
        _efficiency: f64,
    ) -> Vec<GameEvent> {
        Vec::new()
    }

    pub fn process_threat(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
        config: &GameConfig,
        had_real_attack: bool,
        was_defended: bool,
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
        let effective_cooldown =
            self.calculate_cooldown(had_real_attack, state.rebel_activity, state);
        if state.tick_count - self.last_processed_time < effective_cooldown as i64 {
            return events;
        }
        self.last_processed_time = state.tick_count;
        let activity_idx = (state.rebel_activity as usize).min(15);
        self.bayesian_nodes[activity_idx].update(had_real_attack, state.tick_count);
        if had_real_attack {
            self.temporal_pattern
                .record_attack(state.tick_count, !state.is_day);
        }
        let expected_prob = self.bayesian_nodes[activity_idx].prior_attack;
        let observed = if had_real_attack { 1.0 } else { 0.0 };
        let anomaly_detected = self.update_cusum(observed, expected_prob);
        if anomaly_detected && self.evolution_level >= 2 {
            events.push(GameEvent::LogMessage(
                "⚠️ CUSUM: обнаружен статистический сдвиг угрозы — ИИ повышает бдительность!"
                    .to_string(),
            ));
            state.rebel_activity = (state.rebel_activity + 1).min(15);
        }
        let new_state = self.classify_state(state);
        if new_state != self.current_ai_state {
            self.markov_chain
                .record_transition(&self.current_ai_state.clone(), &new_state);
        }
        let prev_state = self.current_ai_state.clone();
        self.current_ai_state = new_state.clone();
        let rng_val = self.prng(state.tick_count as u64 + self.stats.q_learning_steps as u64);
        let chosen_action = self.q_table.select_action(&new_state, rng_val);
        self.stats.q_learning_steps += 1;
        let bayes_prob = self.bayesian_threat_probability(state.rebel_activity, !state.is_day);
        let (markov_next, _markov_conf) = self.markov_chain.predict_next(&new_state);
        let markov_danger = matches!(
            markov_next,
            AIState::Danger | AIState::Critical | AIState::NightSiege
        );
        let final_threat_prob = bayes_prob * 0.6 + (if markov_danger { 0.8 } else { 0.2 }) * 0.4;
        let was_predicted = final_threat_prob > self.adaptive_alarm_threshold;
        self.record_threat_weighted(
            state.rebel_activity,
            had_real_attack,
            state.tick_count,
            state.upgrades.defense_level,
            was_defended,
            was_predicted,
            final_threat_prob,
            &chosen_action,
        );
        if was_predicted && had_real_attack {
            self.successful_predictions += 1;
            self.correct_prediction_streak += 1;
            self.prediction_trust = (self.prediction_trust + 0.05).min(0.9);
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold + 0.01).min(0.85);
        } else if was_predicted && !had_real_attack {
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold + 0.02).min(0.90);
            self.correct_prediction_streak = 0;
        } else if !was_predicted && had_real_attack {
            self.adaptive_alarm_threshold = (self.adaptive_alarm_threshold - 0.03).max(0.3);
            self.prediction_trust = (self.prediction_trust - 0.03).max(0.0);
            self.correct_prediction_streak = 0;
        }
        if self.total_attacks_processed > 0 {
            self.prediction_accuracy =
                self.successful_predictions as f64 / self.total_attacks_processed as f64;
            self.stats.avg_prediction_accuracy = self.prediction_accuracy;
        }

        let points = self.calculate_evolution_points(
            had_real_attack,
            state.rebel_activity,
            was_defended,
            was_predicted,
            state,
        );
        if points > 0 {
            self.evolution_score += points;

            let should_log = had_real_attack
                || self.correct_prediction_streak >= 4
                || (was_predicted && state.rebel_activity >= 9)
                || state.tick_count - self.last_log_time > 90;

            if should_log {
                let reason = if self.correct_prediction_streak >= 3 {
                    format!("серия точных прогнозов x{}", self.correct_prediction_streak)
                } else if had_real_attack {
                    "реальная атака".to_string()
                } else if was_predicted {
                    "точное предсказание".to_string()
                } else {
                    "анализ угрозы".to_string()
                };
                events.push(GameEvent::LogMessage(format!(
                    "🧠 {}: +{} очков эволюции (активность: {})",
                    reason, points, state.rebel_activity
                )));
                self.last_log_time = state.tick_count;
            }
        }

        self.learn_pattern(state, rebel_system, had_real_attack, was_defended);
        let action_events = self.apply_q_action(
            state,
            rebel_system,
            config,
            &chosen_action,
            final_threat_prob,
        );
        events.extend(action_events);
        let reward =
            self.calculate_q_reward(had_real_attack, was_defended, was_predicted, &chosen_action);
        let next_q_state = self.classify_state(state);
        self.q_table.update(
            &prev_state,
            &self.last_q_action.clone(),
            reward,
            &next_q_state,
        );
        self.last_q_action = chosen_action.clone();
        if had_real_attack {
            self.attack_counter += 1;
            if self.attack_counter >= 2 {
                let bonus = self.attack_counter * 8;
                self.evolution_score += bonus;
                events.push(GameEvent::LogMessage(format!(
                    "🔥 Серия из {} атак! +{} бонусных очков эволюции",
                    self.attack_counter, bonus
                )));
            }
        } else {
            self.attack_counter = 0;
        }
        self.cleanup_old_memory(state.tick_count);
        self.update_bonuses();
        self.update_metrics(had_real_attack, was_defended, was_predicted);

        if let Some(intercept_event) = self.try_intercept_message(rebel_system, state) {
            events.push(intercept_event);
        }

        if self.propaganda_active && state.tick_count > self.propaganda_expires_at {
            self.propaganda_active = false;
            if state.current_ai_mode.contains("Дезинформация") {
                state.current_ai_mode = "⚙️ Мониторинг".to_string();
            }
            events.push(GameEvent::LogMessage(
                "📡 Контр-пропаганда завершила работу.".to_string(),
            ));
        }

        self.sync_to_state(state);

        events
    }

    pub fn try_intercept_message(
        &mut self,
        rebel_system: &RebelSystem,
        state: &GameState,
    ) -> Option<GameEvent> {
        if state.tick_count - self.last_intercept_at < self.intercept_cooldown as i64 {
            return None;
        }
        if self.evolution_level < 2 {
            return None;
        }

        let base_chance = 0.08 + self.system_consciousness * 0.25;
        let encryption_penalty = self.enemy_encryption_level as f64 * 0.08;
        let intercept_chance = (base_chance - encryption_penalty).max(0.03);

        let rng = self.prng(state.tick_count as u64 * 7919 + self.stats.q_learning_steps);
        if rng > intercept_chance {
            return None;
        }

        let rng2 = self.prng(state.tick_count as u64 * 1031);
        let rng3 = self.prng(state.tick_count as u64 * 2053);

        let target_hint = if rng2 < 0.3 {
            "неизвестная цель"
        } else if rebel_system
            .htn_plans
            .front()
            .and_then(|p| p.subtasks.front())
            .map(|t| t.target.contains("plasma"))
            .unwrap_or(false)
        {
            "рудник плазмы"
        } else {
            let targets = [
                "рудник-3",
                "энергоблок",
                "склад чипов",
                "командный пункт",
                "зарядная станция",
            ];
            targets[(rng2 * targets.len() as f64) as usize % targets.len()]
        };

        let eta = if rng3 < 0.2 {
            6
        } else {
            10 + (rng3 * 30.0) as i32
        };

        let reliability = if self.evolution_level >= 5 {
            (0.55 + self.prediction_accuracy * 0.35).min(0.85)
        } else if self.evolution_level >= 3 {
            (0.45 + self.prediction_accuracy * 0.30).min(0.75)
        } else {
            (0.35 + self.prediction_accuracy * 0.25).min(0.65)
        };

        let content = if self.evolution_level >= 5 {
            if target_hint == "неизвестная цель" {
                format!(
                    "📡 ПЕРЕХВАТ [Надёжность {:.0}%]: «Цель скрыта, атака через ~{} сек»",
                    reliability * 100.0,
                    eta
                )
            } else if eta == 0 {
                format!(
                    "📡 ПЕРЕХВАТ [Надёжность {:.0}%]: «Цель: {}, время атаки неизвестно»",
                    reliability * 100.0,
                    target_hint
                )
            } else {
                format!(
                    "📡 ПЕРЕХВАТ [Надёжность {:.0}%]: «Цель: {}, атакуем через ~{} сек»",
                    reliability * 100.0,
                    target_hint,
                    eta * 2
                )
            }
        } else if self.evolution_level >= 3 {
            if target_hint == "неизвестная цель" {
                "📡 ОБРЫВОК: «...цель скрыта... операция скоро...»".to_string()
            } else {
                format!("📡 ОБРЫВОК: «...{}... операция скоро...»", target_hint)
            }
        } else {
            "📡 ШУМ ЭФИРА: «...подтверждено... ждите приказа...»".to_string()
        };

        let msg = InterceptedMessage {
            content: content.clone(),
            target_hint: target_hint.to_string(),
            eta_ticks: eta,
            intercepted_at: state.tick_count,
            reliability,
            is_read: false,
        };

        let should_broadcast =
            reliability >= 0.72 && state.tick_count - self.last_warning_time >= 30;
        self.last_intercept_at = state.tick_count;
        self.last_warning_time = state.tick_count;
        self.intercept_cooldown = (40 - self.evolution_level as i32 * 2).max(15);

        if self.intercepted_messages.len() >= 8 {
            self.intercepted_messages.pop_front();
        }
        self.intercepted_messages.push_back(msg);

        if should_broadcast {
            Some(GameEvent::LogMessage(content))
        } else {
            None
        }
    }

    pub fn get_cooldown_remaining(&self, op: &str, current_tick: i64) -> i32 {
        if let Some(&(last_at, duration)) = self.counter_op_cooldowns.get(op) {
            let elapsed = current_tick - last_at;
            (duration as i64 - elapsed).max(0) as i32
        } else {
            0
        }
    }

    pub fn set_cooldown(&mut self, op: &str, current_tick: i64, duration: i32) {
        self.counter_op_cooldowns
            .insert(op.to_string(), (current_tick, duration));
    }

    #[allow(dead_code)]
    pub fn get_ui_cooldown(&self, current_tick: i64) -> i32 {
        [
            "propaganda",
            "fake_depot",
            "close_vulnerability",
            "fleet_shield",
            "encrypt_blueprints",
            "fortify_planets",
        ]
        .iter()
        .map(|op| self.get_cooldown_remaining(op, current_tick))
        .max()
        .unwrap_or(0)
    }

    pub fn deploy_fleet_shield(
        &mut self,
        state: &mut GameState,
        _rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.evolution_level < 4 {
            events.push(GameEvent::LogMessage(
                "❌ Защита флота требует эволюцию Ур.4+".to_string(),
            ));
            return events;
        }

        if self.get_cooldown_remaining("fleet_shield", state.tick_count) > 0 {
            events.push(GameEvent::LogMessage(
                "⏳ Защита флота на перезарядке".to_string(),
            ));
            return events;
        }

        if state.inventory.chips < 25 {
            events.push(GameEvent::LogMessage(
                "❌ Нужно 25 чипов для защиты флота".to_string(),
            ));
            return events;
        }

        state.inventory.chips -= 25;

        state.fleet_shield_active = true;
        state.fleet_shield_expires_at = state.tick_count + 60;

        self.set_cooldown("fleet_shield", state.tick_count, 50);

        events.push(GameEvent::LogMessage(
            "🛡️ ЗАЩИТА ФЛОТА АКТИВНА: нейро развернула щит вокруг кораблей. Шанс атаки на флот -40% на 60 сек. Стоимость: 25 чипов.".to_string()
        ));

        self.sync_to_state(state);
        events
    }

    pub fn encrypt_blueprints(
        &mut self,
        state: &mut GameState,
        _rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.evolution_level < 5 {
            events.push(GameEvent::LogMessage(
                "❌ Шифрование чертежей требует эволюцию Ур.5+".to_string(),
            ));
            return events;
        }

        if self.get_cooldown_remaining("encrypt_blueprints", state.tick_count) > 0 {
            events.push(GameEvent::LogMessage(
                "⏳ Шифрование на перезарядке".to_string(),
            ));
            return events;
        }

        if state.inventory.chips < 30 {
            events.push(GameEvent::LogMessage(
                "❌ Нужно 30 чипов для шифрования".to_string(),
            ));
            return events;
        }

        state.inventory.chips -= 30;

        state.blueprints_encrypted = true;
        state.blueprint_encryption_expires_at = state.tick_count + 90;

        self.set_cooldown("encrypt_blueprints", state.tick_count, 60);

        events.push(GameEvent::LogMessage(
            "🔐 ЧЕРТЕЖИ ЗАШИФРОВАНЫ: нейро защитила производственные цепочки. Кража чертежей заблокирована на 90 сек. Стоимость: 30 чипов.".to_string()
        ));

        self.sync_to_state(state);
        events
    }

    pub fn fortify_planets(
        &mut self,
        state: &mut GameState,
        _rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.evolution_level < 6 {
            events.push(GameEvent::LogMessage(
                "❌ Укрепление планет требует эволюцию Ур.6+".to_string(),
            ));
            return events;
        }

        if self.get_cooldown_remaining("fortify_planets", state.tick_count) > 0 {
            events.push(GameEvent::LogMessage(
                "⏳ Укрепление на перезарядке".to_string(),
            ));
            return events;
        }

        if state.inventory.plasma < 3 {
            events.push(GameEvent::LogMessage(
                "❌ Нужно 3 плазмы для укрепления планет".to_string(),
            ));
            return events;
        }

        state.inventory.plasma -= 3;

        state.planets_fortified = true;
        state.planet_fortification_expires_at = state.tick_count + 120;

        self.set_cooldown("fortify_planets", state.tick_count, 80);

        events.push(GameEvent::LogMessage(
            "🏰 ПЛАНЕТЫ УКРЕПЛЕНЫ: нейро развернула орбитальные щиты. Урон планетам -50% на 120 сек. Стоимость: 3 плазмы.".to_string()
        ));

        self.sync_to_state(state);
        events
    }

    pub fn analyze_commander_behavior(
        &mut self,
        faction_id: &str,
        quiet_nights_before: u32,
        had_attack: bool,
    ) -> Option<GameEvent> {
        if !had_attack {
            return None;
        }

        if !self.commander_profiles.contains_key(faction_id) {
            self.commander_profiles.insert(
                faction_id.to_string(),
                CommanderProfile {
                    faction_id: faction_id.to_string(),
                    attacks_observed: 0,
                    quiet_nights_before_attack: VecDeque::with_capacity(15),
                    predicted_quiet_threshold: 3,
                    signature_revealed: false,
                    times_frustrated: 0,
                },
            );
        }

        {
            let profile = self.commander_profiles.get_mut(faction_id).unwrap();
            profile.attacks_observed += 1;
            profile
                .quiet_nights_before_attack
                .push_back(quiet_nights_before);

            if profile.quiet_nights_before_attack.len() > 12 {
                profile.quiet_nights_before_attack.pop_front();
            }
        }

        let (attacks_observed, signature_revealed, predicted_quiet_threshold, new_threshold) = {
            let profile = self.commander_profiles.get(faction_id).unwrap();

            if profile.attacks_observed < 5 {
                return None;
            }

            let avg = profile.quiet_nights_before_attack.iter().sum::<u32>() as f64
                / profile.quiet_nights_before_attack.len() as f64;
            let new_threshold = avg.round().max(1.0) as u32;

            (
                profile.attacks_observed,
                profile.signature_revealed,
                profile.predicted_quiet_threshold,
                new_threshold,
            )
        };

        let rng = self.prng(attacks_observed as u64 * 31337);
        let tactic_change = attacks_observed >= 7 && rng < 0.08;

        if !signature_revealed || new_threshold != predicted_quiet_threshold || tactic_change {
            let profile = self.commander_profiles.get_mut(faction_id).unwrap();
            profile.predicted_quiet_threshold = new_threshold;

            if !signature_revealed {
                profile.signature_revealed = true;
                return Some(GameEvent::LogMessage(format!(
                    "🔍 НЕЙРО РАСКРЫЛА ПАТТЕРН: командир «{}» атакует после {} тихих ночей. ⚠️ Но повстанцы могут изменить тактику!",
                    faction_id, new_threshold
                )));
            } else if tactic_change {
                return Some(GameEvent::LogMessage(format!(
                    "⚠️ НЕЙРО фиксирует: командир «{}» ИЗМЕНИЛ ТАКТИКУ! Теперь атакует после ~{} ночей. Паттерн нестабилен!",
                    faction_id, new_threshold
                )));
            } else {
                return Some(GameEvent::LogMessage(format!(
                    "🔍 Нейро уточняет: командир «{}» атакует после ~{} ночей.",
                    faction_id, new_threshold
                )));
            }
        }

        None
    }

    fn apply_q_action(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
        config: &GameConfig,
        action: &AIAction,
        threat_prob: f64,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let mode_changed = self.last_q_action != *action;
        let should_broadcast =
            mode_changed || threat_prob > 0.78 || state.tick_count - self.last_mode_log_at > 45;
        match action {
            AIAction::Monitor => {
                state.current_ai_mode = "⚙️ Мониторинг".to_string();
                self.active_defense_bonus = 0.0;
                self.prediction_bonus = self.prediction_accuracy * 0.15;
            }
            AIAction::RaiseDefenses => {
                self.active_defense_bonus = 0.25 + self.prediction_trust * 0.15;
                state.current_ai_mode = "🛡️ Усиленная защита".to_string();
                if threat_prob > 0.7 && should_broadcast {
                    events.push(GameEvent::LogMessage(format!(
                        "🛡️ ИИ поднял уровень защиты (угроза {:.0}%): +{:.0}% к эффективности",
                        threat_prob * 100.0,
                        self.active_defense_bonus * 100.0
                    )));
                }
                if should_broadcast
                    && !state.upgrades.defense
                    && state.inventory.plasma >= config.upgrade_config.defense_activation_cost
                {
                    events.push(GameEvent::LogMessage(
                        "🤖 ИИ рекомендует: активируйте защиту!".to_string(),
                    ));
                }
                rebel_system.on_ai_evolution(self.evolution_level, "defensive");
            }
            AIAction::PredictiveScanning => {
                self.prediction_bonus = 0.3 + self.prediction_trust * 0.2;
                state.current_ai_mode = "🔮 Предсказательный режим".to_string();
                let (lo, hi) = self.bayesian_nodes[(state.rebel_activity as usize).min(15)]
                    .confidence_interval();
                state.attack_warning = format!("Угроза: {:.0}–{:.0}%", lo * 100.0, hi * 100.0);
                state.attack_warning_faction = self.predict_attack_faction(rebel_system);
                state.last_warning_issued_at = state.tick_count as i32;
                if should_broadcast && threat_prob > self.adaptive_alarm_threshold {
                    events.push(GameEvent::LogMessage(format!(
                        "🔮 ИИ прогнозирует атаку: {:.0}% вероятность (ДИ {:.0}–{:.0}%) от {}",
                        threat_prob * 100.0,
                        lo * 100.0,
                        hi * 100.0,
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
                    if should_broadcast {
                        events.push(GameEvent::LogMessage(format!(
                            "⚔️ Упреждающий удар! Активность повстанцев: -{} (осталось: {})",
                            reduction, state.rebel_activity
                        )));
                    }
                }
                rebel_system.on_ai_evolution(self.evolution_level, "aggressive");
            }
            AIAction::ResourceConserve => {
                state.current_ai_mode = "📦 Экономия ресурсов".to_string();
                self.active_defense_bonus = 0.10;
                if should_broadcast {
                    events.push(GameEvent::LogMessage(
                        "📦 ИИ переводит системы в режим экономии: пассивная добыча +20%"
                            .to_string(),
                    ));
                }
            }
            AIAction::PsychWarfare => {
                state.current_ai_mode = "📡 Психо-операция".to_string();
                self.prediction_bonus = 0.2;
                rebel_system.apply_morale_damage(0.08);
                if should_broadcast {
                    events.push(GameEvent::LogMessage(
                        "📡 ИИ запустил контр-пропаганду: мораль повстанцев снижена".to_string(),
                    ));
                }
            }
        }
        if should_broadcast {
            self.last_mode_log_at = state.tick_count;
        }
        let log_entry = format!(
            "[t={}] {:?} → {:?} (угроза:{:.0}%)",
            self.last_processed_time,
            self.current_ai_state,
            action,
            threat_prob * 100.0
        );
        self.decision_log.push_back(log_entry.clone());
        if self.decision_log.len() > 20 {
            self.decision_log.pop_front();
        }
        self.stats.best_action_history.push(format!("{:?}", action));
        if self.stats.best_action_history.len() > 50 {
            self.stats.best_action_history.remove(0);
        }
        events
    }

    fn predict_attack_faction(&self, rebel_system: &RebelSystem) -> String {
        let mut counts: HashMap<String, u32> = HashMap::new();
        for rec in self.threat_memory.iter().rev().take(30) {
            if rec.was_real_attack {
                *counts.entry(rec.threat_type.clone()).or_insert(0) += 1;
            }
        }
        let faction_info = rebel_system.get_faction_info();
        if let Some(f) = faction_info.first() {
            f.clone()
        } else {
            "неизвестная фракция".to_string()
        }
    }

    fn calculate_q_reward(
        &self,
        had_attack: bool,
        was_defended: bool,
        was_predicted: bool,
        action: &AIAction,
    ) -> f64 {
        let mut reward = 0.0;
        if had_attack {
            if was_defended {
                reward += 2.0;
                if was_predicted {
                    reward += 1.0;
                }
            } else {
                reward -= 3.0;
                if was_predicted {
                    reward += 0.5;
                }
            }
        } else {
            if was_predicted {
                reward -= 0.5;
            } else {
                reward += 0.3;
            }
        }
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

    fn record_threat_weighted(
        &mut self,
        threat_level: u32,
        was_real_attack: bool,
        timestamp: i64,
        defense_level: u32,
        was_defended: bool,
        predicted: bool,
        confidence: f64,
        action: &AIAction,
    ) {
        let outcome = if was_defended {
            Outcome::Success
        } else if was_real_attack {
            Outcome::Failure
        } else if predicted {
            Outcome::Predicted
        } else {
            Outcome::Neutral
        };
        let weight = if was_real_attack {
            2.0
        } else if predicted {
            1.5
        } else {
            1.0
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
            prediction_confidence: confidence,
            ai_action_taken: format!("{:?}", action),
            outcome,
            weight,
        };
        if self.threat_memory.len() >= 200 {
            self.threat_memory.pop_front();
        }
        self.threat_memory.push_back(record);
    }

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
        let pattern_index = self
            .learned_patterns
            .iter()
            .position(|p| p.pattern_type == pattern_type);
        if let Some(idx) = pattern_index {
            let p = &mut self.learned_patterns[idx];
            p.usage_count += 1;
            p.last_used = state.tick_count;
            let delta = if success { 0.08 } else { -0.04 };
            p.effectiveness = (p.effectiveness + delta).clamp(0.05, 1.0);
            p.success_rate = p.success_rate * 0.9 + (if success { 0.1 } else { 0.0 });
            p.confidence = (1.0 - 1.0 / (p.usage_count as f64).sqrt()).min(0.95);
            if p.effectiveness > 0.65 {
                p.counter_strategy = counter_strategy;
            }
        } else {
            self.learned_patterns.push(Pattern {
                pattern_type,
                effectiveness: 0.5,
                usage_count: 1,
                last_used: state.tick_count,
                success_rate: if success { 0.6 } else { 0.4 },
                counter_strategy,
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
        format!("{}_{}{}", lvl, faction, night)
    }

    fn select_counter_strategy(&self, pattern: &str) -> String {
        if pattern.contains("desperate") {
            "psychological_warfare".to_string()
        } else if pattern.contains("aggressive_night") {
            "fortify_and_predict".to_string()
        } else if pattern.contains("aggressive") {
            "fortify_defense".to_string()
        } else if pattern.contains("probing") {
            "decoys".to_string()
        } else {
            "standard_defense".to_string()
        }
    }

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

            let gain = 0.08 + (self.evolution_level as f64 * 0.005).min(0.03);
            self.system_consciousness = (self.system_consciousness + gain).min(1.0);
            self.stats
                .consciousness_gains
                .push(self.system_consciousness);
            self.cooldown = (self.cooldown - 1).max(4);
            self.reaction_cooldown = (self.reaction_cooldown - 1).max(2);
            self.q_table.epsilon = (self.q_table.epsilon + 0.05).min(Q_EPSILON_START);
            self.cusum_threshold = (self.cusum_threshold - 0.3).max(2.0);

            state.neuro_evolution = self.evolution_level;
            state.neuro_consciousness = self.system_consciousness;
            state.neuro_score = self.evolution_score;

            events.push(GameEvent::LogMessage(format!(
                "🌟 НЕЙРО-ЭВОЛЮЦИЯ! {} → {} (Сознание: {:.0}% | Q-шаги: {})",
                old_level,
                self.evolution_level,
                self.system_consciousness * 100.0,
                self.stats.q_learning_steps
            )));

            match self.evolution_level {
                1 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 Разблокировано: Байесовское предсказание угроз".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "prediction_unlocked");
                }
                3 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 Разблокировано: Адаптивная оборона (Q-Learning)".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "adaptive_defense");
                }
                5 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 Разблокировано: Марковский контрудар".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "counter_attack");
                }
                7 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 Разблокировано: Психологическая война (CUSUM-детектор)".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "psychological_warfare");
                }
                10 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 ПОЛНОЕ СОЗНАНИЕ: ИИ достиг максимальной эффективности".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "full_consciousness");
                }
                11 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 КВАНТОВОЕ УСКОРЕНИЕ: глобальный множитель добычи x1.20".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "quantum_acceleration");
                }
                12 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 ТЕРМОДИНАМИЧЕСКИЙ ЩИТ: глобальный множитель x1.30".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "thermo_shield");
                }
                13 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 СВЕРХПРОВОДИМОСТЬ: глобальный множитель x1.45".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "superconductivity");
                }
                14 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 НЕЙРОННАЯ СИНГУЛЯРНОСТЬ: глобальный множитель x1.60".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "singularity");
                }
                15 => {
                    events.push(GameEvent::LogMessage(
                        "🧠 АБСОЛЮТНОЕ ДОМИНИРОВАНИЕ: глобальный множитель x1.80".to_string(),
                    ));
                    rebel_system.on_ai_evolution(self.evolution_level, "absolute_dominance");
                }
                _ => {}
            }
            if self.evolution_level >= 3 {
                let bonus = (self.evolution_level as f64 * 0.05).min(0.5);
                self.active_defense_bonus = bonus.max(self.active_defense_bonus);
            }
        }
        self.sync_to_state(state);
        events
    }

    pub fn get_evolution_requirement(&self) -> u32 {
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
            10 => 1250,
            11 => 1550,
            12 => 1900,
            13 => 2300,
            14 => 2800,
            _ => 3400 + (self.evolution_level - 15) * 150,
        }
    }

    pub fn get_consciousness_bonuses(&self) -> ConsciousnessBonus {
        let c = self.system_consciousness;
        let lvl = self.evolution_level;
        let global = if lvl >= 15 {
            1.80
        } else if lvl >= 14 {
            1.60
        } else if lvl >= 13 {
            1.45
        } else if lvl >= 12 {
            1.30
        } else if lvl >= 11 {
            1.20
        } else if lvl >= 10 {
            1.40
        } else if lvl >= 8 {
            1.25
        } else if lvl >= 5 {
            1.15
        } else {
            1.0
        };
        let _q_bonus = (self.q_table.average_reward() * 0.02).max(0.0).min(0.05);
        let _streak_bonus = (self.correct_prediction_streak as f64 * 0.01).min(0.1);
        ConsciousnessBonus {
            mining_chance_bonus: (if lvl >= 1 { c * 0.08 } else { 0.0 })
                + (if lvl >= 11 { 0.08 } else { 0.0 }),
            heat_reduction: (if lvl >= 2 { c * 0.15 } else { 0.0 })
                + (if lvl >= 12 { 0.20 } else { 0.0 }),
            crit_bonus: (if lvl >= 3 { c * 0.06 } else { 0.0 })
                + (if lvl >= 11 { 0.03 } else { 0.0 })
                + (if lvl >= 14 { 0.05 } else { 0.0 }),
            autoclick_speed: if lvl >= 4 { 1.0 - c * 0.15 } else { 1.0 },
            defense_bonus: if lvl >= 5 { (c * 15.0) as u32 } else { 0 },
            passive_multiplier: if lvl >= 6 { 1.0 + c * 0.8 } else { 1.0 },
            trade_discount_chance: if lvl >= 7 { 0.30 + c * 0.08 } else { 0.25 },
            power_bonus: (if lvl >= 8 { 1 + (c * 3.0) as u32 } else { 0 })
                + (if lvl >= 13 { 2 } else { 0 }),
            global_multiplier: global,
        }
    }

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

    #[allow(dead_code)]
    pub fn get_attack_prediction(&self) -> Option<(f64, String)> {
        if self.threat_memory.is_empty() {
            return None;
        }
        let recent: Vec<_> = self.threat_memory.iter().rev().take(30).collect();
        let total_weight: f64 = recent.iter().map(|r| r.weight).sum();
        let attack_weight: f64 = recent
            .iter()
            .filter(|r| r.was_real_attack)
            .map(|r| r.weight)
            .sum();
        let weighted_prob = if total_weight > 0.0 {
            attack_weight / total_weight
        } else {
            0.0
        };
        let confidence = weighted_prob * (0.4 + self.prediction_accuracy * 0.6);
        if confidence > self.adaptive_alarm_threshold * 0.8 {
            let common_type = recent
                .iter()
                .filter(|r| r.was_real_attack)
                .map(|r| &r.threat_type)
                .fold(HashMap::<&String, usize>::new(), |mut acc, t| {
                    *acc.entry(t).or_insert(0) += 1;
                    acc
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

    fn calculate_cooldown(
        &self,
        had_real_attack: bool,
        rebel_activity: u32,
        state: &GameState,
    ) -> i32 {
        let base = if had_real_attack {
            8
        } else if rebel_activity >= 7 {
            12
        } else if rebel_activity >= 4 {
            20
        } else {
            45
        };
        let reduction = (self.evolution_level / 5) as i32;
        let mut result = (base - reduction).max(8);

        if state.fear_level >= 5 {
            result = ((result as f64) * 0.7) as i32;
        }
        result.max(4)
    }

    fn calculate_evolution_points(
        &self,
        had_real_attack: bool,
        rebel_activity: u32,
        was_defended: bool,
        predicted: bool,
        state: &GameState,
    ) -> u32 {
        let base = if had_real_attack {
            45 + rebel_activity * 8
        } else if rebel_activity > 0 {
            10 + rebel_activity * 2
        } else {
            0
        };

        let bonus_defend = if was_defended {
            (self.defense_success_rate * 30.0) as u32
        } else {
            0
        };

        let bonus_predict = if predicted && had_real_attack {
            (self.prediction_accuracy * 25.0) as u32 + self.correct_prediction_streak * 4
        } else {
            0
        };

        let activity_multiplier = if had_real_attack {
            1.0
        } else if rebel_activity > 0 {
            0.5
        } else {
            0.0
        };
        let evo_bonus = (self.evolution_level as f64 * 4.0 * activity_multiplier) as u32;

        let mut result = base + bonus_defend + bonus_predict + evo_bonus;

        if state.fear_level >= 5 {
            result = ((result as f64) * 1.5) as u32;
        }

        result
    }

    fn update_metrics(&mut self, had_attack: bool, was_defended: bool, predicted: bool) {
        self.total_attacks_processed += 1;
        if predicted && had_attack {
            self.successful_predictions += 1;
        }
        if had_attack {
            let s = if was_defended { 1.0 } else { 0.0 };
            self.defense_success_rate = self.defense_success_rate * 0.88 + s * 0.12;
        }
        self.avg_reaction_time =
            self.avg_reaction_time * 0.95 + (self.reaction_cooldown as f32) * 0.05;
    }

    fn update_bonuses(&mut self) {
        self.prediction_bonus = self.prediction_bonus.max(self.system_consciousness * 0.35);
        if self.evolution_level >= 3 {
            let min_bonus = 0.15 + self.evolution_level as f64 * 0.025;
            self.active_defense_bonus = self.active_defense_bonus.max(min_bonus);
        }
    }

    fn cleanup_old_memory(&mut self, current_time: i64) {
        for record in self.threat_memory.iter_mut() {
            let age = current_time - record.timestamp;
            if age > 100 {
                record.weight *= 0.995;
            }
        }
        self.threat_memory
            .retain(|r| current_time - r.timestamp <= 600 && r.weight > 0.01);
        self.learned_patterns
            .retain(|p| p.usage_count > 0 || current_time - p.last_used < 900);
    }

    #[allow(dead_code)]
    pub fn get_status(&self) -> String {
        let (next, _) = self.get_next_level_requirements();
        format!("🧬 Ур.{} | {}/{} | Сознание:{:.1}% | Точность:{:.0}% | Защита:+{:.0}% | Q-шаги:{} | Доверие:{:.0}%",
            self.evolution_level, self.evolution_score, next, self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0, self.get_defense_bonus() * 100.0,
            self.stats.q_learning_steps, self.prediction_trust * 100.0)
    }

    #[allow(dead_code)]
    pub fn get_next_level_requirements(&self) -> (u32, u32) {
        (
            self.get_evolution_requirement(),
            50 + self.evolution_level * 5,
        )
    }

    #[allow(dead_code)]
    pub fn get_debug_info(&self) -> String {
        format!("Neuro Lvl:{} Score:{} Consc:{:.0}% PredAcc:{:.0}% DefBonus:{:.0}% | Bayesian[act]:{:.0}% Markov→{:?} | Q-ε:{:.2} AvgR:{:.2} | CUSUM:{:.1}/{:.1} AlarmThr:{:.0}% Streak:{} Trust:{:.0}%",
            self.evolution_level, self.evolution_score, self.system_consciousness * 100.0,
            self.prediction_accuracy * 100.0, self.get_defense_bonus() * 100.0,
            self.bayesian_nodes[0].ewma_probability * 100.0,
            self.markov_chain.predict_next(&self.current_ai_state).0,
            self.q_table.epsilon, self.q_table.average_reward(),
            self.cusum_sum, self.cusum_threshold, self.adaptive_alarm_threshold * 100.0,
            self.correct_prediction_streak, self.prediction_trust * 100.0)
    }

    #[allow(dead_code)]
    pub fn threat_memory_len(&self) -> usize {
        self.threat_memory.len()
    }
    pub fn get_evolution_score(&self) -> u32 {
        self.evolution_score
    }

    pub fn load_from_state(&mut self, evolution: u32, consciousness: f64, score: u32) {
        self.evolution_level = evolution;
        let normalized = if consciousness > 1.0 {
            (consciousness / 100.0).clamp(0.0, 1.0)
        } else {
            consciousness.clamp(0.0, 1.0)
        };
        let min_expected = (evolution as f64 * 0.03).clamp(0.05, 0.8);
        self.system_consciousness = if normalized < 0.01 && evolution >= 3 {
            min_expected
        } else {
            normalized
        };
        self.evolution_score = score;
        self.last_processed_time = 0;
        self.cooldown = (10 - (evolution / 2) as i32).max(4);
        self.reaction_cooldown = (8 - (evolution / 3) as i32).max(2);
        self.attack_counter = 0;
        self.cusum_threshold = (5.0 - evolution as f64 * 0.3).max(2.0);
        self.update_bonuses();
        self.intercepted_messages.clear();
        self.last_intercept_at = -100;
        self.propaganda_active = false;
        self.fake_depot_active = false;
        self.fake_depot_ttl = 0;
        self.pending_vulnerability = None;
        self.enemy_encryption_level = 0;
        self.counter_op_cooldowns.clear();
        self.last_log_time = -100;
    }

    pub fn launch_propaganda(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if self.evolution_level < 3 {
            events.push(GameEvent::LogMessage(
                "❌ Контр-пропаганда требует эволюцию нейро Ур.3+".to_string(),
            ));
            return events;
        }
        if self.get_cooldown_remaining("propaganda", state.tick_count) > 0 {
            let remaining = self.get_cooldown_remaining("propaganda", state.tick_count);
            events.push(GameEvent::LogMessage(format!(
                "⏳ Контр-пропаганда на перезарядке: {} тиков",
                remaining
            )));
            return events;
        }
        if state.inventory.chips < 20 {
            events.push(GameEvent::LogMessage(
                "❌ Недостаточно чипов (нужно 20) для взлома".to_string(),
            ));
            return events;
        }
        state.inventory.chips -= 20;
        let morale_damage = 0.15 + self.system_consciousness * 0.15;
        rebel_system.apply_morale_damage(morale_damage);
        rebel_system.last_neuro_propaganda = state.tick_count;
        self.enemy_encryption_level = (self.enemy_encryption_level + 1).min(5);
        self.propaganda_active = true;
        self.propaganda_expires_at = state.tick_count + 40;
        self.set_cooldown("propaganda", state.tick_count, 35);
        state.current_ai_mode = "📡 Дезинформация активна".to_string();
        events.push(GameEvent::LogMessage(format!("📡 КОНТР-ПРОПАГАНДА: нейро взломала {:.0}% каналов повстанцев. Мораль врага -{:.0}%. Работает 40 тиков. Стоимость: 20 чипов.", (1.0 - rebel_system.ai_adaptation.prediction_evasion) * 100.0, morale_damage * 100.0)));
        self.sync_to_state(state);
        events
    }

    pub fn deploy_fake_depot(
        &mut self,
        state: &mut GameState,
        _rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if self.evolution_level < 4 {
            events.push(GameEvent::LogMessage(
                "❌ Ловушка требует эволюцию нейро Ур.4+".to_string(),
            ));
            return events;
        }
        if self.fake_depot_active {
            events.push(GameEvent::LogMessage("⚠️ Ловушка уже активна".to_string()));
            return events;
        }
        if state.inventory.trash < 50 {
            events.push(GameEvent::LogMessage(
                "❌ Нужно 50 мусора для создания ловушки".to_string(),
            ));
            return events;
        }
        if self.get_cooldown_remaining("fake_depot", state.tick_count) > 0 {
            events.push(GameEvent::LogMessage(
                "⏳ Нужна перезарядка перед новой операцией".to_string(),
            ));
            return events;
        }
        state.inventory.trash -= 50;
        self.fake_depot_active = true;
        self.fake_depot_expires_at = state.tick_count + 70;
        self.fake_depot_ttl = 70;
        self.set_cooldown("fake_depot", state.tick_count, 45);
        state.current_ai_mode = "🪤 Ловушка расставлена".to_string();
        events.push(GameEvent::LogMessage("💣 ЛОВУШКА АКТИВНА: нейро создала фальшивый склад ресурсов (50 мусора). Если повстанцы попытаются его ограбить — взрыв! Время жизни: 70 тиков.".to_string()));
        self.sync_to_state(state);
        events
    }

    pub fn close_vulnerability(
        &mut self,
        state: &mut GameState,
        rebel_system: &mut RebelSystem,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let _vuln = match rebel_system.current_vulnerability.clone() {
            Some(v) => v,
            None => {
                events.push(GameEvent::LogMessage(
                    "✅ Нейро не обнаружила активных уязвимостей. Системы в порядке.".to_string(),
                ));
                return events;
            }
        };
        if self.evolution_level < 2 {
            events.push(GameEvent::LogMessage(
                "❌ Нужна эволюция Ур.2+ для патча уязвимости".to_string(),
            ));
            return events;
        }
        if state.inventory.chips < 15 {
            events.push(GameEvent::LogMessage(
                "❌ Нужно 15 чипов для патча".to_string(),
            ));
            return events;
        }
        if self.get_cooldown_remaining("close_vulnerability", state.tick_count) > 0 {
            events.push(GameEvent::LogMessage(
                "⏳ Ещё не готова к патчингу".to_string(),
            ));
            return events;
        }
        state.inventory.chips -= 15;

        if rebel_system.arms_race_level > 0 {
            rebel_system.arms_race_level = rebel_system.arms_race_level.saturating_sub(1);
        }
        rebel_system.current_vulnerability = None;
        events.push(GameEvent::LogMessage(
            "🔒 Уязвимость закрыта. Гонка вооружений откатилась назад.".to_string(),
        ));

        self.set_cooldown("close_vulnerability", state.tick_count, 25);
        self.sync_to_state(state);
        events
    }
}
