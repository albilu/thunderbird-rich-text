(() => {
  "use strict";
  const { CHANNEL, FONTS, SIZES, BLOCKS, COLORS, HIGHLIGHTS, EMOJI, normalizeCommand,
    normalizeColor, isPlainTextCommand } = RichText;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const tabId = Number(new URL(location.href).searchParams.get("tabId"));
  let context;
  let busy = false;
  let tray = null;
  let colorTarget = "hiliteColor";
  let lastHeight = 0;
  let resizePending = false;
  const customColors = { foreColor: "#1f2937", hiliteColor: "#fef08a" };
  const icons = {
    undo: "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12", redo: "m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12",
    left: "M4 5h16M4 10h10M4 15h16M4 20h10", center: "M4 5h16M7 10h10M4 15h16M7 20h10",
    right: "M4 5h16M10 10h10M4 15h16M10 20h10", justify: "M4 5h16M4 10h16M4 15h16M4 20h16",
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
  for (const [id, options] of [["#font", FONTS], ["#size", SIZES], ["#block", BLOCKS]]) {
    for (const [value, label] of options) $(id).add(new Option(label, value));
  }

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
    }
    for (const item of $$("[data-tray]")) {
      item.disabled = busy || !context || (context.isPlainText && item.dataset.tray !== "emoji");
    }
    for (const item of $$(".swatch, .emoji, #color-form button, #link-form button[type='submit']")) item.disabled = busy || !context;
  }
  function render(response, force = false) {
    context = response;
    $("#mode").hidden = !context.isPlainText;
    for (const button of $$("[data-command][aria-pressed]")) {
      button.setAttribute("aria-pressed", String(Boolean(context.state.states[button.dataset.command])));
    }
    for (const select of $$("select[data-command]")) {
      if (!force && document.activeElement === select) continue;
      const value = String(context.state.values[select.dataset.command] || "").replace(/[<>"']/g, "").toLowerCase();
      select.value = [...select.options].find(option => option.value.toLowerCase() === value)?.value || "";
    }
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
  function closeTray(focus = true) {
    tray = null;
    $("#trays").hidden = true;
    for (const button of $$("[data-tray]")) button.setAttribute("aria-expanded", "false");
    if (focus) focusEditor();
    resize();
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
      closeTray(false);
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
  for (const select of $$("select[data-command]")) select.addEventListener("change", () => {
    if (select.value) command(select.dataset.command, select.value);
  });

  function colorInputs() {
    $("#color-picker").value = $("#color-hex").value = customColors[colorTarget];
    $("#text-color-line").style.backgroundColor = customColors.foreColor;
    $("#highlight-line").style.backgroundColor = customColors.hiliteColor;
  }
  async function applyColor(value) {
    const target = colorTarget;
    if (await command(target, value) && value !== "transparent") {
      customColors[target] = value;
      colorInputs();
      try { await browser.storage.local.set({ customColors }); } catch { setError("Color applied, but the color preference could not be saved."); }
    }
  }
  function palette() {
    $("#palette").replaceChildren();
    for (const [color, name] of colorTarget === "foreColor" ? COLORS : HIGHLIGHTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.setProperty("--swatch", color);
      button.title = `${name} (${color})`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () => applyColor(color));
      $("#palette").append(button);
    }
    $("#clear-highlight").hidden = colorTarget === "foreColor";
    colorInputs();
  }
  async function showTray(name, button) {
    if (tray === name && (name !== "color" || colorTarget === button.dataset.color)) { closeTray(); return; }
    tray = name;
    if (name === "color") colorTarget = button.dataset.color;
    for (const section of $$("#trays > section")) section.hidden = section.id !== `${name}-tray`;
    for (const toggle of $$("[data-tray]")) toggle.setAttribute("aria-expanded", String(toggle === button));
    $("#trays").hidden = false;
    $("#tray-title").textContent = { color: colorTarget === "foreColor" ? "Text color" : "Highlight / text background",
      link: "Insert or edit a link", emoji: "A little personality" }[name];
    if (name === "color") palette();
    if (name === "link") {
      try { render(await request("state")); } catch (error) { setError(error.message); return; }
      if (tray !== "link") return;
      $("#link-url").value = context.state.link?.url || "";
      $("#link-text").value = context.state.link?.text || context.state.selectedText;
      $("#link-url").focus();
    }
    if (name === "emoji") $("#emoji-search").focus();
    resize();
  }
  for (const button of $$("[data-tray]")) button.addEventListener("click", () => showTray(button.dataset.tray, button));
  $("#close-tray").addEventListener("click", () => closeTray());
  $("#color-picker").addEventListener("input", event => { $("#color-hex").value = event.target.value; });
  $("#color-hex").addEventListener("input", event => {
    if (/^#[\da-f]{6}$/i.test(event.target.value)) $("#color-picker").value = event.target.value;
  });
  $("#color-form").addEventListener("submit", event => { event.preventDefault(); applyColor($("#color-hex").value); });
  $("#clear-highlight").addEventListener("click", () => applyColor("transparent"));
  $("#link-form").addEventListener("submit", event => {
    event.preventDefault(); command("link", { url: $("#link-url").value, text: $("#link-text").value });
  });
  function emoji() {
    const search = $("#emoji-search").value.trim().toLowerCase();
    const matches = EMOJI.filter(([value, label]) => `${value} ${label}`.includes(search));
    $("#emoji-grid").replaceChildren(...matches.map(([value, label]) => {
      const button = document.createElement("button");
      button.className = "emoji";
      button.textContent = value;
      button.title = label;
      button.setAttribute("aria-label", `Insert ${label}`);
      button.addEventListener("click", async () => {
        if (await command("insertText", value)) {
          try {
            const { recentEmoji = [] } = await browser.storage.local.get("recentEmoji");
            await browser.storage.local.set({ recentEmoji: [value, ...(Array.isArray(recentEmoji) ? recentEmoji : []).filter(item => item !== value)].slice(0, 12) });
          } catch { setError("Emoji inserted, but recent emoji could not be saved."); }
        }
      });
      return button;
    }));
    $("#no-emoji").hidden = matches.length > 0;
    resize();
  }
  $("#emoji-search").addEventListener("input", emoji);
  emoji();
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeTray(); }
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
