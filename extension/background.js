/* Only the trusted toolbar and its dropdown page talk to the compose and tabs APIs. */
(() => {
  "use strict";
  const api = browser;
  const { CHANNEL, normalizeCommand, isPlainTextCommand, normalizeToolbarSettings, TYPOGRAPHY_COMMANDS } = RichText;
  const injections = new Map();
  const files = ["shared.js", "editor.js"];

  async function ensureEditor(tabId) {
    try {
      const response = await api.tabs.sendMessage(tabId, { channel: CHANNEL, action: "ping" });
      if (response?.ok) return;
    } catch { /* Windows opened before installation need manual injection. */ }
    if (!injections.has(tabId)) {
      injections.set(tabId, (async () => {
        for (const file of files) await api.tabs.executeScript(tabId, { file });
      })().finally(() => injections.delete(tabId)));
    }
    await injections.get(tabId);
  }

  const ready = (async () => {
    await api.composeScripts.register({ js: files.map(file => ({ file })) });
    const tabs = await api.tabs.query({ type: "messageCompose" });
    await Promise.allSettled(tabs.map(tab => ensureEditor(tab.id)));
  })().catch(error => console.error("Rich Text could not register its compose script:", error));

  // Serialize preference changes so an older async startup read cannot override a newer choice.
  let configuring = Promise.resolve();
  function configureToolbar() {
    configuring = configuring.then(async () => {
      const { toolbarSettings } = await api.storage.local.get("toolbarSettings");
      await api.composeToolbar.configure(normalizeToolbarSettings(toolbarSettings));
    }).catch(error => console.error("Rich Text could not configure its toolbar:", error));
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.toolbarSettings) configureToolbar();
  });
  configureToolbar();

  async function handle(message) {
    await ready;
    const tabId = message.tabId;
    if (!Number.isInteger(tabId)) throw new Error("This toolbar has no message compose window.");
    const tab = await api.tabs.get(tabId);
    if (tab.type !== "messageCompose") throw new Error("This message compose window is no longer available.");
    const { isPlainText } = await api.compose.getComposeDetails(tabId);
    await ensureEditor(tabId);
    let request = { channel: CHANNEL, action: "state" };
    if (message.action === "command") {
      const normalized = normalizeCommand(message.command, message.value);
      if (isPlainText && !isPlainTextCommand(normalized.command)) {
        throw new Error("Formatting needs an HTML message. Hold Shift while clicking Write to switch compose format.");
      }
      if (TYPOGRAPHY_COMMANDS.includes(normalized.command)) {
        // Restore the saved native selection before handing it to the editor API.
        const prepared = await api.tabs.sendMessage(tabId, { channel: CHANNEL, action: "prepareTypography" });
        if (!prepared?.ok) throw new Error(prepared?.error || "The editor selection is unavailable.");
        try { await api.composeToolbar.applyTypography(tabId, normalized.command, normalized.value); }
        finally { await api.tabs.sendMessage(tabId, { channel: CHANNEL, action: "finishTypography" }); }
      } else request = { channel: CHANNEL, action: "command", ...normalized };
    } else if (!["connect", "state"].includes(message.action)) {
      throw new Error("Unknown Rich Text request.");
    }
    const response = await api.tabs.sendMessage(tabId, request);
    if (!response?.ok) throw new Error(response?.error || "The message editor is not ready. Try reconnecting the toolbar.");
    if (!isPlainText) response.state.values = { ...response.state.values, ...await api.composeToolbar.getTypography(tabId) };
    return { ...response, tabId, isPlainText };
  }

  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.channel !== CHANNEL || sender.id !== api.runtime.id) return undefined;
    if (message.action === "editorState" && sender.tab && !sender.url?.startsWith(api.runtime.getURL(""))) {
      // Compose scripts only send transient formatting state, never preferences or commands.
      api.tabs.get(sender.tab.id).then(async tab => {
        if (tab.type === "messageCompose") return api.runtime.sendMessage({
          channel: CHANNEL, action: "toolbarState", tabId: tab.id,
          state: { ...message.state, values: { ...message.state.values, ...await api.composeToolbar.getTypography(tab.id) } }
        });
        return undefined;
      }).catch(() => { /* The window or toolbar may have just closed. */ });
      return undefined;
    }
    if (!["toolbar/toolbar.html", "toolbar/dropdown.html"].some(path => sender.url?.split("?")[0] === api.runtime.getURL(path))) return undefined;
    const boundValue = new URL(sender.url).searchParams.get("tabId");
    const boundTab = Number(boundValue);
    if (!boundValue || !Number.isInteger(boundTab) || message.tabId !== boundTab) {
      return Promise.resolve({ ok: false, error: "This toolbar belongs to a different compose window." });
    }
    return handle(message).catch(error => ({ ok: false, error: error.message }));
  });
})();
