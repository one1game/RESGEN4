import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const game = fs.readFileSync('game.js', 'utf8');
const modules = {
  inventory: ['resourcesContainer', 'updateInventoryDisplay'],
  upgrades: ['upgradesContainer', 'renderUpgradesTab'],
  trade: ['tradeContainer', 'tradeModule'],
  quests: ['questsContainer', 'renderQuestsTab'],
  command: ['class="cc-wrap"', 'updateCommandCenter'],
  craft: ['craftContainer', 'craftModule'],
  design: ['designContainer', 'designModule'],
  fleet: ['fleetContainer', 'fleetModule'],
  space: ['space-main-canvas', 'spaceModule'],
};
const result = {};
for (const [tab, [container, marker]] of Object.entries(modules)) {
  const tabPresent = index.includes(`data-tab="${tab}"`);
  const containerPresent = container.startsWith('class=') ? index.includes(container) : index.includes(`id="${container}"`);
  const hookPresent = game.includes(marker);
  result[tab] = { tabPresent, containerPresent, hookPresent, ok: tabPresent && containerPresent && hookPresent };
}
const expectedTabs = ['inventory', 'upgrades', 'trade', 'quests', 'command', 'craft', 'design', 'fleet', 'space'];
const tabSwitches = expectedTabs.filter(tab => index.includes(`data-tab="${tab}"`));
const switchFunctionPresent = game.includes('function switchMainTab');
const scriptTags = [...index.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
const missing = Object.entries(result).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(JSON.stringify({
  ok: missing.length === 0 && tabSwitches.length === 9 && switchFunctionPresent,
  sections: result,
  tabSwitches,
  tabSwitchCount: tabSwitches.length,
  switchFunctionPresent,
  missing,
  scriptCount: scriptTags.length,
}, null, 2));
if (missing.length || tabSwitches.length !== 9 || !switchFunctionPresent) process.exitCode = 1;

