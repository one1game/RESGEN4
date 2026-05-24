// src/game/mod.rs

pub mod state;
pub mod config;
pub mod events;

// Экспорт структур для использования в других модулях
pub use state::AttackRecord;
pub use state::GameState;
pub use state::Inventory;
pub use state::Upgrades;
pub use state::Quest;
pub use state::QuestType;
pub use state::FleetShip;
pub use state::Planet;
pub use state::PlanetMission;
pub use events::GameEvent;
pub use config::GameConfig;