use crate::game::config::GameConfig;
use crate::game::state::AttackRecord;
use crate::game::{GameEvent, GameState};
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::JsValue;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum PersonalityType {
    Coward,
    Fanatic,
    Strategist,
    Chaos,
}

impl Default for PersonalityType {
    fn default() -> Self {
        PersonalityType::Fanatic
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct CommanderState {
    pub name: String,
    pub consecutive_losses: u32,
    pub is_frustrated: bool,
    pub quiet_nights_accumulated: u32,
    pub last_loss_time: i64,
    pub signature_attack: AttackType,
}

impl CommanderState {
    fn new_for(faction_id: &str) -> Self {
        let (name, sig) = match faction_id {
            "scavengers" => ("Рекс «Падальщик»", AttackType::ResourceRaid),
            "technomads" => ("Доктор Вирус", AttackType::Technological),
            "cyber_rebels" => ("Призрак-7", AttackType::Stealth),
            _ => ("Неизвестный", AttackType::DirectAssault),
        };
        Self {
            name: name.to_string(),
            consecutive_losses: 0,
            is_frustrated: false,
            quiet_nights_accumulated: 0,
            last_loss_time: -999,
            signature_attack: sig,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
pub enum AttackType {
    ResourceRaid,
    PowerSabotage,
    DirectAssault,
    Psychological,
    Stealth,
    Technological,
    FleetAssault,
    BlueprintTheft,
    PlanetHarass,
    TecSabotage,
    CoalitionStrike,
    ProtectionBreach,
}

impl Default for AttackType {
    fn default() -> Self {
        AttackType::ResourceRaid
    }
}

impl AttackType {
    pub fn to_index(&self) -> usize {
        match self {
            Self::ResourceRaid => 0,
            Self::PowerSabotage => 1,
            Self::DirectAssault => 2,
            Self::Psychological => 3,
            Self::Stealth => 4,
            Self::Technological => 5,
            Self::FleetAssault => 6,
            Self::BlueprintTheft => 7,
            Self::PlanetHarass => 8,
            Self::TecSabotage => 9,
            Self::CoalitionStrike => 10,
            Self::ProtectionBreach => 11,
        }
    }

    pub fn from_index(i: usize) -> Self {
        match i % 12 {
            0 => Self::ResourceRaid,
            1 => Self::PowerSabotage,
            2 => Self::DirectAssault,
            3 => Self::Psychological,
            4 => Self::Stealth,
            5 => Self::Technological,
            6 => Self::FleetAssault,
            7 => Self::BlueprintTheft,
            8 => Self::PlanetHarass,
            9 => Self::TecSabotage,
            10 => Self::CoalitionStrike,
            _ => Self::ProtectionBreach,
        }
    }
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
            AttackType::FleetAssault => write!(f, "🚀 Атака на флот"),
            AttackType::BlueprintTheft => write!(f, "📐 Кража чертежей"),
            AttackType::PlanetHarass => write!(f, "🪐 Атака на планету"),
            AttackType::TecSabotage => write!(f, "🔥 Саботаж ТЭЦ"),
            AttackType::CoalitionStrike => write!(f, "⚡ Коалиционный удар"),
            AttackType::ProtectionBreach => write!(f, "💀 Прорыв защиты"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TacticGenome {
    pub weights: [f64; 12],
    pub fitness: f64,
    pub age: u32,
    pub mutations: u32,
}

impl TacticGenome {
    fn new_default() -> Self {
        Self {
            weights: [
                0.25, 0.15, 0.12, 0.08, 0.08, 0.08, 0.06, 0.05, 0.05, 0.04, 0.02, 0.02,
            ],
            fitness: 0.0,
            age: 0,
            mutations: 0,
        }
    }
    fn mutate(&mut self, temperature: f64, rng_idx: f64, rng_noise: f64) {
        let idx = (rng_idx * 12.0) as usize % 12;
        let noise = (rng_noise * 2.0 - 1.0) * temperature * 0.15;
        self.weights[idx] = (self.weights[idx] + noise).clamp(0.01, 0.9);
        self.mutations += 1;
        self.normalize();
    }
    fn crossover(&self, other: &TacticGenome, point: usize) -> TacticGenome {
        let mut child = self.clone();
        for i in point..12 {
            child.weights[i] = other.weights[i];
        }
        child.fitness = 0.0;
        child.age = 0;
        child.normalize();
        child
    }
    fn normalize(&mut self) {
        let sum: f64 = self.weights.iter().sum();
        if sum > 0.0 {
            for w in self.weights.iter_mut() {
                *w /= sum;
            }
        }
    }
    fn update_fitness(&mut self, success: bool) {
        let signal = if success { 1.0 } else { -0.3 };
        self.fitness = self.fitness * 0.92 + signal * 0.08;
        self.age += 1;
    }
    #[allow(dead_code)]
    fn get_weight(&self, idx: usize) -> f64 {
        self.weights[idx.min(11)]
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SarsaAgent {
    pub q_table: Vec<[f64; 12]>,
    pub eligibility: Vec<[f64; 12]>,
    pub last_state: usize,
    pub last_action: usize,
    pub alpha: f64,
    pub gamma: f64,
    pub lambda: f64,
    pub epsilon: f64,
    pub total_reward: f64,
}

impl SarsaAgent {
    fn new() -> Self {
        Self {
            q_table: vec![[0.1f64; 12]; 16],
            eligibility: vec![[0.0f64; 12]; 16],
            last_state: 0,
            last_action: 0,
            alpha: 0.12,
            gamma: 0.85,
            lambda: 0.7,
            epsilon: 0.25,
            total_reward: 0.0,
        }
    }
    fn choose_action(&mut self, state: usize, rng_val: f64) -> usize {
        self.epsilon = (self.epsilon * 0.995).max(0.05);
        if rng_val < self.epsilon {
            ((rng_val / self.epsilon) * 12.0) as usize % 12
        } else {
            self.q_table[state.min(15)]
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                .map(|(i, _)| i)
                .unwrap_or(0)
        }
    }
    fn update(&mut self, s: usize, a: usize, r: f64, s_next: usize, a_next: usize) {
        let s = s.min(15);
        let s_next = s_next.min(15);
        let a = a.min(11);
        let a_next = a_next.min(11);
        let td_error = r + self.gamma * self.q_table[s_next][a_next] - self.q_table[s][a];
        for i in 0..16 {
            for j in 0..12 {
                self.eligibility[i][j] *= self.gamma * self.lambda;
            }
        }
        self.eligibility[s][a] += 1.0;
        for i in 0..16 {
            for j in 0..12 {
                self.q_table[i][j] += self.alpha * td_error * self.eligibility[i][j];
                self.q_table[i][j] = self.q_table[i][j].clamp(-5.0, 5.0);
            }
        }
        self.total_reward += r;
        self.last_state = s_next;
        self.last_action = a_next;
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

struct AttackExecutionSummary {
    stolen_map: HashMap<String, u32>,
    total_stolen: u32,
    defense_damaged: bool,
    mining_damaged: bool,
    autoclick_damaged: bool,
    player_harmed: bool,
    result_details: String,
}

impl AttackExecutionSummary {
    fn new() -> Self {
        Self {
            stolen_map: HashMap::new(),
            total_stolen: 0,
            defense_damaged: false,
            mining_damaged: false,
            autoclick_damaged: false,
            player_harmed: false,
            result_details: String::new(),
        }
    }

    fn attack_record_result(&self, final_success: bool) -> String {
        if !final_success {
            return if self.result_details.is_empty() {
                "отражена".to_string()
            } else {
                self.result_details.clone()
            };
        }

        if self.total_stolen > 0 {
            format!("украдено {} ресурсов", self.total_stolen)
        } else if self.defense_damaged {
            "повреждена защита".to_string()
        } else if self.mining_damaged {
            "саботаж добычи".to_string()
        } else if self.autoclick_damaged {
            "психологическая атака".to_string()
        } else if self.result_details.is_empty() {
            "нанесён урон системам".to_string()
        } else {
            self.result_details.clone()
        }
    }
}

impl AttackPlan {
    pub fn calculate_attack_power(&self) -> f64 {
        let base = match self.attack_type {
            AttackType::ResourceRaid => 15.0,
            AttackType::PowerSabotage => 22.0,
            AttackType::DirectAssault => 32.0,
            AttackType::Psychological => 14.0,
            AttackType::Stealth => 20.0,
            AttackType::Technological => 28.0,
            AttackType::FleetAssault => 35.0,
            AttackType::BlueprintTheft => 18.0,
            AttackType::PlanetHarass => 25.0,
            AttackType::TecSabotage => 30.0,
            AttackType::CoalitionStrike => 45.0,
            AttackType::ProtectionBreach => 40.0,
        };
        base * (0.75 + self.stealth_level * 0.5)
    }
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
pub struct RebelFaction {
    pub id: String,
    pub name: String,
    pub evolution_stage: u32,
    pub primary_motivation: String,
    pub resources: FactionResources,
    pub personnel: Personnel,
    pub last_activity: i64,
    pub specializations: Vec<String>,
    pub ideology: String,
    pub personality: PersonalityType,
    pub commander: CommanderState,
    pub decoy_use_count: u32,
    pub decoy_ignored_by_player: u32,
    pub consecutive_quiet_nights: u32,
}

impl RebelFaction {
    fn new_scavengers() -> Self {
        Self {
            id: "scavengers".to_string(),
            name: "Мародёры".to_string(),
            evolution_stage: 0,
            primary_motivation: "resources".to_string(),
            resources: FactionResources {
                experience: 10,
                manpower: 100,
                technology: 5,
                morale: 0.7,
                weapons: 20,
                intelligence: 15,
            },
            personnel: Personnel {
                total: 100,
                operatives: 30,
                commanders: 3,
                specialists: 5,
            },
            last_activity: 0,
            specializations: vec!["raid".to_string()],
            ideology: "Выживание любой ценой".to_string(),
            personality: PersonalityType::Fanatic,
            commander: CommanderState::new_for("scavengers"),
            decoy_use_count: 0,
            decoy_ignored_by_player: 0,
            consecutive_quiet_nights: 0,
        }
    }
    fn new_technomads() -> Self {
        Self {
            id: "technomads".to_string(),
            name: "Технокочевники".to_string(),
            evolution_stage: 0,
            primary_motivation: "technology".to_string(),
            resources: FactionResources {
                experience: 20,
                manpower: 60,
                technology: 30,
                morale: 0.6,
                weapons: 15,
                intelligence: 25,
            },
            personnel: Personnel {
                total: 60,
                operatives: 20,
                commanders: 5,
                specialists: 10,
            },
            last_activity: 0,
            specializations: vec!["technology".to_string(), "stealth".to_string()],
            ideology: "Технологии освободят нас".to_string(),
            personality: PersonalityType::Strategist,
            commander: CommanderState::new_for("technomads"),
            decoy_use_count: 2,
            decoy_ignored_by_player: 0,
            consecutive_quiet_nights: 0,
        }
    }
    fn new_cyber_rebels() -> Self {
        Self {
            id: "cyber_rebels".to_string(),
            name: "Кибер-повстанцы".to_string(),
            evolution_stage: 0,
            primary_motivation: "freedom".to_string(),
            resources: FactionResources {
                experience: 15,
                manpower: 40,
                technology: 25,
                morale: 0.8,
                weapons: 10,
                intelligence: 35,
            },
            personnel: Personnel {
                total: 40,
                operatives: 15,
                commanders: 4,
                specialists: 12,
            },
            last_activity: 0,
            specializations: vec!["psychological".to_string(), "stealth".to_string()],
            ideology: "Долой корпоративный ИИ!".to_string(),
            personality: PersonalityType::Chaos,
            commander: CommanderState::new_for("cyber_rebels"),
            decoy_use_count: 1,
            decoy_ignored_by_player: 0,
            consecutive_quiet_nights: 0,
        }
    }
    fn update(&mut self, state: &GameState) {
        if !state.is_day {
            self.resources.manpower = (self.resources.manpower + 1).min(200);
            self.resources.experience += 1;
            self.personnel.operatives = (self.resources.manpower / 3).min(70);
        } else {
            self.resources.manpower = (self.resources.manpower.saturating_sub(1)).max(10);
            self.personnel.operatives = (self.resources.manpower / 3).min(50);
        }
    }
    #[allow(dead_code)]
    fn calculate_power(&self) -> u32 {
        self.resources.experience / 10
            + self.resources.manpower / 5
            + self.resources.technology * 3
            + self.resources.weapons * 2
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CounterTactic {
    pub name: String,
    pub effectiveness: f64,
    pub usage_count: u32,
    pub last_used: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AIAdaptation {
    pub recognized_patterns: Vec<String>,
    pub counter_tactics: HashMap<String, CounterTactic>,
    pub last_ai_decision: Option<String>,
    pub adaptation_speed: f64,
    pub prediction_evasion: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct TacticPreferences {
    pub resource_raid: f64,
    pub power_sabotage: f64,
    pub direct_assault: f64,
    pub psychological: f64,
    pub stealth: f64,
    pub sabotage: f64,
    pub fleet_assault: f64,
    pub blueprint_theft: f64,
    pub planet_harass: f64,
    pub tec_sabotage: f64,
    pub coalition_strike: f64,
    pub protection_breach: f64,
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
    pub campaigns_started: u32,
    pub genome_mutations: u32,
    pub nash_solutions: u32,
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
    pub start_time: i64,
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

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SubTask {
    pub task_type: usize,
    pub target: String,
    pub estimated_gain: f64,
    pub risk: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct HierarchicalPlan {
    pub id: String,
    pub goal: String,
    pub subtasks: VecDeque<SubTask>,
    pub priority: f64,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Campaign {
    pub name: String,
    pub phase: u32,
    pub total_phases: u32,
    pub attacks_in_phase: u32,
    pub goals: Vec<String>,
    pub started_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct RebelSystem {
    pub factions: HashMap<String, RebelFaction>,
    pub active_faction: Option<String>,
    pub evolution_level: u32,
    pub evolution_score: u32,
    pub adaptation_level: u32,
    pub morale: f64,
    pub aggression: f64,
    pub strategic_intelligence: f64,
    pub ai_adaptation: AIAdaptation,
    pub last_ai_level: u32,
    pub ai_threat_perception: f64,
    pub operation_queue: VecDeque<Operation>,
    pub active_operations: HashMap<String, ActiveOperation>,
    pub tactic_preferences: TacticPreferences,
    pub last_major_operation: i64,
    pub last_attack_time: i64,
    pub last_strategy_switch: i64,
    pub stats: RebelStats,
    pub available_forces_cache: usize,
    pub current_night_type: String,
    pub genome_population: Vec<TacticGenome>,
    pub best_genome: TacticGenome,
    pub sa_temperature: f64,
    pub sarsa_agents: HashMap<String, SarsaAgent>,
    pub nash_strategy: [f64; 12],
    pub coalition_matrix: HashMap<(String, String), f64>,
    pub htn_plans: VecDeque<HierarchicalPlan>,
    pub current_campaign: Option<Campaign>,
    pub attack_type_success: HashMap<usize, (u32, u32)>,
    pub target_value_estimate: HashMap<String, f64>,
    pub genome_switch_cooldown: i32,
    pub psych_pressure: f64,
    pub prng_counter: u64,
    pub player_reaction_times: VecDeque<i64>,
    pub slow_reaction_count: u32,
    pub multiphase_active: bool,
    pub multiphase_phase: u32,
    pub multiphase_timer: i32,
    pub arms_race_level: u32,
    pub current_vulnerability: Option<String>,
    pub cyber_attack_unlocked: bool,
    pub trap_triggered: bool,
    pub last_neuro_propaganda: i64,
    pub last_scanner_warning_at: i64,
}

impl Default for RebelSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl RebelSystem {
    pub fn new() -> Self {
        let mut factions = HashMap::new();
        factions.insert("scavengers".to_string(), RebelFaction::new_scavengers());
        factions.insert("technomads".to_string(), RebelFaction::new_technomads());
        factions.insert("cyber_rebels".to_string(), RebelFaction::new_cyber_rebels());

        let mut sarsa_agents = HashMap::new();
        sarsa_agents.insert("scavengers".to_string(), SarsaAgent::new());
        sarsa_agents.insert("technomads".to_string(), SarsaAgent::new());
        sarsa_agents.insert("cyber_rebels".to_string(), SarsaAgent::new());

        let mut coalition_matrix = HashMap::new();
        let names = ["scavengers", "technomads", "cyber_rebels"];
        for &a in &names {
            for &b in &names {
                if a != b {
                    coalition_matrix.insert((a.to_string(), b.to_string()), 0.3);
                }
            }
        }

        let genome_population = vec![
            TacticGenome::new_default(),
            TacticGenome {
                weights: [
                    0.15, 0.20, 0.08, 0.12, 0.12, 0.08, 0.05, 0.04, 0.04, 0.04, 0.04, 0.04,
                ],
                fitness: 0.0,
                age: 0,
                mutations: 0,
            },
            TacticGenome {
                weights: [
                    0.08, 0.08, 0.20, 0.15, 0.08, 0.15, 0.04, 0.04, 0.04, 0.04, 0.08, 0.06,
                ],
                fitness: 0.0,
                age: 0,
                mutations: 0,
            },
        ];

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
            genome_population,
            best_genome: TacticGenome::new_default(),
            sa_temperature: 1.0,
            sarsa_agents,
            nash_strategy: [1.0 / 12.0; 12],
            coalition_matrix,
            htn_plans: VecDeque::new(),
            current_campaign: None,
            attack_type_success: HashMap::new(),
            target_value_estimate: HashMap::new(),
            genome_switch_cooldown: 0,
            psych_pressure: 0.0,
            prng_counter: 0,
            player_reaction_times: VecDeque::with_capacity(20),
            slow_reaction_count: 0,
            multiphase_active: false,
            multiphase_phase: 0,
            multiphase_timer: 0,
            arms_race_level: 0,
            current_vulnerability: None,
            cyber_attack_unlocked: false,
            trap_triggered: false,
            last_neuro_propaganda: -999,
            last_scanner_warning_at: -999,
        }
    }

    pub fn after_deserialize(&mut self) {
        if let Some(best) = self
            .genome_population
            .iter()
            .max_by(|a, b| a.fitness.partial_cmp(&b.fitness).unwrap())
        {
            self.best_genome = best.clone();
        }
        self.sync_preferences_from_genome();
        if self.player_reaction_times.is_empty() {
            self.slow_reaction_count = 0;
        }
    }

    pub fn restore_runtime_from_state(&mut self, state: &GameState) {
        self.arms_race_level = state.arms_race_level;
        self.current_vulnerability = if state.current_vulnerability.is_empty() {
            None
        } else {
            Some(state.current_vulnerability.clone())
        };
        self.multiphase_active = state.multiphase_warning;
        if !self.multiphase_active {
            self.multiphase_phase = 0;
            self.multiphase_timer = 0;
        }

        self.stats.total_attacks = self.stats.total_attacks.max(state.rebel_attacks_count);
        self.stats.defenses_bypassed = self.stats.defenses_bypassed.max(state.total_breaches);
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

    fn sync_preferences_from_genome(&mut self) {
        let w = &self.best_genome.weights;
        self.tactic_preferences = TacticPreferences {
            resource_raid: w[0],
            power_sabotage: w[1],
            direct_assault: w[2],
            psychological: w[3],
            stealth: w[4],
            sabotage: w[5],
            fleet_assault: w[6],
            blueprint_theft: w[7],
            planet_harass: w[8],
            tec_sabotage: w[9],
            coalition_strike: w[10],
            protection_breach: w[11],
        };
    }

    fn compute_nash_strategy(&mut self, defense_power: f64, ai_evolution: u32) {
        let def = defense_power.clamp(0.0, 1.0);
        let evo_factor = 1.0 + ai_evolution as f64 * 0.05;
        let payoffs: [f64; 12] = [
            0.55 / evo_factor,
            (0.5 - def * 0.3).max(0.1),
            (0.4 - def * 0.4).max(0.05),
            0.65 / (1.0 + def * 0.2),
            0.7 * (1.0 - def * 0.15),
            0.45 + (ai_evolution as f64 * 0.02).min(0.2),
            0.35 + (ai_evolution as f64 * 0.01).min(0.15),
            0.30 + (ai_evolution as f64 * 0.01).min(0.12),
            0.55 / (1.0 + def * 0.1),
            0.40 + (ai_evolution as f64 * 0.015).min(0.18),
            0.60 * (1.0 + ai_evolution as f64 * 0.03),
            0.50 + (ai_evolution as f64 * 0.02).min(0.25),
        ];
        let max_p = payoffs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let exps: [f64; 12] = std::array::from_fn(|i| ((payoffs[i] - max_p) * 3.0).exp());
        let sum_exp: f64 = exps.iter().sum();
        for i in 0..12 {
            self.nash_strategy[i] = self.nash_strategy[i] * 0.7 + (exps[i] / sum_exp) * 0.3;
        }
        self.stats.nash_solutions += 1;
    }

    fn htn_decompose_goal(&self, goal: &str, state: &GameState) -> HierarchicalPlan {
        let subtasks = match goal {
            "weaken_defense" => {
                let mut tasks = VecDeque::new();
                tasks.push_back(SubTask {
                    task_type: 3,
                    target: "morale".to_string(),
                    estimated_gain: 0.3,
                    risk: 0.2,
                });
                tasks.push_back(SubTask {
                    task_type: 5,
                    target: "upgrades".to_string(),
                    estimated_gain: 0.5,
                    risk: 0.4,
                });
                tasks.push_back(SubTask {
                    task_type: 2,
                    target: "defense".to_string(),
                    estimated_gain: 0.8,
                    risk: 0.7,
                });
                tasks
            }
            "steal_plasma" => {
                let mut tasks = VecDeque::new();
                tasks.push_back(SubTask {
                    task_type: 4,
                    target: "detection".to_string(),
                    estimated_gain: 0.2,
                    risk: 0.15,
                });
                tasks.push_back(SubTask {
                    task_type: 0,
                    target: "plasma".to_string(),
                    estimated_gain: 1.0,
                    risk: 0.5,
                });
                tasks
            }
            "demoralize" => {
                let mut tasks = VecDeque::new();
                tasks.push_back(SubTask {
                    task_type: 3,
                    target: "autoclick".to_string(),
                    estimated_gain: 0.4,
                    risk: 0.1,
                });
                tasks.push_back(SubTask {
                    task_type: 3,
                    target: "trade".to_string(),
                    estimated_gain: 0.4,
                    risk: 0.15,
                });
                tasks
            }
            _ => VecDeque::new(),
        };
        let priority = match goal {
            "weaken_defense" => {
                if state.upgrades.defense {
                    0.9
                } else {
                    0.3
                }
            }
            "steal_plasma" => {
                if state.inventory.plasma > 2 {
                    0.8
                } else {
                    0.2
                }
            }
            "demoralize" => 0.5 + self.psych_pressure * 0.4,
            _ => 0.3,
        };
        HierarchicalPlan {
            id: format!("{}_{}", goal, state.tick_count),
            goal: goal.to_string(),
            subtasks,
            priority,
            created_at: state.tick_count,
        }
    }

    fn strategic_planning_htn(&mut self, state: &GameState) {
        if state.rebel_activity < 4 {
            return;
        }
        let goal = if state.upgrades.defense && state.upgrades.defense_level >= 2 {
            "weaken_defense"
        } else if state.inventory.plasma > 3 && self.strategic_intelligence > 0.5 {
            "steal_plasma"
        } else if self.psych_pressure > 0.4 {
            "demoralize"
        } else {
            "steal_plasma"
        };
        if self.htn_plans.iter().any(|p| p.goal == goal) {
            return;
        }
        let plan = self.htn_decompose_goal(goal, state);
        self.htn_plans.push_back(plan);
        if self.htn_plans.len() > 5 {
            self.htn_plans.pop_front();
        }
    }

    fn get_player_fleet_count(&self, _state: &GameState) -> u32 {
        if let Some(window) = web_sys::window() {
            if let Ok(fleet_module) =
                js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule"))
            {
                if let Ok(ships) = js_sys::Reflect::get(&fleet_module, &JsValue::from_str("ships"))
                {
                    if let Ok(length) = js_sys::Reflect::get(&ships, &JsValue::from_str("length")) {
                        return length.as_f64().unwrap_or(0.0) as u32;
                    }
                }
            }
        }
        0
    }

    fn calculate_attack_probability_ai(&mut self, state: &GameState, config: &GameConfig) -> f64 {
        let mut p = config.rebels.base_attack_chance;
        p += ((state.rebel_activity as f64 + 1.0).ln() * 0.12).min(0.5);
        p += if !state.is_day { 0.28 } else { 0.0 };
        p += if !state.upgrades.defense { 0.12 } else { 0.0 };
        p += self.aggression * 0.22;
        p += self.strategic_intelligence * 0.08;

        let adaptation_bonus = (self.adaptation_level as f64 * 0.015).min(0.15);
        p += adaptation_bonus;

        if config.rebels.fear_scaling_enabled {
            let neuro_scaling =
                state.neuro_evolution as f64 * config.rebels.attack_chance_per_neuro_level;
            p += neuro_scaling.min(0.30);

            let mining_scaling = state.upgrades.mining as f64 * config.rebels.mining_level_scaling;
            p += mining_scaling.min(0.10);

            let fleet_count = self.get_player_fleet_count(state);
            let fleet_scaling = fleet_count as f64 * config.rebels.fleet_scaling_per_ship;
            p += fleet_scaling.min(0.15);
        }

        let fear_aggression = 1.0 + (state.fear_level as f64 * 0.03);
        p *= fear_aggression.min(1.5);

        let consciousness_penalty = state.neuro_consciousness * 0.18;
        p *= (1.0 - consciousness_penalty).max(0.55);

        let nash_attack_prob = self
            .nash_strategy
            .iter()
            .enumerate()
            .map(|(i, &w)| {
                w * match i {
                    2 => 0.9,
                    0 => 0.7,
                    5 => 0.6,
                    _ => 0.4,
                }
            })
            .sum::<f64>();
        p += nash_attack_prob * 0.15;

        if let Some(ref campaign) = self.current_campaign {
            p += campaign.phase as f64 * 0.05;
        }

        p += self.psych_pressure * 0.08;

        if self.ai_adaptation.prediction_evasion > 0.3 {
            p += self.ai_adaptation.prediction_evasion * 0.18;
        }

        if self.stats.total_attacks > 0 {
            let sr = self.stats.successful_attacks as f64 / self.stats.total_attacks as f64;
            p += sr * 0.08;
        }

        if state.rebel_activity >= 5 {
            p = p.max(0.18);
        }

        let morale_mod = 0.7 + self.morale * 0.6;
        p *= morale_mod;

        if let Some(active_id) = &self.active_faction.clone() {
            if let Some(faction) = self.factions.get(active_id) {
                let personality = faction.personality.clone();
                let consecutive_losses = faction.commander.consecutive_losses;
                let quiet_nights_accumulated = faction.commander.quiet_nights_accumulated;
                let consecutive_quiet_nights = faction.consecutive_quiet_nights;
                let is_frustrated = faction.commander.is_frustrated;

                let mut mod_p = 1.0;
                match personality {
                    PersonalityType::Coward => {
                        if consecutive_losses >= 1 {
                            if quiet_nights_accumulated < 2 {
                                mod_p = 0.25;
                            } else {
                                mod_p = 1.8;
                            }
                        }
                    }
                    PersonalityType::Fanatic => {
                        mod_p = 1.5;
                        p += 0.10;
                    }
                    PersonalityType::Strategist => {
                        mod_p = if consecutive_quiet_nights < 3 {
                            0.05
                        } else {
                            2.2
                        };
                    }
                    PersonalityType::Chaos => {
                        let chaos = self
                            .prng(state.tick_count as u64 * 31 + self.stats.total_attacks as u64);
                        mod_p = 0.2 + chaos * 2.5;
                    }
                }
                p *= mod_p;

                if is_frustrated {
                    p *= 0.55;
                }
            }
        }

        if self.multiphase_active && self.multiphase_phase == 2 {
            p = (p * 1.6).min(config.rebels.max_attack_chance);
        }

        let max_chance = if config.rebels.fear_scaling_enabled {
            config.rebels.max_attack_chance_scaled
        } else {
            config.rebels.max_attack_chance
        };

        p.min(max_chance).max(0.04)
    }

    fn select_attack_type_ai(
        &mut self,
        state: &GameState,
        config: &GameConfig,
        time: u64,
    ) -> AttackType {
        let genome_w = &self.best_genome.weights;
        let nash_w = &self.nash_strategy;
        let sarsa_w = if let Some(fid) = &self.active_faction {
            if let Some(agent) = self.sarsa_agents.get(fid) {
                let s = self.encode_sarsa_state(state);
                let best_a = agent.q_table[s]
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let mut w = [0.05f64; 12];
                w[best_a] += 0.7;
                w
            } else {
                [1.0 / 12.0; 12]
            }
        } else {
            [1.0 / 12.0; 12]
        };

        let mut htn_boost = [0.0f64; 12];
        if let Some(plan) = self.htn_plans.front() {
            if let Some(task) = plan.subtasks.front() {
                let idx = task.task_type.min(11);
                htn_boost[idx] = 0.3 * plan.priority;
            }
        }

        let alpha = 0.25;
        let beta = 0.25;
        let gamma = 0.35;
        let delta = 0.15;
        let mut combined = [0.0f64; 12];

        for i in 0..6 {
            combined[i] =
                alpha * genome_w[i] + beta * nash_w[i] + gamma * sarsa_w[i] + delta * htn_boost[i];
            combined[i] += match i {
                0 if state.inventory.coal > 50 => 0.1,
                1 if state.computational_power > 100 => 0.1,
                2 if !state.upgrades.defense => 0.15,
                4 if self.ai_threat_perception > 0.7 => 0.12,
                5 if state.upgrades.mining >= 5 => 0.12,
                3 if state.neuro_evolution >= 3 => 0.1 + state.neuro_evolution as f64 * 0.04,
                _ => 0.0,
            };
        }

        let fleet_count = self.get_player_fleet_count(state);
        if fleet_count > 0 && config.rebels.fleet_attack_chance > 0.0 {
            combined[6] = config.rebels.fleet_attack_chance + (fleet_count as f64 * 0.01).min(0.15);
        }

        if state.neuro_evolution >= 3 && config.rebels.blueprint_steal_chance > 0.0 {
            let any_blueprint = state.blueprint_cargo_unlocked
                || state.blueprint_scout_unlocked
                || state.blueprint_combat_unlocked;
            if any_blueprint {
                combined[7] = config.rebels.blueprint_steal_chance
                    + (state.neuro_evolution as f64 * 0.005).min(0.08);
            }
        }

        if !state.planets.is_empty() && config.rebels.planet_harass_chance > 0.0 {
            combined[8] =
                config.rebels.planet_harass_chance + (state.planets.len() as f64 * 0.02).min(0.10);
        }

        if state.coal_enabled && config.rebels.tec_sabotage_chance > 0.0 {
            combined[9] =
                config.rebels.tec_sabotage_chance + (state.inventory.coal as f64 * 0.001).min(0.10);
        }

        if self.current_campaign.is_some() && config.rebels.coalition_real_attack_chance > 0.0 {
            combined[10] =
                config.rebels.coalition_real_attack_chance + self.strategic_intelligence * 0.15;
        }

        if state.rebel_protection_active && state.rebel_activity >= 5 {
            combined[11] = config.rebels.breach_protection_chance_base
                + (state.rebel_activity as f64 * config.rebels.breach_protection_per_activity);
            combined[11] = combined[11].min(config.rebels.breach_protection_max);
        }

        if state.fleet_shield_active {
            combined[6] *= 0.35;
            combined[11] += 0.08;
        }
        if state.blueprints_encrypted {
            combined[7] *= 0.25;
            combined[5] += 0.05;
            combined[9] += 0.08;
        }
        if state.planets_fortified {
            combined[8] *= 0.40;
            combined[10] += 0.05;
        }
        if state.fake_depot_active {
            combined[0] *= 0.45;
            combined[3] += 0.04;
            combined[5] += 0.06;
        }
        if state.craft_blocked_until > state.tick_count {
            combined[9] *= 0.20;
        }
        if let Some(vulnerability) = self.current_vulnerability.as_deref() {
            match vulnerability {
                "prediction" => {
                    combined[4] += 0.08;
                    combined[3] += 0.05;
                }
                "defense" => {
                    combined[2] += 0.08;
                    combined[11] += 0.10;
                }
                "craft_chain" => {
                    combined[9] += 0.14;
                    combined[5] += 0.05;
                }
                "communication" => {
                    combined[3] += 0.08;
                    combined[4] += 0.06;
                }
                _ => {}
            }
        }

        let max_c = combined.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let inv_temp = 1.0 / self.sa_temperature.max(0.01);
        let exps: [f64; 12] = std::array::from_fn(|i| ((combined[i] - max_c) * inv_temp).exp());
        let total: f64 = exps.iter().sum();
        let rng = self.prng(time);
        let mut roll = rng * total;
        for i in 0..12 {
            if roll < exps[i] {
                return AttackType::from_index(i);
            }
            roll -= exps[i];
        }
        AttackType::ResourceRaid
    }

    fn prepare_attack_ai(
        &mut self,
        state: &GameState,
        config: &GameConfig,
        time: u64,
    ) -> AttackPlan {
        let attack_type = self.select_attack_type_ai(state, config, time);
        let faction = self
            .attempt_coalition_attack(&attack_type)
            .unwrap_or_else(|| self.select_attacking_faction(&attack_type));

        let htn_target = if let Some(plan) = self.htn_plans.front() {
            if let Some(task) = plan.subtasks.front() {
                Some(task.target.clone())
            } else {
                None
            }
        } else {
            None
        };

        let targets = if let Some(ref target) = htn_target {
            self.select_targets_from_htn(state, config, &attack_type, target)
        } else {
            self.select_targets(state, config, &attack_type)
        };

        if let Some(plan) = self.htn_plans.front_mut() {
            plan.subtasks.pop_front();
        }
        self.htn_plans.retain(|p| !p.subtasks.is_empty());

        let stealth = if self.ai_adaptation.prediction_evasion > 0.3 {
            (0.5 + self.ai_adaptation.prediction_evasion * 0.4).min(0.9)
        } else {
            0.3
        };

        let mut plan = AttackPlan {
            id: format!("attack_{}_{}", faction, state.tick_count),
            attack_type: attack_type.clone(),
            faction,
            targets,
            success_probability: self.calculate_success_probability_ai(state, &attack_type),
            stealth_level: stealth,
            expected_gain: self.calculate_expected_gain(state, &attack_type),
        };

        if let Some(active_id) = &self.active_faction.clone() {
            if let Some(f) = self.factions.get(active_id) {
                if f.commander.is_frustrated {
                    let rng = self.prng(state.tick_count as u64 * 113);
                    plan.success_probability *= 0.55 + rng * 0.15;
                    plan.stealth_level *= 0.6;
                }
            }
        }

        plan
    }

    fn select_attacking_faction(&mut self, attack_type: &AttackType) -> String {
        let rng_val = self.prng(self.stats.total_attacks as u64 * 7 + self.evolution_score as u64);
        let available: Vec<(&String, &RebelFaction)> = self
            .factions
            .iter()
            .filter(|(_, f)| f.personnel.operatives > 0)
            .collect();
        if available.is_empty() {
            return "unknown".to_string();
        }
        let specialized = available
            .iter()
            .find(|(_, f)| match attack_type {
                AttackType::Stealth => f.specializations.contains(&"stealth".to_string()),
                AttackType::Technological => f.specializations.contains(&"technology".to_string()),
                AttackType::Psychological => {
                    f.specializations.contains(&"psychological".to_string())
                }
                _ => false,
            })
            .map(|(id, _)| *id);
        if let Some(id) = specialized {
            return id.clone();
        }
        available[(rng_val * available.len() as f64) as usize % available.len()]
            .0
            .clone()
    }

    fn select_targets_from_htn(
        &mut self,
        state: &GameState,
        config: &GameConfig,
        attack_type: &AttackType,
        htn_target: &str,
    ) -> Vec<AttackTarget> {
        let mut targets = self.select_targets(state, config, attack_type);
        if htn_target == "plasma" && state.inventory.plasma > 0 {
            targets.insert(
                0,
                AttackTarget::Resource {
                    resource: "plasma".to_string(),
                    amount: ((state.inventory.plasma as f64 * 0.2).round() as u32)
                        .min(5)
                        .max(1),
                },
            );
        }
        targets
    }

    fn select_targets(
        &mut self,
        state: &GameState,
        config: &GameConfig,
        attack_type: &AttackType,
    ) -> Vec<AttackTarget> {
        let mut targets = Vec::new();
        let rng_val = self.prng(self.stats.total_attacks as u64 + state.tick_count as u64);

        if state.fake_depot_active {
            let trap_chance = 0.40 + self.strategic_intelligence * 0.25;
            if self.prng(state.tick_count as u64 * 99) < trap_chance {
                targets.clear();
                targets.push(AttackTarget::System {
                    system: "fake_depot".to_string(),
                    damage: 0,
                });
                return targets;
            }
        }

        match attack_type {
            AttackType::ResourceRaid => {
                let best_resource = ["plasma", "chips", "ore", "coal", "trash"]
                    .iter()
                    .max_by(|&&a, &&b| {
                        let va = self
                            .target_value_estimate
                            .get(a)
                            .cloned()
                            .unwrap_or(match a {
                                "plasma" => state.inventory.plasma as f64 * 2.0,
                                "chips" => state.inventory.chips as f64 * 1.5,
                                "ore" => state.inventory.ore as f64 * 1.2,
                                "coal" => state.inventory.coal as f64,
                                _ => 0.0,
                            });
                        let vb = self.target_value_estimate.get(b).cloned().unwrap_or(0.0);
                        va.partial_cmp(&vb).unwrap()
                    })
                    .copied()
                    .unwrap_or("coal");

                let (percent, cap_percent, inventory) = match best_resource {
                    "plasma" => (
                        config.rebels.plasma_steal_percent,
                        config.rebels.plasma_steal_cap_percent,
                        state.inventory.plasma,
                    ),
                    "chips" => (
                        config.rebels.chips_steal_percent,
                        config.rebels.chips_steal_cap_percent,
                        state.inventory.chips,
                    ),
                    "ore" => (
                        config.rebels.ore_steal_percent,
                        config.rebels.ore_steal_cap_percent,
                        state.inventory.ore,
                    ),
                    "trash" => (
                        config.rebels.trash_steal_percent,
                        config.rebels.trash_steal_cap_percent,
                        state.inventory.trash,
                    ),
                    _ => (
                        config.rebels.coal_steal_percent,
                        config.rebels.coal_steal_cap_percent,
                        state.inventory.coal,
                    ),
                };

                let base_amount: u32 = ((inventory as f64) * (percent as f64)).round() as u32;
                let cap: u32 = ((inventory as f64) * (cap_percent as f64)).round() as u32;
                let amount = base_amount.min(cap).max(1);

                if inventory > 0 && amount > 0 {
                    targets.push(AttackTarget::Resource {
                        resource: best_resource.to_string(),
                        amount,
                    });
                }
            }

            AttackType::FleetAssault => {
                targets.push(AttackTarget::System {
                    system: "fleet".to_string(),
                    damage: 20 + (rng_val * 30.0) as u32,
                });
            }

            AttackType::BlueprintTheft => {
                targets.push(AttackTarget::Intelligence { data_loss: 1 });
            }

            AttackType::PlanetHarass => {
                if !state.planets.is_empty() {
                    targets.push(AttackTarget::System {
                        system: "planet".to_string(),
                        damage: 1,
                    });
                }
            }

            AttackType::TecSabotage => {
                targets.push(AttackTarget::System {
                    system: "tec".to_string(),
                    damage: 60,
                });
            }

            AttackType::CoalitionStrike => {
                targets.push(AttackTarget::Resource {
                    resource: "plasma".to_string(),
                    amount: ((state.inventory.plasma as f64 * 0.3).round() as u32).max(3),
                });
                targets.push(AttackTarget::Resource {
                    resource: "chips".to_string(),
                    amount: ((state.inventory.chips as f64 * 0.25).round() as u32).max(3),
                });
                targets.push(AttackTarget::System {
                    system: "defense".to_string(),
                    damage: 3,
                });
                targets.push(AttackTarget::Moral {
                    demoralization: 0.5,
                });
            }

            AttackType::ProtectionBreach => {
                targets.push(AttackTarget::Resource {
                    resource: "plasma".to_string(),
                    amount: ((state.inventory.plasma as f64 * 0.5).round() as u32).max(5),
                });
                targets.push(AttackTarget::Resource {
                    resource: "chips".to_string(),
                    amount: ((state.inventory.chips as f64 * 0.4).round() as u32).max(5),
                });
                targets.push(AttackTarget::System {
                    system: "defense".to_string(),
                    damage: 2,
                });
                targets.push(AttackTarget::Moral {
                    demoralization: 0.7,
                });
            }

            AttackType::PowerSabotage => {
                if state.computational_power > 0 {
                    let dmg = (state.computational_power as f64 * 0.22).min(35.0) as u32;
                    targets.push(AttackTarget::System {
                        system: "computational_power".to_string(),
                        damage: dmg,
                    });
                }
            }

            AttackType::DirectAssault => {
                targets.push(AttackTarget::System {
                    system: "defense".to_string(),
                    damage: 1 + (rng_val * 3.0) as u32,
                });
            }

            AttackType::Psychological => {
                let demorale = 0.25 + rng_val * 0.35 + self.psych_pressure * 0.15;
                targets.push(AttackTarget::Moral {
                    demoralization: demorale.min(0.7),
                });
            }

            AttackType::Stealth => {
                if state.inventory.chips > 0 {
                    let loss = 5 + (rng_val * 12.0) as u32;
                    targets.push(AttackTarget::Intelligence { data_loss: loss });
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

    fn calculate_success_probability_ai(
        &mut self,
        state: &GameState,
        attack_type: &AttackType,
    ) -> f64 {
        let mut p = match attack_type {
            AttackType::ResourceRaid => 0.55,
            AttackType::PowerSabotage => 0.50,
            AttackType::DirectAssault => 0.40,
            AttackType::Psychological => 0.65,
            AttackType::Stealth => 0.72,
            AttackType::Technological => 0.48,
            AttackType::FleetAssault => 0.35,
            AttackType::BlueprintTheft => 0.30,
            AttackType::PlanetHarass => 0.55,
            AttackType::TecSabotage => 0.40,
            AttackType::CoalitionStrike => 0.60,
            AttackType::ProtectionBreach => 0.50,
        };

        if !state.upgrades.defense {
            p += 0.18;
        }
        if !state.is_day {
            p += 0.08;
        }
        p += self.ai_adaptation.prediction_evasion * 0.18;
        p += (self.strategic_intelligence - 0.5).max(0.0) * 0.1;
        p += self.best_genome.fitness * 0.08;

        p += (self.adaptation_level as f64 * 0.01).min(0.10);

        if let Some(fid) = &self.active_faction {
            if let Some(agent) = self.sarsa_agents.get(fid) {
                let s = (state.rebel_activity as usize).min(15);
                let idx = attack_type.to_index().min(11);
                let q = agent.q_table[s][idx];
                p += (q * 0.05).clamp(-0.1, 0.1);
            }
        }

        p.min(0.88).max(0.15)
    }

    fn calculate_expected_gain(&mut self, state: &GameState, attack_type: &AttackType) -> u32 {
        match attack_type {
            AttackType::ResourceRaid => (state.inventory.coal / 8).max(5),
            AttackType::PowerSabotage => (state.computational_power / 5).max(10),
            AttackType::DirectAssault => 15,
            AttackType::Psychological => 20 + (self.psych_pressure * 15.0) as u32,
            AttackType::Stealth => 28,
            AttackType::Technological => 35,
            AttackType::FleetAssault => 40,
            AttackType::BlueprintTheft => 50,
            AttackType::PlanetHarass => 25,
            AttackType::TecSabotage => 30,
            AttackType::CoalitionStrike => 60,
            AttackType::ProtectionBreach => 55,
        }
    }

    pub fn execute_attack(
        &mut self,
        state: &mut GameState,
        config: &GameConfig,
        attack: &AttackPlan,
    ) -> (Vec<GameEvent>, bool) {
        let mut events = Vec::new();
        let defense_bonus = state.neuro_defense_bonus;
        let defense_power = if state.upgrades.defense {
            let base = config.rebels.defense_base_power as f64;
            let level_bonus =
                state.upgrades.defense_level as f64 * config.rebels.defense_level_bonus as f64;
            let neuro = defense_bonus * 55.0;

            let temp_bonus = state.temporary_defense_bonus as f64;
            base + level_bonus + neuro + temp_bonus
        } else {
            0.0
        };
        let attack_power = attack.calculate_attack_power();

        let coalition_bonus = if attack.faction.contains('+') && defense_power > 0.0 {
            0.08
        } else if attack.faction.contains('+') {
            0.04
        } else {
            0.0
        };

        let success_chance = if defense_power > 0.0 {
            (attack_power / (attack_power + defense_power)).min(0.92)
        } else {
            attack.success_probability
        };
        let stealth_bonus = if attack.stealth_level > 0.5 {
            attack.success_probability * 0.18
        } else {
            0.0
        };
        let rng_val = self.prng(state.tick_count as u64 * 137 + self.stats.total_attacks as u64);
        let raw_success = rng_val < (success_chance + stealth_bonus + coalition_bonus);

        let mut summary = AttackExecutionSummary::new();

        if raw_success {
            self.apply_successful_attack_targets(state, attack, &mut summary, &mut events);
        }

        let final_success = raw_success && summary.player_harmed;

        if final_success {
            let fear_growth = if state.neuro_evolution >= 5 { 1 } else { 2 };
            state.fear_level = (state.fear_level + fear_growth).min(15);
            state.last_fear_event_time = state.tick_count as i32;

            if summary.total_stolen > 0 {
                events.push(GameEvent::LogMessage(format!(
                    "🪨 Украдено {} единиц ресурсов",
                    summary.total_stolen
                )));
            }

            let faction_display = if attack.faction.contains('+') {
                format!("⚡ КОАЛИЦИОННАЯ АТАКА: {}", attack.faction)
            } else {
                attack.faction.clone()
            };
            let result_text = summary.attack_record_result(true);

            events.push(GameEvent::LogMessage(format!(
                "⚔️ УСПЕШНАЯ АТАКА! {} нанёс урон: {}",
                faction_display, result_text
            )));
            summary.result_details = result_text;
        } else if raw_success {
            state.fear_level = state.fear_level.saturating_sub(1);
            if summary.result_details.is_empty() {
                summary.result_details = "командный пункт нейтрализовал атаку".to_string();
            }
            events.push(GameEvent::LogMessage(format!(
                "🛡️ Командный пункт сорвал атаку {}: {}",
                attack.faction, summary.result_details
            )));
        } else {
            state.fear_level = state.fear_level.saturating_sub(1);

            events.push(GameEvent::LogMessage(format!(
                "🛡️ Атака {} отражена!",
                attack.faction
            )));
            summary.result_details = "отражена".to_string();
        }

        let record = AttackRecord {
            faction: attack.faction.clone(),
            attack_type: attack.attack_type.to_string(),
            was_defended: !final_success,
            result: summary.attack_record_result(final_success),
            game_time: state.tick_count as i32,
            stolen: summary.stolen_map,
        };
        state.attack_history.push_back(record);
        if state.attack_history.len() > 20 {
            state.attack_history.pop_front();
        }

        (events, final_success)
    }

    fn apply_successful_attack_targets(
        &mut self,
        state: &mut GameState,
        attack: &AttackPlan,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        for target in &attack.targets {
            match target {
                AttackTarget::Resource { resource, amount } => {
                    self.apply_resource_attack_target(state, resource, *amount, summary);
                }
                AttackTarget::System { system, damage } => {
                    self.apply_system_attack_target(
                        state, attack, system, *damage, summary, events,
                    );
                }
                AttackTarget::Moral { demoralization } => {
                    self.apply_moral_attack_target(state, *demoralization, summary, events);
                }
                AttackTarget::Intelligence { data_loss } => {
                    self.apply_intelligence_attack_target(state, *data_loss, summary, events);
                }
            }
        }
    }

    fn apply_resource_attack_target(
        &mut self,
        state: &mut GameState,
        resource: &str,
        amount: u32,
        summary: &mut AttackExecutionSummary,
    ) {
        let stolen = self.steal_resource(state, resource, amount);
        if stolen > 0 {
            *summary.stolen_map.entry(resource.to_string()).or_insert(0) += stolen;
            summary.result_details = format!("украдено {} {}", stolen, resource);
            summary.player_harmed = true;
        }
        summary.total_stolen += stolen;
        *self
            .stats
            .resources_stolen
            .entry(resource.to_string())
            .or_insert(0) += stolen;
    }

    fn apply_system_attack_target(
        &mut self,
        state: &mut GameState,
        attack: &AttackPlan,
        system: &str,
        damage: u32,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        match system {
            "computational_power" => {
                let actual_damage = damage.min(state.computational_power);
                if actual_damage > 0 {
                    state.computational_power -= actual_damage;
                    summary.player_harmed = true;
                    events.push(GameEvent::LogMessage(format!(
                        "⚡ Потеряно {} вычислительной мощности",
                        actual_damage
                    )));
                    summary.result_details = format!("потеряно {} мощности", actual_damage);
                } else {
                    summary.result_details = "энергосеть устояла".to_string();
                }
            }
            "defense" => {
                if state.upgrades.defense_level > 0 {
                    state.defense_debuff_remaining = 2;
                    summary.defense_damaged = true;
                    summary.player_harmed = true;
                    events.push(GameEvent::LogMessage(
                        "🛡️ Защита повреждена на 2 ночи!".to_string(),
                    ));
                    summary.result_details = "защита повреждена".to_string();
                } else {
                    summary.result_details = "защита устояла".to_string();
                }
            }
            "upgrades" => {
                state.mining_debuff_remaining = 60;
                state.mining_debuff_percent = 0.4;
                summary.mining_damaged = true;
                summary.player_harmed = true;
                events.push(GameEvent::LogMessage(
                    "🔧 Технологический саботаж! Добыча -40% на ~1 минуту".to_string(),
                ));
                summary.result_details = "добыча снижена на 40%".to_string();
            }
            "fleet" => {
                self.apply_fleet_attack_target(state, attack, damage, summary, events);
            }
            "tec" => {
                if state.blueprints_encrypted {
                    summary.result_details = "защищённый контур сорвал саботаж".to_string();
                } else {
                    state.tec_sabotaged = true;
                    state.tec_sabotage_remaining = damage as i32;
                    state.coal_enabled = false;
                    summary.player_harmed = true;
                    events.push(GameEvent::LogMessage(format!(
                        "🔥 ТЭЦ САБОТИРОВАНА! Принудительное отключение на {} тиков!",
                        damage
                    )));
                    summary.result_details = format!("ТЭЦ саботирована на {} тиков", damage);
                }
            }
            "planet" => {
                self.apply_planet_attack_target(state, summary, events);
            }
            "fake_depot" => {
                state.fake_depot_active = false;
                self.morale = (self.morale - 0.25).max(0.1);
                events.push(GameEvent::LogMessage(
                    "💥 ЛОВУШКА СРАБОТАЛА! Отряд подорвался на фальшивом складе!".to_string(),
                ));
                summary.result_details = "отряд попал в ловушку".to_string();
            }
            "craft_chain" => {
                state.craft_blocked_until = state.tick_count + 60;
                summary.player_harmed = true;
                events.push(GameEvent::LogMessage(
                    "💻 КИБЕРАТАКА! Крафт заблокирован на 60 сек!".to_string(),
                ));
                summary.result_details = "крафт заблокирован".to_string();
            }
            _ => {}
        }
    }

    fn apply_fleet_attack_target(
        &mut self,
        state: &mut GameState,
        attack: &AttackPlan,
        damage: u32,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        if state.fleet_shield_active {
            state.fleet_shield_active = false;
            state.fleet_shield_expires_at = 0;
            events.push(GameEvent::LogMessage(
                "🛡️ Щит флота поглотил удар и рассеялся!".to_string(),
            ));
            summary.result_details = "отражена щитом флота".to_string();
            return;
        }

        let attack_id = format!("attack_{}_{}", state.tick_count, self.stats.total_attacks);
        self.notify_fleet_damage(attack, &attack_id);

        state.fleet_under_attack = true;
        state.fleet_attack_damage = damage;
        state.last_fleet_attack_time = state.tick_count as i32;
        events.push(GameEvent::LogMessage(format!(
            "🚀 ФЛОТ АТАКОВАН! Корабль получил {} урона!",
            damage
        )));
        summary.player_harmed = true;
        summary.result_details = format!("флот атакован (-{} HP)", damage);
    }

    fn notify_fleet_damage(&self, attack: &AttackPlan, attack_id: &str) {
        if let Some(window) = web_sys::window() {
            if let Ok(fleet_module) =
                js_sys::Reflect::get(&window, &JsValue::from_str("fleetModule"))
            {
                if let Ok(damage_fn) = js_sys::Reflect::get(
                    &fleet_module,
                    &JsValue::from_str("damageRandomCombatShip"),
                ) {
                    if damage_fn.is_function() {
                        let _ = js_sys::Function::from(damage_fn).call2(
                            &fleet_module,
                            &JsValue::from_str(&attack.attack_type.to_string()),
                            &JsValue::from_str(attack_id),
                        );
                    }
                }
            }
        }
    }

    fn apply_planet_attack_target(
        &mut self,
        state: &mut GameState,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        if state.planets_fortified {
            summary.result_details = "планеты выдержали налёт".to_string();
            return;
        }

        if state.planets.is_empty() {
            return;
        }

        let planet_idx = (self.prng(state.tick_count as u64 * 31) * state.planets.len() as f64)
            as usize
            % state.planets.len();
        let planet = &mut state.planets[planet_idx];
        let stolen_coal = (planet.resources_remaining.coal as f64 * 0.3) as u32;
        let stolen_ore = (planet.resources_remaining.ore as f64 * 0.3) as u32;
        planet.resources_remaining.coal =
            planet.resources_remaining.coal.saturating_sub(stolen_coal);
        planet.resources_remaining.ore = planet.resources_remaining.ore.saturating_sub(stolen_ore);

        state.planet_under_harass = true;
        state.harassed_planet_id = planet.id.clone();

        events.push(GameEvent::LogMessage(format!(
            "🪐 Планета {} ограблена! Потеряно: {}🪨 {}⛏️",
            planet.name, stolen_coal, stolen_ore
        )));
        if stolen_coal > 0 || stolen_ore > 0 {
            summary.player_harmed = true;
        }
        summary.result_details = format!("планета {} ограблена", planet.name);
    }

    fn apply_moral_attack_target(
        &mut self,
        state: &mut GameState,
        demoralization: f64,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        let duration = 25 + (self.psych_pressure * 15.0) as i32;
        state.autoclick_debuff_remaining = duration;
        state.autoclick_debuff_percent = (demoralization as f32).min(0.9); // ← cap 90%
        summary.autoclick_damaged = true;
        summary.player_harmed = demoralization > 0.0;
        events.push(GameEvent::LogMessage(format!(
            "😨 Психо-атака! Автокликер замедлен на {:.0}% на {} сек.",
            demoralization * 100.0,
            duration
        )));
        summary.result_details = format!("автокликер -{:.0}%", demoralization * 100.0);
    }

    fn apply_intelligence_attack_target(
        &mut self,
        state: &mut GameState,
        data_loss: u32,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        if state.blueprints_encrypted {
            summary.result_details = "шифрование чертежей выдержало взлом".to_string();
            return;
        }

        if data_loss == 1 && state.neuro_evolution >= 3 {
            self.apply_blueprint_theft_target(state, summary, events);
            return;
        }

        let actual_loss = data_loss.min(state.inventory.chips);
        if actual_loss > 0 {
            state.inventory.chips -= actual_loss;
            summary.player_harmed = true;
            events.push(GameEvent::LogMessage(format!(
                "📊 Украдено {} чипов! Данные скомпрометированы.",
                actual_loss
            )));
            summary.result_details = format!("украдено {} чипов", actual_loss);
        }

        let rebel_gain = actual_loss / 2;
        if rebel_gain > 0 {
            self.evolution_score += rebel_gain;
            events.push(GameEvent::LogMessage(format!(
                "🔓 Повстанцы улучшили шифрование (+{} эволюции)!",
                rebel_gain
            )));
        }
    }

    fn apply_blueprint_theft_target(
        &mut self,
        state: &mut GameState,
        summary: &mut AttackExecutionSummary,
        events: &mut Vec<GameEvent>,
    ) {
        let blueprints = ["cargo", "scout", "combat"];
        let unlocked: Vec<_> = blueprints
            .iter()
            .filter(|&&bp| match bp {
                "cargo" => state.blueprint_cargo_unlocked,
                "scout" => state.blueprint_scout_unlocked,
                "combat" => state.blueprint_combat_unlocked,
                _ => false,
            })
            .collect();

        if !unlocked.is_empty() {
            let stolen_bp = unlocked[(self.prng(state.tick_count as u64 * 17)
                * unlocked.len() as f64) as usize
                % unlocked.len()];

            state.locked_blueprint_id = stolen_bp.to_string();
            state.blueprint_locked_until = state.tick_count + 120;
            summary.player_harmed = true;

            events.push(GameEvent::LogMessage(format!(
                "📐 ЧЕРТЁЖ УКРАДЕН! {} заблокирован на 2 минуты!",
                stolen_bp
            )));
            summary.result_details = format!("чертеж {} украден", stolen_bp);
            return;
        }

        let actual_loss = 5 + (self.prng(state.tick_count as u64 * 103) * 15.0) as u32;
        let loss = actual_loss.min(state.inventory.chips);
        if loss > 0 {
            state.inventory.chips -= loss;
            summary.player_harmed = true;
            events.push(GameEvent::LogMessage(format!(
                "📊 Украдено {} чипов! Данные скомпрометированы.",
                loss
            )));
            summary.result_details = format!("украдено {} чипов", loss);
        }
    }

    fn steal_resource(&self, state: &mut GameState, resource: &str, amount: u32) -> u32 {
        match resource {
            "coal" => {
                let a = amount.min(state.inventory.coal);
                state.inventory.coal -= a;
                a
            }
            "chips" => {
                let a = amount.min(state.inventory.chips);
                state.inventory.chips -= a;
                a
            }
            "plasma" => {
                let a = amount.min(state.inventory.plasma);
                state.inventory.plasma -= a;
                a
            }
            "ore" => {
                let a = amount.min(state.inventory.ore);
                state.inventory.ore -= a;
                a
            }
            "trash" => {
                let a = amount.min(state.inventory.trash);
                state.inventory.trash -= a;
                a
            }
            _ => 0,
        }
    }

    pub fn try_background_sabotage(
        &mut self,
        state: &mut GameState,
        config: &GameConfig,
    ) -> Option<Vec<GameEvent>> {
        if state.background_sabotage_cooldown_remaining > 0 {
            return None;
        }

        let rng = self.prng(state.tick_count as u64 * 7919);
        if rng >= config.rebels.background_sabotage_chance {
            return None;
        }

        state.background_sabotage_cooldown_remaining = config.rebels.background_sabotage_cooldown;

        let mut events = Vec::new();
        let sabotage_type = (rng * 1000.0) as u32 % 4;

        match sabotage_type {
            0 => {
                let loss = (state.computational_power as f64 * 0.15) as u32;
                if loss > 0 {
                    state.computational_power = state.computational_power.saturating_sub(loss);
                    events.push(GameEvent::LogMessage(format!(
                        "⚡ ФОНОВАЯ ДИВЕРСИЯ: потеряно {} мощности!",
                        loss
                    )));
                }
            }
            1 => {
                let stolen = (state.inventory.coal as f64 * 0.08) as u32;
                if stolen > 0 {
                    state.inventory.coal = state.inventory.coal.saturating_sub(stolen);
                    events.push(GameEvent::LogMessage(format!(
                        "🪨 ФОНОВАЯ ДИВЕРСИЯ: украдено {} угля!",
                        stolen
                    )));
                }
            }
            2 => {
                state.autoclick_debuff_remaining = 15;
                state.autoclick_debuff_percent = 0.2;
                events.push(GameEvent::LogMessage(
                    "😨 ФОНОВАЯ ДИВЕРСИЯ: автокликер замедлен на 15 сек!".to_string(),
                ));
            }
            3 => {
                self.psych_pressure = (self.psych_pressure + 0.1).min(1.0);
                events.push(GameEvent::LogMessage(
                    "📡 ФОНОВАЯ ДИВЕРСИЯ: мораль повстанцев растёт!".to_string(),
                ));
            }
            _ => {}
        }

        if events.is_empty() {
            None
        } else {
            Some(events)
        }
    }

    pub fn update_rebel_activity(
        &mut self,
        state: &mut GameState,
        config: &GameConfig,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let was_day = state.is_day;

        if state.fleet_under_attack {
            let fleet_reset_delay = (state.fleet_attack_damage as i64).max(10).min(30);
            if state.last_fleet_attack_time > 0
                && state.tick_count - state.last_fleet_attack_time as i64 > fleet_reset_delay
            {
                state.fleet_under_attack = false;
                state.fleet_attack_damage = 0;
            }
        }

        // Таймеры саботажа и временных блокировок обновляются централизованно
        // в GameState::update_time. Здесь обрабатывается только поведение ИИ.

        if !state.is_day {
            let old_activity = state.rebel_activity;
            let increase = if self.aggression > 0.75 {
                3
            } else if self.aggression > 0.55 {
                2
            } else {
                1
            };
            // Используем вероятностную модель вместо детерминированной
            let activity_chance = config.rebels.activity_bonus_per_level
                * state.upgrades.mining as f64
                * increase as f64;
            let activity_bonus = if rand::thread_rng().gen::<f64>() < activity_chance {
                increase
            } else {
                0
            };
            state.rebel_activity =
                (state.rebel_activity + increase + activity_bonus).min(config.rebels.max_activity);

            let def_power = if state.upgrades.defense {
                (config.rebels.defense_base_power as f64
                    + state.upgrades.defense_level as f64
                        * config.rebels.defense_level_bonus as f64)
                    / 100.0
            } else {
                0.0
            };
            self.compute_nash_strategy(def_power, state.neuro_evolution);

            if state.tick_count - self.last_major_operation > 20 {
                self.strategic_planning_htn(state);
                self.last_major_operation = state.tick_count;
            }

            self.update_internal_state(state);

            if state.rebel_activity >= 14 && old_activity < 14 {
                events.push(GameEvent::LogMessage(
                    "⚠️ КРИТИЧЕСКАЯ АКТИВНОСТЬ! Повстанцы запустили финальную кампанию!"
                        .to_string(),
                ));
                if self.current_campaign.is_none() {
                    self.start_campaign("counter_ai", "critical");
                }
                self.aggression = (self.aggression + 0.1).min(1.0);
            } else if state.rebel_activity >= 12 && old_activity < 12 {
                events.push(GameEvent::LogMessage(
                    "⚠️ Активность повстанцев достигла опасного уровня!".to_string(),
                ));
            }
        } else {
            if state.rebel_activity > 0 {
                let fall = if state.rebel_activity >= 12 {
                    3
                } else if state.rebel_activity >= 8 {
                    2
                } else {
                    1
                };
                state.rebel_activity = state.rebel_activity.saturating_sub(fall);
                if fall >= 2 {
                    for agent in self.sarsa_agents.values_mut() {
                        agent.alpha = (agent.alpha * 0.98).max(0.05);
                    }
                }
                if config.rebels.enable_activity_messages && fall > 0 {
                    events.push(GameEvent::LogMessage(format!(
                        "☀️ Активность повстанцев снижается: {}/15",
                        state.rebel_activity
                    )));
                }
            }
            self.psych_pressure = (self.psych_pressure - 0.05).max(0.0);
        }

        if !state.is_day && was_day {
            let mut rng = rand::thread_rng();
            events.extend(self.on_night_start(state, &mut rng));
        }

        if state.is_day && !was_day {
            state.trade_blocked = false;
            if state.current_night_type == "siege" {
                events.push(GameEvent::LogMessage(
                    "🔓 Осада снята — торговля возобновлена".to_string(),
                ));
            }
        }

        events.extend(self.execute_operations(state, config));

        if let Some(sabotage_events) = self.try_background_sabotage(state, config) {
            events.extend(sabotage_events);
        }

        events
    }

    pub fn on_night_start(&mut self, state: &mut GameState, rng: &mut impl Rng) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let campaign_bonus = self
            .current_campaign
            .as_ref()
            .map(|c| c.phase as u32)
            .unwrap_or(0);
        let effective_activity = (state.rebel_activity + campaign_bonus).min(15);

        let night_type = match effective_activity {
            0..=2 => "quiet",
            3..=5 => {
                if rng.gen_bool(0.4) {
                    "scout"
                } else {
                    "quiet"
                }
            }
            6..=9 => {
                let types = ["raid", "scout", "propaganda"];
                *types.choose(rng).unwrap_or(&"raid")
            }
            10..=12 => {
                let types = ["siege", "raid", "elite"];
                *types.choose(rng).unwrap_or(&"siege")
            }
            _ => {
                if self.current_campaign.is_some() {
                    "coordinated"
                } else {
                    "elite"
                }
            }
        };
        state.current_night_type = night_type.to_string();
        self.current_night_type = night_type.to_string();

        if let Some(ref mut campaign) = self.current_campaign {
            campaign.attacks_in_phase += 1;
            if campaign.attacks_in_phase >= 3 {
                campaign.phase = (campaign.phase + 1).min(campaign.total_phases - 1);
                campaign.attacks_in_phase = 0;
            }
        }

        match night_type {
            "quiet" => {
                state.rebel_activity = state.rebel_activity.saturating_sub(2);
                self.psych_pressure = (self.psych_pressure - 0.1).max(0.0);
                events.push(GameEvent::LogMessage(
                    "🌙 Тихая ночь — повстанцы отступили".to_string(),
                ));
            }
            "scout" => {
                events.push(GameEvent::LogMessage(
                    "🔍 РАЗВЕДЫВАТЕЛЬНАЯ НОЧЬ — сбор разведданных".to_string(),
                ));
                state.rebel_activity = (state.rebel_activity + 1).min(15);
                self.target_value_estimate
                    .insert("coal".to_string(), state.inventory.coal as f64);
                self.target_value_estimate
                    .insert("plasma".to_string(), state.inventory.plasma as f64);
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.1).min(0.5);
            }
            "raid" => {
                events.push(GameEvent::LogMessage(
                    "⚠️ НОЧЬ НАЛЁТА — геном оптимизирован под ресурсы!".to_string(),
                ));
                self.tactic_preferences.resource_raid =
                    (self.tactic_preferences.resource_raid + 0.2).min(0.6);
                self.best_genome.weights[0] += 0.1;
                self.best_genome.normalize();
            }
            "siege" => {
                state.trade_blocked = true;
                events.push(GameEvent::LogMessage(
                    "🔴 НОЧЬ ОСАДЫ — блокада торговли!".to_string(),
                ));
            }
            "propaganda" => {
                state.autoclick_debuff_remaining = 8;
                state.autoclick_debuff_percent = 0.3;
                self.psych_pressure = (self.psych_pressure + 0.2).min(1.0);
                events.push(GameEvent::LogMessage(
                    "📡 ПРОПАГАНДА — автокликер замедлен.".to_string(),
                ));
                self.tactic_preferences.psychological =
                    (self.tactic_preferences.psychological + 0.15).min(0.5);
            }
            "elite" => {
                events.push(GameEvent::LogMessage(
                    "💀 НОЧЬ ЭЛИТНОГО ШТУРМА!".to_string(),
                ));
                self.aggression = (self.aggression + 0.15).min(1.0);
                self.strategic_intelligence = (self.strategic_intelligence + 0.1).min(1.0);
                for agent in self.sarsa_agents.values_mut() {
                    agent.alpha = (agent.alpha + 0.02).min(0.25);
                }
            }
            "coordinated" => {
                events.push(GameEvent::LogMessage(
                    "⚡ КООРДИНИРОВАННАЯ КАМПАНИЯ — все фракции объединились!".to_string(),
                ));
                self.aggression = (self.aggression + 0.2).min(1.0);
                for val in self.coalition_matrix.values_mut() {
                    *val = (*val + 0.1).min(0.95);
                }
            }
            _ => {}
        }

        events
    }

    pub fn check_rebel_attack(
        &mut self,
        state: &mut GameState,
        config: &GameConfig,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        let is_protected = state.rebel_protection_active;

        if state.is_day || state.rebel_activity < 2 {
            return events;
        }

        let mut breach_chance = 0.0;
        if is_protected {
            breach_chance = config.rebels.breach_protection_chance_base
                + (state.rebel_activity as f64 * config.rebels.breach_protection_per_activity);

            breach_chance = breach_chance.min(0.50);

            if state.rebel_activity >= config.rebels.elite_attack_threshold {
                breach_chance *= 1.3;
            }
            if self.current_campaign.is_some() {
                breach_chance *= 1.5;
            }

            breach_chance = breach_chance.min(0.75);
        }

        let base_cooldown = if self.ai_adaptation.prediction_evasion > 0.3 {
            9
        } else {
            12
        };
        let attack_cooldown = if state.rebel_activity > 10 {
            (base_cooldown - 3).max(4)
        } else if state.rebel_activity > 7 {
            (base_cooldown - 1).max(6)
        } else {
            base_cooldown
        };

        if state.tick_count - self.last_attack_time < attack_cooldown as i64 {
            return events;
        }

        let attack_probability = self.calculate_attack_probability_ai(state, config);
        let rng_val = self.prng(
            (state.tick_count as u64 * 97 + self.stats.total_attacks as u64)
                + (js_sys::Date::now() as u64 % 997),
        );

        if rng_val < attack_probability {
            let time_seed = state.tick_count as u64 * 1000 + self.stats.total_attacks as u64;
            let attack = self.prepare_attack_ai(state, config, time_seed);
            let primary_faction = attack
                .faction
                .split('+')
                .next()
                .unwrap_or(&attack.faction)
                .trim()
                .to_string();
            self.active_faction = Some(primary_faction);
            state.last_attacking_faction = attack.faction.clone();

            if state.attack_warning.is_empty() && rng_val < 0.6 {
                let warning = format!(
                    "СКАНЕР: {} готовит атаку типа {}",
                    attack.faction, attack.attack_type
                );
                state.attack_warning = warning.clone();
                state.attack_warning_faction = attack.faction.clone();
                let severe_wave = attack_probability >= 0.55
                    || state.rebel_activity >= 10
                    || self.current_campaign.is_some();
                if severe_wave && state.tick_count - self.last_scanner_warning_at >= 18 {
                    events.push(GameEvent::LogMessage(format!("⚠️ {}", warning)));
                    self.last_scanner_warning_at = state.tick_count;
                }
                self.last_attack_time = state.tick_count - attack_cooldown + 1;
                return events;
            }

            state.attack_warning.clear();
            state.attack_warning_faction.clear();

            let breached = if is_protected {
                let breach_rng = self.prng(time_seed + 999);
                breach_rng < breach_chance
            } else {
                false
            };

            if breached {
                state.protection_breached_this_night = true;
                state.total_breaches += 1;
                events.push(GameEvent::LogMessage(
                    "💀 ПОВСТАНЦЫ ПРОБИЛИ ЗАЩИТУ! Откуп не помог!".to_string(),
                ));

                let (attack_events, was_successful) = self.execute_attack(state, config, &attack);
                state.rebel_attacks_count += 1;
                self.last_attack_time = state.tick_count;
                self.stats.total_attacks += 1;

                let attack_type_idx = attack.attack_type.to_index();
                self.genetic_step(was_successful, attack_type_idx, state.tick_count as u64);
                self.update_coalition_after_attack(was_successful);

                self.update_sarsa_and_morale(state, attack_type_idx, was_successful);

                if was_successful && self.stats.total_attacks % 4 == 0 {
                    events.extend(self.escalate_arms_race("attack_success"));
                }

                events.extend(attack_events);
                return events;
            }

            if is_protected {
                events.push(GameEvent::LogMessage(format!(
                    "🛡️ Откуп отпугнул основную волну (шанс прорыва был {:.0}%)",
                    breach_chance * 100.0
                )));
                if let Some(sabotage_events) = self.try_background_sabotage(state, config) {
                    events.extend(sabotage_events);
                }
                return events;
            }

            let (attack_events, was_successful) = self.execute_attack(state, config, &attack);
            state.rebel_attacks_count += 1;
            self.last_attack_time = state.tick_count;
            self.stats.total_attacks += 1;

            let attack_type_idx = attack.attack_type.to_index();
            self.genetic_step(was_successful, attack_type_idx, state.tick_count as u64);
            self.update_coalition_after_attack(was_successful);

            self.update_sarsa_and_morale(state, attack_type_idx, was_successful);

            if was_successful && self.stats.total_attacks % 4 == 0 {
                events.extend(self.escalate_arms_race("attack_success"));
            }

            events.extend(attack_events);
        }

        events
    }

    fn attempt_coalition_attack(&mut self, _attack_type: &AttackType) -> Option<String> {
        if self.strategic_intelligence < 0.6 {
            return None;
        }

        let active = self.active_faction.clone().unwrap_or_default();
        let partners: Vec<String> = self
            .coalition_matrix
            .iter()
            .filter(|((a, _), &v)| *a == active && v > 0.5)
            .map(|((_, b), _)| b.clone())
            .collect();

        if partners.is_empty() {
            return None;
        }

        Some(format!("{} + {}", active, partners[0]))
    }

    fn update_coalition_after_attack(&mut self, success: bool) {
        for val in self.coalition_matrix.values_mut() {
            if success {
                *val = (*val + 0.05).min(0.95);
            } else {
                *val = (*val - 0.03).max(0.1);
            }
        }
    }

    fn genetic_step(&mut self, success: bool, used_type_idx: usize, time: u64) {
        self.best_genome.update_fitness(success);
        let entry = self
            .attack_type_success
            .entry(used_type_idx)
            .or_insert((0, 0));
        if success {
            entry.0 += 1;
        }
        entry.1 += 1;

        self.sa_temperature = (self.sa_temperature * 0.995).max(0.05);

        if self.best_genome.age > 20 || self.best_genome.fitness < -0.1 {
            if self.genome_switch_cooldown <= 0 {
                let rng_val = self.prng(time);
                if self.genome_population.len() >= 2 {
                    let i1 = (rng_val * self.genome_population.len() as f64) as usize
                        % self.genome_population.len();
                    let i2 = (rng_val * 7.0 * self.genome_population.len() as f64) as usize
                        % self.genome_population.len();
                    let point = ((rng_val * 12.0) as usize).min(11);
                    let child =
                        self.genome_population[i1].crossover(&self.genome_population[i2], point);
                    if let Some(worst_idx) = self
                        .genome_population
                        .iter()
                        .enumerate()
                        .min_by(|a, b| a.1.fitness.partial_cmp(&b.1.fitness).unwrap())
                        .map(|(i, _)| i)
                    {
                        self.genome_population[worst_idx] = child.clone();
                        self.best_genome = child;
                        self.stats.genome_mutations += 1;
                    }
                }
                let rng2 = self.prng(time + 1);
                let rng3 = self.prng(time + 2);
                if rng2 < self.sa_temperature {
                    self.best_genome.mutate(self.sa_temperature, rng2, rng3);
                }
                self.sync_preferences_from_genome();
                self.genome_switch_cooldown = 15;
            }
        }
        if self.genome_switch_cooldown > 0 {
            self.genome_switch_cooldown -= 1;
        }
    }

    pub fn encode_sarsa_state(&self, game_state: &GameState) -> usize {
        let activity_bucket = (game_state.rebel_activity / 3).min(4) as usize;
        let day_night = if game_state.is_day { 0 } else { 1 };
        let defense_bucket = if !game_state.upgrades.defense {
            0
        } else if game_state.upgrades.defense_level < 3 {
            1
        } else {
            2
        };
        let neuro_bucket = (game_state.neuro_evolution / 3).min(2) as usize;

        let raw = activity_bucket * 18 + day_night * 9 + defense_bucket * 3 + neuro_bucket;
        raw % 16
    }

    fn sarsa_update_faction(
        &mut self,
        faction_id: &str,
        state: usize,
        action: usize,
        reward: f64,
        next_state: usize,
        time: u64,
    ) {
        if let Some(agent) = self.sarsa_agents.get_mut(faction_id) {
            let rng = agent.total_reward as u64 + time;
            let next_action = agent.choose_action(next_state, (rng % 1000) as f64 / 1000.0);
            agent.update(state, action, reward, next_state, next_action);
        }
    }

    fn update_sarsa_and_morale(
        &mut self,
        state: &GameState,
        attack_type_idx: usize,
        was_successful: bool,
    ) {
        let sarsa_state = self.encode_sarsa_state(state);
        let sarsa_next = self.encode_sarsa_state(state);

        let sarsa_reward = if was_successful {
            match attack_type_idx {
                0 => 1.2,
                1 => 1.5,
                2 => 0.8,
                3 => 1.8,
                4 => 2.0,
                5 => 1.6,
                6 => 1.4,
                7 => 1.7,
                8 => 1.1,
                9 => 1.5,
                10 => 2.5,
                _ => 1.3,
            }
        } else {
            match attack_type_idx {
                2 => -0.5,
                6 => -1.5,
                10 => -2.0,
                _ => -1.0,
            }
        };

        let faction_id = self.active_faction.clone().unwrap_or_default();
        self.sarsa_update_faction(
            &faction_id,
            sarsa_state,
            attack_type_idx,
            sarsa_reward,
            sarsa_next,
            state.tick_count as u64,
        );

        if was_successful {
            self.stats.successful_attacks += 1;
            self.morale = (self.morale + 0.06).min(1.0);
            self.psych_pressure = (self.psych_pressure + 0.05).min(1.0);
        } else {
            self.stats.failed_attacks += 1;
            self.morale = (self.morale - 0.04).max(0.2);
        }
    }

    fn start_campaign(&mut self, campaign_type: &str, _trigger: &str) {
        let (name, phases, goals) = match campaign_type {
            "counter_ai" => (
                "Операция: Затмение".to_string(),
                3,
                vec![
                    "psych_pressure".to_string(),
                    "intel_steal".to_string(),
                    "final_assault".to_string(),
                ],
            ),
            "resource_blitz" => (
                "Операция: Урожай".to_string(),
                2,
                vec!["scout_resources".to_string(), "mass_raid".to_string()],
            ),
            _ => (
                "Операция: Призрак".to_string(),
                2,
                vec!["infiltrate".to_string(), "sabotage".to_string()],
            ),
        };
        self.current_campaign = Some(Campaign {
            name: name.clone(),
            phase: 0,
            total_phases: phases,
            attacks_in_phase: 0,
            goals,
            started_at: 0,
        });
        self.stats.campaigns_started += 1;
    }

    fn execute_operations(
        &mut self,
        state: &mut GameState,
        _config: &GameConfig,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let mut completed = Vec::new();

        let op_list: Vec<(String, ActiveOperation)> = self
            .active_operations
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        for (id, mut op) in op_list {
            let rate = 0.08 / op.operation.complexity as f64;
            op.progress += rate;
            if op.progress >= 1.0 {
                completed.push(id.clone());
                let rng = self.prng(op.start_time as u64 + state.tick_count as u64);
                let success = op.operation.success_probability > rng;
                if success {
                    let mut new_op = op.clone();
                    new_op.status = OperationStatus::Completed;
                    self.active_operations.insert(id.clone(), new_op);
                    events.push(GameEvent::LogMessage(format!(
                        "✅ Операция '{}' выполнена!",
                        op.operation.name
                    )));
                    self.evolution_score += 6;
                    for f in self.factions.values_mut() {
                        f.resources.experience += 12;
                    }
                } else {
                    let mut new_op = op.clone();
                    new_op.status = OperationStatus::Failed;
                    self.active_operations.insert(id.clone(), new_op);
                    events.push(GameEvent::LogMessage(format!(
                        "❌ Операция '{}' провалена!",
                        op.operation.name
                    )));
                    self.morale = (self.morale - 0.05).max(0.3);
                }
            } else {
                self.active_operations.insert(id.clone(), op);
            }
        }

        for id in completed {
            self.active_operations.remove(&id);
        }

        if let Some(operation) = self.operation_queue.pop_front() {
            if self.can_execute_operation(&operation) {
                let name = operation.name.clone();
                let id = operation.id.clone();
                self.active_operations.insert(
                    id,
                    ActiveOperation {
                        operation,
                        progress: 0.0,
                        start_time: state.tick_count,
                        status: OperationStatus::Executing,
                    },
                );
                events.push(GameEvent::LogMessage(format!(
                    "🚀 Запущена операция: {}",
                    name
                )));
            }
        }

        events
    }

    fn can_execute_operation(&self, op: &Operation) -> bool {
        let manpower_ok = op
            .resources_committed
            .get("manpower")
            .map(|&m| m <= self.available_forces_cache as u32)
            .unwrap_or(true);
        manpower_ok && self.active_operations.len() < 4
    }

    fn update_internal_state(&mut self, state: &GameState) {
        for faction in self.factions.values_mut() {
            faction.update(state);
        }
        self.update_cache();
        if self.stats.total_attacks > 0 {
            let sr = self.stats.successful_attacks as f64 / self.stats.total_attacks as f64;
            self.morale = self.morale * 0.94 + sr * 0.06;
        }
    }

    fn update_cache(&mut self) {
        self.available_forces_cache = self
            .factions
            .values()
            .map(|f| f.personnel.operatives as usize)
            .sum();
    }

    pub fn get_faction_info(&self) -> Vec<String> {
        self.factions
            .values()
            .filter(|f| f.personnel.operatives > 0)
            .map(|f| f.name.clone())
            .collect()
    }

    pub fn get_faction_personality_hint(&self, faction_id: &str) -> String {
        let Some(faction) = self.factions.get(faction_id) else {
            return String::new();
        };
        let personality_desc = match faction.personality {
            PersonalityType::Coward => format!(
                "«Трус» — после поражения прячется ({} тихих ночей), но возвращается сильнее",
                faction.commander.quiet_nights_accumulated
            ),
            PersonalityType::Fanatic => format!(
                "«Фанатик» — атакует безрассудно, мощные удары. Потери для него — не преграда."
            ),
            PersonalityType::Strategist => format!(
                "«Стратег» — накапливает {} из 3 тихих ночей, затем наносит идеальный удар",
                faction.consecutive_quiet_nights
            ),
            PersonalityType::Chaos => "«Хаос» — непредсказуем, даже сам не знает план".to_string(),
        };
        let frustration = if faction.commander.is_frustrated {
            format!(
                " ⚠️ ДЕМОРАЛИЗОВАН ({} поражений подряд)",
                faction.commander.consecutive_losses
            )
        } else {
            String::new()
        };
        format!(
            "{} [{}{}]",
            personality_desc, faction.commander.name, frustration
        )
    }

    pub fn on_ai_evolution(&mut self, ai_level: u32, strategy: &str) {
        if ai_level > self.last_ai_level {
            let diff = ai_level - self.last_ai_level;
            self.adaptation_level += diff;
            self.strategic_intelligence =
                (self.strategic_intelligence + 0.06 * diff as f64).min(1.0);
            self.ai_threat_perception = (self.ai_threat_perception + 0.12).min(1.0);
            if !self
                .ai_adaptation
                .recognized_patterns
                .contains(&strategy.to_string())
            {
                self.ai_adaptation
                    .recognized_patterns
                    .push(strategy.to_string());
            }
            self.develop_counter_tactic(strategy, ai_level);
            self.adapt_tactics_to_ai(strategy);
            let rng = self.prng(ai_level as u64 * 1337 + self.evolution_score as u64);
            if rng < 0.4 {
                let rng2 = self.prng(ai_level as u64 * 1338 + self.evolution_score as u64);
                let rng3 = self.prng(ai_level as u64 * 1339 + self.evolution_score as u64);
                self.best_genome
                    .mutate(self.sa_temperature * 1.5, rng2, rng3);
                self.sync_preferences_from_genome();
                self.stats.genome_mutations += 1;
            }
            let def = if self.ai_threat_perception > 0.5 {
                0.6
            } else {
                0.3
            };
            self.compute_nash_strategy(def, ai_level);
            if ai_level >= 3 && self.current_campaign.is_none() {
                self.start_campaign("counter_ai", strategy);
            }
            self.evolution_score += diff * 12;
            if self.evolution_score >= 100 {
                self.evolve();
            }
            self.stats.strategy_switches += 1;
        }
        self.last_ai_level = ai_level;
    }

    pub fn on_ai_prediction(&mut self, prediction_accuracy: f64) {
        self.ai_adaptation.prediction_evasion =
            (self.ai_adaptation.prediction_evasion + 0.06).min(0.6);
        self.strategic_intelligence = (self.strategic_intelligence + 0.04).min(1.0);
        if prediction_accuracy > 0.65 {
            self.switch_to_evasion_tactics();
            self.best_genome.weights[4] += 0.08;
            self.best_genome.weights[3] += 0.05;
            self.best_genome.normalize();
        }
    }

    pub fn apply_morale_damage(&mut self, damage: f64) {
        self.morale = (self.morale - damage).max(0.2);
        self.psych_pressure = (self.psych_pressure - damage * 0.5).max(0.0);
        if self.morale < 0.35 {
            for agent in self.sarsa_agents.values_mut() {
                agent.epsilon = (agent.epsilon + 0.05).min(0.4);
            }
        }
    }

    fn develop_counter_tactic(&mut self, ai_strategy: &str, ai_level: u32) {
        let name = match ai_strategy {
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
        let eff = (0.3 + ai_level as f64 * 0.06).min(0.85);
        self.ai_adaptation.counter_tactics.insert(
            ai_strategy.to_string(),
            CounterTactic {
                name: name.to_string(),
                effectiveness: eff,
                usage_count: 0,
                last_used: 0,
            },
        );
    }

    fn adapt_tactics_to_ai(&mut self, ai_strategy: &str) {
        match ai_strategy {
            "predictive" => {
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.1).min(0.4);
                self.tactic_preferences.psychological =
                    (self.tactic_preferences.psychological + 0.05).min(0.3);
            }
            "defensive" => {
                self.aggression = (self.aggression + 0.1).min(0.9);
                self.tactic_preferences.direct_assault =
                    (self.tactic_preferences.direct_assault + 0.1).min(0.5);
            }
            "aggressive" => {
                self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.15).min(0.5);
                self.tactic_preferences.sabotage =
                    (self.tactic_preferences.sabotage + 0.1).min(0.4);
            }
            _ => {}
        }
    }

    fn switch_to_evasion_tactics(&mut self) {
        self.tactic_preferences.stealth = (self.tactic_preferences.stealth + 0.15).min(0.6);
        self.tactic_preferences.psychological =
            (self.tactic_preferences.psychological + 0.1).min(0.4);
        self.ai_adaptation.prediction_evasion =
            (self.ai_adaptation.prediction_evasion + 0.1).min(0.6);
        self.stats.strategy_switches += 1;
    }

    fn evolve(&mut self) {
        self.evolution_level += 1;
        self.evolution_score -= 100;
        self.stats.evolutions += 1;
        self.strategic_intelligence = (self.strategic_intelligence + 0.12).min(1.0);
        self.ai_adaptation.adaptation_speed =
            (self.ai_adaptation.adaptation_speed + 0.06).min(0.85);
        match self.evolution_level {
            2 => {
                for f in self.factions.values_mut() {
                    f.specializations.push("stealth".to_string());
                }
            }
            4 => {
                for f in self.factions.values_mut() {
                    f.specializations.push("technology".to_string());
                }
            }
            6 => {
                for f in self.factions.values_mut() {
                    f.specializations.push("psychological".to_string());
                }
            }
            _ => {}
        }
        for agent in self.sarsa_agents.values_mut() {
            agent.epsilon = (agent.epsilon - 0.05).max(0.05);
        }
        if self.evolution_level % 2 == 0 {
            self.start_campaign("resource_blitz", "evolution");
        }
    }

    pub fn record_commander_defeat(
        &mut self,
        faction_id: &str,
        current_time: i64,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if let Some(faction) = self.factions.get_mut(faction_id) {
            faction.commander.consecutive_losses += 1;
            faction.commander.last_loss_time = current_time;
            faction.commander.quiet_nights_accumulated = 0;
            if faction.commander.consecutive_losses == 3 && !faction.commander.is_frustrated {
                faction.commander.is_frustrated = true;
                events.push(GameEvent::LogMessage(format!(
                    "🎯 Нейро фиксирует: командир {} [{}] деморализован. \
                     3-е поражение подряд — его атаки стали предсказуемы и слабее!",
                    faction.commander.name, faction.name
                )));
            } else if faction.commander.consecutive_losses >= 3 {
                events.push(GameEvent::LogMessage(format!(
                    "💀 {} продолжает проигрывать ({}× подряд). Отряд теряет веру в командира.",
                    faction.commander.name, faction.commander.consecutive_losses
                )));
            }
        }
        events
    }

    pub fn record_commander_victory(&mut self, faction_id: &str) {
        if let Some(faction) = self.factions.get_mut(faction_id) {
            faction.commander.consecutive_losses = 0;
            faction.commander.is_frustrated = false;
            faction.commander.quiet_nights_accumulated = 0;
        }
    }

    pub fn update_quiet_nights(&mut self, had_attack_this_night: bool) {
        for faction in self.factions.values_mut() {
            if had_attack_this_night {
                faction.consecutive_quiet_nights = 0;
                if faction.commander.is_frustrated {
                    faction.commander.quiet_nights_accumulated += 1;
                }
            } else {
                faction.consecutive_quiet_nights += 1;
                faction.commander.quiet_nights_accumulated += 1;
            }
        }
    }

    #[allow(dead_code)]
    pub fn record_decoy_result(&mut self, faction_id: &str, was_ignored: bool) {
        if let Some(faction) = self.factions.get_mut(faction_id) {
            if was_ignored {
                faction.decoy_ignored_by_player += 1;
                if faction.decoy_ignored_by_player == 5 {
                    faction.decoy_use_count = 0;
                    faction.resources.manpower = (faction.resources.manpower + 10).min(200);
                }
            } else {
                faction.decoy_use_count += 1;
                faction.decoy_ignored_by_player = faction.decoy_ignored_by_player.saturating_sub(1);
            }
        }
    }

    pub fn try_launch_multiphase(
        &mut self,
        state: &GameState,
        _config: &GameConfig,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();

        if self.arms_race_level < 3 || state.rebel_activity < 10 || self.multiphase_active {
            return events;
        }
        if state.is_day {
            return events;
        }
        self.multiphase_active = true;
        self.multiphase_phase = 1;
        self.multiphase_timer = 15;
        events.push(GameEvent::LogMessage(
            "⚡ Повстанцы перешли к многофазной тактике! Фаза 1: отвлечение...".to_string(),
        ));
        events
    }

    pub fn tick_multiphase(
        &mut self,
        state: &mut GameState,
        config: &GameConfig,
    ) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if !self.multiphase_active {
            return events;
        }
        if self.multiphase_phase == 1 {
            self.multiphase_timer -= 1;
            if self.multiphase_timer <= 0 {
                self.multiphase_phase = 2;
                self.multiphase_timer = 5;
                events.push(GameEvent::LogMessage(
                    "💥 МНОГОФАЗНАЯ АТАКА! Фаза 2: реальный удар!".to_string(),
                ));
            }
        } else if self.multiphase_phase == 2 {
            self.multiphase_timer -= 1;
            if self.multiphase_timer <= 0 {
                self.multiphase_active = false;
                self.multiphase_phase = 0;

                let attack = AttackPlan {
                    id: format!("multiphase_{}", state.tick_count),
                    attack_type: AttackType::CoalitionStrike,
                    faction: self
                        .active_faction
                        .clone()
                        .unwrap_or_else(|| "scavengers".to_string()),
                    targets: vec![
                        AttackTarget::Resource {
                            resource: "plasma".to_string(),
                            amount: ((state.inventory.plasma as f64 * 0.3).round() as u32).max(3),
                        },
                        AttackTarget::Resource {
                            resource: "chips".to_string(),
                            amount: ((state.inventory.chips as f64 * 0.25).round() as u32).max(3),
                        },
                        AttackTarget::System {
                            system: "defense".to_string(),
                            damage: 2,
                        },
                    ],
                    success_probability: 0.75,
                    stealth_level: 0.3,
                    expected_gain: 60,
                };
                let (attack_events, success) = self.execute_attack(state, config, &attack);
                if success {
                    events.push(GameEvent::LogMessage(
                        "💥 МНОГОФАЗНАЯ АТАКА: УСПЕШНЫЙ УДАР! Ресурсы захвачены!".to_string(),
                    ));
                } else {
                    events.push(GameEvent::LogMessage(
                        "💥 МНОГОФАЗНАЯ АТАКА: ОТРАЖЕНА! Защита выстояла!".to_string(),
                    ));
                }
                events.extend(attack_events);
            }
        }
        events
    }

    pub fn record_player_reaction(&mut self, warning_time: i64, action_time: i64) {
        let reaction = action_time - warning_time;
        self.player_reaction_times.push_back(reaction);
        if self.player_reaction_times.len() > 20 {
            self.player_reaction_times.pop_front();
        }
        if reaction > 20 {
            self.slow_reaction_count += 1;
        } else {
            self.slow_reaction_count = self.slow_reaction_count.saturating_sub(1);
        }
    }

    pub fn escalate_arms_race(&mut self, _trigger: &str) -> Vec<GameEvent> {
        let mut events = Vec::new();
        self.arms_race_level += 1;
        let new_vuln = match self.arms_race_level % 4 {
            1 => "prediction",
            2 => "defense",
            3 => "craft_chain",
            _ => "communication",
        };
        self.current_vulnerability = Some(new_vuln.to_string());
        match new_vuln {
            "prediction" => {
                self.ai_adaptation.prediction_evasion =
                    (self.ai_adaptation.prediction_evasion + 0.15).min(0.9);
                events.push(GameEvent::LogMessage(format!(
                    "🔄 [ГОНКА ВООРУЖЕНИЙ Ур.{}] Повстанцы обошли систему предсказания нейро! \
                     Эвазия: {:.0}%",
                    self.arms_race_level,
                    self.ai_adaptation.prediction_evasion * 100.0
                )));
            }
            "defense" => {
                self.aggression = (self.aggression + 0.12).min(1.0);
                events.push(GameEvent::LogMessage(format!(
                    "🔄 [ГОНКА ВООРУЖЕНИЙ Ур.{}] Повстанцы нашли брешь в защитном периметре!",
                    self.arms_race_level
                )));
            }
            "craft_chain" => {
                self.cyber_attack_unlocked = true;
                events.push(GameEvent::LogMessage(format!(
                    "🔄 [ГОНКА ВООРУЖЕНИЙ Ур.{}] ВНИМАНИЕ: Повстанцы взломали производственные \
                     цепочки! Следующая атака может остановить крафт!",
                    self.arms_race_level
                )));
            }
            "communication" => {
                events.push(GameEvent::LogMessage(format!(
                    "🔄 [ГОНКА ВООРУЖЕНИЙ Ур.{}] Повстанцы зашифровали каналы связи — \
                     нейро труднее перехватывать сообщения.",
                    self.arms_race_level
                )));
            }
            _ => {}
        }
        events
    }

    #[allow(dead_code)]
    pub fn get_status(&self) -> String {
        let genome_desc = format!(
            "GA-fitness:{:.2} T:{:.2}",
            self.best_genome.fitness, self.sa_temperature
        );
        let nash_top = self
            .nash_strategy
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(i, &w)| format!("Nash→{} ({:.0}%)", AttackType::from_index(i), w * 100.0))
            .unwrap_or_default();
        format!(
            "☠️ Мятеж Ур.{} | Мораль:{:.0}% | Инт:{:.0}% | {} | {} | Кампания:{}",
            self.evolution_level,
            self.morale * 100.0,
            self.strategic_intelligence * 100.0,
            genome_desc,
            nash_top,
            self.current_campaign
                .as_ref()
                .map(|c| c.name.clone())
                .unwrap_or("нет".to_string())
        )
    }
}
