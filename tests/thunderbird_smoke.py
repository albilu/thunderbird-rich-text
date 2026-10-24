#!/usr/bin/env python3
"""Real Thunderbird tests using a disposable offline profile and Marionette.

Requires Thunderbird, Xvfb, and xfwm4 on Linux; no Python packages are needed.
Never opens the user's profile, connects a mail account, or sends a message.
"""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TEST_LOCALE = os.environ.get("RICH_TEXT_TEST_LOCALE", "en-US")
if TEST_LOCALE not in {"en-US", "fr", "fr-CA", "de"}:
    raise SystemExit("RICH_TEXT_TEST_LOCALE must be en-US, fr, fr-CA, or de.")
LANGUAGE = "fr" if TEST_LOCALE.startswith("fr") else "en"
MESSAGES = json.loads((ROOT / "extension/_locales" / LANGUAGE / "messages.json").read_text())
RESULTS = ROOT / "test-results"
if TEST_LOCALE != "en-US":
    RESULTS /= TEST_LOCALE
ADDON_ID = "rich-text@thunderbird-rich-text.local"


class Marionette:
    def __init__(self, port):
        self.socket = socket.create_connection(("127.0.0.1", port), timeout=30)
        self.sequence = 0
        self.read()
        self.call("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
        self.call("Marionette:SetContext", {"value": "chrome"})
        self.call("WebDriver:SetTimeouts", {"script": 30000})

    def read(self):
        length = b""
        while not length.endswith(b":"):
            chunk = self.socket.recv(1)
            if not chunk:
                raise RuntimeError("Thunderbird closed the Marionette connection")
            length += chunk
        remaining = int(length[:-1])
        chunks = []
        while remaining:
            chunk = self.socket.recv(remaining)
            if not chunk:
                raise RuntimeError("Incomplete Marionette response")
            chunks.append(chunk)
            remaining -= len(chunk)
        return json.loads(b"".join(chunks))

    def call(self, name, params=None):
        self.sequence += 1
        payload = json.dumps([0, self.sequence, name, params or {}]).encode()
        self.socket.sendall(str(len(payload)).encode() + b":" + payload)
        response = self.read()
        if response[2]:
            raise RuntimeError(json.dumps(response[2], indent=2))
        return response[3]

    def script(self, code, *args):
        result = self.call("WebDriver:ExecuteScript", {"script": code, "args": list(args), "newSandbox": False, "sandbox": "default"})
        return result.get("value")

    def async_script(self, code, *args):
        wrapped = "const done = arguments[arguments.length - 1]; (async () => {" + code + "})().then(value => done({result: value}), error => done({error: String(error), stack: error.stack}));"
        result = self.call("WebDriver:ExecuteAsyncScript", {"script": wrapped, "args": list(args), "newSandbox": False, "sandbox": "default"}).get("value")
        if result and "error" in result:
            raise RuntimeError(json.dumps(result, indent=2))
        return result.get("result") if result else None

    def wait(self, code, timeout=15):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            result = self.script(code)
            if result:
                return result
            time.sleep(0.1)
        raise AssertionError(f"Timed out waiting for: {code}")

    def extension_script(self, view_type, code, *args):
        return self.async_script("""
          const view = [...testExtension.views].find(view => view.viewType === arguments[0]);
          if (!view) throw new Error('Extension view is unavailable: ' + arguments[0]);
          return await view.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(
            arguments[1], arguments[2], {sandboxName: 'default', newSandbox: false, timeout: 20000});
        """, view_type, code, list(args))

    def page_script(self, path, code, *args):
        return self.async_script("""
          const url = testExtension.baseURI.resolve(arguments[0]);
          const view = [...testExtension.views].find(view => view.uri?.spec === url);
          if (!view) throw new Error('Extension page unavailable: ' + arguments[0]);
          return await view.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(
            arguments[1], arguments[2], {sandboxName: 'default', newSandbox: false, timeout: 20000});
        """, path, code, list(args))

    def toolbar_script(self, tab, code, *args):
        return self.page_script(f"toolbar/toolbar.html?tabId={tab['id']}", code, *args)

    def dropdown_script(self, tab, kind, code, *args):
        return self.page_script(f"toolbar/dropdown.html?tabId={tab['id']}&kind={kind}", code, *args)


def toolbar_ready(client, tab):
    url = f"toolbar/toolbar.html?tabId={tab['id']}"
    client.wait(f"return [...testExtension.views].some(view => view.uri?.spec === testExtension.baseURI.resolve({json.dumps(url)}));")
    result = client.toolbar_script(tab, """
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 8000;
        const timer = setInterval(() => {
          const error = document.getElementById('error')?.textContent;
          if (error) { clearInterval(timer); resolve({error}); }
          else if (document.querySelector('[data-menu=emoji]') && !document.querySelector('[data-menu=emoji]').disabled) {
            clearInterval(timer); resolve({ready: true});
          } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Toolbar did not connect')); }
        }, 30);
      });
    """)
    assert result.get("ready"), result


def basic_tests(client):
    version = client.script("return Services.appinfo.version;")
    print(f"Testing Thunderbird {version}, requested locale {TEST_LOCALE}", flush=True)
    installed = client.async_script("""
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(arguments[0]);
      const addon = await AddonManager.installTemporaryAddon(file);
      return {id: addon.id, active: addon.isActive};
    """, str(client.addon_path))
    assert installed["active"], installed
    print("PASS: add-on installs and starts", flush=True)
    client.script("""
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      globalThis.testExtension = ExtensionParent.GlobalManager.extensionMap.get(arguments[0]);
    """, ADDON_ID)
    tab = client.extension_script("background", """
      return window.wrappedJSObject.browser.compose.beginNew({
        body: '<p id="target">Hello colorful world.</p><p id="untouched">Keep this paragraph.</p>',
        subject: 'Rich Text integration test', isPlainText: false
      });
    """)
    handles = client.call('WebDriver:GetWindowHandles')
    handles = handles.get('value', handles) if isinstance(handles, dict) else handles
    client.call('WebDriver:SwitchToWindow', {'handle': handles[-1]})
    client.script("""
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      globalThis.testExtension = ExtensionParent.GlobalManager.extensionMap.get(arguments[1]);
      globalThis.testTab = arguments[0];
      globalThis.testCompose = Services.wm.getMostRecentWindow('msgcompose');
    """, tab, ADDON_ID)
    client.wait("return Boolean(testCompose.GetCurrentEditor()?.document.getElementById('target'));")
    toolbar_ready(client, tab)
    localized = client.toolbar_script(tab, """
      const api = window.wrappedJSObject.browser;
      return {language: document.documentElement.lang, title: document.title,
        bold: document.querySelector('[data-command=bold]').title,
        glyph: document.querySelector('[data-command=bold]').textContent,
        description: api.runtime.getManifest().description};
    """)
    assert localized == {"language": LANGUAGE, "title": MESSAGES["toolbarTitle"]["message"],
                         "bold": MESSAGES["bold"]["message"], "glyph": MESSAGES["boldGlyph"]["message"],
                         "description": MESSAGES["extensionDescription"]["message"]}, localized
    assert client.script("return testCompose.document.getElementById('rich-text-compose-toolbar').getAttribute('aria-label');") == MESSAGES["nativeToolbarLabel"]["message"]
    native_error = client.toolbar_script(tab, """
      return window.wrappedJSObject.browser.composeToolbar.applyTypography(arguments[0], 'fontSize', 0)
        .then(() => '', error => error.message);
    """, tab['id'])
    assert native_error == MESSAGES["errorTypographyValue"]["message"], native_error
    script_error = client.extension_script("background", """
      return window.wrappedJSObject.browser.tabs.sendMessage(arguments[0], {
        channel: 'thunderbird-rich-text/v1', action: 'command', command: 'fontSize', value: 12
      });
    """, tab['id'])
    assert not script_error['ok'] and script_error['error'] == MESSAGES["errorTypographyAdapter"]["message"], script_error
    print("PASS: localized manifest, toolbar, accessibility labels, and native/compose-script errors", flush=True)
    assert client.script("return testCompose.document.getElementById('FormatToolbar').nextElementSibling.id;") == "rich-text-compose-toolbar"
    assert client.script("return testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect().height;") > 30
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display === 'none';")
    assert client.script("return !testCompose.document.getElementById('rich-text_thunderbird-rich-text_local-composeAction-toolbarbutton');")
    assert client.extension_script("background", "return !window.wrappedJSObject.browser.runtime.getManifest().compose_action;")
    assert client.toolbar_script(tab, "return !document.querySelector('#open-panel, [data-menu=settings]');")
    print("PASS: toolbar replaces Thunderbird formatting by default without popup or launcher buttons", flush=True)
    client.script("""
      testCompose.focus();
      const doc = testCompose.GetCurrentEditor().document;
      doc.defaultView.focus();
      const range = doc.createRange();
      range.setStart(doc.getElementById('target').firstChild, 6);
      range.setEnd(doc.getElementById('target').firstChild, 14);
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    """)
    time.sleep(0.2)
    status = client.toolbar_script(tab, """
      const button = document.querySelector('[data-command=bold]');
      button.focus(); button.click();
      return new Promise(resolve => {
        const timer = setInterval(() => {
          if (document.querySelector('[data-menu=emoji]').disabled) return;
          clearInterval(timer);
          resolve({pressed: document.querySelector('[data-command=bold]').getAttribute('aria-pressed'), error: document.getElementById('error').textContent});
        }, 50);
      });
    """)
    assert not status.get("error"), status
    assert status["pressed"] == "true", status
    assert editor_snapshot(client)["selection"] == "colorful"
    print("PASS: toolbar bold button formats and preserves the native selection", flush=True)
    return tab


def send_command(client, tab, command, value=None, expect_ok=True):
    message = {"channel": "thunderbird-rich-text/v1", "action": "command", "tabId": tab["id"], "command": command}
    if value is not None:
        message["value"] = value
    result = client.toolbar_script(tab, "return window.wrappedJSObject.browser.runtime.sendMessage(arguments[0]);", message)
    assert result["ok"] == expect_ok, (command, result)
    return result


def editor_snapshot(client):
    return client.script("""
      const doc = testCompose.GetCurrentEditor().document;
      const selection = doc.defaultView.getSelection();
      const node = selection.anchorNode;
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      const style = element ? doc.defaultView.getComputedStyle(element) : null;
      return {html: doc.body.innerHTML, text: doc.body.textContent,
        selection: selection.toString(), color: style?.color, highlight: style?.backgroundColor, fontSize: style?.fontSize,
        paragraphBackground: doc.defaultView.getComputedStyle(doc.getElementById('target') || doc.body.firstElementChild || doc.body).backgroundColor,
        bodyBackground: doc.defaultView.getComputedStyle(doc.body).backgroundColor,
        untouched: doc.getElementById('untouched')?.outerHTML,
        links: [...doc.querySelectorAll('a')].map(a => ({url: a.getAttribute('href'), text: a.textContent})),
        images: doc.querySelectorAll('img').length};
    """)


def select_range(client, start, end):
    client.script("""
      const doc = testCompose.GetCurrentEditor().document;
      testCompose.focus(); doc.defaultView.focus();
      const root = doc.getElementById('target') || doc.body;
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = doc.createRange();
      let node, offset = 0, began = false;
      while ((node = walker.nextNode())) {
        if (!began && (arguments[0] < offset + node.length ||
            (arguments[0] === arguments[1] && arguments[0] === offset + node.length))) { range.setStart(node, arguments[0] - offset); began = true; }
        if (began && arguments[1] <= offset + node.length) { range.setEnd(node, arguments[1] - offset); break; }
        offset += node.length;
      }
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    """, start, end)
    time.sleep(0.1)


def canonical_html(client):
    # Native CSS undo may reserialize declarations in a different order.
    return client.script("""
      const clone = testCompose.GetCurrentEditor().document.body.cloneNode(true);
      for (const element of clone.querySelectorAll('[style]')) {
        const properties = [...element.style].sort().map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
        element.removeAttribute('style');
        for (const [name, value, priority] of properties) element.style.setProperty(name, value, priority);
      }
      return clone.innerHTML;
    """)


def reset_fixture(client, tab, start=6, end=14):
    client.extension_script("background", """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {
        body: '<p id="target">Hello colorful world.</p><p id="untouched">Keep this paragraph.</p>'
      });
    """, tab["id"])
    select_range(client, start, end)


def toolbar_action(client, tab, code):
    result = client.toolbar_script(tab, code + """
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 8000;
        const timer = setInterval(() => {
          if (!document.querySelector('[data-menu=emoji]').disabled) {
            clearInterval(timer); resolve({error: document.getElementById('error').textContent});
          } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Toolbar action timed out')); }
        }, 30);
      });
    """)
    assert not result.get("error"), result


def click_toolbar(client, tab, selector):
    # Real pointer input also exercises focus transfer across the embedded frame.
    if shutil.which('xdotool'):
        point = client.toolbar_script(tab, "const box=document.querySelector(arguments[0]).getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};", selector)
        origin = client.script("const box=testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect();return {x:testCompose.mozInnerScreenX+box.x,y:testCompose.mozInnerScreenY+box.y};")
        subprocess.run(['xdotool', 'mousemove', '--sync', str(round(origin['x'] + point['x'])), str(round(origin['y'] + point['y'])), 'click', '1'], env=client.test_env, check=True)
    else:
        client.script("testCompose.document.getElementById('rich-text-toolbar-browser').focus();")
        client.toolbar_script(tab, "const button=document.querySelector(arguments[0]);button.focus();button.click();", selector)


def compose_geometry(client):
    return client.script("""
      const toolbar=testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect();
      const editor=testCompose.GetCurrentEditorElement().getBoundingClientRect();
      return {toolbarHeight:toolbar.height,toolbarWidth:toolbar.width,editorTop:editor.top,editorHeight:editor.height};
    """)


def open_dropdown(client, tab, kind):
    before = compose_geometry(client)
    click_toolbar(client, tab, f'[data-menu="{kind}"]')
    url = f"toolbar/dropdown.html?tabId={tab['id']}&kind={kind}"
    client.wait(f"return [...testExtension.views].some(view => view.uri?.spec === testExtension.baseURI.resolve({json.dumps(url)}));")
    ready = client.dropdown_script(tab, kind, """
      return new Promise((resolve, reject) => {
        const end=Date.now()+8000;
        const timer=setInterval(() => {
          const error=document.getElementById('error').textContent;
          if (error || document.body.dataset.ready === 'true') {clearInterval(timer);resolve({error});}
          else if (Date.now()>end) {clearInterval(timer);reject(new Error('Dropdown did not load'));}
        },30);
      });
    """)
    assert not ready.get('error'), ready
    client.wait("return testCompose.document.getElementById('rich-text-dropdown-panel')?.state === 'open';")
    time.sleep(0.2)
    assert compose_geometry(client) == before, {'before': before, 'after': compose_geometry(client)}
    selector = {'font':'#font-search', 'style':'[data-block]', 'line-spacing':'[data-line-spacing]', 'link':'#link-url', 'emoji':'#emoji-search', 'text-color':'#palette button', 'background-color':'#palette button'}[kind]
    focus = client.dropdown_script(tab, kind, "return {focused:document.hasFocus(), active:document.activeElement.id, expected:document.activeElement.matches(arguments[0])};", selector)
    assert focus['focused'] and focus['expected'], focus
    anchor = client.toolbar_script(tab, "const rect=document.querySelector('[data-menu=\"'+arguments[0]+'\"]').getBoundingClientRect();return {left:rect.left,right:rect.right};", kind)
    placement = client.script("const panel=testCompose.document.getElementById('rich-text-dropdown-panel').getBoundingClientRect(), host=testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect();return {left:panel.left-host.left,right:panel.right-host.left};")
    assert placement['right'] >= anchor['left'] and placement['left'] <= anchor['right'], {'anchor': anchor, 'popup': placement}
    localized = client.dropdown_script(tab, kind, """
      return {language: document.documentElement.lang, title: document.title,
        fits: document.documentElement.scrollWidth <= innerWidth,
        heading: document.querySelector('[data-block=h2]')?.textContent.replace('✓', '').trim(),
        line: document.querySelector('[data-line-spacing="1.15"]')?.textContent.trim(),
        swatch: document.querySelector('#palette button')?.title};
    """)
    title_key = {'font': 'fontFamily', 'style': 'paragraphStyle', 'line-spacing': 'lineSpacing',
                 'text-color': 'textColor', 'background-color': 'highlightTitle', 'link': 'insertLink', 'emoji': 'insertEmoji'}[kind]
    assert localized['language'] == LANGUAGE and localized['title'] == MESSAGES[title_key]['message'], localized
    assert localized['fits'], localized
    if kind == 'style':
        assert localized['heading'] == MESSAGES['blockHeading2']['message'], localized
    if kind == 'line-spacing':
        assert localized['line'] == MESSAGES['line115Value']['message'], localized
    if kind in ['text-color', 'background-color']:
        key, hex_value = ('colorInk', '#1f2937') if kind == 'text-color' else ('colorLemon', '#fef08a')
        assert localized['swatch'] == f"{MESSAGES[key]['message']} ({hex_value})", localized
    return before


def dropdown_action(client, tab, kind, code):
    client.dropdown_script(tab, kind, code)
    client.wait("return !testCompose.document.getElementById('rich-text-dropdown-panel');")


def theme_tests(client, tab):
    themes = client.async_script("""
      const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      return (await AddonManager.getAddonsByTypes(['theme'])).map(theme=>({id:theme.id,active:theme.isActive}));
    """)
    original = next(theme['id'] for theme in themes if theme['active'])
    try:
        for scheme in ['light', 'dark']:
            theme = next(theme['id'] for theme in themes if f'compact-{scheme}@' in theme['id'])
            client.async_script("""
              const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
              await (await AddonManager.getAddonByID(arguments[0])).enable();
            """, theme)
            # Allow the native theme stylesheets to finish updating before comparison.
            time.sleep(0.4)
            native = client.toolbar_script(tab, "return window.wrappedJSObject.browser.composeToolbar.getTheme(arguments[0]);", tab['id'])
            actual = client.toolbar_script(tab, """
              return new Promise((resolve, reject) => {
                const expected=arguments[0], deadline=Date.now()+5000;
                const timer=setInterval(() => {
                  const style=getComputedStyle(document.documentElement);
                  const actual={background:style.backgroundColor,text:style.color,accent:style.getPropertyValue('--accent').trim()};
                  if (actual.background === expected.background && actual.text === expected.text && actual.accent === expected.accent) {clearInterval(timer);resolve(actual);}
                  else if (Date.now()>deadline) {clearInterval(timer);reject(new Error(JSON.stringify({expected,actual})));}
                },30);
              });
            """, native)
            assert actual['background'] == client.script("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbox')).backgroundColor;")
            assert native['scheme'] == scheme, native
            open_dropdown(client, tab, 'style')
            popup = client.dropdown_script(tab, 'style', "const style=getComputedStyle(document.documentElement);return {background:style.backgroundColor,text:style.color};")
            assert popup == {'background': native['surface'], 'text': native['surface-text']}, popup
            if shutil.which('import'):
                subprocess.run(['import', '-window', 'root', str(RESULTS / f'theme-{scheme}.png')], env=client.test_env, check=True)
            dropdown_action(client, tab, 'style', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));")
        print('PASS: toolbar and floating panels follow live Thunderbird light/dark theme colors', flush=True)
    finally:
        client.async_script("""
          const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
          await (await AddonManager.getAddonByID(arguments[0])).enable();
        """, original)


