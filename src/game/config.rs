use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct QuestConfig {
    pub id: String,
    pub title: String,
    pub description: String,
    pub quest_type: String,
    pub target: u32,
    pub reward: u32,
    pub enabled: bool,
    pub order: u32,
    pub unlocks: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GameConfig {
    pub version: String,
    pub cycle_duration: i32,
    pub max_slots: usize,
    pub time_config: TimeConfig,
    pub mining_config: MiningConfig,
    pub economy_config: EconomyConfig,
    pub upgrade_config: UpgradeConfig,
    pub rebels: RebelConfig,
    pub quests: Vec<QuestConfig>,
    pub auto_click_config: AutoClickConfig,
    pub coal_consumption_config: CoalConsumptionConfig,
    pub ui_config: UiConfig,
    pub game_balance_config: GameBalanceConfig,
    pub debug_config: DebugConfig,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TimeConfig {
    pub day_duration: i32,
    pub night_duration: i32,
    pub initial_time: i32,
    pub start_at_day: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MiningConfig {
    pub base_chances: BaseChances,
    pub upgrade_bonus: f64,
    pub coal_bonus: f64,
    pub critical_chance: f64,
    pub critical_multiplier: u32,
    pub passive_chances: PassiveChances,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BaseChances {
    pub coal: f64,
    pub trash: f64,
    pub ore: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PassiveChances {
    pub coal: f64,
    pub trash: f64,
    pub ore: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EconomyConfig {
    pub trash_base_price: u32,
    pub trade_prices: TradePrices,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TradePrices {
    pub coal_buy: u32,
    pub coal_sell: u32,
    pub chips_buy: u32,
    pub chips_sell: u32,
    pub plasma_buy: u32,
    pub plasma_sell: u32,
    pub ore_buy: u32,
    pub ore_sell: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UpgradeConfig {
    pub mining_base_cost: u32,
    pub mining_cost_multiplier: f64,
    pub mining_max_level: u32,
    pub defense_activation_cost: u32,
    pub defense_max_level: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RebelConfig {

    pub base_attack_chance: f64,
    pub activity_increase: u32,
    pub activity_decrease: u32,
    pub max_activity: u32,
    pub activity_bonus_per_level: f64,
    pub max_attack_chance: f64,
    pub defense_base_power: u32,
    pub defense_level_bonus: u32,
    pub steal_rates: StealRates,
    pub disable_chances: DisableChances,
    pub power_reset_rate: f64,
    pub log_activity_threshold: u32,
    pub enable_attack_messages: bool,
    pub enable_defense_messages: bool,
    pub enable_strategic_behavior: bool,
    pub max_adaptation_level: u32,
    pub psychological_warfare_chance: f64,
    pub strategy_adaptation_speed: f64,
    pub enable_activity_messages: bool,
    pub enable_night_types: bool,

    pub fear_scaling_enabled: bool,
    pub attack_chance_per_neuro_level: f64,
    pub max_attack_chance_scaled: f64,
    pub mining_level_scaling: f64,
    pub fleet_scaling_per_ship: f64,

    pub breach_protection_chance_base: f64,
    pub breach_protection_per_activity: f64,
    pub breach_protection_max: f64,
    pub elite_attack_threshold: u32,

    pub coal_steal_percent: f64,
    pub ore_steal_percent: f64,
    pub chips_steal_percent: f64,
    pub plasma_steal_percent: f64,
    pub trash_steal_percent: f64,

    pub coal_steal_cap_percent: f64,
    pub ore_steal_cap_percent: f64,
    pub chips_steal_cap_percent: f64,
    pub plasma_steal_cap_percent: f64,
    pub trash_steal_cap_percent: f64,

    pub coalition_real_attack_chance: f64,
    pub coalition_combo_types: u32,

    pub background_sabotage_chance: f64,
    pub background_sabotage_cooldown: i32,

    pub fleet_attack_chance: f64,
    pub blueprint_steal_chance: f64,
    pub planet_harass_chance: f64,
    pub tec_sabotage_chance: f64,

    pub fear_events_enabled: bool,
    pub fear_message_intensity: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StealRates {
    pub low_activity_trash: f64,
    pub medium_activity_coal: f64,
    pub high_activity_chips: f64,
    pub very_high_activity_ore: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DisableChances {
    pub coal_plant_disable: f64,
    pub power_reset: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AutoClickConfig {
    pub enabled: bool,
    pub max_computational_power: u32,
    pub clicks_per_power: u32,
    pub power_per_manual_click: u32,
    pub auto_click_interval: i32,
    pub power_per_auto_click: u32,
    pub use_same_chances_as_manual: bool,
    pub auto_click_chance_multiplier: f64,
    pub long_press_duration: u32,
    pub visual_feedback: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CoalConsumptionConfig {
    pub day_coal_min: u32,
    pub day_coal_max: u32,
    pub night_coal_min: u32,
    pub night_coal_max: u32,
    pub plasma_conversion_rate: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UiConfig {
    pub max_log_entries: u32,
    pub auto_save_interval: u32,
    pub panel_collapse_enabled: bool,
    pub power_glow_enabled: bool,
    pub floating_button_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GameBalanceConfig {
    pub initial_coal: u32,
    pub initial_trash: u32,
    pub initial_chips: u32,
    pub initial_plasma: u32,
    pub initial_ore: u32,
    pub max_inventory_stack: u32,
    pub rebel_protection_cost: u32,
    pub base_mining_bonus: u32,
    pub coal_mining_bonus: u32,
    pub ore_mining_bonus: u32,

}

#[derive(Serialize, Deserialize, Clone)]
pub struct DebugConfig {
    pub enable_debug_commands: bool,
    pub log_level: String,
    pub show_fps: bool,
    pub enable_cheats: bool,
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            version: "5.0-no-prestige".to_string(),
            cycle_duration: 32,
            max_slots: 18,
            time_config: TimeConfig {
                day_duration: 180,
                night_duration: 300,
                initial_time: 180,
                start_at_day: true,
            },
            mining_config: MiningConfig {
                base_chances: BaseChances {
                    coal: 0.28,
                    trash: 0.25,
                    ore: 0.18,
                },
                upgrade_bonus: 0.018,
                coal_bonus: 0.030,
                critical_chance: 0.11,
                critical_multiplier: 2,
                passive_chances: PassiveChances {
                    coal: 0.010,
                    trash: 0.008,
                    ore: 0.006,
                },
            },
            economy_config: EconomyConfig {
                trash_base_price: 2,
                trade_prices: TradePrices {
                    coal_buy: 12,
                    coal_sell: 10,
                    chips_buy: 50,
                    chips_sell: 38,
                    plasma_buy: 140,
                    plasma_sell: 120,
                    ore_buy: 25,
                    ore_sell: 18,
                },
            },
            upgrade_config: UpgradeConfig {
                mining_base_cost: 8,
                mining_cost_multiplier: 2.5,
                mining_max_level: 15,
                defense_activation_cost: 1,
                defense_max_level: 8,
            },
            rebels: RebelConfig {

                base_attack_chance: 0.03,
                activity_increase: 2,
                activity_decrease: 1,
                max_activity: 15,
                activity_bonus_per_level: 0.015,
                max_attack_chance: 0.12,
                defense_base_power: 45,
                defense_level_bonus: 14,
                steal_rates: StealRates {
                    low_activity_trash: 0.06,
                    medium_activity_coal: 0.03,
                    high_activity_chips: 0.02,
                    very_high_activity_ore: 0.025,
                },
                disable_chances: DisableChances {
                    coal_plant_disable: 0.08,
                    power_reset: 0.06,
                },
                power_reset_rate: 0.15,
                log_activity_threshold: 7,
                enable_attack_messages: true,
                enable_defense_messages: true,
                enable_strategic_behavior: true,
                max_adaptation_level: 100,
                psychological_warfare_chance: 0.08,
                strategy_adaptation_speed: 0.4,
                enable_activity_messages: false,
                enable_night_types: true,

                fear_scaling_enabled: true,
                attack_chance_per_neuro_level: 0.025,
                max_attack_chance_scaled: 0.45,
                mining_level_scaling: 0.008,
                fleet_scaling_per_ship: 0.012,

                breach_protection_chance_base: 0.08,
                breach_protection_per_activity: 0.02,
                breach_protection_max: 0.35,
                elite_attack_threshold: 10,

                coal_steal_percent: 0.25,
                ore_steal_percent: 0.20,
                chips_steal_percent: 0.22,
                plasma_steal_percent: 0.18,
                trash_steal_percent: 0.15,

                coal_steal_cap_percent: 0.35,
                ore_steal_cap_percent: 0.30,
                chips_steal_cap_percent: 0.35,
                plasma_steal_cap_percent: 0.40,
                trash_steal_cap_percent: 0.25,

                coalition_real_attack_chance: 0.65,
                coalition_combo_types: 2,

                background_sabotage_chance: 0.18,
                background_sabotage_cooldown: 25,

                fleet_attack_chance: 0.22,
                blueprint_steal_chance: 0.08,
                planet_harass_chance: 0.12,
                tec_sabotage_chance: 0.15,

                fear_events_enabled: true,
                fear_message_intensity: 1.5,
            },
            quests: vec![],
            auto_click_config: AutoClickConfig {
                enabled: true,
                max_computational_power: 1000,
                clicks_per_power: 8,
                power_per_manual_click: 4,
                auto_click_interval: 8,
                power_per_auto_click: 3,
                use_same_chances_as_manual: true,
                auto_click_chance_multiplier: 1.0,
                long_press_duration: 600,
                visual_feedback: true,
            },
            coal_consumption_config: CoalConsumptionConfig {
                day_coal_min: 1,
                day_coal_max: 1,
                night_coal_min: 1,
                night_coal_max: 3,
                plasma_conversion_rate: 40,
            },
            ui_config: UiConfig {
                max_log_entries: 50,
                auto_save_interval: 30,
                panel_collapse_enabled: true,
                power_glow_enabled: true,
                floating_button_enabled: true,
            },
            game_balance_config: GameBalanceConfig {
                initial_coal: 0,
                initial_trash: 0,
                initial_chips: 0,
                initial_plasma: 0,
                initial_ore: 0,
                max_inventory_stack: 9999,
                rebel_protection_cost: 100,
                base_mining_bonus: 3,
                coal_mining_bonus: 2,
                ore_mining_bonus: 2,

            },
            debug_config: DebugConfig {
                enable_debug_commands: true,
                log_level: "info".to_string(),
                show_fps: false,
                enable_cheats: false,
            },
        }
    }
}