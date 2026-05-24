/* tslint:disable */
/* eslint-disable */

export class CoreGame {
    free(): void;
    [Symbol.dispose](): void;
    activate_defense(): void;
    add_manual_click(): void;
    add_power(amount: number): void;
    add_resource(resource: string, amount: number): void;
    apply_fleet_repair(ore_cost: number, chips_cost: number): boolean;
    apply_fleet_upgrade(ore: number, chips: number, plasma: number): boolean;
    buy_rebel_protection(): void;
    buy_resource(resource: string): void;
    clear_log(): void;
    craft_cargo_ship(): string;
    craft_chips_from_ore(): string;
    craft_combat_ship(): string;
    craft_plasma_from_coal(): string;
    craft_scout_ship(): string;
    design_ship(ship_type: string): string;
    game_loop(): void;
    get_active_planet_missions(): string;
    get_blueprint_status(): string;
    get_computational_power(): number;
    get_max_computational_power(): number;
    get_neuro_evolution(): number;
    get_planets(): string;
    get_resource(resource: string): number;
    get_statistics(): string;
    get_turbine_heat(): number;
    get_turbine_upgrade_level(): number;
    get_universal_save(): string;
    init(): void;
    is_auto_clicking(): boolean;
    is_turbine_cooling(): boolean;
    load_game_state(state_json: string): void;
    constructor();
    reload_config(): void;
    repair_systems(): void;
    research_planet(): string;
    reset_progress(): void;
    save_current_state(): void;
    sell_resource(resource: string): void;
    send_ship_to_planet(ship_id: string, planet_id: string): string;
    set_fleet_cargo_bonus(bonus: number): void;
    set_fleet_defense_bonus(bonus: number): void;
    set_max_power(max: number): void;
    start_auto_clicking(): void;
    stop_auto_clicking(): void;
    subtract_power(amount: number): void;
    subtract_resource(resource: string, amount: number): void;
    sync_blueprints(cargo: boolean, scout: boolean, combat: boolean): void;
    toggle_coal(): void;
    toggle_rebel_protection(): void;
    upgrade_cooling_module(): void;
    upgrade_crit_module(): void;
    upgrade_defense(): void;
    upgrade_mining(): void;
    upgrade_turbine(): boolean;
}

export function apply_config_from_admin(config_json: string): string;

export function main(): void;

export function start_game(): CoreGame;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_coregame_free: (a: number, b: number) => void;
    readonly apply_config_from_admin: (a: number, b: number) => [number, number];
    readonly coregame_activate_defense: (a: number) => void;
    readonly coregame_add_manual_click: (a: number) => void;
    readonly coregame_add_power: (a: number, b: number) => void;
    readonly coregame_add_resource: (a: number, b: number, c: number, d: number) => void;
    readonly coregame_apply_fleet_repair: (a: number, b: number, c: number) => number;
    readonly coregame_apply_fleet_upgrade: (a: number, b: number, c: number, d: number) => number;
    readonly coregame_buy_rebel_protection: (a: number) => void;
    readonly coregame_buy_resource: (a: number, b: number, c: number) => void;
    readonly coregame_clear_log: (a: number) => void;
    readonly coregame_craft_cargo_ship: (a: number) => [number, number];
    readonly coregame_craft_chips_from_ore: (a: number) => [number, number];
    readonly coregame_craft_combat_ship: (a: number) => [number, number];
    readonly coregame_craft_plasma_from_coal: (a: number) => [number, number];
    readonly coregame_craft_scout_ship: (a: number) => [number, number];
    readonly coregame_design_ship: (a: number, b: number, c: number) => [number, number];
    readonly coregame_game_loop: (a: number) => void;
    readonly coregame_get_active_planet_missions: (a: number) => [number, number];
    readonly coregame_get_blueprint_status: (a: number) => [number, number];
    readonly coregame_get_computational_power: (a: number) => number;
    readonly coregame_get_max_computational_power: (a: number) => number;
    readonly coregame_get_neuro_evolution: (a: number) => number;
    readonly coregame_get_planets: (a: number) => [number, number];
    readonly coregame_get_resource: (a: number, b: number, c: number) => number;
    readonly coregame_get_statistics: (a: number) => [number, number];
    readonly coregame_get_turbine_heat: (a: number) => number;
    readonly coregame_get_turbine_upgrade_level: (a: number) => number;
    readonly coregame_get_universal_save: (a: number) => [number, number];
    readonly coregame_init: (a: number) => void;
    readonly coregame_is_auto_clicking: (a: number) => number;
    readonly coregame_is_turbine_cooling: (a: number) => number;
    readonly coregame_load_game_state: (a: number, b: number, c: number) => [number, number];
    readonly coregame_new: () => number;
    readonly coregame_reload_config: (a: number) => void;
    readonly coregame_repair_systems: (a: number) => void;
    readonly coregame_research_planet: (a: number) => [number, number];
    readonly coregame_reset_progress: (a: number) => void;
    readonly coregame_save_current_state: (a: number) => void;
    readonly coregame_send_ship_to_planet: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly coregame_set_fleet_cargo_bonus: (a: number, b: number) => void;
    readonly coregame_set_fleet_defense_bonus: (a: number, b: number) => void;
    readonly coregame_set_max_power: (a: number, b: number) => void;
    readonly coregame_start_auto_clicking: (a: number) => void;
    readonly coregame_stop_auto_clicking: (a: number) => void;
    readonly coregame_subtract_power: (a: number, b: number) => void;
    readonly coregame_subtract_resource: (a: number, b: number, c: number, d: number) => void;
    readonly coregame_sync_blueprints: (a: number, b: number, c: number, d: number) => void;
    readonly coregame_toggle_coal: (a: number) => void;
    readonly coregame_toggle_rebel_protection: (a: number) => void;
    readonly coregame_upgrade_cooling_module: (a: number) => void;
    readonly coregame_upgrade_crit_module: (a: number) => void;
    readonly coregame_upgrade_defense: (a: number) => void;
    readonly coregame_upgrade_mining: (a: number) => void;
    readonly coregame_upgrade_turbine: (a: number) => number;
    readonly main: () => void;
    readonly start_game: () => number;
    readonly coregame_sell_resource: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