def typography_tests(client, tab):
    installed = client.script("return Cc['@mozilla.org/gfx/fontenumerator;1'].getService(Ci.nsIFontEnumerator).EnumerateAllFonts();")
    open_dropdown(client, tab, 'font')
    listed = client.dropdown_script(tab, 'font', "return [...document.querySelectorAll('#font-list [role=option]')].map(option => option.dataset.font);")
    assert set(installed).issubset(listed), (set(installed) - set(listed))
    assert client.toolbar_script(tab, "return document.getElementById('font-toggle').getAttribute('aria-expanded') === 'true';")
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'font-dropdown.png')], env=client.test_env, check=True)
    original = editor_snapshot(client)['html']
    dropdown_action(client, tab, 'font', "document.getElementById('font-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));")
    assert editor_snapshot(client)['html'] == original
    font = next((name for name in installed if name not in ['serif', 'sans-serif', 'monospace', 'math']), 'serif')
    reset_fixture(client, tab)
    open_dropdown(client, tab, 'font')
    client.dropdown_script(tab, 'font', "const input=document.getElementById('font-search');input.focus();input.value=arguments[0];input.dispatchEvent(new Event('input',{bubbles:true}));", font)
    matching = client.dropdown_script(tab, 'font', "return [...document.querySelectorAll('#font-list [role=option]')].map(option=>option.dataset.font);")
    assert font in matching and all(font.lower() in name.lower() for name in matching), matching
    dropdown_action(client, tab, 'font', "document.getElementById('font-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));")
    assert client.script("return testCompose.GetCurrentEditor().document.queryCommandValue('fontName');").strip('"') == font
    assert client.toolbar_script(tab, "return document.getElementById('font-toggle').getAttribute('aria-expanded') === 'false';")
    assert editor_snapshot(client)['selection'] == 'colorful'
    send_command(client, tab, 'bold')
    send_command(client, tab, 'foreColor', '#2563eb')
    send_command(client, tab, 'link', {'url': 'https://example.com/size'})
    before = editor_snapshot(client)
    toolbar_action(client, tab, "const input = document.getElementById('size'); input.focus(); input.value = '9'; input.dispatchEvent(new Event('change', {bubbles:true}));")
    snapshot = editor_snapshot(client)
    assert snapshot['selection'] == 'colorful' and snapshot['color'] == before['color'], snapshot
    assert snapshot['links'] == before['links'] and snapshot['untouched'] == before['untouched'], snapshot
    assert client.script("return testCompose.GetCurrentEditor().document.queryCommandState('bold');")
    assert client.toolbar_script(tab, "return document.getElementById('size').value;") == '9'
    assert snapshot['fontSize'] == '12px', snapshot
    send_command(client, tab, 'undo')
    assert editor_snapshot(client)['html'] == before['html']
    send_command(client, tab, 'redo')
    assert editor_snapshot(client)['html'] == snapshot['html']
    print('PASS: all installed fonts, numeric point sizes, links and inline styles, atomic undo/redo', flush=True)

    client.extension_script('background', """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {body:
        '<p id="target">Hello <font style="color:rgb(37,99,235);font-weight:bold">color</font><span style="font-size:30pt;font-style:italic">ful</span> world.</p><p id="untouched">Keep this paragraph.</p>'});
    """, tab['id'])
    select_range(client, 6, 14)
    original = canonical_html(client)
    send_command(client, tab, 'fontSize', 12)
    runs = client.script("""
      const doc=testCompose.GetCurrentEditor().document, walker=doc.createTreeWalker(doc.getElementById('target'),NodeFilter.SHOW_TEXT);
      const result=[]; let node;
      while ((node=walker.nextNode())) {const style=doc.defaultView.getComputedStyle(node.parentElement); result.push({text:node.data,size:style.fontSize,bold:style.fontWeight,italic:style.fontStyle,color:style.color});}
      return result;
    """)
    color = next(run for run in runs if run['text'] == 'color')
    ful = next(run for run in runs if run['text'] == 'ful')
    assert color['size'] == ful['size'] == '16px' and color['bold'] == '700' and color['color'] == 'rgb(37, 99, 235)' and ful['italic'] == 'italic', runs
    assert editor_snapshot(client)['selection'] == 'colorful'
    send_command(client, tab, 'undo')
    assert canonical_html(client) == original, {'before': original, 'after_undo': canonical_html(client)}
    reset_fixture(client, tab, 6, 6)
    result = send_command(client, tab, 'fontSize', 10.5)
    assert result['state']['values']['fontSize'] == 10.5, result
    send_command(client, tab, 'insertText', 'X')
    select_range(client, 6, 7)
    assert editor_snapshot(client)['fontSize'] == '14px', editor_snapshot(client)
    send_command(client, tab, 'undo')
    assert editor_snapshot(client)['text'] == 'Hello colorful world.Keep this paragraph.'
    print('PASS: mixed-font selections retain styling and point sizes apply to subsequent typing', flush=True)

    reset_fixture(client, tab)
    before = editor_snapshot(client)
    open_dropdown(client, tab, 'line-spacing')
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'line-spacing.png')], env=client.test_env, check=True)
    dropdown_action(client, tab, 'line-spacing', "document.querySelector('[data-line-spacing=\"1.5\"]').click();")
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.lineHeight;") == '1.5'
    assert editor_snapshot(client)['untouched'] == before['untouched']
    send_command(client, tab, 'undo')
    assert editor_snapshot(client)['html'] == before['html']
    send_command(client, tab, 'redo')
    open_dropdown(client, tab, 'line-spacing')
    dropdown_action(client, tab, 'line-spacing', "const mode=document.getElementById('line-spacing-mode');mode.value='proportional';mode.dispatchEvent(new Event('change'));document.getElementById('line-spacing').value='125';document.getElementById('line-spacing-form').requestSubmit();")
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.lineHeight;") == '1.25'
    client.script("""
      const doc=testCompose.GetCurrentEditor().document, range=doc.createRange();
      range.selectNodeContents(doc.body); doc.defaultView.getSelection().removeAllRanges();doc.defaultView.getSelection().addRange(range);
      doc.defaultView.focus();
    """)
    time.sleep(0.1)
    send_command(client, tab, 'paragraphSpacing', {'before': 6, 'after': 12})
    assert client.script("return [...testCompose.GetCurrentEditor().document.querySelectorAll('p')].every(p=>p.style.marginTop === '6pt' && p.style.marginBottom === '12pt');")
    send_command(client, tab, 'undo')
    assert client.script("return [...testCompose.GetCurrentEditor().document.querySelectorAll('p')].every(p=>!p.style.marginTop && !p.style.marginBottom);")
    send_command(client, tab, 'redo')
    send_command(client, tab, 'paragraphSpacing', {'after': 0})
    assert client.script("return [...testCompose.GetCurrentEditor().document.querySelectorAll('p')].every(p=>p.style.marginTop === '6pt' && p.style.marginBottom === '0pt');")
    print('PASS: line and paragraph spacing affect selected paragraphs, preserve other content, and undo together', flush=True)

    client.extension_script('background', """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {body:
        'First line<br>Second line<br><p id="untouched">Keep this paragraph.</p>'});
    """, tab['id'])
    select_range(client, 0, 5)
    original = canonical_html(client)
    untouched = editor_snapshot(client)['untouched']
    send_command(client, tab, 'lineSpacing', 2)
    assert client.script("return !testCompose.GetCurrentEditor().document.body.style.lineHeight;")
    assert editor_snapshot(client)['untouched'] == untouched
    assert client.script("return testCompose.GetCurrentEditor().document.querySelector('p').style.lineHeight;") == '2'
    send_command(client, tab, 'undo')
    assert canonical_html(client) == original

    client.extension_script('background', """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {body:
        '<p id="target"><br></p><p id="untouched">Keep this paragraph.</p>'});
    """, tab['id'])
    client.script("""
      const doc=testCompose.GetCurrentEditor().document, range=doc.createRange();
      range.setStart(doc.getElementById('target'),0);range.collapse(true);
      doc.defaultView.getSelection().removeAllRanges();doc.defaultView.getSelection().addRange(range);doc.defaultView.focus();
    """)
    time.sleep(0.1)
    send_command(client, tab, 'paragraphSpacing', {'before': 6, 'after': 0})
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.marginTop;") == '6pt'
    assert not client.script("return testCompose.GetCurrentEditor().document.getElementById('untouched').getAttribute('style');")
    client.script("""
      const doc=testCompose.GetCurrentEditor().document, range=doc.createRange();
      range.selectNodeContents(doc.body);doc.defaultView.getSelection().removeAllRanges();doc.defaultView.getSelection().addRange(range);doc.defaultView.focus();
    """)
    time.sleep(0.1)
    send_command(client, tab, 'lineSpacing', 1.5)
    assert client.script("return [...testCompose.GetCurrentEditor().document.querySelectorAll('p')].every(p=>p.style.lineHeight==='1.5');")

    client.extension_script('background', """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {body:
        '<ul><li id="target">First item</li><li id="untouched">Second item</li></ul>'});
    """, tab['id'])
    select_range(client, 0, 5)
    untouched = editor_snapshot(client)['untouched']
    toolbar_action(client, tab, "document.querySelector('[data-command=paragraphSpacingIncrease]').click();")
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.marginBottom;") == '2.85pt'
    assert editor_snapshot(client)['untouched'] == untouched
    print('PASS: spacing handles bare text, empty paragraphs, and list items without changing their neighbors', flush=True)

    toolbar_action(client, tab, "document.querySelector('[data-command=paragraphSpacingDecrease]').click();")
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.marginBottom;") == '0pt'
    assert client.toolbar_script(tab, "return document.querySelector('[data-command=paragraphSpacingDecrease]').disabled;")
    send_command(client, tab, 'undo')
    assert client.script("return testCompose.GetCurrentEditor().document.getElementById('target').style.marginBottom;") == '2.85pt'
    client.extension_script('background', """
      return window.wrappedJSObject.browser.compose.setComposeDetails(arguments[0], {body:
        '<p style="margin:0pt 0 6pt">First</p><p style="margin:12pt 0 18pt">Second</p>'});
    """, tab['id'])
    client.script("""
      const doc=testCompose.GetCurrentEditor().document, range=doc.createRange();range.selectNodeContents(doc.body);
      doc.defaultView.getSelection().removeAllRanges();doc.defaultView.getSelection().addRange(range);doc.defaultView.focus();
    """)
    time.sleep(0.1)
    before = canonical_html(client)
    toolbar_action(client, tab, "document.querySelector('[data-command=paragraphSpacingIncrease]').click();")
    assert client.script("return [...testCompose.GetCurrentEditor().document.querySelectorAll('p')].map(p=>[p.style.marginTop,p.style.marginBottom]);") == [['2.85pt','8.85pt'],['14.85pt','20.85pt']]
    send_command(client, tab, 'undo')
    assert canonical_html(client) == before
    print('PASS: paragraph increase/decrease preserve mixed margins, stop at zero, and undo in one step', flush=True)


