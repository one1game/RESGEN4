// ======== src/web/ui.rs (ИСПРАВЛЕННАЯ ВЕРСИЯ) ========

use crate::game::{GameState, GameEvent, QuestType};
use wasm_bindgen::prelude::*;
use web_sys::{Document, HtmlElement};

const MAX_LOG_ENTRIES: usize = 50;
const LOG_STORAGE_KEY: &str = "corebox_game_log";

fn should_log(msg: &str) -> bool {
    if msg.contains("Пассивный рост") || msg.contains("КРИТИЧЕСКАЯ АКТИВНОСТЬ")
        || msg.contains("добыта 1 плазма") || msg.contains("Побочный продукт")
        || msg.contains("+0 мощности") || (msg.contains("Сожжено") && msg.contains("угля для работы"))
        || msg.contains("вычислительной мощности") { return false; }
    true
}

#[derive(Clone)]
pub struct GameUI {
    document: Document, current_tab: String, log_box: Option<HtmlElement>,
    inventory_div: Option<HtmlElement>, quests_container: Option<HtmlElement>,
    craft_container: Option<HtmlElement>, design_container: Option<HtmlElement>,
    fleet_container: Option<HtmlElement>, protection_panel: Option<HtmlElement>,
}

impl GameUI {
    pub fn new() -> Self {
        let doc = web_sys::window().unwrap().document().unwrap();
        Self {
            document: doc.clone(), current_tab: "inventory".to_string(),
            log_box: doc.get_element_by_id("logBox").and_then(|e| e.dyn_into().ok()),
            inventory_div: doc.get_element_by_id("resourcesContainer").and_then(|e| e.dyn_into().ok()),
            quests_container: doc.get_element_by_id("questsContainer").and_then(|e| e.dyn_into().ok()),
            craft_container: doc.get_element_by_id("craftContainer").and_then(|e| e.dyn_into().ok()),
            design_container: doc.get_element_by_id("designContainer").and_then(|e| e.dyn_into().ok()),
            fleet_container: doc.get_element_by_id("fleetContainer").and_then(|e| e.dyn_into().ok()),
            protection_panel: doc.get_element_by_id("rebelProtectionPanel").and_then(|e| e.dyn_into().ok()),
        }
    }

    fn save_log(&self) {
        if let Some(log) = &self.log_box {
            if let Some(storage) = web_sys::window().and_then(|w| w.local_storage().ok()).flatten() {
                let _ = storage.set_item(LOG_STORAGE_KEY, &log.inner_html());
            }
        }
    }

    fn trim_log(&self) {
        if let Some(log) = &self.log_box {
            let mut count: i32 = 0;
            let mut child = log.first_child();
            while let Some(_) = child { count += 1; child = child.and_then(|c| c.next_sibling()); }
            for _ in 0..(count as usize).saturating_sub(MAX_LOG_ENTRIES) {
                if let Some(first) = log.first_child() { let _ = log.remove_child(&first); }
            }
        }
    }

    pub fn add_log_entry(&self, msg: &str) -> Result<(), JsValue> {
        if let Some(log) = &self.log_box {
            let entry = self.document.create_element("div")?;
            entry.set_class_name("log-entry");
            entry.set_text_content(Some(msg));
            log.append_child(&entry)?;
            self.trim_log();
            log.set_scroll_top(log.scroll_height());
            self.save_log();
        }
        Ok(())
    }

    pub fn clear_log(&self) { if let Some(log) = &self.log_box { log.set_inner_html(""); Self::clear_storage(); } }
    fn clear_storage() { if let Some(storage) = web_sys::window().and_then(|w| w.local_storage().ok()).flatten() { let _ = storage.remove_item(LOG_STORAGE_KEY); } }

    pub fn render(&self, state: &GameState) {
        let _ = self.update_time(state);
        let _ = self.update_status(state);
        let _ = self.update_inventory(state);
        let _ = self.update_upgrades(state);
        let _ = self.update_quests(state);
        let _ = self.update_mining_bonus(state);
        let _ = self.update_click_system(state);
        let _ = self.update_rebel_protection(state);
        self.update_craft_tab(state);
        self.update_design_tab(state);
        self.update_fleet_tab(state);
    }

