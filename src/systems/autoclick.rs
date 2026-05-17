// game/src/systems/autoclick.rs
use crate::game::{GameState, GameEvent};
use crate::game::config::AutoClickConfig;
use rand::Rng;

#[derive(Clone)]
pub struct AutoClickSystem {
    config: AutoClickConfig,
}

impl AutoClickSystem {
    pub fn new(config: AutoClickConfig) -> Self {
        Self { config }
    }
    
    pub fn add_manual_click(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if !state.is_ai_active() {
            events.push(GameEvent::LogMessage("❌ Система неактивна! Включите ТЭЦ или дождитесь дня".to_string()));
            return events;
        }
        
        state.manual_clicks += 1;
        
        if state.manual_clicks >= self.config.clicks_per_power {
            let power_to_add = self.config.power_per_manual_click;
            state.manual_clicks = 0;
            state.computational_power = (state.computational_power + power_to_add)
                .min(state.max_computational_power);
            
            events.push(GameEvent::ComputationalPowerAdded { 
                amount: power_to_add, 
                total: state.computational_power 
            });
        }
        
        events
    }
    
    pub fn start_auto_clicking(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if !state.auto_clicking && state.computational_power > 0 {
            state.auto_clicking = true;
            state.last_auto_click_time = 0;
            events.push(GameEvent::AutoClickingStarted);
            events.push(GameEvent::LogMessage("🤖 Автоклики активированы!".to_string()));
        } else if state.computational_power == 0 {
            events.push(GameEvent::LogMessage("❌ Недостаточно мощности для автокликов".to_string()));
        }
        
        events
    }
    
    pub fn stop_auto_clicking(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.auto_clicking {
            state.auto_clicking = false;
            events.push(GameEvent::AutoClickingStopped);
            events.push(GameEvent::LogMessage("⏹️ Автоклики остановлены".to_string()));
        }
        
        events
    }
    
    pub fn process_auto_click(&self, state: &mut GameState) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if !state.auto_clicking || !state.can_auto_click() {
            return events;
        }
        
        state.last_auto_click_time += 1;
        
        if state.last_auto_click_time >= self.config.auto_click_interval {
            let power_cost = self.config.power_per_auto_click;
            
            if state.computational_power >= power_cost {
                state.computational_power -= power_cost;
                state.last_auto_click_time = 0;
                
                events.push(GameEvent::LogMessage(
                    format!("⚡ Автоклик: -{} мощности (интервал: {}сек)", power_cost, self.config.auto_click_interval)
                ));
            } else {
                state.auto_clicking = false;
                events.push(GameEvent::ComputationalPowerDepleted);
                events.push(GameEvent::LogMessage(
                    "❌ Недостаточно мощности! Автоклики отключены".to_string()
                ));
            }
        }
        
        events
    }
    
    pub fn get_power_percentage(&self, state: &GameState) -> f32 {
        if state.max_computational_power == 0 {
            0.0
        } else {
            (state.computational_power as f32 / state.max_computational_power as f32) * 100.0
        }
    }
    
    pub fn can_activate_auto_click(&self, state: &GameState) -> bool {
        state.computational_power > 0 && state.is_ai_active()
    }
    
    pub fn get_click_progress(&self, state: &GameState) -> (u32, u32) {
        (state.manual_clicks, self.config.clicks_per_power)
    }
}