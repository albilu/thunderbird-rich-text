/* Privileged adapter: compose UI, installed fonts, and bounded typography transactions.
 * Other formatting and all UI logic run in unprivileged extension scripts.
 */
var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionError } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { BasePopup } = ChromeUtils.importESModule("resource:///modules/ExtensionPopups.sys.mjs");

// Use Thunderbird's popup browser so menus can cross the toolbar frame boundary.
// Its native panel handles outside clicks, Escape, focus, and screen-edge placement.
var RichTextDropdown = class extends BasePopup {
  closePopup() {
    if (this.panel?.state === "closed") this.destroy();
    else this.panel?.hidePopup();
  }

  destroy() {
    if (this.destroyed) return Promise.resolve();
    const panel = this.panel;
    this.onClosed?.();
    return super.destroy().finally(() => panel?.remove());
  }
};

var RichTextLocalizedError = class extends Error {};

/* Native editor transactions for point sizes and paragraph spacing. No HTML replacement. */
var RichTextTypography = (() => {
  "use strict";
  const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,pre,li,dt,dd,blockquote,td,th,body";
  const rounded = value => Math.round(value * 100) / 100;
  function elementAt(node, offset = 0) {
    if (node.nodeType === 3) return node.parentElement;
    const child = node.childNodes[offset] || node.childNodes[offset - 1];
    return child?.nodeType === 3 ? child.parentElement : child || node;
  }
  function offsets(doc, range) {
    const prefix = doc.createRange();
    prefix.selectNodeContents(doc.body);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    return [start, prefix.toString().length];
  }
  function textRuns(doc, range) {
    const [start, end] = offsets(doc, range);
    const walker = doc.createTreeWalker(doc.body, doc.defaultView.NodeFilter.SHOW_TEXT);
    const runs = [];
    let node, index = 0;
    while ((node = walker.nextNode())) {
      const next = index + node.length;
      if (next > start && index < end) runs.push({ node, start: Math.max(start, index), end: Math.min(end, next) });
      index = next;
      if (index >= end) break;
    }
    return runs;
  }
  function selectOffsets(editor, start, end) {
    const doc = editor.document;
    const walker = doc.createTreeWalker(doc.body, doc.defaultView.NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let node, index = 0, began = false;
    while ((node = walker.nextNode())) {
      const next = index + node.length;
      if (!began && start < next) { range.setStart(node, start - index); began = true; }
      if (began && end <= next) { range.setEnd(node, end - index); break; }
      index = next;
    }
    if (!began) throw new RichTextLocalizedError("errorSelectText");
    editor.selection.removeAllRanges();
    editor.selection.addRange(range);
  }
  function fontStyle(doc, element) {
    const ancestors = [];
    for (let node = element; node && node !== doc.body; node = node.parentElement) {
      if (node.localName === "font") ancestors.unshift(node);
    }
    const style = doc.createElement("span").style;
    for (const node of ancestors) {
      for (const property of node.style) style.setProperty(property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property));
    }
    return style;
  }
  function setFontSize(editor, size) {
    const doc = editor.document, selection = editor.selection;
    const range = selection.getRangeAt(0);
    if (selection.isCollapsed) {
      const style = fontStyle(doc, elementAt(range.startContainer, range.startOffset));
      const pending = editor.getInlinePropertyWithAttrValue("font", "style", "", {}, {}, {});
      if (pending) style.cssText = pending;
      style.fontSize = `${size}pt`;
      editor.removeInlineProperty("font", "size");
      editor.setInlineProperty("font", "style", style.cssText);
      return;
    }
    const [start, end] = offsets(doc, range);
    // Each existing font style is preserved separately, including mixed selections.
    // Reverse order and text offsets survive the native editor splitting/merging wrappers.
    const runs = textRuns(doc, range).map(run => {
      const style = fontStyle(doc, run.node.parentElement);
      style.fontSize = `${size}pt`;
      return { ...run, style: style.cssText };
    });
    if (!runs.length) throw new RichTextLocalizedError("errorSelectText");
    for (const run of runs.reverse()) {
      selectOffsets(editor, run.start, run.end);
      editor.removeInlineProperty("font", "size");
      editor.setInlineProperty("font", "style", run.style);
    }
    selectOffsets(editor, start, end);
  }
  function paragraphs(editor) {
    const doc = editor.document, selection = editor.selection;
    const range = selection.getRangeAt(0);
    const blocks = new Set();
    if (selection.isCollapsed) {
      blocks.add(elementAt(range.startContainer, range.startOffset).closest(BLOCKS) || doc.body);
    } else {
      for (const { node } of textRuns(doc, range)) blocks.add(node.parentElement.closest(BLOCKS) || doc.body);
      for (const block of doc.body.querySelectorAll(BLOCKS)) {
        if (block.textContent || block.querySelector(BLOCKS)) continue;
        const contents = doc.createRange();
        contents.selectNodeContents(block);
        if (range.compareBoundaryPoints(range.END_TO_START, contents) < 0 &&
            range.compareBoundaryPoints(range.START_TO_END, contents) > 0) blocks.add(block);
      }
    }
    return [...blocks];
  }
  function writeStyle(editor, element, properties) {
    const style = editor.document.createElement("span").style;
    style.cssText = element.getAttribute("style") || "";
    for (const [property, value] of Object.entries(properties)) style.setProperty(property, value);
    if (style.cssText !== element.style.cssText) editor.setAttributeOrEquivalent(element, "style", style.cssText, false);
  }
  function apply(editor, command, value) {
    // Thunderbird's schema normalization supplies null for omitted optional fields.
    if (command === "paragraphSpacing" && value && typeof value === "object") {
      value = Object.fromEntries(Object.entries(value).filter(([, amount]) => amount != null));
    }
    const number = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
    const valid = command === "fontSize" ? number(value, 1, 200) :
      command === "lineSpacing" ? value === "normal" || number(value, 0.5, 5) :
      command === "paragraphSpacing" && value && typeof value === "object" && Object.keys(value).length > 0 &&
        ((Object.keys(value).length === 1 && ["increase", "decrease"].includes(value.adjust)) ||
        Object.entries(value).every(([key, amount]) => ["before", "after"].includes(key) && number(amount, 0, 200)));
    if (!valid) throw new RichTextLocalizedError("errorTypographyValue");
    if (!editor.isDocumentEditable || !editor.isSelectionEditable || !editor.selection.rangeCount) throw new RichTextLocalizedError("errorEditorNotReady");
    editor.beginTransaction();
    try {
      if (command === "fontSize") setFontSize(editor, value);
      else {
        let blocks = paragraphs(editor);
        if (!blocks.length || blocks.includes(editor.document.body)) {
          // Give unwrapped body text its own paragraph, without styling the whole draft.
          if (!editor.document.execCommand("formatBlock", false, "p")) throw new RichTextLocalizedError("errorSelectParagraph");
          blocks = paragraphs(editor);
        }
        const properties = command === "lineSpacing" ? { "line-height": String(value) } : {
          ...(value.before !== undefined ? { "margin-top": `${value.before}pt` } : {}),
          ...(value.after !== undefined ? { "margin-bottom": `${value.after}pt` } : {})
        };
        for (const block of blocks) {
          if (block === editor.document.body) continue;
          if (command === "paragraphSpacing" && value.adjust) {
            const style = editor.document.defaultView.getComputedStyle(block);
            const delta = value.adjust === "increase" ? 2.85 : -2.85;
            const adjust = value => {
              const current = Math.max(0, parseFloat(value) * 0.75 || 0);
              return rounded(delta > 0 ? Math.max(current, Math.min(200, current + delta)) : Math.max(0, current + delta));
            };
            writeStyle(editor, block, { "margin-top": `${adjust(style.marginTop)}pt`, "margin-bottom": `${adjust(style.marginBottom)}pt` });
          } else writeStyle(editor, block, properties);
        }
      }
    } finally { editor.endTransaction(); }
  }
  function read(editor) {
    const selection = editor.selection, doc = editor.document;
    if (!selection?.rangeCount) return {};
    const range = selection.getRangeAt(0);
    const elements = selection.isCollapsed ? [elementAt(range.startContainer, range.startOffset)] :
      textRuns(doc, range).map(run => run.node.parentElement);
    const sizeValues = elements.map(element => rounded(parseFloat(doc.defaultView.getComputedStyle(element).fontSize) * 0.75));
    if (selection.isCollapsed) {
      const pending = editor.getInlinePropertyWithAttrValue("font", "style", "", {}, {}, {});
      const style = doc.createElement("span").style;
      style.cssText = pending;
      if (/^[\d.]+pt$/.test(style.fontSize)) sizeValues[0] = parseFloat(style.fontSize);
    }
    const uniform = values => values.length && values.every(value => value === values[0]) ? values[0] : "";
    const blocks = paragraphs(editor).map(block => doc.defaultView.getComputedStyle(block));
    return {
      fontSize: uniform(sizeValues),
      lineSpacing: uniform(blocks.map(style => style.lineHeight === "normal" ? "normal" : rounded(parseFloat(style.lineHeight) / parseFloat(style.fontSize)))),
      paragraphBefore: uniform(blocks.map(style => rounded(parseFloat(style.marginTop) * 0.75))),
      paragraphAfter: uniform(blocks.map(style => rounded(parseFloat(style.marginBottom) * 0.75))),
      canDecreaseParagraphSpacing: blocks.some(style => parseFloat(style.marginTop) > 0 || parseFloat(style.marginBottom) > 0),
      canIncreaseParagraphSpacing: blocks.some(style => parseFloat(style.marginTop) * 0.75 < 200 || parseFloat(style.marginBottom) * 0.75 < 200)
    };
  }
  return Object.freeze({ apply, read });
})();

