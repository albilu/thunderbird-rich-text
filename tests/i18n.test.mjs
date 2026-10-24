import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { catalogs, translator } from './helpers/i18n.mjs';

const shared = await readFile(new URL('../extension/shared.js', import.meta.url), 'utf8');
function context(locale) {
  const sandbox = vm.createContext({ browser: { i18n: { getMessage: translator(locale) } }, URL });
  vm.runInContext(shared, sandbox);
  return sandbox;
}

test('French covers every English message and preserves named placeholders', () => {
  assert.deepEqual(Object.keys(catalogs.fr).sort(), Object.keys(catalogs.en).sort());
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, entry] of Object.entries(catalog)) {
      assert.equal(typeof entry.message, 'string', `${locale}.${key}`);
      assert.ok(entry.message.trim(), `${locale}.${key} must not be empty`);
      assert.deepEqual(entry.placeholders, catalogs.en[key].placeholders, `${locale}.${key} placeholders`);
      const placeholders = [...entry.message.matchAll(/\$([A-Z]+)\$/g)].map(match => match[1].toLowerCase());
      assert.deepEqual([...new Set(placeholders)].sort(), Object.keys(entry.placeholders || {}).sort(), `${locale}.${key} substitutions`);
    }
  }
});

test('manifest, declarative UI, errors, and dynamic palettes reference existing messages', async () => {
  const root = new URL('../extension/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  const files = await readdir(root, { recursive: true });
  for (const file of files.filter(file => /\.(html|js)$/.test(file))) {
    const source = await readFile(new URL(file, root), 'utf8');
    const references = [...source.matchAll(/data-i18n(?:-title|-label|-placeholder)?="(\w+)"|(?:message|translate|localizeMessage|RichTextLocalizedError)\("(\w+)"/g)];
    for (const ref of references) assert.ok(catalogs.en[ref[1] || ref[2]], `${file}: ${ref[1] || ref[2]}`);
    if (file.endsWith('.html')) assert.ok(source.indexOf('../localize.js') > source.indexOf('../shared.js'), file);
  }
  const { BLOCKS, COLORS, HIGHLIGHTS, EMOJI } = context('fr').RichText;
  for (const [, key] of [...BLOCKS, ...COLORS, ...HIGHLIGHTS, ...EMOJI]) assert.ok(catalogs.fr[key], key);
});

test('localized validation keeps command values and safety rules unchanged', () => {
  const french = context('fr').RichText;
  assert.equal(french.message('paragraphStyleValue', 'Titre 2'), 'Style de paragraphe : Titre 2');
  assert.throws(() => french.normalizeCommand('lineSpacing', 0), /L’interligne doit être un nombre compris entre 0,5 et 5\./);
  assert.throws(() => french.normalizeCommand('fontSize', 201), /La taille de police/);
  assert.throws(() => french.normalizeUrl('javascript:alert(1)'), /Les liens doivent utiliser/);
  assert.equal(french.normalizeCommand('lineSpacing', '1.15').value, 1.15);
  assert.equal(french.normalizeCommand('formatBlock', 'h2').value, 'h2');
  assert.equal(french.normalizeCommand('fontName', 'Noto Sans').value, 'Noto Sans');
  for (const locale of ['en', 'fr']) {
    const { normalizeCommand } = context(locale).RichText;
    for (const command of ['insertHTML', 'unknown', 'emojiLink']) {
      assert.throws(() => normalizeCommand(command, { url: 'https://example.com', text: 'link-shaped input' }));
    }
  }
  assert.equal(context('fr-CA').RichText.message('bold'), 'Gras');
  assert.equal(context('de').RichText.message('bold'), 'Bold');
});

test('French emoji search accepts accents, ligatures, and existing English keywords', () => {
  const { EMOJI, emojiMatches } = context('fr').RichText;
  for (const [query, expected] of [['fête', '🎉'], ['FETE', '🎉'], ['félicitations', '🎉'],
    ['cœur', '❤️'], ['coeur', '❤️'], ['merci', '🙏'], ['travail', '💻'], ['party', '🎉'], ['🎉', '🎉']]) {
    assert.ok(EMOJI.filter(entry => emojiMatches(entry, query)).some(([emoji]) => emoji === expected), query);
  }
  assert.equal(EMOJI.filter(entry => emojiMatches(entry, 'zzzzzz')).length, 0);
});

test('page localization writes text and allowed attributes without interpreting markup', async () => {
  const sandbox = context('fr');
  const attributes = { 'data-i18n-title': 'bold', 'data-i18n-label': 'fontFamily', 'data-i18n-placeholder': 'searchFonts' };
  const node = {
    dataset: { i18n: 'settingsTitle' },
    getAttribute(name) { return attributes[name]; },
    setAttribute(name, value) { attributes[name] = value; },
    set innerHTML(_) { assert.fail('Translations must never be interpreted as HTML'); }
  };
  sandbox.document = { documentElement: {}, querySelectorAll() { return [node]; } };
  const script = await readFile(new URL('../extension/localize.js', import.meta.url), 'utf8');
  vm.runInContext(script, sandbox);
  assert.equal(sandbox.document.documentElement.lang, 'fr');
  assert.equal(node.textContent, 'Paramètres de Rich Text');
  assert.equal(attributes.title, 'Gras');
  assert.equal(attributes['aria-label'], 'Police');
  assert.equal(attributes.placeholder, 'Rechercher une police…');
  sandbox.browser.i18n.getMessage = () => '<img src=x onerror=alert(1)>';
  vm.runInContext(script, sandbox);
  assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
});
