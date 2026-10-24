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
const references = [...manifest.background.scripts, manifest.compose_action.default_popup,
  manifest.compose_action.default_icon, ...Object.values(manifest.icons)];
const popup = await readFile(resolve(root, 'extension', manifest.compose_action.default_popup), 'utf8');
assert.ok([...popup.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].every(match => !match[1].trim()), 'No inline scripts');
assert.ok(!/\son\w+=/i.test(popup), 'No inline event handlers');
for (const match of popup.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!match[1].startsWith('#')) references.push(relative(resolve(root, 'extension'), resolve(root, 'extension/popup', match[1])));
}
for (const ref of references) {
  assert.ok(!ref.startsWith('..') && !ref.includes('://'), `Only local resources: ${ref}`);
  assert.ok((await stat(resolve(root, 'extension', ref))).isFile(), `Missing ${ref}`);
}
const ids = [...popup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Popup IDs must be unique');
console.log(`Checked JavaScript syntax, manifest, permissions, and ${references.length} resource references.`);
