(() => {
  "use strict";
  const { CHANNEL, SIZES, BLOCKS, normalizeCommand,
    normalizeColor, isPlainTextCommand } = RichText;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const tabId = Number(new URL(location.href).searchParams.get("tabId"));
  let context;
  let busy = false;
  let dropdown = null;
  let lastHeight = 0;
  let resizePending = false;
  const customColors = { foreColor: "#1f2937", hiliteColor: "#fef08a" };
  const icons = {
    undo: "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12", redo: "m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12",
    left: "M4 5h16M4 10h10M4 15h16M4 20h10", center: "M4 5h16M7 10h10M4 15h16M7 20h10",
    right: "M4 5h16M10 10h10M4 15h16M10 20h10", justify: "M4 5h16M4 10h16M4 15h16M4 20h16",
    spacing: "M11 5h10M11 12h10M11 19h10M5 3v18m-3-3 3 3 3-3M2 6l3-3 3 3",
    "space-increase": "M4 3h16M4 7h16M4 17h16M4 21h16m-5-11 3-3 3 3m-3-3v10m-3-3 3 3 3-3",
    "space-decrease": "M4 3h16M4 7h16M4 17h16M4 21h16m-5-13 3 3 3-3m-3-4v7m-3 4 3-3 3 3m-3 4v-7",
    chevron: "m6 9 6 6 6-6",
    bullets: "M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1",
    numbers: "M10 6h11M10 12h11M10 18h11M3 3h1v5M2 8h4M2 13c0-3 4-3 4 0 0 2-4 3-4 6h4",
    indent: "M3 4h18M3 20h18M12 9h9M12 15h9m-18-6 4 3-4 3", outdent: "M3 4h18M3 20h18M12 9h9M12 15h9m-5-6-4 3 4 3",
    clear: "m13 4 7 7-9 9H6l-4-4L13 4ZM8 10l7 7m1 3h6", rule: "M3 12h18",
    marker: "m5 15 9-11 6 5-9 11H6l-1-5Zm1-1 6 5M3 22h7",
    link: "m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2m-3 5-2 2a5 5 0 0 1-7-7l2-2",
    smile: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.1M16 9h.1M7 14c2 4 8 4 10 0",
    close: "m6 6 12 12M6 18 18 6"
  };
  for (const element of $$("[data-icon]")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", icons[element.dataset.icon]);
    svg.append(path);
    element.append(svg);
  }
  for (const size of SIZES) $("#font-sizes").append(new Option(`${size} pt`, String(size)));
  function closeDropdown() {
    if (dropdown) browser.composeToolbar.closeDropdown(tabId).catch(() => {});
    dropdown = null;
    for (const button of $$("[data-menu]")) button.setAttribute("aria-expanded", "false");
  }
  for (const button of $$("[data-menu]")) button.addEventListener("click", async () => {
    const kind = button.dataset.menu;
    if (dropdown === kind) { closeDropdown(); return; }
    closeDropdown();
    dropdown = kind;
    button.setAttribute("aria-expanded", "true");
    const rect = button.getBoundingClientRect();
    try {
      await browser.composeToolbar.openDropdown(tabId, kind, { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height });
    } catch (error) { closeDropdown(); setError(error.message); }
  });
  browser.composeToolbar.onDropdownClosed.addListener((closedTab, kind) => {
    if (closedTab !== tabId || dropdown !== kind) return;
    dropdown = null;
    for (const button of $$("[data-menu]")) button.setAttribute("aria-expanded", "false");
    request("state").then(render).catch(() => {});
  });

  function resize() {
    if (!context || resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      const height = Math.max(36, Math.min(360, Math.ceil(document.body.getBoundingClientRect().height)));
      if (height === lastHeight) return;
      lastHeight = height;
      browser.composeToolbar.setHeight(tabId, height).catch(() => { /* Host removed or window closed. */ });
    });
  }
  new ResizeObserver(resize).observe(document.body);
  function setError(message = "") {
    $("#error").textContent = message;
    $("#error").hidden = !message;
    resize();
  }
  function enableControls() {
    for (const item of $$("[data-command]")) {
      const command = item.dataset.command;
      item.disabled = busy || !context || (context.isPlainText && !isPlainTextCommand(command));
      if (command === "undo") item.disabled ||= !context?.state.canUndo;
      if (command === "redo") item.disabled ||= !context?.state.canRedo;
      if (command === "removeFormat") item.disabled ||= context?.state.collapsed;
      if (command === "unlink") item.disabled ||= !context?.state.link && context?.state.collapsed;
      if (command === "paragraphSpacingDecrease") item.disabled ||= context?.state.values.canDecreaseParagraphSpacing === false;
      if (command === "paragraphSpacingIncrease") item.disabled ||= context?.state.values.canIncreaseParagraphSpacing === false;
    }
    for (const item of $$("[data-menu]")) item.disabled = busy || !context || (context.isPlainText && item.dataset.menu !== "emoji");
  }
  function render(response, force = false) {
    context = response;
    $("#mode").hidden = !context.isPlainText;
    for (const button of $$("[data-command][aria-pressed]")) {
      button.setAttribute("aria-pressed", String(Boolean(context.state.states[button.dataset.command])));
    }
    for (const input of $$("input[data-command]")) {
      if (!force && document.activeElement === input) continue;
      const value = context.state.values[input.dataset.command] ?? "";
      input.value = value;
    }
    const font = String(context.state.values.fontName || "").replace(/^["']|["']$/g, "");
    $("#font").textContent = font || "Font family";
    $("#font-toggle").setAttribute("aria-label", font ? `Font family: ${font}` : "Font family");
    const block = String(context.state.values.formatBlock || "").replace(/[<>]/g, "").toLowerCase();
    const style = BLOCKS.find(([value]) => value === block)?.[1] || "Style";
    $("#block").textContent = style;
    $("#style-toggle").setAttribute("aria-label", `Paragraph style: ${style}`);
    enableControls();
    resize();
  }
  async function request(action, extra = {}) {
    const result = await browser.runtime.sendMessage({ channel: CHANNEL, action, tabId, ...extra });
    if (!result?.ok) throw new Error(result?.error || "The message editor is not ready. Try reconnecting.");
    return result;
  }
  async function focusEditor() {
    try { await browser.composeToolbar.focusEditor(tabId); } catch { /* Compose window closed. */ }
  }
  async function command(name, value) {
    if (busy || !context) return false;
    try {
      const normalized = normalizeCommand(name, value);
      busy = true;
      enableControls();
      setError();
      render(await request("command", normalized), true);
      $("#status").textContent = "Applied to your message.";
      closeDropdown();
      await focusEditor();
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    } finally {
      busy = false;
      enableControls();
    }
  }
  for (const button of $$("button[data-command]")) button.addEventListener("click", () => command(button.dataset.command));
  for (const input of $$("input[data-command]")) {
    const apply = () => { if (input.value && input.reportValidity()) command(input.dataset.command, input.value); };
    input.addEventListener("change", apply);
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); apply(); } });
  }

  function colorInputs() {
    $("#text-color-line").style.backgroundColor = customColors.foreColor;
    $("#highlight-line").style.backgroundColor = customColors.hiliteColor;
  }
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (dropdown) { const anchor = $$("[data-menu]").find(button => button.dataset.menu === dropdown); closeDropdown(); anchor?.focus(); }
      else focusEditor();
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !event.target.matches("#strip button")) return;
    const buttons = $$("#strip button:not(:disabled)");
    const index = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus();
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === browser.runtime.id && message?.channel === CHANNEL && message.action === "toolbarState" && message.tabId === tabId && context && !busy) {
      render({ ...context, state: message.state });
    }
  });
  function preferences(values) {
    for (const key of Object.keys(customColors)) {
      try { customColors[key] = normalizeColor(values.customColors?.[key]); } catch { /* Keep the existing color. */ }
    }
    colorInputs();
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local") preferences(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])));
  });
  browser.storage.local.get("customColors").then(preferences).catch(() => {});
  async function connect() {
    setError(); $("#retry").hidden = true;
    try { render(await request("connect"), true); $("#status").textContent = "Rich Text toolbar ready."; }
    catch (error) { setError(error.message); $("#retry").hidden = false; }
  }
  $("#retry").addEventListener("click", connect);
  connect();
})();