def toolbar_tests(client):
    tab = client.extension_script("background", """
      return window.wrappedJSObject.browser.compose.beginNew({
        body: '<p id="target">Hello colorful world.</p><p id="untouched">Keep this paragraph.</p>',
        subject: 'Toolbar integration test', isPlainText: false
      });
    """)
    handles = client.call("WebDriver:GetWindowHandles")
    handles = handles.get("value", handles) if isinstance(handles, dict) else handles
    client.call("WebDriver:SwitchToWindow", {"handle": handles[-1]})
    client.script("""
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      globalThis.testExtension = ExtensionParent.GlobalManager.extensionMap.get(arguments[0]);
      globalThis.testCompose = Services.wm.getMostRecentWindow('msgcompose');
    """, ADDON_ID)
    toolbar_ready(client, tab)
    others = client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].filter(win => win !== testCompose)
        .map(win => win.GetCurrentEditor().document.body.innerHTML);
    """)
    native_collapsed = client.script("return testCompose.document.getElementById('FormatToolbar').getAttribute('collapsed');")
    select_range(client, 6, 14)
    toolbar_action(client, tab, "const button = document.querySelector('[data-command=bold]'); button.focus(); button.click();")
    assert "font-weight: bold" in editor_snapshot(client)["html"]
    assert editor_snapshot(client)["selection"] == "colorful"
    open_dropdown(client, tab, 'font')
    dropdown_action(client, tab, 'font', "const input = document.getElementById('font-search'); input.focus(); input.value = 'Georgia'; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));")
    assert "Georgia" in editor_snapshot(client)["html"]
    before_style = canonical_html(client)
    open_dropdown(client, tab, 'style')
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'style-popup.png')], env=client.test_env, check=True)
    dropdown_action(client, tab, 'style', "document.querySelector('[data-block=h2]').click();")
    assert client.script("return testCompose.GetCurrentEditor().document.queryCommandValue('formatBlock');").lower() == 'h2'
    send_command(client, tab, 'undo')
    assert canonical_html(client) == before_style
    open_dropdown(client, tab, 'text-color')
    dropdown_action(client, tab, 'text-color', "document.getElementById('color-hex').value='#2563eb';document.getElementById('color-form').requestSubmit();")
    assert editor_snapshot(client)['color'] == 'rgb(37, 99, 235)'
    open_dropdown(client, tab, 'background-color')
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'color-popup.png')], env=client.test_env, check=True)
    dropdown_action(client, tab, 'background-color', "document.getElementById('color-hex').value='#dbeafe';document.getElementById('color-form').requestSubmit();")
    assert editor_snapshot(client)['highlight'] == 'rgb(219, 234, 254)'
    open_dropdown(client, tab, 'background-color')
    assert client.dropdown_script(tab, 'background-color', "return document.getElementById('color-hex').value;") == '#dbeafe'
    dropdown_action(client, tab, 'background-color', "document.getElementById('clear-highlight').click();")
    assert editor_snapshot(client)['highlight'] != 'rgb(219, 234, 254)'
    send_command(client, tab, 'undo')
    open_dropdown(client, tab, 'link')
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'link-popup.png')], env=client.test_env, check=True)
    dropdown_action(client, tab, 'link', "document.getElementById('link-url').value='https://example.com/toolbar';document.getElementById('link-form').requestSubmit();")
    assert editor_snapshot(client)['links'] == [{'url': 'https://example.com/toolbar', 'text': 'colorful'}]
    select_range(client, 14, 14)
    open_dropdown(client, tab, 'emoji')
    if shutil.which('import'):
        subprocess.run(['import', '-window', 'root', str(RESULTS / 'emoji-popup.png')], env=client.test_env, check=True)
    query = 'fete' if LANGUAGE == 'fr' else 'party'
    results = client.dropdown_script(tab, 'emoji', """
      const input = document.getElementById('emoji-search');
      input.value = arguments[0]; input.dispatchEvent(new Event('input', {bubbles: true}));
      return [...document.querySelectorAll('#emoji-grid button')].map(button => ({emoji: button.textContent, title: button.title}));
    """, query)
    assert results == [{'emoji': '🎉', 'title': MESSAGES['emojiParty']['message']}], results
    dropdown_action(client, tab, 'emoji', "document.querySelector('#emoji-grid button').click();")
    assert "colorful🎉" in editor_snapshot(client)["text"]
    assert client.script("return testCompose.GetCurrentEditor().document.querySelector('[id^=rich-text]') === null;")
    assert client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].filter(win => win !== testCompose)
        .map(win => win.GetCurrentEditor().document.body.innerHTML);
    """) == others
    print("PASS: toolbar fonts, styles, custom highlights, links, and emoji preserve the selection and other drafts", flush=True)

    # Native undo changes the editor independently of the toolbar; its state must follow.
    client.script("testCompose.GetCurrentEditor().document.execCommand('undo');")
    select_range(client, 0, 5)
    client.toolbar_script(tab, """
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const timer = setInterval(() => {
          if (document.querySelector('[data-command=bold]').getAttribute('aria-pressed') === 'false') {clearInterval(timer); resolve(true);}
          else if (Date.now() > deadline) {clearInterval(timer); reject(new Error('Toolbar selection state did not update'));}
        }, 30);
      });
    """)
    toolbar_action(client, tab, "document.querySelector('[data-command=italic]').click();")
    assert "font-style: italic" in editor_snapshot(client)["html"]
    print("PASS: toolbar state follows native selections", flush=True)

    client.script("testCompose.resizeTo(1148, 840);")
    time.sleep(0.2)
    if shutil.which("import"):
        subprocess.run(["import", "-window", "root", str(RESULTS / "toolbar.png")], env=client.test_env, check=True)
    client.script("testCompose.resizeTo(720, 840);")
    time.sleep(0.2)
    layout = client.toolbar_script(tab, "return {width: innerWidth, scroll: document.documentElement.scrollWidth, height: innerHeight};")
    assert layout["scroll"] <= layout["width"] and 36 <= layout["height"] <= 360, layout
    for kind in ['font', 'style', 'line-spacing', 'text-color', 'background-color', 'link', 'emoji']:
        open_dropdown(client, tab, kind)
        if shutil.which('xdotool'):
            point = client.script("const box=testCompose.GetCurrentEditorElement().getBoundingClientRect();return {x:testCompose.mozInnerScreenX+box.right-30,y:testCompose.mozInnerScreenY+box.bottom-30};")
            subprocess.run(['xdotool', 'mousemove', '--sync', str(round(point['x'])), str(round(point['y'])), 'click', '1'], env=client.test_env, check=True)
            client.wait("return !testCompose.document.getElementById('rich-text-dropdown-panel');")
        else:
            dropdown_action(client, tab, kind, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));")
    print('PASS: floating dropdowns keep the toolbar and editor fixed, including in narrow windows', flush=True)
    client.script("testCompose.resizeTo(1148, 840);")
    theme_tests(client, tab)

    assert client.script("return testCompose.document.getElementById('FormatToolbar').getAttribute('collapsed');") == native_collapsed
    assert client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].every(win =>
        win.document.getElementById('FormatToolbar').hasAttribute('data-rich-text-hidden'));
    """)
    assert client.async_script("""
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(arguments[0]);
      return addon.optionsURL === testExtension.baseURI.resolve('options/options.html');
    """, ADDON_ID)
    client.extension_script("background", "return window.wrappedJSObject.browser.runtime.openOptionsPage();")
    client.wait("return [...testExtension.views].some(view => view.uri?.spec === testExtension.baseURI.resolve('options/options.html'));")
    settings = client.page_script("options/options.html", """
      return new Promise(resolve => {
        const timer = setInterval(() => {
          const show = document.getElementById('show-toolbar'), hide = document.getElementById('hide-native');
          if (show && !show.disabled) {clearInterval(timer); resolve({show: show.checked, hide: hide.checked});}
        }, 30);
      });
    """)
    assert settings == {"show": True, "hide": True}, settings
    assert client.page_script("options/options.html", "return [document.documentElement.lang, document.title, document.getElementById('toolbar-heading').textContent];") == [LANGUAGE, MESSAGES['settingsTitle']['message'], MESSAGES['composeToolbar']['message']]
    client.page_script("options/options.html", "document.getElementById('hide-native').click();")
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display !== 'none';")
    assert client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].every(win =>
        !win.document.getElementById('FormatToolbar').hasAttribute('data-rich-text-hidden'));
    """)
    client.page_script("options/options.html", "document.getElementById('hide-native').click();")
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display === 'none';")
    client.page_script("options/options.html", "document.getElementById('show-toolbar').click();")
    client.wait("return !testCompose.document.getElementById('rich-text-compose-toolbar');")
    assert client.script("return !testCompose.document.getElementById('FormatToolbar').hasAttribute('data-rich-text-hidden');")
    assert client.script("return testCompose.document.getElementById('FormatToolbar').getAttribute('collapsed');") == native_collapsed
    client.page_script("options/options.html", "document.getElementById('show-toolbar').click();")
    toolbar_ready(client, tab)
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display === 'none';")
    print("PASS: Add-ons Manager preferences synchronize across compose windows and safely restore the native toolbar", flush=True)

    body = editor_snapshot(client)["html"]
    client.async_script("""
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(arguments[0]);
      await addon.reload();
    """, ADDON_ID)
    client.wait("""
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      globalThis.testExtension = ExtensionParent.GlobalManager.extensionMap.get('rich-text@thunderbird-rich-text.local');
      return testExtension && [...testExtension.views].some(view => view.viewType === 'background');
    """)
    toolbar_ready(client, tab)
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display === 'none';")
    assert client.script("return testCompose.document.querySelectorAll('#rich-text-compose-toolbar').length;") == 1
    assert editor_snapshot(client)["html"] == body
    client.script("testCompose.focus();")
    open_dropdown(client, tab, 'font')
    client.async_script("""
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(arguments[0]);
      await addon.disable();
    """, ADDON_ID)
    assert client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].every(win =>
        !win.document.getElementById('rich-text-compose-toolbar') &&
        !win.document.getElementById('rich-text-toolbar-visibility') &&
        !win.document.getElementById('rich-text-dropdown-panel') &&
        !win.document.getElementById('FormatToolbar').hasAttribute('data-rich-text-hidden'));
    """)
    assert client.script("return testCompose.document.getElementById('FormatToolbar').getAttribute('collapsed');") == native_collapsed
    assert editor_snapshot(client)["html"] == body
    print("PASS: preferences survive reload; disabling removes all toolbar UI and restores Thunderbird without modifying drafts", flush=True)


def run_tests(client):
    tab = basic_tests(client)
    snapshot = editor_snapshot(client)
    assert snapshot["selection"] == "colorful", snapshot
    assert snapshot["untouched"] == '<p id="untouched">Keep this paragraph.</p>', snapshot
    assert not send_command(client, tab, "undo")["state"]["states"]["bold"]
    assert send_command(client, tab, "redo")["state"]["states"]["bold"]
    print("PASS: native undo/redo and unchanged neighboring text", flush=True)

    for command in ["italic", "underline", "strikeThrough", "superscript", "subscript"]:
        result = send_command(client, tab, command)
        assert result["state"]["states"][command], (command, result)
    for command, value in [("fontName", "Liberation Sans"), ("fontSize", "5")]:
        result = send_command(client, tab, command, value)
        assert value in str(result["state"]["values"][command]), result
    send_command(client, tab, "foreColor", "#2563eb")
    send_command(client, tab, "hiliteColor", "#fef08a")
    snapshot = editor_snapshot(client)
    assert snapshot["color"] == "rgb(37, 99, 235)", snapshot
    assert snapshot["highlight"] == "rgb(254, 240, 138)", snapshot
    send_command(client, tab, "hiliteColor", "transparent")
    assert editor_snapshot(client)["highlight"] == "rgba(0, 0, 0, 0)"
    send_command(client, tab, "removeFormat")
    result = send_command(client, tab, "bold")
    assert result["state"]["states"]["bold"], result
    print("PASS: inline typography, font sizes, text/background colors, and clearing", flush=True)

    reset_fixture(client, tab)
    for command in ["justifyCenter", "justifyRight", "justifyFull", "justifyLeft", "insertUnorderedList", "insertOrderedList"]:
        result = send_command(client, tab, command)
        assert result["state"]["states"][command], (command, result)
    send_command(client, tab, "indent")
    send_command(client, tab, "outdent")
    reset_fixture(client, tab)
    for block in ["h1", "h2", "h3", "blockquote", "pre", "p"]:
        result = send_command(client, tab, "formatBlock", block)
        assert block in result["state"]["values"]["formatBlock"].lower(), result
    send_command(client, tab, "insertHorizontalRule")
    assert "<hr" in editor_snapshot(client)["html"]
    print("PASS: alignment, lists, indentation, headings, quotations, and dividers", flush=True)

    reset_fixture(client, tab)
    send_command(client, tab, "bold")
    send_command(client, tab, "link", {"url": "https://example.com/?a=1&b=2", "text": "colorful"})
    snapshot = editor_snapshot(client)
    assert snapshot["links"] == [{"url": "https://example.com/?a=1&b=2", "text": "colorful"}], snapshot
    assert "font-weight: bold" in snapshot["html"], snapshot
    before = snapshot["html"]
    assert send_command(client, tab, "link", {"url": "javascript:alert(1)"}, expect_ok=False)['error'] == MESSAGES['errorUrlScheme']['message']
    assert editor_snapshot(client)["html"] == before
    send_command(client, tab, "unlink")
    assert not editor_snapshot(client)["links"]
    label = '<img src=x onerror="alert(1)"> & hello'
    send_command(client, tab, "link", {"url": "mailto:hello@example.com", "text": label})
    snapshot = editor_snapshot(client)
    assert snapshot["links"][0]["text"] == label and snapshot["images"] == 0, snapshot
    print("PASS: links preserve formatting, unlink works, and unsafe input cannot become active HTML", flush=True)

    reset_fixture(client, tab, 6, 6)
    send_command(client, tab, "insertText", "👩🏽‍💻")
    assert "Hello 👩🏽‍💻colorful world." in editor_snapshot(client)["text"]
    send_command(client, tab, "undo")
    assert "👩🏽‍💻" not in editor_snapshot(client)["text"]
    send_command(client, tab, "redo")
    assert "👩🏽‍💻" in editor_snapshot(client)["text"]
    print("PASS: Unicode insertion at a collapsed cursor and native history", flush=True)

    typography_tests(client, tab)

    plain = client.extension_script("background", """
      return window.wrappedJSObject.browser.compose.beginNew({plainTextBody: 'Plain message', isPlainText: true});
    """)
    handles = client.call("WebDriver:GetWindowHandles")
    handles = handles.get("value", handles) if isinstance(handles, dict) else handles
    client.call("WebDriver:SwitchToWindow", {"handle": handles[-1]})
    client.script("""
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      globalThis.testExtension = ExtensionParent.GlobalManager.extensionMap.get(arguments[0]);
      globalThis.testCompose = Services.wm.getMostRecentWindow('msgcompose');
    """, ADDON_ID)
    toolbar_ready(client, plain)
    select_range(client, 13, 13)
    assert client.toolbar_script(plain, "return !document.getElementById('mode').hidden;")
    assert client.script("return testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect().height;") > 30
    send_command(client, plain, "bold", expect_ok=False)
    open_dropdown(client, plain, 'emoji')
    dropdown_action(client, plain, 'emoji', """
      const search = document.getElementById('emoji-search');
      search.value = 'celebration'; search.dispatchEvent(new Event('input', {bubbles: true}));
      [...document.querySelectorAll('#emoji-grid button')].find(button => button.textContent === '🎉').click();
    """)
    assert "🎉" in editor_snapshot(client)["text"], editor_snapshot(client)
    preferences = client.toolbar_script(plain, "return window.wrappedJSObject.browser.storage.local.get(null);")
    assert preferences["recentEmoji"][0] == "🎉", preferences
    assert set(preferences).issubset({"recentEmoji", "customColors"}), preferences
    assert client.toolbar_script(plain, "return document.querySelector('[data-command=bold]').disabled && document.querySelector('[data-menu=link]').disabled;")
    print("PASS: plain-text safeguards, searchable emoji, and preference-only storage", flush=True)
    toolbar_tests(client)
    print("All native integration checks passed.", flush=True)
    (RESULTS / "native-result.json").write_text(json.dumps({
        "thunderbird": client.script("return Services.appinfo.version;"),
        "platform": "Linux", "passed": True, "artifact": client.addon_path.name,
        "requestedLocale": TEST_LOCALE, "extensionLanguage": LANGUAGE,
    }, indent=2) + "\n")


def main():
    thunderbird = shutil.which(os.environ.get("THUNDERBIRD_BINARY", "thunderbird"))
    if not thunderbird or not all(shutil.which(binary) for binary in ["Xvfb", "xfwm4"]):
        raise SystemExit("Install Thunderbird, Xvfb, and xfwm4 to run native integration tests.")
    RESULTS.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/package.py")], check=True)
    version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
    addon_path = ROOT / "dist" / f"thunderbird-rich-text-{version}.xpi"
    with tempfile.TemporaryDirectory(prefix="rich-text-thunderbird-") as temporary:
        profile = Path(temporary) / "profile"
        profile.mkdir()
        (profile / "Mail" / "Local Folders").mkdir(parents=True)
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
        prefs = {
            "marionette.port": port, "marionette.enabled": True,
            "mail.shell.checkDefaultClient": False, "mail.provider.enabled": False,
            "mail.provider.suppress_dialog_on_startup": True, "mailnews.start_page.enabled": False,
            "mail.accountmanager.accounts": "account1", "mail.accountmanager.defaultaccount": "account1",
            "mail.accountmanager.localfoldersserver": "server1", "mail.account.account1.server": "server1",
            "mail.account.account1.identities": "id1", "mail.server.server1.type": "none",
            "mail.server.server1.hostname": "Local Folders", "mail.server.server1.name": "Local Folders",
            "mail.server.server1.userName": "nobody", "mail.server.server1.directory": str(profile / "Mail" / "Local Folders"),
            "mail.identity.id1.fullName": "Rich Text Test", "mail.identity.id1.useremail": "writer@example.invalid",
            "mail.identity.id1.compose_html": True, "mail.identity.id1.fcc": False,
            "mail.identity.id1.draft_folder": "mailbox://nobody@Local%20Folders/Drafts",
            "app.update.auto": False, "datareporting.policy.dataSubmissionEnabled": False,
            "toolkit.telemetry.reportingpolicy.firstRun": False,
            "browser.startup.homepage_override.mstone": "ignore", "mailnews.start_page.override_url": "",
        }
        (profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(key)}, {json.dumps(value)});" for key, value in prefs.items()))
        with (RESULTS / "thunderbird.log").open("w") as log:
            xvfb = subprocess.Popen(["Xvfb", "-displayfd", "1", "-screen", "0", "1280x960x24", "-nolisten", "tcp"], stdout=subprocess.PIPE, stderr=log)
            process = None
            manager = None
            client = None
            try:
                display = xvfb.stdout.readline().decode().strip()
                if not display:
                    raise RuntimeError("Xvfb could not start; see test-results/thunderbird.log")
                env = {**os.environ, "DISPLAY": f":{display}", "MOZ_ENABLE_WAYLAND": "0", "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}
                if shutil.which("xfwm4"):
                    manager = subprocess.Popen(["xfwm4", "--compositor=off"], env=env, stdout=log, stderr=log)
                process = subprocess.Popen([thunderbird, "-no-remote", "-profile", str(profile), "-offline", "-marionette"], env=env, stdout=log, stderr=log)
                end = time.monotonic() + 40
                while time.monotonic() < end:
                    if process.poll() is not None:
                        raise RuntimeError("Thunderbird exited; see test-results/thunderbird.log")
                    try:
                        client = Marionette(port)
                        break
                    except (ConnectionRefusedError, TimeoutError):
                        time.sleep(0.2)
                if not client:
                    raise RuntimeError("Thunderbird did not start Marionette within 40 seconds")
                client.test_env = env
                client.addon_path = addon_path
                # Exercise the real WebExtension locale resolver without downloading
                # language packs or depending on the installed Thunderbird UI locale.
                # This changes only the disposable test process; no i18n APIs are mocked.
                locales = client.script("""
                  Services.locale.availableLocales = [...new Set([...Services.locale.availableLocales, arguments[0]])];
                  Services.locale.requestedLocales = [arguments[0]];
                  return Services.locale.appLocalesAsBCP47;
                """, TEST_LOCALE)
                assert locales[0] == TEST_LOCALE, locales
                run_tests(client)
            except Exception:
                if client:
                    try:
                        print('Thunderbird diagnostics:', client.script("return Services.console.getMessageArray().slice(-10).map(item => item.message);"), flush=True)
                        screenshot = client.call("WebDriver:TakeScreenshot", {"id": None, "full": False, "scroll": False})
                        (RESULTS / "failure.png").write_bytes(base64.b64decode(screenshot["value"]))
                    except Exception:
                        pass
                raise
            finally:
                if client:
                    client.socket.close()
                if process:
                    process.terminate()
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                if manager:
                    manager.terminate()
                    manager.wait(timeout=5)
                xvfb.terminate()
                xvfb.wait(timeout=5)


if __name__ == "__main__":
    main()
