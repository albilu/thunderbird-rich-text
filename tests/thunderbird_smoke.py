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
RESULTS = ROOT / "test-results"
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


def toolbar_ready(client, tab):
    url = f"toolbar/toolbar.html?tabId={tab['id']}"
    client.wait(f"return [...testExtension.views].some(view => view.uri?.spec === testExtension.baseURI.resolve({json.dumps(url)}));")
    result = client.toolbar_script(tab, """
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 8000;
        const timer = setInterval(() => {
          const error = document.getElementById('error')?.textContent;
          if (error) { clearInterval(timer); resolve({error}); }
          else if (document.querySelector('[data-tray=emoji]') && !document.querySelector('[data-tray=emoji]').disabled) {
            clearInterval(timer); resolve({ready: true});
          } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Toolbar did not connect')); }
        }, 30);
      });
    """)
    assert result.get("ready"), result


def basic_tests(client):
    version = client.script("return Services.appinfo.version;")
    print(f"Testing Thunderbird {version}", flush=True)
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
    assert client.script("return testCompose.document.getElementById('FormatToolbar').nextElementSibling.id;") == "rich-text-compose-toolbar"
    assert client.script("return testCompose.document.getElementById('rich-text-toolbar-browser').getBoundingClientRect().height;") > 30
    client.wait("return testCompose.getComputedStyle(testCompose.document.getElementById('FormatToolbar')).display === 'none';")
    assert client.script("return !testCompose.document.getElementById('rich-text_thunderbird-rich-text_local-composeAction-toolbarbutton');")
    assert client.extension_script("background", "return !window.wrappedJSObject.browser.runtime.getManifest().compose_action;")
    assert client.toolbar_script(tab, "return !document.querySelector('#open-panel, [data-tray=settings]');")
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
          if (document.querySelector('[data-tray=emoji]').disabled) return;
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
        selection: selection.toString(), color: style?.color, highlight: style?.backgroundColor,
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
        if (!began && arguments[0] <= offset + node.length) { range.setStart(node, arguments[0] - offset); began = true; }
        if (arguments[1] <= offset + node.length) { range.setEnd(node, arguments[1] - offset); break; }
        offset += node.length;
      }
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    """, start, end)
    time.sleep(0.1)


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
          if (!document.querySelector('[data-tray=emoji]').disabled) {
            clearInterval(timer); resolve({error: document.getElementById('error').textContent});
          } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Toolbar action timed out')); }
        }, 30);
      });
    """)
    assert not result.get("error"), result


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
    toolbar_action(client, tab, "const select = document.getElementById('font'); select.focus(); select.value = 'Georgia'; select.dispatchEvent(new Event('change', {bubbles: true}));")
    assert "Georgia" in editor_snapshot(client)["html"]
    toolbar_action(client, tab, """
      document.getElementById('highlight').click();
      const input = document.getElementById('color-hex'); input.focus(); input.value = '#dbeafe';
      document.getElementById('color-form').requestSubmit();
    """)
    assert editor_snapshot(client)["highlight"] == "rgb(219, 234, 254)"
    client.toolbar_script(tab, "document.querySelector('[data-tray=link]').click();")
    client.toolbar_script(tab, """
      return new Promise(resolve => {
        const timer = setInterval(() => {
          if (document.activeElement.id === 'link-url') {clearInterval(timer); resolve(true);}
        }, 30);
      });
    """)
    toolbar_action(client, tab, """
      document.getElementById('link-url').value = 'https://example.com/toolbar';
      document.getElementById('link-form').requestSubmit();
    """)
    assert editor_snapshot(client)["links"] == [{"url": "https://example.com/toolbar", "text": "colorful"}]
    select_range(client, 14, 14)
    toolbar_action(client, tab, """
      document.querySelector('[data-tray=emoji]').click();
      document.querySelector('#emoji-grid button[title="party celebration congratulations"]').click();
    """)
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
    client.script("testCompose.resizeTo(1148, 840);")

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
    client.async_script("""
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(arguments[0]);
      await addon.disable();
    """, ADDON_ID)
    assert client.script("""
      return [...Services.wm.getEnumerator('msgcompose')].every(win =>
        !win.document.getElementById('rich-text-compose-toolbar') &&
        !win.document.getElementById('rich-text-toolbar-visibility') &&
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
    send_command(client, tab, "link", {"url": "javascript:alert(1)"}, expect_ok=False)
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
    toolbar_action(client, plain, """
      document.querySelector('[data-tray=emoji]').click();
      const search = document.getElementById('emoji-search');
      search.value = 'celebration'; search.dispatchEvent(new Event('input', {bubbles: true}));
      document.querySelector('#emoji-grid button').click();
    """)
    assert "🎉" in editor_snapshot(client)["text"], editor_snapshot(client)
    preferences = client.toolbar_script(plain, "return window.wrappedJSObject.browser.storage.local.get(null);")
    assert preferences["recentEmoji"][0] == "🎉", preferences
    assert set(preferences).issubset({"recentEmoji", "customColors"}), preferences
    assert client.toolbar_script(plain, "return document.querySelector('[data-command=bold]').disabled && document.querySelector('[data-tray=link]').disabled;")
    print("PASS: plain-text safeguards, searchable emoji, and preference-only storage", flush=True)
    toolbar_tests(client)
    print("All native integration checks passed.", flush=True)
    (RESULTS / "native-result.json").write_text(json.dumps({
        "thunderbird": client.script("return Services.appinfo.version;"),
        "platform": "Linux", "passed": True, "artifact": client.addon_path.name,
    }, indent=2) + "\n")


def main():
    thunderbird = shutil.which(os.environ.get("THUNDERBIRD_BINARY", "thunderbird"))
    if not thunderbird or not all(shutil.which(binary) for binary in ["Xvfb", "xfwm4"]):
        raise SystemExit("Install Thunderbird, Xvfb, and xfwm4 to run native integration tests.")
    RESULTS.mkdir(exist_ok=True)
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
