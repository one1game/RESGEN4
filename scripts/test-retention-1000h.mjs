const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
globalThis.document = { getElementById: id => id === 'corebox-ops-deck-host' ? host : null };
globalThis.window = { showNotif: () => {} };
const { operationsModule } = await import('../operations-module.js');

let now = 0;
const realNow = Date.now;
Date.now = () => now;
const resources = { ore: 500, coal: 300, chips: 300, plasma: 0, trash: 300 };
const game = {
  get_statistics: () => JSON.stringify({ computational_power: 1000, ore_inventory: resources.ore, coal_inventory: resources.coal, chips_inventory: resources.chips, trash_inventory: resources.trash, plasma_inventory: resources.plasma }),
  get_computational_power: () => 1000,
  add_resource: (resource, amount) => { resources[resource] = Math.min(9999, resources[resource] + amount); },
  subtract_resource: (resource, amount) => { if (resources[resource] < amount) throw new Error(`negative ${resource}`); resources[resource] -= amount; },
  add_power: () => {},
};

const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
operationsModule.init(game, 'headless-retention');
operationsModule.destroy();

const outcomes = { completed: 0, incidents: 0, reports: 0, convoys: 0, projects: 0, goalsClaimed: 0, maxHeat: 0, minResource: Infinity, cycleUnlocked: false };
const contractIds = ['ore-run', 'signal-hunt', 'watchline', 'void-pulse'];
for (let hour = 0; hour < 1000; hour += 1) {
  const id = contractIds[hour % contractIds.length];
  operationsModule.start(id, true);
  assert(operationsModule.state.active, `operation did not start at hour ${hour}`);
  now += 10 * 60 * 60 * 1000;
  const before = operationsModule.state.completed;
  operationsModule.resolveDue();
  assert(operationsModule.state.completed === before + 1, `operation did not resolve at hour ${hour}`);
  outcomes.completed += 1;
  if (operationsModule.state.lastReport?.incident) outcomes.incidents += 1;
  if (operationsModule.state.lastReport) outcomes.reports += 1;
  Object.values(operationsModule.state.sectorHeat).forEach(v => { outcomes.maxHeat = Math.max(outcomes.maxHeat, v); });
  Object.values(resources).forEach(v => { outcomes.minResource = Math.min(outcomes.minResource, v); });

  if (hour % 40 === 0 && !operationsModule.state.projects.relay) { operationsModule.buildProject('relay'); if (operationsModule.state.projects.relay) outcomes.projects += 1; }
  if (hour % 55 === 0 && !operationsModule.state.projects.vault) { operationsModule.buildProject('vault'); if (operationsModule.state.projects.vault) outcomes.projects += 1; }
  if (hour % 70 === 0 && !operationsModule.state.projects.beacon) { operationsModule.buildProject('beacon'); if (operationsModule.state.projects.beacon) outcomes.projects += 1; }
  if (hour % 80 === 0 && !operationsModule.state.convoy) { operationsModule.runConvoy(); now += 60 * 1000; operationsModule.resolveDue(); outcomes.convoys += 1; }
  for (const goal of ['first-command', 'sector-keeper', 'archive-runner']) {
    const claimKey = `claimed:${goal}`;
    if (!operationsModule.state.goals[claimKey] && (Number(operationsModule.state.goals[goal] || 0) >= ({ 'first-command': 1, 'sector-keeper': 5, 'archive-runner': 3 }[goal]))) { operationsModule.claimGoal(goal); outcomes.goalsClaimed += 1; }
  }
  if (hour === 20) { operationsModule.state.cycle.unlocked = false; operationsModule.startCycle(); }
  if (operationsModule.state.cycle.unlocked) outcomes.cycleUnlocked = true;
  assert(operationsModule.state.completed >= 0, 'negative completed');
  assert(Object.values(resources).every(v => Number.isFinite(v) && v >= 0 && v <= 9999), `resource invariant failed at hour ${hour}`);
  assert(Object.values(operationsModule.state.sectorHeat).every(v => v >= 0 && v <= 100), `heat invariant failed at hour ${hour}`);
}

assert(outcomes.completed === 1000, 'not all operations completed');
assert(outcomes.reports === 1000, 'missing welcome-back reports');
assert(outcomes.projects >= 3, 'resource sinks did not activate');
assert(outcomes.convoys > 0, 'NPC convoy never ran');
assert(outcomes.goalsClaimed >= 2, 'long-run goals did not reward progress');
assert(outcomes.cycleUnlocked, 'alternate cycle did not unlock');
console.log(JSON.stringify({ ok: true, simulatedHours: 1000, outcomes, finalState: operationsModule.state, resources }, null, 2));
Date.now = realNow;
