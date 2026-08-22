import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.cwd();
const files = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
const sourceFiles = files.filter(f => /\.(js|mjs|html|css|rs|json)$/.test(f));
const report = { root, files: sourceFiles.length, missingLocalRefs: [], imports: [], htmlScripts: [], ids: { declared: [], referenced: [], missing: [] } };
const exists = p => fs.existsSync(path.join(root, p));
const addRef = (from, ref) => {
  if (!ref || /^(https?:|data:|mailto:|#|javascript:|node:)/i.test(ref) || /\$\{[^}]+\}/.test(ref)) return;
  const clean = ref.split(/[?#]/)[0];
  if (!clean || clean.startsWith('/')) return;
  if (!exists(clean)) report.missingLocalRefs.push({ from, ref: clean });
};
for (const file of sourceFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of text.matchAll(/\bfrom\s*["'](\.?\.?\/?[^"']+)["']/g)) {
    const ref = m[1].replace(/^\.\//, '');
    addRef(file, ref);
    report.imports.push({ from: file, ref });
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*["'](\.?\.?\/?[^"']+)["']\s*\)/g)) {
    const ref = m[1].replace(/^\.\//, '');
    addRef(file, ref);
    report.imports.push({ from: file, ref, dynamic: true });
  }
  for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["'](\.?\.?\/?[^"']+)["']/g)) {
    const ref = m[1].replace(/^\.\//, '');
    addRef(file, ref);
    report.htmlScripts.push({ from: file, ref });
  }
  for (const m of text.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) report.ids.declared.push({ file, id: m[1] });
  for (const m of text.matchAll(/getElementById\s*\(\s*["']([^"']+)["']/g)) report.ids.referenced.push({ file, id: m[1] });
  for (const m of text.matchAll(/(?:querySelector(?:All)?|closest)\s*\(\s*["']#([A-Za-z][\w-]*)/g)) report.ids.referenced.push({ file, id: m[1] });
}
const declared = new Set(report.ids.declared.map(x => x.id));
report.ids.missing = [...new Set(report.ids.referenced.map(x => x.id))].filter(id => !declared.has(id));
report.missingLocalRefs = [...new Map(report.missingLocalRefs.map(x => [`${x.from}:${x.ref}`, x])).values()];
report.summary = { sourceFiles: report.files, moduleImports: report.imports.length, htmlScripts: report.htmlScripts.length, missingLocalRefs: report.missingLocalRefs.length, missingDomIds: report.ids.missing.length, declaredDomIds: declared.size };
console.log(JSON.stringify(report, null, 2));
