// быстрый тест биндинга типов в node:sqlite
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (a TEXT, b TEXT, c INTEGER)');
const tests = [
  [{ a: 1, b: 'x' }],
  [{ a: { ore: 5 } }],
  [{ a: [1, 2] }],
  [{ a: 'str' }],
  [{ a: true }],
  [{ a: null }],
  [{ a: 5 }],
];
for (const t of tests) {
  try {
    db.prepare('INSERT INTO t (a) VALUES (?)').run(t[0].a);
    console.log('OK:', JSON.stringify(t[0].a), typeof t[0].a);
  } catch (e) {
    console.log('FAIL:', JSON.stringify(t[0].a), typeof t[0].a, '→', e.message);
  }
}
