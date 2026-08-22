import fs from 'node:fs';

const saveSource = fs.readFileSync('save.js', 'utf8');
const gameSource = fs.readFileSync('game.js', 'utf8');
const required = {
  saveVersionIsThree: saveSource.includes('const SAVE_VERSION = 3;'),
  saveWritesTimestamp: saveSource.includes('timestamp: now') && saveSource.includes('_savedAt: now'),
  saveIncludesFleet: saveSource.includes('fleet: fleet'),
  saveIncludesBlueprints: saveSource.includes('blueprints: blueprints'),
  emergencySnapshotWritesTimestamp: gameSource.includes('emergencyState._emergencySavedAt = Date.now();'),
  emergencySnapshotRestores: gameSource.includes('const emergencySnapshot = loadEmergencySnapshot(user.id)') && gameSource.includes('initializeGame(initialSave)'),
  emergencySnapshotClearsAfterUse: gameSource.includes('clearEmergencySnapshot(user.id)'),
  offlinePowerOutsideLossBlock: gameSource.includes("if (p.plasmaStolen > 0) game.subtract_resource('plasma', p.plasmaStolen);\n    }\n\n    if (p.powerGained > 0)"),
};
console.log(JSON.stringify(required, null, 2));
if (Object.values(required).some(value => value !== true)) {
  console.error('Save integrity contract mismatch detected.');
  process.exitCode = 1;
}
