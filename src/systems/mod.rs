// game/src/systems/mod.rs
pub mod mining;
pub mod economy;
pub mod upgrades;
pub mod rebel;
pub mod neuro_ecosystem;
pub mod autoclick;  // 🆕 Добавляем новую систему

pub use mining::MiningSystem;
pub use economy::EconomySystem;
pub use upgrades::UpgradeSystem;
pub use rebel::RebelSystem;
pub use neuro_ecosystem::NeuroEcosystem;
pub use autoclick::AutoClickSystem;  // 🆕 Экспортируем