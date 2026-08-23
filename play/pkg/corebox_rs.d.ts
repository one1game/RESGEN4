/* tslint:disable */
/* eslint-disable */
export function main(): void;
export function apply_config_from_admin(config_json: string): string;
export function start_game(): CoreGame;
export class CoreGame {
  free(): void;
  [Symbol.dispose](): void;
  design_ship(ship_type: string): string;
  get_planets(): string;
  toggle_coal(): void;
  add_resource(resource: string, amount: number): void;
  buy_resource(resource: string): void;
  get_resource(resource: string): number;
  reload_config(): void;
  sell_resource(resource: string): void;
  set_max_power(max: number): void;
  get_statistics(): string;
  is_demo_locked(): boolean;
  repair_systems(): void;
  reset_progress(): void;
  subtract_power(amount: number): boolean;
  upgrade_mining(): void;
  get_rebel_intel(): string;
  load_game_state(state_json: string): void;
  research_planet(): string;
  sync_blueprints(cargo: boolean, scout: boolean, combat: boolean): void;
  upgrade_defense(): void;
  upgrade_turbine(): boolean;
  activate_defense(): void;
  add_manual_click(): void;
  craft_cargo_ship(): string;
  craft_scout_ship(): string;
  get_turbine_heat(): number;
  is_auto_clicking(): boolean;
  is_tec_sabotaged(): boolean;
  neuro_fake_depot(): void;
  neuro_propaganda(): void;
  craft_combat_ship(): string;
  subtract_resource(resource: string, amount: number): void;
  apply_fleet_repair(ore_cost: number, chips_cost: number): boolean;
  get_neuro_cooldown(op: string, current_tick: bigint): number;
  get_total_breaches(): number;
  get_universal_save(): string;
  is_turbine_cooling(): boolean;
  save_current_state(): void;
  stop_auto_clicking(): void;
  sync_fleet_from_js(fleet_json: string): string;
  apply_fleet_upgrade(ore: number, chips: number, plasma: number): boolean;
  get_neuro_analytics(): string;
  get_neuro_evolution(): number;
  is_blueprint_locked(): boolean;
  send_ship_to_planet(ship_json: string, planet_id: string): string;
  start_auto_clicking(): void;
  upgrade_crit_module(): void;
  buy_rebel_protection(): void;
  craft_chips_from_ore(): string;
  get_blueprint_status(): string;
  get_q_learning_debug(): string;
  get_rebel_fear_level(): number;
  is_fleet_under_attack(): boolean;
  neuro_fortify_planets(): void;
  set_fleet_cargo_bonus(bonus: number): void;
  set_fleet_power_bonus(bonus: number): void;
  craft_plasma_from_coal(): string;
  get_neuro_score_needed(): number;
  upgrade_cooling_module(): void;
  complete_planet_mission(mission_id: string): string;
  get_computational_power(): number;
  get_fleet_attack_damage(): number;
  get_locked_blueprint_id(): string;
  set_fleet_defense_bonus(_bonus: number): void;
  set_neuro_consciousness(consciousness: number): void;
  toggle_rebel_protection(): void;
  get_intercepted_messages(): string;
  neuro_encrypt_blueprints(): void;
  get_turbine_upgrade_level(): number;
  neuro_close_vulnerability(): void;
  neuro_deploy_fleet_shield(): void;
  get_active_planet_missions(): string;
  get_tec_sabotage_remaining(): number;
  set_temporary_mining_bonus(bonus_percent: number): void;
  add_manual_click_with_combo(combo_power_bonus: number): void;
  get_max_computational_power(): number;
  set_temporary_defense_bonus(bonus_percent: number): void;
  get_blueprint_lock_remaining(): number;
  add_manual_click_with_multiplier(mult: number): void;
  constructor();
  init(): void;
  add_power(amount: number): void;
  clear_log(): void;
  game_loop(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_coregame_free: (a: number, b: number) => void;
  readonly apply_config_from_admin: (a: number, b: number) => [number, number];
  readonly coregame_activate_defense: (a: number) => void;
  readonly coregame_add_manual_click: (a: number) => void;
  readonly coregame_add_manual_click_with_combo: (a: number, b: number) => void;
  readonly coregame_add_manual_click_with_multiplier: (a: number, b: number) => void;
  readonly coregame_add_power: (a: number, b: number) => void;
  readonly coregame_add_resource: (a: number, b: number, c: number, d: number) => void;
  readonly coregame_apply_fleet_repair: (a: number, b: number, c: number) => number;
  readonly coregame_apply_fleet_upgrade: (a: number, b: number, c: number, d: number) => number;
  readonly coregame_buy_rebel_protection: (a: number) => void;
  readonly coregame_buy_resource: (a: number, b: number, c: number) => void;
  readonly coregame_clear_log: (a: number) => void;
  readonly coregame_complete_planet_mission: (a: number, b: number, c: number) => [number, number];
  readonly coregame_craft_cargo_ship: (a: number) => [number, number];
  readonly coregame_craft_chips_from_ore: (a: number) => [number, number];
  readonly coregame_craft_combat_ship: (a: number) => [number, number];
  readonly coregame_craft_plasma_from_coal: (a: number) => [number, number];
  readonly coregame_craft_scout_ship: (a: number) => [number, number];
  readonly coregame_design_ship: (a: number, b: number, c: number) => [number, number];
  readonly coregame_game_loop: (a: number) => void;
  readonly coregame_get_active_planet_missions: (a: number) => [number, number];
  readonly coregame_get_blueprint_lock_remaining: (a: number) => number;
  readonly coregame_get_blueprint_status: (a: number) => [number, number];
  readonly coregame_get_computational_power: (a: number) => number;
  readonly coregame_get_fleet_attack_damage: (a: number) => number;
  readonly coregame_get_intercepted_messages: (a: number) => [number, number];
  readonly coregame_get_locked_blueprint_id: (a: number) => [number, number];
  readonly coregame_get_max_computational_power: (a: number) => number;
  readonly coregame_get_neuro_analytics: (a: number) => [number, number];
  readonly coregame_get_neuro_cooldown: (a: number, b: number, c: number, d: bigint) => number;
  readonly coregame_get_neuro_evolution: (a: number) => number;
  readonly coregame_get_neuro_score_needed: (a: number) => number;
  readonly coregame_get_planets: (a: number) => [number, number];
  readonly coregame_get_q_learning_debug: (a: number) => [number, number];
  readonly coregame_get_rebel_fear_level: (a: number) => number;
  readonly coregame_get_rebel_intel: (a: number) => [number, number];
  readonly coregame_get_resource: (a: number, b: number, c: number) => number;
  readonly coregame_get_statistics: (a: number) => [number, number];
  readonly coregame_get_tec_sabotage_remaining: (a: number) => number;
  readonly coregame_get_total_breaches: (a: number) => number;
  readonly coregame_get_turbine_heat: (a: number) => number;
  readonly coregame_get_turbine_upgrade_level: (a: number) => number;
  readonly coregame_get_universal_save: (a: number) => [number, number];
  readonly coregame_init: (a: number) => void;
  readonly coregame_is_auto_clicking: (a: number) => number;
  readonly coregame_is_blueprint_locked: (a: number) => number;
  readonly coregame_is_demo_locked: (a: number) => number;
  readonly coregame_is_fleet_under_attack: (a: number) => number;
  readonly coregame_is_tec_sabotaged: (a: number) => number;
  readonly coregame_is_turbine_cooling: (a: number) => number;
  readonly coregame_load_game_state: (a: number, b: number, c: number) => [number, number];
  readonly coregame_neuro_close_vulnerability: (a: number) => void;
  readonly coregame_neuro_deploy_fleet_shield: (a: number) => void;
  readonly coregame_neuro_encrypt_blueprints: (a: number) => void;
  readonly coregame_neuro_fake_depot: (a: number) => void;
  readonly coregame_neuro_fortify_planets: (a: number) => void;
  readonly coregame_neuro_propaganda: (a: number) => void;
  readonly coregame_new: () => number;
  readonly coregame_reload_config: (a: number) => void;
  readonly coregame_repair_systems: (a: number) => void;
  readonly coregame_research_planet: (a: number) => [number, number];
  readonly coregame_reset_progress: (a: number) => void;
  readonly coregame_save_current_state: (a: number) => void;
  readonly coregame_sell_resource: (a: number, b: number, c: number) => void;
  readonly coregame_send_ship_to_planet: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly coregame_set_fleet_cargo_bonus: (a: number, b: number) => void;
  readonly coregame_set_fleet_defense_bonus: (a: number, b: number) => void;
  readonly coregame_set_fleet_power_bonus: (a: number, b: number) => void;
  readonly coregame_set_max_power: (a: number, b: number) => void;
  readonly coregame_set_neuro_consciousness: (a: number, b: number) => void;
  readonly coregame_set_temporary_defense_bonus: (a: number, b: number) => void;
  readonly coregame_set_temporary_mining_bonus: (a: number, b: number) => void;
  readonly coregame_start_auto_clicking: (a: number) => void;
  readonly coregame_stop_auto_clicking: (a: number) => void;
  readonly coregame_subtract_power: (a: number, b: number) => number;
  readonly coregame_subtract_resource: (a: number, b: number, c: number, d: number) => void;
  readonly coregame_sync_blueprints: (a: number, b: number, c: number, d: number) => void;
  readonly coregame_sync_fleet_from_js: (a: number, b: number, c: number) => [number, number];
  readonly coregame_toggle_coal: (a: number) => void;
  readonly coregame_toggle_rebel_protection: (a: number) => void;
  readonly coregame_upgrade_cooling_module: (a: number) => void;
  readonly coregame_upgrade_crit_module: (a: number) => void;
  readonly coregame_upgrade_defense: (a: number) => void;
  readonly coregame_upgrade_mining: (a: number) => void;
  readonly coregame_upgrade_turbine: (a: number) => number;
  readonly main: () => void;
  readonly start_game: () => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
