(() => {
  "use strict";
  const { CHANNEL, FONTS, BLOCKS, COLORS, HIGHLIGHTS, EMOJI, normalizeCommand, normalizeColor } = RichText;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const params = new URL(location.href).searchParams;
  const tabId = Number(params.get("tabId"));
  const kind = params.get("kind");
  const panels = {
    font: ["#font-dropdown", "Font family"], style: ["#style-menu", "Paragraph style"],
    "line-spacing": ["#line-spacing-menu", "Line spacing"], "text-color": ["#color-menu", "Text color"],
    "background-color": ["#color-menu", "Highlight / text background"], link: ["#link-menu", "Insert or edit a link"],
    emoji: ["#emoji-menu", "Insert emoji"]
  };
  const colorTarget = kind === "text-color" ? "foreColor" : "hiliteColor";
  const customColors = { foreColor: "#1f2937", hiliteColor: "#fef08a" };
  let context;
  let busy = false;
  let fonts = [...FONTS];
  let matches = [];
  let index = -1;

  function setError(message = "") {
    $("#error").textContent = message;
    $("#error").hidden = !message;
  }
  function enableControls() {
    for (const control of $$("button, input, select")) control.disabled = busy || !context || (context.isPlainText && kind !== "emoji");
    $("#line-spacing").disabled ||= $("#line-spacing-mode").value !== "proportional";
    $("[data-command=unlink]").disabled ||= !context?.state.link && context?.state.collapsed;
  }
  async function request(action, extra = {}) {
    const response = await browser.runtime.sendMessage({ channel: CHANNEL, action, tabId, ...extra });
    if (!response?.ok) throw new Error(response?.error || "The message editor is no longer available.");
    return response;
  }
  async function command(name, value) {
    if (busy || !context) return;
    busy = true;
    enableControls();
    setError();
    try {
      await request("command", normalizeCommand(name, value));
      // Persist preferences before closing destroys this popup's script context.
      try {
        if (["foreColor", "hiliteColor"].includes(name) && value !== "transparent") {
          customColors[name] = value;
          await browser.storage.local.set({ customColors });
        } else if (name === "insertText") {
          const { recentEmoji = [] } = await browser.storage.local.get("recentEmoji");
          await browser.storage.local.set({ recentEmoji: [value, ...(Array.isArray(recentEmoji) ? recentEmoji : []).filter(item => item !== value)].slice(0, 12) });
        }
      } catch { /* Formatting succeeded; preference storage is best-effort. */ }
      // Closing destroys this page. Return focus in the same native operation.
      await browser.composeToolbar.closeDropdown(tabId, true);
    } catch (error) {
      setError(error.message);
      busy = false;
      enableControls();
    }
  }
  function currentFont() {
    return String(context?.state.values.fontName || "").replace(/^["']|["']$/g, "");
  }
  function activateFont(next) {
    index = Math.max(0, Math.min(next, matches.length - 1));
    const options = $$("#font-list [role=option]");
    options.forEach((option, i) => option.classList.toggle("active", i === index));
    if (options[index]) {
      $("#font-search").setAttribute("aria-activedescendant", options[index].id);
      const list = $("#font-list"), option = options[index];
      const top = option.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + option.offsetHeight - list.clientHeight;
    } else $("#font-search").removeAttribute("aria-activedescendant");
  }
  function drawFonts(search = "") {
    matches = fonts.filter(font => font.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    $("#font-list").replaceChildren(...matches.map((font, i) => {
      const option = document.createElement("div");
      option.id = `font-option-${i}`;
      option.className = "font-option";
      option.dataset.font = font;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(font.toLowerCase() === currentFont().toLowerCase()));
      option.textContent = font;
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", () => command("fontName", font));
      return option;
    }));
    $("#font-count").textContent = `${matches.length} fonts`;
    $("#no-fonts").hidden = matches.length > 0;
    activateFont(search ? 0 : Math.max(0, matches.findIndex(font => font.toLowerCase() === currentFont().toLowerCase())));
  }
  $("#font-search").addEventListener("input", event => drawFonts(event.target.value));
  $("#font-search").addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault();
      activateFont(index + ({ ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 })[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const value = matches.length ? matches[index] : $("#font-search").value;
      if (value) command("fontName", value);
    }
  });
  function renderLineSpacing() {
    const value = context.state.values.lineSpacing;
    const number = value === "normal" ? 1 : Number(value);
    for (const button of $$("[data-line-spacing]")) button.setAttribute("aria-pressed", String(value !== "" && Number(button.dataset.lineSpacing) === number));
    $("#line-spacing-mode").value = [1, 1.15, 1.5, 2].includes(number) ? String(number) : "proportional";
    $("#line-spacing").value = number > 0 ? Math.round(number * 100) : "";
  }
  for (const button of $$("[data-line-spacing]")) button.addEventListener("click", () => command("lineSpacing", button.dataset.lineSpacing));
  $("#line-spacing-mode").addEventListener("change", () => {
    enableControls();
    if ($("#line-spacing-mode").value === "proportional") { $("#line-spacing").focus(); $("#line-spacing").select(); }
  });
  $("#line-spacing-form").addEventListener("submit", event => {
    event.preventDefault();
    command("lineSpacing", $("#line-spacing-mode").value === "proportional" ? Number($("#line-spacing").value) / 100 : $("#line-spacing-mode").value);
  });
  function renderStyles() {
    const current = String(context.state.values.formatBlock || "").replace(/[<>]/g, "").toLowerCase();
    $("#style-list").replaceChildren(...BLOCKS.map(([value, label]) => {
      const button = document.createElement("button");
      button.className = "style-option";
      button.dataset.block = value;
      button.setAttribute("aria-pressed", String(value === current));
      const preview = document.createElement("span");
      preview.className = `style-preview style-${value}`;
      preview.textContent = label;
      const check = document.createElement("span");
      check.className = "style-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      button.append(preview, check);
      button.addEventListener("click", () => command("formatBlock", value));
      return button;
    }));
  }
  async function renderColors() {
    const saved = await browser.storage.local.get("customColors").catch(() => ({}));
    for (const key of Object.keys(customColors)) {
      try { customColors[key] = normalizeColor(saved.customColors?.[key]); } catch { /* Keep the default. */ }
    }
    $("#color-title").textContent = panels[kind][1];
    $("#palette").replaceChildren(...(colorTarget === "foreColor" ? COLORS : HIGHLIGHTS).map(([value, label]) => {
      const button = document.createElement("button");
      button.className = "swatch";
      button.style.setProperty("--swatch", value);
      button.title = `${label} (${value})`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () => command(colorTarget, value));
      return button;
    }));
    $("#color-picker").value = $("#color-hex").value = customColors[colorTarget];
    $("#clear-highlight").hidden = colorTarget === "foreColor";
  }
  $("#color-picker").addEventListener("input", event => { $("#color-hex").value = event.target.value; });
  $("#color-hex").addEventListener("input", event => {
    if (/^#[\da-f]{6}$/i.test(event.target.value)) $("#color-picker").value = event.target.value;
  });
  $("#color-form").addEventListener("submit", event => { event.preventDefault(); command(colorTarget, $("#color-hex").value); });
  $("#clear-highlight").addEventListener("click", () => command("hiliteColor", "transparent"));
  $("#link-form").addEventListener("submit", event => {
    event.preventDefault(); command("link", { url: $("#link-url").value, text: $("#link-text").value });
  });
  $("[data-command=unlink]").addEventListener("click", () => command("unlink"));
  function renderEmoji() {
    const search = $("#emoji-search").value.trim().toLowerCase();
    const matches = EMOJI.filter(([value, label]) => `${value} ${label}`.includes(search));
    $("#emoji-grid").replaceChildren(...matches.map(([value, label]) => {
      const button = document.createElement("button");
      button.className = "emoji";
      button.textContent = value;
      button.title = label;
      button.setAttribute("aria-label", `Insert ${label}`);
      button.addEventListener("click", () => command("insertText", value));
      return button;
    }));
    $("#no-emoji").hidden = matches.length > 0;
    enableControls();
  }
  $("#emoji-search").addEventListener("input", renderEmoji);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      browser.composeToolbar.closeDropdown(tabId).catch(() => {});
    }
    const styles = event.target.matches("[data-block]");
    if (!(styles ? ["ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"]).includes(event.key) || (!styles && !event.target.matches("[data-line-spacing]"))) return;
    const buttons = $$(styles ? "[data-block]" : "[data-line-spacing]");
    const current = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus();
  });

  async function connect() {
    try {
      if (!Object.hasOwn(panels, kind)) throw new Error("Unknown formatting dropdown.");
      document.body.dataset.kind = kind;
      $(panels[kind][0]).hidden = false;
      document.title = panels[kind][1];
      context = await request("state");
      let focus;
      if (kind === "font") {
        try { fonts = [...new Set([...FONTS, ...await browser.composeToolbar.getFonts()])]; }
        catch { $("#font-search").placeholder = "Enter a font family…"; }
        $("#font-search").value = currentFont();
        drawFonts();
        focus = $("#font-search");
      } else if (kind === "line-spacing") {
        renderLineSpacing();
        focus = $("#line-presets [aria-pressed=true]") || $("#line-presets button");
      } else if (kind === "style") {
        renderStyles();
        focus = $("#style-list [aria-pressed=true]") || $("#style-list button");
      } else if (kind.endsWith("color")) {
        await renderColors();
        focus = $("#palette button");
      } else if (kind === "link") {
        $("#link-url").value = context.state.link?.url || "";
        $("#link-text").value = context.state.link?.text || context.state.selectedText;
        focus = $("#link-url");
      } else if (kind === "emoji") {
        renderEmoji();
        focus = $("#emoji-search");
      }
      enableControls();
      focus?.focus();
      if (kind === "font") focus.select();
      document.body.dataset.ready = "true";
    } catch (error) { setError(error.message); }
  }
  connect();
})();
