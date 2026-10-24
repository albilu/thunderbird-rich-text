/* Privileged adapter: only manages the compose-window toolbar's host and visibility.
 * All formatting and UI logic runs in the existing unprivileged extension pages.
 */
var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

var composeToolbar = class extends ExtensionCommon.ExtensionAPI {
  constructor(extension) {
    super(extension);
    this.records = new Map();
    this.settings = { showToolbar: true, hideNativeToolbar: true };
    this.listenerId = `${extension.id}:compose-toolbar`;
    this.listening = false;
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
    host.setAttribute("aria-label", "Rich Text formatting toolbar");
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

  getAPI() {
    return {
      composeToolbar: {
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
