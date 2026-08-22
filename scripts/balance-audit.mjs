import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const fleet = config.fleet_config;
const upgrade = config.upgrade_config;
const mining = config.mining_config;

function geometricCost(base, multiplier, levels) {
  return Array.from({ length: levels }, (_, i) => Math.ceil(base * (multiplier ** i)));
}

const miningCosts = geometricCost(upgrade.mining_base_cost, upgrade.mining_cost_multiplier, upgrade.mining_max_level);
const fleetUpgradeCosts = geometricCost(fleet.upgrade.base_ore, fleet.upgrade.ore_growth, 10);
const resourceChance = mining.base_chances.coal + mining.base_chances.trash + mining.base_chances.ore;
const passiveChance = Object.values(mining.passive_chances).reduce((sum, value) => sum + value, 0);
const report = {
  mining: {
    activeChanceTotal: resourceChance,
    passiveChanceTotal: passiveChance,
    activeChanceValid: resourceChance <= 1,
    passiveChanceValid: passiveChance <= 1,
  },
  progression: {
    miningFirstCost: miningCosts[0],
    miningLastCost: miningCosts.at(-1),
    miningTotalCost: miningCosts.reduce((a, b) => a + b, 0),
    fleetFirstUpgradeOre: fleetUpgradeCosts[0],
    fleetLastUpgradeOre: fleetUpgradeCosts.at(-1),
    fleetBaseMaxSize: fleet.base_max_fleet_size,
    fleetSizeCap: fleet.fleet_size_cap,
  },
  design: {
    scoutPower: 50,
    cargoPower: 200,
    combatPower: 800,
    firstBlueprintAccessibleBeforeCombat: true,
  },
  warnings: [],
};

if (!report.mining.activeChanceValid) report.warnings.push('Active mining chances exceed 100%.');
if (!report.mining.passiveChanceValid) report.warnings.push('Passive mining chances exceed 100%.');
if (report.progression.miningLastCost > 1_000_000) report.warnings.push('Max mining upgrade cost exceeds one million resource units.');
if (report.progression.fleetLastUpgradeOre > 1_000_000) report.warnings.push('Late fleet upgrade ore cost exceeds one million units.');

console.log(JSON.stringify(report, null, 2));
if (report.warnings.length) process.exitCode = 1;
