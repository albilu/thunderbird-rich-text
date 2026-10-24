/* Runs only in the existing Thunderbird compose body. Never inserts editor UI. */
(() => {
  "use strict";
  if (globalThis.__richTextEditorInstalled) return;
  globalThis.__richTextEditorInstalled = true;
  const { CHANNEL, TOGGLES, normalizeCommand, linkHtml } = RichText;
  let savedRange = null;
  let executing = false;

  function validRange(range) {
    return range && document.body?.contains(range.startContainer) && document.body.contains(range.endContainer);
  }

  function rememberSelection(force = false) {
    if (executing || (!force && !document.hasFocus())) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && validRange(selection.getRangeAt(0))) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (!validRange(savedRange)) {
      if (selection?.rangeCount && validRange(selection.getRangeAt(0))) {
        savedRange = selection.getRangeAt(0).cloneRange();
      } else {
        savedRange = document.createRange();
        savedRange.selectNodeContents(document.body);
        savedRange.collapse(true);
      }
    }
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return selection;
  }

  function query(method, command, fallback) {
    try { return document[method](command); } catch { return fallback; }
  }

  function currentLink() {
    const node = window.getSelection()?.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest("a[href]");
  }

  function getState() {
    const selection = restoreSelection();
    const link = currentLink();
    const states = Object.fromEntries(TOGGLES.map(command => [command, query("queryCommandState", command, false)]));
    const values = Object.fromEntries(["fontName", "fontSize", "formatBlock", "foreColor", "hiliteColor"]
      .map(command => [command, query("queryCommandValue", command, "")]));
    return { states, values, selectedText: selection.toString().slice(0, 2000),
      selectionLength: selection.toString().length, collapsed: selection.isCollapsed,
      link: link ? { url: link.getAttribute("href"), text: link.textContent.slice(0, 2000) } : null,
      canUndo: query("queryCommandEnabled", "undo", false), canRedo: query("queryCommandEnabled", "redo", false) };
  }

  function execute(command, value) {
    ({ command, value } = normalizeCommand(command, value));
    const selection = restoreSelection();
    const wasCss = query("queryCommandState", "styleWithCSS", false);
    executing = true;
    try {
      // Native edit commands preserve Thunderbird's undo stack, unlike rewriting body HTML.
      document.execCommand("styleWithCSS", false, true);
      let applied;
      if (command === "link") {
        const link = currentLink();
        if (selection.isCollapsed && link) {
          const range = document.createRange();
          range.selectNodeContents(link);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (!selection.isCollapsed && (!value.text || value.text === selection.toString())) {
          applied = document.execCommand("createLink", false, value.url);
        } else {
          applied = document.execCommand("insertHTML", false, linkHtml(value.url, value.text));
        }
      } else {
        applied = document.execCommand(command, false, value ?? null);
      }
      if (!applied) throw new Error("This action is unavailable at the current cursor position. Click in the message and try again.");
    } finally {
      document.execCommand("styleWithCSS", false, wasCss);
      executing = false;
      rememberSelection(true);
    }
    return getState();
  }

  document.addEventListener("selectionchange", () => rememberSelection());
  document.addEventListener("input", () => rememberSelection());
  document.addEventListener("mouseup", () => rememberSelection());
  document.addEventListener("keyup", () => rememberSelection());
  window.addEventListener("blur", () => rememberSelection(true));
  rememberSelection(true);

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.channel !== CHANNEL || sender.id !== browser.runtime.id) return undefined;
    try {
      if (message.action === "ping") return Promise.resolve({ ok: true });
      if (message.action === "state") return Promise.resolve({ ok: true, state: getState() });
      if (message.action === "command") return Promise.resolve({ ok: true, state: execute(message.command, message.value) });
    } catch (error) {
      return Promise.resolve({ ok: false, error: error.message });
    }
    return undefined;
  });
})();
