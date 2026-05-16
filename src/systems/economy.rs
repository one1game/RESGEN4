use crate::game::{GameState, GameEvent};

#[derive(Clone)]
pub struct EconomySystem;

impl EconomySystem {
    pub fn new(_config: crate::game::config::EconomyConfig) -> Self {
        Self
    }
    
    pub fn buy_resource(&self, _state: &mut GameState, _resource: &str) -> Vec<GameEvent> {
        vec![GameEvent::LogMessage("Торговля отключена".to_string())]
    }
    
    pub fn sell_resource(&self, _state: &mut GameState, _resource: &str) -> Vec<GameEvent> {
        vec![GameEvent::LogMessage("Торговля отключена".to_string())]
    }
}