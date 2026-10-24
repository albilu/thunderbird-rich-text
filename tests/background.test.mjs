import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const shared = await readFile(new URL('../extension/shared.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

async function setup({ plain = false, installed = true, active = 7 } = {}) {
  const injected = [];
  const sent = [];
  const liveTabs = new Map([[7, { id: 7, type: 'messageCompose' }], [9, { id: 9, type: 'messageCompose' }], [1, { id: 1, type: 'mail' }]]);
  let listener;
  const browser = {
    runtime: { id: 'test-addon', getURL: path => `moz-extension://test/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
    composeScripts: { async register(options) { assert.equal(options.js.length, 2); } },
    compose: { async getComposeDetails() { return { isPlainText: plain }; } },
    tabs: {
      async query(options) { return options.active ? [liveTabs.get(active)].filter(Boolean) : [...liveTabs.values()].filter(tab => tab.type === options.type); },
      async get(id) { if (!liveTabs.has(id)) throw new Error('Compose window closed'); return liveTabs.get(id); },
      async executeScript(id, details) { injected.push([id, details.file]); if (details.file === 'editor.js') installed = true; },
      async sendMessage(id, message) {
        if (!installed) throw new Error('No receiving end');
        if (message.action !== 'ping') sent.push([id, message]);
        return { ok: true, state: { collapsed: true } };
      }
    }
  };
  const context = vm.createContext({ browser, console, URL });
  vm.runInContext(shared, context);
  vm.runInContext(background, context);
  await new Promise(resolve => setImmediate(resolve));
  const sender = { id: 'test-addon', url: 'moz-extension://test/popup/popup.html' };
  const send = (message, from = sender) => listener({ channel: 'thunderbird-rich-text/v1', ...message }, from);
  return { send, injected, sent, liveTabs, sender };
}

test('connect binds to the active compose window; commands stay pinned to it', async () => {
  const app = await setup();
  const connection = await app.send({ action: 'connect' });
  assert.equal(connection.tabId, 7);
  const result = await app.send({ action: 'command', tabId: 9, command: 'bold' });
  assert.equal(result.ok, true);
  assert.equal(app.sent.at(-1)[0], 9);
});

test('closed and non-compose tabs fail without falling back to another draft', async () => {
  const app = await setup();
  app.liveTabs.delete(9);
  assert.equal((await app.send({ action: 'command', tabId: 9, command: 'bold' })).ok, false);
  assert.equal((await app.send({ action: 'command', tabId: 1, command: 'bold' })).ok, false);
  assert.equal(app.sent.length, 0);
});

test('plain-text formatting is rejected while emoji still reach the native editor', async () => {
  const app = await setup({ plain: true });
  assert.equal((await app.send({ action: 'command', tabId: 7, command: 'bold' })).ok, false);
  assert.equal(app.sent.length, 0);
  assert.equal((await app.send({ action: 'command', tabId: 7, command: 'insertText', value: '🎉' })).ok, true);
  assert.equal(app.sent[0][1].value, '🎉');
});

test('windows opened before installation get both scripts in order', async () => {
  const app = await setup({ installed: false });
  await app.send({ action: 'connect' });
  assert.ok(app.injected.length >= 2);
  assert.deepEqual(app.injected.filter(([id]) => id === 7).map(([, file]) => file), ['shared.js', 'editor.js']);
  const count = app.injected.length;
  await app.send({ action: 'state', tabId: 7 });
  assert.equal(app.injected.length, count, 'Already installed scripts must not be injected twice');
});

test('foreign senders, compose scripts, and unknown commands cannot invoke the bridge', async () => {
  const app = await setup();
  for (const sender of [{ ...app.sender, id: 'foreign' }, { ...app.sender, tab: { id: 7 }, url: 'about:blank' }, { ...app.sender, url: 'https://example.com' }]) {
    assert.equal(app.send({ action: 'command', tabId: 7, command: 'bold' }, sender), undefined);
  }
  assert.equal((await app.send({ action: 'command', tabId: 7, command: 'insertHTML', value: '<script>' })).ok, false);
  assert.equal(app.sent.length, 0);
});

test('a trusted popup may carry a compose tab in its sender metadata', async () => {
  const app = await setup();
  assert.equal((await app.send({ action: 'connect' }, { ...app.sender, tab: { id: 7 } })).ok, true);
});

test('connect outside a compose window produces a clear failure', async () => {
  const app = await setup({ active: 1 });
  const result = await app.send({ action: 'connect' });
  assert.equal(result.ok, false);
  assert.match(result.error, /compose window/);
});