    pub fn handle_event(&self, event: &GameEvent) -> Result<(), JsValue> {
        match event {
            GameEvent::LogMessage(msg) => { if should_log(msg) { self.add_log_entry(&format!("> {}", msg))?; } }
            GameEvent::ResourceMined { resource, amount, critical } => {
                if resource == "coal" || resource == "trash" || resource == "ore" { return Ok(()); }
                let (icon, name) = match resource.as_str() {
                    "chips" => ("🎛️", if *amount == 1 { "чип" } else { "чипов" }),
                    "plasma" => ("⚡", if *amount == 1 { "плазма" } else { "плазмы" }),
                    _ => return Ok(()),
                };
                let crit = if *critical { " ✨КРИТ!" } else { "" };
                self.add_log_entry(&format!("{} {} {} {}{}", icon, if *amount == 1 { "изготовлен" } else { "изготовлено" }, amount, name, crit))?;
            }
            GameEvent::NightStarted => self.add_log_entry("🌙 Наступила ночь")?,
            GameEvent::DayStarted => self.add_log_entry("☀️ Наступил день")?,
            GameEvent::CoalActivated => self.add_log_entry("🔥 ТЭЦ активирована")?,
            GameEvent::CoalDeactivated => self.add_log_entry("⏸️ ТЭЦ деактивирована")?,
            GameEvent::CoalDepleted => self.add_log_entry("🔋 Уголь закончился! ТЭЦ отключена")?,
            GameEvent::ComputationalPowerDepleted => self.add_log_entry("⚠️ Вычислительная мощность истощена!")?,
            _ => {}
        }
        Ok(())
    }

    fn update_time(&self, state: &GameState) -> Result<(), JsValue> {
    if let Some(el) = self.document.get_element_by_id("timeDisplay") {
        let icon = if state.is_day { "☀️" } else { "🌙" };
        let text = if state.is_day { "День" } else { "Ночь" };
        // БАГ 1: визуальный таймер в виде полосы
        let filled = (state.game_time as usize).min(24) / 2;
        let empty = 12usize.saturating_sub(filled);
        let bar = "█".repeat(filled);
        let empty_bar = "░".repeat(empty);
        el.set_text_content(Some(&format!("{} {} [{}{}]", icon, text, bar, empty_bar)));
    }
    Ok(())
}

    fn update_status(&self, state: &GameState) -> Result<(), JsValue> {
        let set = |id, val| if let Some(el) = self.document.get_element_by_id(id) { el.set_text_content(Some(val)); };
        set("coalStatus", if state.coal_enabled { "АКТИВНА" } else { "ОФФЛАЙН" });
        set("aiStatusText", if state.is_ai_active() { "АКТИВЕН" } else { "НЕАКТИВЕН" });
        
        let defense_text = if state.upgrades.defense { format!("АКТИВНА (УР. {})", state.upgrades.defense_level) } else { "НЕАКТИВНА".to_string() };
        if let Some(el) = self.document.get_element_by_id("defenseStatusText") { el.set_text_content(Some(&defense_text)); }
        
        let rebel_text = if state.rebel_protection_active { "🛡️ ОТКУП" } else {
            match state.rebel_activity { 0..=3 => "НИЗКИЙ", 4..=6 => "СРЕДНИЙ", 7..=10 => "ВЫСОКИЙ", _ => "КРИТИЧЕСКИЙ" }
        };
        if let Some(el) = self.document.get_element_by_id("rebelStatus") { el.set_text_content(Some(rebel_text)); }
        Ok(())
    }

    fn update_mining_bonus(&self, state: &GameState) -> Result<(), JsValue> {
        let cfg = crate::CONFIG.lock().unwrap();
        let mut bonus = cfg.game_balance_config.base_mining_bonus + state.upgrades.mining
            + if state.coal_enabled { cfg.game_balance_config.coal_mining_bonus } else { 0 }
            + if state.ore_unlocked { cfg.game_balance_config.ore_mining_bonus } else { 0 };
        if state.mining_debuff_percent > 0.0 { bonus = bonus.saturating_sub((bonus as f32 * state.mining_debuff_percent) as u32); }
        if let Some(el) = self.document.get_element_by_id("miningBonusFloat") { el.set_text_content(Some(&format!("+{}%", bonus))); }
        Ok(())
    }

