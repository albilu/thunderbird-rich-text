import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('XPI builds reproducibly with a root manifest and only extension assets', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'rich-text-package-'));
  try {
    const script = fileURLToPath(new URL('../scripts/package.py', import.meta.url));
    const first = join(temporary, 'first.xpi');
    const second = join(temporary, 'second.xpi');
    execFileSync('python3', [script, '--output', first]);
    execFileSync('python3', [script, '--output', second]);
    assert.deepEqual(await readFile(first), await readFile(second));
    const inspect = 'import json, sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"files":z.namelist(),"valid":z.testzip() is None}))';
    const archive = JSON.parse(execFileSync('python3', ['-c', inspect, first], { encoding: 'utf8' }));
    assert.ok(archive.valid);
    assert.ok(archive.files.includes('manifest.json'));
    assert.ok(archive.files.includes('editor.js'));
    assert.ok(archive.files.includes('popup/popup.html'));
    assert.ok(archive.files.every(file => !/^(tests|scripts|node_modules|\.git)\//.test(file)));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
