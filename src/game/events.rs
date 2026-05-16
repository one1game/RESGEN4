// game/src/game/events.rs

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum GameEvent {
    LogMessage(String),
    ResourceMined {
        resource: String,
        amount: u32,
        critical: bool,
    },
    QuestCompleted {
        title: String,
        reward: u32,
    },
    RebelAttack {
        attack_type: String,
        details: String,
    },
    UpgradePurchased {
        upgrade_type: String,
        level: u32,
    },
    DefenseActivated,
    NotEnoughResources {
        resource: String,
        required: u32,
        available: u32,
    },
    CoalActivated,
    CoalDeactivated,
    CoalDepleted,
    DayStarted,
    NightStarted,
    
    // НОВЫЕ СОБЫТИЯ ДЛЯ СИСТЕМЫ КЛИКОВ
    ComputationalPowerAdded {
        amount: u32,
        total: u32,
    },
    ComputationalPowerDepleted,
    AutoClickingStarted,
    AutoClickingStopped,

    // НОВЫЕ СОБЫТИЯ ДЛЯ УМНЫХ ПОВСТАНЦЕВ
    RebelStrategyChanged {
        new_strategy: String,
        reason: String,
    },
    RebelAdaptation {
        adaptation_level: u32,
        effects: String,
    },
    PsychologicalWarfare {
        message: String,
        power_loss: u32,
    },

    // НОВЫЕ СОБЫТИЯ ДЛЯ НЕЙРО-ЭКОСИСТЕМЫ
    NeuroDefenseActivated {
        system: String,
        strategy: String,
        power_cost: u32,
    },
    EcosystemEvolution {
        new_capability: String,
        consciousness_level: f64,
    },
    QuantumCollapse {
        decision: String,
        probability: f64,
    },
    EmergentBehavior {
        behavior_name: String,
        description: String,
    },
    ImmuneResponse {
        cell_type: String,
        effectiveness: f64,
    },
    NeuralNetworkActivation {
        activated_cells: u32,
        decision_strength: f64,
    },
    PhaseTransition {
        from_state: String,
        to_state: String,
        trigger: String,
    },
    HolographicRecall {
        memory_fragments: u32,
        relevance: f64,
    },
    SystemEvent(String),
    
    // ЭВОЛЮЦИОННЫЕ СОБЫТИЯ
    EvolutionaryLeap {
        old_level: u32,
        new_level: u32,
        new_abilities: Vec<String>,
    },
    ConsciousnessExpansion {
        old_consciousness: f64,
        new_consciousness: f64,
        insights: Vec<String>,
    },
    
    // КВАНТОВЫЕ СОБЫТИЯ
    QuantumSuperposition {
        possible_futures: u32,
        collapse_trigger: String,
    },
    EntanglementFormed {
        system_a: String,
        system_b: String,
        correlation: f64,
    },
    
    // БИОЛОГИЧЕСКИЕ СОБЫТИЯ (иммунная система)
    ImmuneCellActivation {
        cell_type: String,
        target: String,
        aggression: f64,
    },
    AntigenMemoryUpdate {
        pattern: String,
        effectiveness: f64,
        success_count: u32,
    },
    AutoimmuneBalanceShift {
        old_balance: f64,
        new_balance: f64,
        reason: String,
    },
    
    // ЭМЕРДЖЕНТНЫЕ ПОВЕДЕНИЯ
    SymbioticCoexistenceProposed {
        to_faction: String,
        terms: String,
    },
    SystemMetamorphosisStarted {
        old_architecture: String,
        new_architecture: String,
        estimated_duration: u32,
    },
    RealityHackAttempt {
        target_rules: Vec<String>,
        success_chance: f64,
    },
    
    // ГОЛОГРАФИЧЕСКАЯ ПАМЯТЬ
    MemoryFragmentStored {
        significance: f64,
        emotional_context: String,
    },
    PatternRecognition {
        recognized_pattern: String,
        confidence: f64,
        source_memories: Vec<u32>,
    },
    
    // НЕЙРОННЫЕ СОБЫТИЯ
    NeuralPathwayFormed {
        from_neuron: u32,
        to_neuron: u32,
        strength: f64,
    },
    NeuroplasticityEvent {
        modified_connections: u32,
        overall_impact: f64,
    },
    CollectiveDecision {
        participating_neurons: u32,
        consensus_level: f64,
        final_decision: String,
    },
}