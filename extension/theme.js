/* Mirror Thunderbird's resolved UI colors; system colors remain the fallback. */
(() => {
  "use strict";
  const tab = new URL(location.href).searchParams.get("tabId");
  const tabId = tab === null ? null : Number(tab);
  const names = ["background", "text", "surface", "surface-text", "field", "field-text",
    "hover", "line", "muted", "accent", "accent-text", "pressed", "error-text"];
  function apply(theme) {
    if (!theme) return;
    for (const name of names) {
      if (typeof theme[name] === "string" && CSS.supports("color", theme[name])) {
        document.documentElement.style.setProperty(`--${name}`, theme[name]);
      }
    }
    if (["light", "dark"].includes(theme.scheme)) document.documentElement.style.colorScheme = theme.scheme;
  }
  function refresh() {
    (tabId === null ? browser.composeToolbar.getTheme() : browser.composeToolbar.getTheme(tabId)).then(apply).catch(() => {});
  }
  browser.composeToolbar.onThemeChanged.addListener((changedTab, theme) => {
    if (tabId === null || changedTab === tabId) apply(theme);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  refresh();
})();