    fn update_click_system(&self, state: &GameState) -> Result<(), JsValue> {
        let cfg = crate::CONFIG.lock().unwrap();
        let active = state.is_ai_active();
        let perc = (state.computational_power as f32 / state.max_computational_power as f32 * 100.0) as u32;
        if let Some(el) = self.document.get_element_by_id("powerFill") { el.set_attribute("style", &format!("width: {}%", perc))?; }
        if let Some(el) = self.document.get_element_by_id("powerText") { el.set_text_content(Some(&format!("{}/{}", state.computational_power, state.max_computational_power))); }
        if let Some(el) = self.document.get_element_by_id("clickProgress") { 
            let click_perc = if active { (state.manual_clicks as f32 / cfg.auto_click_config.clicks_per_power as f32 * 100.0) as u32 } else { 0 };
            el.set_attribute("style", &format!("width: {}%", click_perc))?;
        }
        if let Some(el) = self.document.get_element_by_id("clickProgressText") { 
            let text = if active { format!("{}/{}", state.manual_clicks, cfg.auto_click_config.clicks_per_power) } else { "СИСТЕМА НЕАКТИВНА".to_string() };
            el.set_text_content(Some(&text));
        }
        if let Some(el) = self.document.get_element_by_id("autoClickStatus") { 
    el.set_text_content(Some(if state.auto_clicking { "АКТИВНА" } else { "ОТКЛЮЧЕНА" })); 
}
        Ok(())
    }

