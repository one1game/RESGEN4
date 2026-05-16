pub mod config;
pub mod events;
pub mod state;


#[allow(unused_imports)]
pub use config::{GameConfig, MiningConfig, EconomyConfig, UpgradeConfig};

#[allow(unused_imports)]  
pub use state::{GameState, Inventory, Upgrades, Quest, QuestType};

pub use events::GameEvent;