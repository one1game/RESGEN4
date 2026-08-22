import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const source = fs.readFileSync('quests_content.js', 'utf8');
const quests = config.quests || [];
const blueprintQuest = quests.find(q => q.id === 'quest_fleet_blueprint');
const endgameQuestIds = ['quest_neuro_frontier', 'quest_plasma_reserve', 'quest_supply_network'];
const checks = {
  blueprintQuestPresent: Boolean(blueprintQuest),
  blueprintQuestType: blueprintQuest?.quest_type === 'BlueprintUnlocked',
  blueprintQuestTarget: blueprintQuest?.target === 1,
  frontendUsesBlueprintType: source.includes('quest_type: "BlueprintUnlocked"'),
  rustVariantImplemented: fs.readFileSync('src/game/state.rs', 'utf8').includes('BlueprintUnlocked'),
  endgameQuestsPresent: endgameQuestIds.every(id => quests.some(q => q.id === id)),
  endgameOrdersSequential: endgameQuestIds.every((id, index) => quests.find(q => q.id === id)?.order === index + 8),
  collectResourceFrontendSupport: source.includes('quest_type === "CollectResource"') || fs.readFileSync('game.js', 'utf8').includes("q.quest_type === 'CollectResource'"),
  rustInventorySerialized: fs.readFileSync('src/lib.rs', 'utf8').includes('"inventory":'),
};
console.log(JSON.stringify(checks, null, 2));
if (Object.values(checks).some(value => value !== true)) {
  console.error('Quest contract mismatch detected.');
  process.exitCode = 1;
}