var composeToolbar = class extends ExtensionCommon.ExtensionAPI {
  constructor(extension) {
    super(extension);
    this.records = new Map();
    this.settings = { showToolbar: true, hideNativeToolbar: true };
    this.listenerId = `${extension.id}:compose-toolbar`;
    this.listening = false;
    this.dropdownListeners = new Set();
    this.themeListeners = new Set();
  }

  watch(window) {
    if (this.records.has(window)) return;
    const record = { window, ready: false, host: null, style: null, browser: null };
    this.records.set(window, record);
    record.onReady = () => this.mount(record);
    window.addEventListener("compose-editor-ready", record.onReady);
    if (window.GetCurrentEditor?.()) this.mount(record);
  }

  mount(record) {
    const { window } = record;
    if (record.host || window.closed || !this.records.has(window) || !this.settings.showToolbar) return;
    const doc = window.document;
    const anchor = doc.getElementById("FormatToolbox");
    if (!anchor) return; // A future unsupported compose layout leaves the native toolbar intact.
    record.tabId = this.extension.tabManager.getWrapper(window).id;
    const host = doc.createXULElement("vbox");
    host.id = "rich-text-compose-toolbar";
    host.setAttribute("aria-label", this.extension.localizeMessage("nativeToolbarLabel"));
    host.style.minWidth = "0";
    host.style.width = "100%";
    const browser = doc.createXULElement("browser");
    browser.id = "rich-text-toolbar-browser";
    for (const [name, value] of Object.entries({
      type: "content", disableglobalhistory: "true", messagemanagergroup: "webext-browsers",
      "webextension-view-type": "tab", tooltip: "aHTMLTooltip", context: "browserContext",
      autocompletepopup: "PopupAutoComplete", selectmenulist: "ContentSelectDropdown",
      constrainpopups: "false", datetimepicker: "DateTimePickerPanel", maychangeremoteness: "true",
      initialBrowsingContextGroupId: this.extension.policy.browsingContextGroupId
    })) browser.setAttribute(name, value);
    browser.setAttribute("nodefaultsrc", "");
    browser.style.height = "84px";
    browser.style.minHeight = "36px";
    browser.style.minWidth = "0";
    browser.style.width = "100%";
    if (this.extension.remote) {
      browser.setAttribute("remote", "true");
      browser.setAttribute("remoteType", this.extension.remoteType);
    }
    record.host = host;
    record.browser = browser;
    const load = () => {
      if (!host.isConnected || !this.records.has(window)) return;
      ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
      const url = this.extension.baseURI.resolve(`toolbar/toolbar.html?tabId=${record.tabId}`);
      browser.fixupAndLoadURIString(url, { triggeringPrincipal: this.extension.principal });
    };
    // Frame-loader events fire during the browser element's own initialization.
    // Wait for the promise continuation before calling its navigation methods.
    const frameReady = new Promise(resolve => browser.addEventListener(
      this.extension.remote ? "XULFrameLoaderCreated" : "load", resolve, { once: true }
    ));
    host.append(browser);
    // Keep both bars in Thunderbird's existing format-toolbar grid area.
    // Adding a sibling grid item would create an unintended column/row.
    anchor.append(host);
    if (!this.extension.remote) void browser.contentWindow;
    frameReady.then(load).catch(error => console.error("Rich Text toolbar could not load:", error));

    // A temporary CSS override preserves Thunderbird's own persisted collapsed state.
    const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = "rich-text-toolbar-visibility";
    style.textContent = '#FormatToolbar[data-rich-text-hidden="true"] { display: none !important; }';
    doc.documentElement.append(style);
    record.style = style;
    const themeChanged = () => {
      window.clearTimeout(record.themeTimer);
      record.themeTimer = window.setTimeout(() => {
        if (!this.records.has(window)) return;
        const theme = this.readTheme(window);
        const signature = JSON.stringify(theme);
        if (signature === record.themeSignature) return;
        record.themeSignature = signature;
        for (const fire of this.themeListeners) fire.async(record.tabId, theme);
      }, 0);
    };
    record.themeObserver = new window.MutationObserver(themeChanged);
    record.themeObserver.observe(doc.documentElement, { attributes: true });
    record.colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    record.onThemeChanged = themeChanged;
    record.colorScheme.addEventListener("change", themeChanged);
  }

  applyVisibility(record) {
    record.window.document.getElementById("FormatToolbar")?.toggleAttribute(
      "data-rich-text-hidden", Boolean(record.ready && this.settings.showToolbar && this.settings.hideNativeToolbar)
    );
    // toggleAttribute produces an empty value; use a fixed value for the scoped rule.
    const native = record.window.document.getElementById("FormatToolbar");
    if (native?.hasAttribute("data-rich-text-hidden")) native.setAttribute("data-rich-text-hidden", "true");
  }

  remove(window) {
    const record = this.records.get(window);
    if (!record) return;
    record.dropdown?.closePopup();
    record.themeObserver?.disconnect();
    record.colorScheme?.removeEventListener("change", record.onThemeChanged);
    window.clearTimeout(record.themeTimer);
    window.removeEventListener("compose-editor-ready", record.onReady);
    window.document.getElementById("FormatToolbar")?.removeAttribute("data-rich-text-hidden");
    record.host?.remove();
    record.style?.remove();
    this.records.delete(window);
  }

  stop() {
    if (this.listening) ExtensionSupport.unregisterWindowListener(this.listenerId);
    this.listening = false;
    for (const window of [...this.records.keys()]) this.remove(window);
  }

  getRecord(tabId) {
    // The tab manager rejects stale IDs; never fall back to the active compose window.
    const tab = this.extension.tabManager.get(tabId);
    return this.records.get(tab.nativeTab);
  }

  readTheme(window) {
    if (!window || window.closed) return {};
    const doc = window.document;
    const toolbar = doc.getElementById("FormatToolbox") || doc.documentElement;
    const style = window.getComputedStyle(toolbar);
    const probe = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;";
    probe.style.color = style.color;
    toolbar.append(probe);
    try {
      const resolve = value => {
        probe.style.backgroundColor = value;
        return window.getComputedStyle(probe).backgroundColor;
      };
      const colors = {
        background: style.backgroundColor === "rgba(0, 0, 0, 0)" ? resolve("ButtonFace") : style.backgroundColor,
        text: style.color,
        surface: resolve("var(--arrowpanel-background, var(--color-surface-subtle, Canvas))"),
        "surface-text": resolve("var(--arrowpanel-color, var(--color-text-base, CanvasText))"),
        field: resolve("var(--toolbar-field-background-color, Field)"),
        "field-text": resolve("var(--toolbar-field-color, FieldText)"),
        hover: resolve("var(--toolbarbutton-background-color-hover, color-mix(in srgb, currentColor 10%, transparent))"),
        line: resolve("var(--button-border-color, ButtonBorder)"),
        muted: resolve("var(--layout-color-2, GrayText)"),
        accent: resolve("var(--selected-item-color, AccentColor)"),
        "accent-text": resolve("var(--selected-item-text-color, AccentColorText)"),
        pressed: resolve("var(--toolbarbutton-checked-background, color-mix(in srgb, AccentColor 16%, transparent))"),
        "error-text": resolve("light-dark(#a4000f, #ff9aa2)"),
        scheme: resolve("light-dark(black, white)") === "rgb(255, 255, 255)" ? "dark" : "light"
      };
      return colors;
    } finally { probe.remove(); }
  }

  async openDropdown(tabId, kind, anchor) {
    const record = this.getRecord(tabId);
    if (!record?.browser?.isConnected || (!record.window.gMsgCompose?.composeHTML && kind !== "emoji")) {
      throw new ExtensionError(this.extension.localizeMessage("errorToolbarUnavailable"));
    }
    record.dropdown?.closePopup();
    const doc = record.window.document;
    const panel = doc.createXULElement("panel");
    panel.id = "rich-text-dropdown-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("class", "panel-no-padding");
    panel.setAttribute("neverhidden", "true");
    panel.setAttribute("consumeoutsideclicks", "false");
    if (this.extension.remote) panel.setAttribute("remote", "true");
    doc.getElementById("mainPopupSet").append(panel);
    const url = this.extension.baseURI.resolve(`toolbar/dropdown.html?tabId=${tabId}&kind=${kind}`);
    const popup = new RichTextDropdown(this.extension, panel, url, false);
    panel.addEventListener("popupshown", () => {
      record.window.promiseDocumentFlushed(() => {
        if (!popup.destroyed && panel.state === "open") popup.browser.focus();
      });
    }, { once: true });
    record.dropdown = popup;
    popup.onClosed = () => {
      if (record.dropdown === popup) record.dropdown = null;
      for (const fire of this.dropdownListeners) fire.async(tabId, kind);
    };
    try {
      await popup.browserReady;
      if (popup.destroyed || record.dropdown !== popup || !record.browser.isConnected) return;
      popup.browser.style.width = `${({ font: 300, style: 240, link: 340, emoji: 320 })[kind] || 280}px`;
      popup.browser.style.height = "280px";
      const bounds = record.browser.getBoundingClientRect();
      // Anchor to the button's screen rectangle, not the full-width browser.
      // Native edge flipping then stays beside that button on narrow displays.
      panel.openPopupAtScreenRect("after_start",
        Math.round(record.window.mozInnerScreenX + bounds.left + Math.min(anchor.x, bounds.width)),
        Math.round(record.window.mozInnerScreenY + bounds.top + Math.min(anchor.y, bounds.height)),
        Math.round(anchor.width), Math.round(anchor.height + 4), false, false);
    } catch (error) {
      popup.closePopup();
      throw error;
    }
  }

  getAPI(context) {
    return {
      composeToolbar: {
        getTheme: async tabId => this.readTheme(tabId == null
          ? Services.wm.getMostRecentWindow("mail:3pane") || Services.wm.getMostRecentWindow("msgcompose")
          : this.getRecord(tabId)?.window),
        onThemeChanged: new ExtensionCommon.EventManager({
          context, name: "composeToolbar.onThemeChanged",
          register: fire => {
            this.themeListeners.add(fire);
            return () => this.themeListeners.delete(fire);
          }
        }).api(),
        openDropdown: (tabId, kind, anchor) => this.openDropdown(tabId, kind, anchor),
        closeDropdown: async (tabId, focusEditor) => {
          const record = this.getRecord(tabId);
          record?.dropdown?.closePopup();
          if (focusEditor) record?.window.GetCurrentEditorElement()?.focus();
        },
        onDropdownClosed: new ExtensionCommon.EventManager({
          context, name: "composeToolbar.onDropdownClosed",
          register: fire => {
            this.dropdownListeners.add(fire);
            return () => this.dropdownListeners.delete(fire);
          }
        }).api(),
        getFonts: async () => {
          const fonts = Cc["@mozilla.org/gfx/fontenumerator;1"].getService(Ci.nsIFontEnumerator).EnumerateAllFonts();
          return [...new Set(fonts)].sort((a, b) => a.localeCompare(b));
        },
        getTypography: async tabId => {
          const record = this.getRecord(tabId);
          if (!record || record.window.closed || !record.window.gMsgCompose?.composeHTML) return {};
          return RichTextTypography.read(record.window.GetCurrentEditor());
        },
        applyTypography: async (tabId, command, value) => {
          const record = this.getRecord(tabId);
          if (!record || record.window.closed) throw new ExtensionError(this.extension.localizeMessage("errorComposeClosed"));
          if (!record.window.gMsgCompose?.composeHTML) throw new ExtensionError(this.extension.localizeMessage("errorTypographyHtml"));
          try { RichTextTypography.apply(record.window.GetCurrentEditor(), command, value); }
          catch (error) {
            if (error instanceof RichTextLocalizedError) throw new ExtensionError(this.extension.localizeMessage(error.message));
            throw error;
          }
        },
        configure: async settings => {
          this.settings = { ...settings };
          if (!settings.showToolbar) { this.stop(); return; }
          if (!this.listening) {
            this.listening = true;
            ExtensionSupport.registerWindowListener(this.listenerId, {
              chromeURLs: ["chrome://messenger/content/messengercompose/messengercompose.xhtml"],
              onLoadWindow: window => this.watch(window),
              onUnloadWindow: window => this.remove(window)
            });
          }
          for (const record of this.records.values()) this.applyVisibility(record);
        },
        setHeight: async (tabId, height) => {
          const record = this.getRecord(tabId);
          if (!record?.browser?.isConnected) return;
          record.browser.style.height = `${height}px`;
          record.ready = true;
          this.applyVisibility(record);
        },
        focusEditor: async tabId => {
          const record = this.getRecord(tabId);
          if (!record || record.window.closed) return;
          record.window.GetCurrentEditorElement()?.focus();
        }
      }
    };
  }

  onShutdown(isAppShutdown) {
    this.stop();
    if (!isAppShutdown) Services.obs.notifyObservers(null, "startupcache-invalidate");
  }
};
