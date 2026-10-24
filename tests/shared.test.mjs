import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared.js';

const { normalizeUrl, normalizeColor, normalizeCommand, linkHtml, isPlainTextCommand, FONTS, SIZES, BLOCKS, EMOJI } = globalThis.RichText;

test('web, email, and telephone links are normalized', () => {
  assert.equal(normalizeUrl(' HTTPS://Example.com/path?q=yes '), 'https://example.com/path?q=yes');
  assert.equal(normalizeUrl('mailto:person@example.com?subject=Hello%20there'), 'mailto:person@example.com?subject=Hello%20there');
  assert.equal(normalizeUrl('tel:+33123456789'), 'tel:+33123456789');
});

test('active content, relative, malformed, and control-character URLs are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:msgbox(1)',
    '//example.com', 'example.com', '', 'https://', 'https://exam ple.com', 'java\nscript:alert(1)', 'https://example.com\r\n?x', 'mailto:', 'tel:', null, 5]) {
    assert.throws(() => normalizeUrl(url), undefined, String(url));
  }
});

test('link markup escapes both the label and attribute', () => {
  const html = linkHtml('https://example.com/?a=1&b="test"', '<img src=x onerror=alert(1)> & \'hello\'');
  assert.equal(html, '<a href="https://example.com/?a=1&amp;b=%22test%22">&lt;img src=x onerror=alert(1)&gt; &amp; &#39;hello&#39;</a>');
  assert.throws(() => linkHtml('javascript:alert(1)', 'Click'));
});

test('only explicit formatting commands and supported values are accepted', () => {
  assert.deepEqual(normalizeCommand('bold', 'ignored'), { command: 'bold' });
  for (const [value] of FONTS) assert.equal(normalizeCommand('fontName', value).value, value);
  for (const [value] of SIZES) assert.equal(normalizeCommand('fontSize', Number(value)).value, value);
  for (const [value] of BLOCKS) assert.equal(normalizeCommand('formatBlock', value).value, value);
  for (const [name, value] of [['insertHTML', '<script>'], ['fontSize', 42], ['fontName', 'url(evil)'], ['formatBlock', 'script'], ['copy'], ['delete'], ['unknown']]) {
    assert.throws(() => normalizeCommand(name, value));
  }
});

test('colors allow hex and background clearing, without arbitrary CSS', () => {
  assert.equal(normalizeColor('#ABCDEF'), '#abcdef');
  assert.equal(normalizeCommand('hiliteColor', 'transparent').value, 'transparent');
  for (const color of ['red', '#fff', '#gggggg', '#123456; color:red', 'url(https://example.com)', null]) assert.throws(() => normalizeColor(color));
  assert.throws(() => normalizeCommand('foreColor', 'transparent'));
});

test('emoji preserve full Unicode sequences and text is bounded', () => {
  for (const [emoji] of EMOJI) assert.equal(normalizeCommand('insertText', emoji).value, emoji);
  assert.equal(normalizeCommand('insertText', '👩🏽‍💻').value, '👩🏽‍💻');
  for (const value of ['', '\0', '\n', 'x'.repeat(129), {}, 42]) assert.throws(() => normalizeCommand('insertText', value));
});

test('plain text permits only text insertion and native edit history', () => {
  for (const command of ['insertText', 'undo', 'redo']) assert.ok(isPlainTextCommand(command));
  for (const command of ['bold', 'fontName', 'link', 'insertHorizontalRule', 'foreColor']) assert.equal(isPlainTextCommand(command), false);
});

test('link input validation rejects non-string and oversized labels', () => {
  assert.deepEqual(normalizeCommand('link', { url: 'https://example.com' }), { command: 'link', value: { url: 'https://example.com/', text: '' } });
  for (const text of [42, {}, 'x'.repeat(2001)]) assert.throws(() => normalizeCommand('link', { url: 'https://example.com', text }));
});