    fn update_inventory(&self, state: &GameState) -> Result<(), JsValue> {
        if let Some(container) = &self.inventory_div {
            let mut slots = Vec::new();
            if state.inventory.coal > 0 { slots.push(format!(r#"<div class="slot" onclick="window.game?.toggle_coal()"><div class="item-name">Уголь</div><div class="item-count">x{}</div></div>"#, state.inventory.coal)); }
            if state.inventory.trash > 0 { slots.push(format!(r#"<div class="slot"><div class="item-name">Мусор</div><div class="item-count">x{}</div></div>"#, state.inventory.trash)); }
            if state.inventory.chips > 0 { slots.push(format!(r#"<div class="slot chips"><div class="item-name">Чипы</div><div class="item-count">x{}</div></div>"#, state.inventory.chips)); }
            if state.inventory.plasma > 0 { slots.push(format!(r#"<div class="slot plasma"><div class="item-name">Плазма</div><div class="item-count">x{}</div></div>"#, state.inventory.plasma)); }
            if state.inventory.ore > 0 { slots.push(format!(r#"<div class="slot ore"><div class="item-name">Руда</div><div class="item-count">x{}</div></div>"#, state.inventory.ore)); }
            while slots.len() < 18 { slots.push(r#"<div class="slot empty"><div class="item-name">[Пусто]</div><div class="item-count">+</div></div>"#.to_string()); }
            container.set_inner_html(&slots.join(""));
        }
        Ok(())
    }

    fn update_upgrades(&self, state: &GameState) -> Result<(), JsValue> {
        if let Some(el) = self.document.get_element_by_id("miningLevel") { el.set_text_content(Some(&state.upgrades.mining.to_string())); }
        if let Some(el) = self.document.get_element_by_id("miningProgress") { el.set_attribute("style", &format!("width: {}%", (state.upgrades.mining as f32 / 10.0 * 100.0) as u32))?; }
        if let Some(el) = self.document.get_element_by_id("defenseStatus") { el.set_text_content(Some(if state.upgrades.defense { "Активно" } else { "Неактивно" })); }
        if let Some(el) = self.document.get_element_by_id("defenseLevel") { el.set_text_content(Some(&format!("Ур. {}/5", state.upgrades.defense_level))); }
        Ok(())
    }

    fn update_quests(&self, state: &GameState) -> Result<(), JsValue> {
        if let Some(container) = &self.quests_container {
            if state.quests.is_empty() { container.set_inner_html(r#"<div class="quest-card"><div class="quest-header"><div class="quest-title">Квестов нет</div></div></div>"#); return Ok(()); }
            if state.current_quest >= state.quests.len() { container.set_inner_html(r#"<div class="quest-card"><div class="quest-header"><div class="quest-title">Все квесты завершены!</div></div></div>"#); return Ok(()); }
            let q = &state.quests[state.current_quest];
            let (progress_text, percent) = match &q.quest_type {
                QuestType::MineAny => (format!("Добыто: {}/{}", state.total_mined, q.target), (state.total_mined as f32 / q.target as f32 * 100.0).min(100.0) as u32),
                QuestType::SurviveNight => (format!("Ночей: {}/{}", state.nights_survived, q.target), (state.nights_survived as f32 / q.target as f32 * 100.0).min(100.0) as u32),
                QuestType::MineResource(r) => {
                    let count = match r.as_str() { "coal" => state.total_coal_mined, "chips" => state.inventory.chips, "plasma" => state.total_plasma_mined, "ore" => state.total_ore_mined, _ => 0 };
                    (format!("Добыто {}: {}/{}", r, count, q.target), (count as f32 / q.target as f32 * 100.0).min(100.0) as u32)
                }
                QuestType::ActivateDefense => (format!("Защита: {}", if state.upgrades.defense { "Активирована" } else { "Не активирована" }), if state.upgrades.defense { 100 } else { 0 }),
                QuestType::SurviveAttack => (format!("Атак: {}/{}", state.rebel_attacks_count, q.target), (state.rebel_attacks_count as f32 / q.target as f32 * 100.0).min(100.0) as u32),
                QuestType::ReachEvolutionLevel => (format!("Эволюция: {}/{}", state.neuro_evolution, q.target), (state.neuro_evolution as f32 / q.target as f32 * 100.0).min(100.0) as u32),
                QuestType::CollectResource(r) => {
                    let count = match r.as_str() { "coal" => state.total_coal_mined, "ore" => state.total_ore_mined, "plasma" => state.total_plasma_mined, _ => 0 };
                    (format!("Добыто {}: {}/{}", r, count, q.target), (count as f32 / q.target as f32 * 100.0).min(100.0) as u32)
                }
            };
            container.set_inner_html(&format!(r#"<div class="quest-card"><div class="quest-header"><div class="quest-title">{}</div><div class="quest-reward">+{}₸</div></div><div class="progress-container"><div class="progress-fill" style="width: {}%"></div></div><div class="quest-description">{}<br><small>{}</small></div></div>"#, q.title, q.reward, percent, q.description, progress_text));
        }
        Ok(())
    }

    fn update_rebel_protection(&self, state: &GameState) -> Result<(), JsValue> {
        if let Some(container) = &self.protection_panel {
            container.set_inner_html(&format!(r#"<div class="protection-info"><div class="protection-stats"><div>НОЧИ: <strong>{}</strong></div><div>СТАТУС: <strong>{}</strong></div><div>МУСОР: <strong>{}/100</strong></div></div><button class="protection-buy-btn" onclick="window.game?.buy_rebel_protection()">+1 НОЧЬ ЗА 100 ♻️</button><button class="protection-toggle-btn" onclick="window.game?.toggle_rebel_protection()" style="margin-top:10px;">{}</button></div>"#,
                state.rebel_protection_nights, if state.rebel_protection_active { "АКТИВНА ✅" } else { "НЕАКТИВНА ❌" },
                state.inventory.trash, if state.rebel_protection_active { "ДЕАКТИВИРОВАТЬ" } else { "АКТИВИРОВАТЬ" }));
        }
        Ok(())
    }

    fn update_craft_tab(&self, state: &GameState) {
        if let Some(c) = &self.craft_container {
            let _ = c.set_attribute("data-coal", &state.inventory.coal.to_string());
            let _ = c.set_attribute("data-ore", &state.inventory.ore.to_string());
            let _ = c.set_attribute("data-chips", &state.inventory.chips.to_string());
            let _ = c.set_attribute("data-plasma", &state.inventory.plasma.to_string());
        }
    }

    fn update_design_tab(&self, state: &GameState) {
        if let Some(c) = &self.design_container {
            let _ = c.set_attribute("data-power", &state.computational_power.to_string());
            let _ = c.set_attribute("data-ore", &state.inventory.ore.to_string());
        }
    }

    fn update_fleet_tab(&self, state: &GameState) {
        if let Some(c) = &self.fleet_container {
            let _ = c.set_attribute("data-ore", &state.inventory.ore.to_string());
            let _ = c.set_attribute("data-chips", &state.inventory.chips.to_string());
        }
    }
}