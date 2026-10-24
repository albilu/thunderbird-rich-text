(() => {
  "use strict";
  const { CHANNEL, FONTS, SIZES, BLOCKS, COLORS, HIGHLIGHTS, EMOJI, normalizeCommand, normalizeColor } = RichText;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const icons = {
    undo: "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12", redo: "m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12",
    selection: "M5 3H3v5m16-5h2v5M3 16v5h5m13-5v5h-5M8 8h8M12 8v8m-3 0h6",
    type: "M4 5h16M12 5v15m-4 0h8M4 5v3m16-3v3", plus: "M12 5v14M5 12h14",
    clear: "m13 4 7 7-9 9H6l-4-4L13 4ZM8 10l7 7m1 3h6",
    left: "M4 5h16M4 10h10M4 15h16M4 20h10", center: "M4 5h16M7 10h10M4 15h16M7 20h10",
    right: "M4 5h16M10 10h10M4 15h16M10 20h10", justify: "M4 5h16M4 10h16M4 15h16M4 20h16",
    bullets: "M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1",
    numbers: "M10 6h11M10 12h11M10 18h11M3 3h1v5M2 8h4M2 13c0-3 4-3 4 0 0 2-4 3-4 6h4",
    indent: "M3 4h18M3 20h18M12 9h9M12 15h9m-18-6 4 3-4 3", outdent: "M3 4h18M3 20h18M12 9h9M12 15h9m-5-6-4 3 4 3",
    search: "M20 20l-5-5m2-6a6 6 0 1 1-12 0 6 6 0 0 1 12 0", rule: "M3 12h18", check: "m5 12 4 4L19 6"
  };
  let tabId = null;
  let state = null;
  let isPlainText = false;
  let busy = false;
  let target = "hiliteColor";
  let recentEmoji = [];
  const customColors = { foreColor: "#1f2937", hiliteColor: "#fef08a" };

  for (const element of $$("[data-icon]")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", icons[element.dataset.icon]);
    svg.append(path);
    element.append(svg);
  }

  for (const [id, items] of [["#font", FONTS], ["#size", SIZES], ["#block", BLOCKS]]) {
    for (const [value, label] of items) {
      const option = new Option(label, value);
      if (id === "#font") option.style.fontFamily = value;
      $(id).add(option);
    }
  }

  function setError(message) {
    $("#error").textContent = message || "";
    $("#error").hidden = !message;
  }

  async function request(action, extra = {}) {
    if (!globalThis.browser?.runtime) throw new Error("Install this add-on in Thunderbird, then open Rich Text from a compose window.");
    const response = await browser.runtime.sendMessage({ channel: CHANNEL, action, tabId, ...extra });
    if (!response?.ok) throw new Error(response?.error || "Could not reach the message editor. Close and reopen Rich Text.");
    return response;
  }

  function updateControls() {
    $("#tools").disabled = busy || !state;
    $("[data-command='undo']").disabled = busy || !state?.canUndo;
    $("[data-command='redo']").disabled = busy || !state?.canRedo;
    $("[data-command='unlink']").disabled = !state?.link && state?.collapsed !== false;
    $("[data-command='removeFormat']").disabled = state?.collapsed !== false;
  }

  function renderState(response, fillLink = false) {
    tabId = response.tabId;
    isPlainText = response.isPlainText;
    state = response.state;
    $("#selection-label").textContent = state.collapsed ? "AT YOUR CURSOR" : `${state.selectionLength.toLocaleString()} CHARACTERS SELECTED`;
    $("#selection-preview").textContent = state.collapsed ? "Ready for your next thought." : state.selectedText.replace(/\s+/g, " ");
    $("#mode").textContent = isPlainText ? "PLAIN TEXT" : "HTML";
    $("#notice").hidden = !isPlainText;
    $("#format-tab").disabled = isPlainText;
    $("#link-section").hidden = isPlainText;
    $("#insert-rule").hidden = isPlainText;
    if (isPlainText) switchTab("insert");
    for (const button of $$("button[data-command][aria-pressed]")) {
      button.setAttribute("aria-pressed", String(Boolean(state.states[button.dataset.command])));
    }
    for (const select of $$("select[data-command]")) {
      let value = String(state.values[select.dataset.command] || "").replace(/[<>"']/g, "");
      if (select.id === "block") value = value.toLowerCase();
      const option = [...select.options].find(item => item.value.toLowerCase() === value.toLowerCase());
      select.value = option?.value || "";
    }
    if (fillLink) {
      $("#link-url").value = state.link?.url || "";
      $("#link-text").value = state.link?.text || state.selectedText;
    }
    renderPalette();
    updateControls();
  }

  async function command(name, value, label) {
    if (busy || !state) return false;
    try {
      const normalized = normalizeCommand(name, value);
      busy = true;
      updateControls();
      setError("");
      const response = await request("command", normalized);
      renderState(response, name === "link" || name === "unlink");
      $("#status").textContent = label || "Applied to your message.";
      return true;
    } catch (error) {
      setError(error.message);
      $("#status").textContent = "Your message is still in Thunderbird.";
      return false;
    } finally {
      busy = false;
      updateControls();
    }
  }

  function switchTab(name, focus = false) {
    for (const candidate of ["format", "insert"]) {
      const active = name === candidate;
      $(`#${candidate}-tab`).setAttribute("aria-selected", String(active));
      $(`#${candidate}-tab`).tabIndex = active ? 0 : -1;
      $(`#${candidate}-panel`).hidden = !active;
    }
    if (focus) $(`#${name}-tab`).focus();
  }

  for (const tab of $$("[role='tab']")) {
    tab.addEventListener("click", () => switchTab(tab.id.split("-")[0]));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || isPlainText) return;
      event.preventDefault();
      switchTab(event.key === "Home" ? "format" : event.key === "End" ? "insert" : tab.id === "format-tab" ? "insert" : "format", true);
    });
  }
  for (const button of $$("button[data-command]")) {
    button.addEventListener("click", () => command(button.dataset.command, undefined, `${button.title || button.textContent.trim()} applied.`));
  }
  for (const select of $$("select[data-command]")) {
    select.addEventListener("change", () => { if (select.value) command(select.dataset.command, select.value); });
  }

  function colorHex(value) {
    if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
    const match = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value);
    return match ? `#${match.slice(1).map(part => Number(part).toString(16).padStart(2, "0")).join("")}` : "";
  }

  function renderPalette() {
    const palette = $("#palette");
    palette.replaceChildren();
    palette.setAttribute("aria-label", `${target === "foreColor" ? "Text" : "Highlight"} colors`);
    for (const [color, name] of target === "foreColor" ? COLORS : HIGHLIGHTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.setProperty("--swatch", color);
      button.title = `${name} (${color})`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(colorHex(state?.values[target] || "") === color));
      button.addEventListener("click", () => applyColor(color));
      palette.append(button);
    }
  }

  function setColorInputs(color) {
    $("#color-picker").value = color;
    $("#color-hex").value = color;
  }

  async function savePreferences() {
    try { await browser.storage.local.set({ recentEmoji, customColors }); } catch {
      $("#status").textContent = "Applied. Could not save palette preferences.";
    }
  }

  async function applyColor(color) {
    const appliedTarget = target;
    if (await command(appliedTarget, color, color === "transparent" ? "Background cleared." : "Color applied to your message.")) {
      if (color !== "transparent") {
        customColors[appliedTarget] = color;
        if (target === appliedTarget) setColorInputs(color);
        await savePreferences();
      }
    }
  }

  for (const button of $$("[data-color-target]")) {
    button.addEventListener("click", () => {
      target = button.dataset.colorTarget;
      for (const item of $$("[data-color-target]")) item.setAttribute("aria-pressed", String(item === button));
      $("#clear-color").hidden = target === "foreColor";
      $("#clear-color").textContent = "Clear highlight";
      setColorInputs(customColors[target]);
      renderPalette();
    });
  }
  $("#color-picker").addEventListener("input", event => { $("#color-hex").value = event.target.value; });
  $("#color-hex").addEventListener("input", event => {
    if (/^#[\da-f]{6}$/i.test(event.target.value)) $("#color-picker").value = event.target.value;
  });
  $("#color-form").addEventListener("submit", event => { event.preventDefault(); applyColor($("#color-hex").value); });
  $("#clear-color").addEventListener("click", () => applyColor("transparent"));
  $("#link-form").addEventListener("submit", event => {
    event.preventDefault();
    command("link", { url: $("#link-url").value, text: $("#link-text").value }, "Link applied to your message.");
  });

  function emojiButton([emoji, name]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-button";
    button.textContent = emoji;
    button.title = name;
    button.setAttribute("aria-label", `Insert ${name}`);
    button.addEventListener("click", async () => {
      if (await command("insertText", emoji, `${emoji} inserted into your message.`)) {
        recentEmoji = [emoji, ...recentEmoji.filter(item => item !== emoji)].slice(0, 12);
        renderRecent();
        await savePreferences();
      }
    });
    return button;
  }
  function renderRecent() {
    const matches = recentEmoji.map(emoji => EMOJI.find(([value]) => value === emoji)).filter(Boolean);
    $("#recent-emoji").replaceChildren(...matches.map(emojiButton));
    $("#recent-section").hidden = !matches.length || Boolean($("#emoji-search").value.trim());
  }
  function renderEmoji() {
    const search = $("#emoji-search").value.trim().toLowerCase();
    const matches = EMOJI.filter(([emoji, name]) => `${emoji} ${name}`.includes(search));
    $("#emoji-grid").replaceChildren(...matches.map(emojiButton));
    $("#no-emoji").hidden = matches.length > 0;
    renderRecent();
  }
  $("#emoji-search").addEventListener("input", renderEmoji);
  $("#done").addEventListener("click", () => window.close());
  document.addEventListener("keydown", event => { if (event.key === "Escape") window.close(); });

  async function connect() {
    busy = true;
    state = null;
    updateControls();
    setError("");
    $("#retry").hidden = true;
    try {
      renderState(await request("connect"), true);
      $("#status").textContent = "Edits stay in your message.";
    } catch (error) {
      setError(error.message);
      $("#selection-preview").textContent = "Open a message to start formatting.";
      $("#retry").hidden = false;
    } finally {
      busy = false;
      updateControls();
    }
  }
  $("#retry").addEventListener("click", connect);
  renderEmoji();
  renderPalette();
  if (globalThis.browser?.storage) {
    browser.storage.local.get(["recentEmoji", "customColors"]).then(prefs => {
      recentEmoji = Array.isArray(prefs.recentEmoji) ? prefs.recentEmoji.filter(value => EMOJI.some(([emoji]) => emoji === value)).slice(0, 12) : [];
      for (const key of Object.keys(customColors)) {
        try { customColors[key] = normalizeColor(prefs.customColors?.[key]); } catch { /* Keep the default. */ }
      }
      setColorInputs(customColors[target]);
      renderRecent();
    }).catch(() => { /* Preferences are optional; composing still works. */ });
  }
  connect();
})();
