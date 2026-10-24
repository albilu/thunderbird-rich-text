/* Only this trusted extension page talks to the compose and tabs APIs. */
(() => {
  "use strict";
  const api = browser;
  const { CHANNEL, normalizeCommand, isPlainTextCommand } = RichText;
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

  async function handle(message) {
    await ready;
    let tabId = message.tabId;
    if (message.action === "connect") {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      tabId = tabs.find(tab => tab.type === "messageCompose")?.id;
    }
    if (!Number.isInteger(tabId)) throw new Error("Open Rich Text from a message compose window.");
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
      request = { channel: CHANNEL, action: "command", ...normalized };
    } else if (!["connect", "state"].includes(message.action)) {
      throw new Error("Unknown Rich Text request.");
    }
    const response = await api.tabs.sendMessage(tabId, request);
    if (!response?.ok) throw new Error(response?.error || "The message editor is not ready. Try opening Rich Text again.");
    return { ...response, tabId, isPlainText };
  }

  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.channel !== CHANNEL || sender.id !== api.runtime.id ||
        !sender.url?.startsWith(api.runtime.getURL("popup/"))) return undefined;
    return handle(message).catch(error => ({ ok: false, error: error.message }));
  });
})();
