import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ignored = new Set(['node_modules', 'pkg', 'target', '.git']);
const files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await walk(join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(join(dir, entry.name));
    }
  }
}

await walk(process.cwd());
files.sort();

const failures = [];
for (const file of files) {
  await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code !== 0) failures.push(file);
      resolve();
    });
  });
}

if (failures.length) {
  console.error(`JavaScript syntax failures: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`JavaScript syntax OK: ${files.length} files`);
