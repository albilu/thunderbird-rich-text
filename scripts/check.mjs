import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(resolve(folder, entry.name)) : resolve(folder, entry.name)))).flat();
}
const files = (await Promise.all(['extension', 'scripts', 'tests'].map(dir => walk(resolve(root, dir))))).flat();
for (const file of files.filter(file => /\.(m?js)$/.test(file))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}
const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and manifest versions must agree');
assert.equal(manifest.manifest_version, 2);
assert.ok(manifest.browser_specific_settings.gecko.id);
assert.deepEqual(manifest.permissions, ['compose', 'storage']);
const references = [...manifest.background.scripts, manifest.options_ui.page, ...Object.values(manifest.icons)];
for (const [name, experiment] of Object.entries(manifest.experiment_apis)) {
  references.push(experiment.schema, experiment.parent.script);
  const schema = JSON.parse(await readFile(resolve(root, 'extension', experiment.schema), 'utf8'));
  assert.equal(schema[0].namespace, name);
}
for (const file of files.filter(file => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  assert.ok([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].every(match => !match[1].trim()), `No inline scripts: ${file}`);
  assert.ok(!/\son\w+=/i.test(html), `No inline event handlers: ${file}`);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!match[1].startsWith('#')) references.push(relative(resolve(root, 'extension'), resolve(dirname(file), match[1])));
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, `HTML IDs must be unique: ${file}`);
}
for (const ref of references) {
  assert.ok(!ref.startsWith('..') && !ref.includes('://'), `Only local resources: ${ref}`);
  assert.ok((await stat(resolve(root, 'extension', ref))).isFile(), `Missing ${ref}`);
}
console.log(`Checked JavaScript syntax, manifest, permissions, and ${references.length} resource references.`);
