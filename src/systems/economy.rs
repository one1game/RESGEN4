// src/systems/economy.rs
// ПОЛНАЯ РЕАЛИЗАЦИЯ ТОРГОВЛИ

use crate::game::{GameState, GameEvent};
use crate::game::config::EconomyConfig;

#[derive(Clone)]
pub struct EconomySystem {
    config: EconomyConfig,
}

impl EconomySystem {
    pub fn new(config: EconomyConfig) -> Self {
        Self { config }
    }
    
    pub fn buy_resource(&self, state: &mut GameState, resource: &str, amount: u32) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.trade_blocked {
            events.push(GameEvent::LogMessage("🔴 Торговля заблокирована (осада)!".to_string()));
            return events;
        }
        
        if amount == 0 || amount > 1000 {
            events.push(GameEvent::LogMessage("❌ Некорректное количество".to_string()));
            return events;
        }
        
        let (cost_resource, cost_per_unit, gain_resource, gain_per_unit) = match resource {
            "coal"  => ("trash", self.config.trade_prices.coal_buy,   "coal",  1u32),
            "chips" => ("ore",   self.config.trade_prices.chips_buy,  "chips", 1u32),
            "plasma"=> ("coal",  self.config.trade_prices.plasma_buy, "plasma",1u32),
            "ore"   => ("trash", self.config.trade_prices.ore_buy,    "ore",   1u32),
            _ => {
                events.push(GameEvent::LogMessage(format!("❌ Неизвестный ресурс для покупки: {}", resource)));
                return events;
            }
        };
        
        let total_cost = cost_per_unit * amount;
        let current = match cost_resource {
            "trash" => state.inventory.trash,
            "ore"   => state.inventory.ore,
            "coal"  => state.inventory.coal,
            _       => 0,
        };
        
        if current < total_cost {
            events.push(GameEvent::LogMessage(
                format!("❌ Недостаточно {} для покупки {} (нужно {}, есть {})", 
                    cost_resource, resource, total_cost, current)
            ));
            return events;
        }
        
        match cost_resource {
            "trash" => state.inventory.trash -= total_cost,
            "ore"   => state.inventory.ore   -= total_cost,
            "coal"  => state.inventory.coal  -= total_cost,
            _ => {}
        }
        
        let gained = gain_per_unit * amount;
        match gain_resource {
            "coal"   => state.inventory.coal   += gained,
            "chips"  => state.inventory.chips  += gained,
            "plasma" => state.inventory.plasma += gained,
            "ore"    => state.inventory.ore    += gained,
            _ => {}
        }
        
        events.push(GameEvent::LogMessage(
            format!("💱 Куплено: +{} {} за {} {}", gained, gain_resource, total_cost, cost_resource)
        ));
        events
    }
    
    pub fn sell_resource(&self, state: &mut GameState, resource: &str, amount: u32) -> Vec<GameEvent> {
        let mut events = Vec::new();
        
        if state.trade_blocked {
            events.push(GameEvent::LogMessage("🔴 Торговля заблокирована!".to_string()));
            return events;
        }
        
        if amount == 0 || amount > 1000 {
            events.push(GameEvent::LogMessage("❌ Некорректное количество".to_string()));
            return events;
        }
        
        let (sell_resource, gain_per_unit) = match resource {
            "coal"  => ("coal",  self.config.trade_prices.coal_sell),
            "chips" => ("chips", self.config.trade_prices.chips_sell),
            "plasma"=> ("plasma",self.config.trade_prices.plasma_sell),
            "ore"   => ("ore",   self.config.trade_prices.ore_sell),
            _ => {
                events.push(GameEvent::LogMessage(format!("❌ Нельзя продать: {}", resource)));
                return events;
            }
        };
        
        let current = match sell_resource {
            "coal"   => state.inventory.coal,
            "chips"  => state.inventory.chips,
            "plasma" => state.inventory.plasma,
            "ore"    => state.inventory.ore,
            _        => 0,
        };
        
        if current < amount {
            events.push(GameEvent::LogMessage(
                format!("❌ Недостаточно {} для продажи (есть {})", resource, current)
            ));
            return events;
        }
        
        match sell_resource {
            "coal"   => state.inventory.coal   -= amount,
            "chips"  => state.inventory.chips  -= amount,
            "plasma" => state.inventory.plasma -= amount,
            "ore"    => state.inventory.ore    -= amount,
            _ => {}
        }
        
        let earned = gain_per_unit * amount;
        state.inventory.trash += earned;
        
        events.push(GameEvent::LogMessage(
            format!("💰 Продано: {} {} за {} мусора", amount, resource, earned)
        ));
        events
    }
}