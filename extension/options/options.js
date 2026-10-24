(() => {
  "use strict";
  const show = document.getElementById("show-toolbar");
  const hide = document.getElementById("hide-native");
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  function render(value) {
    const settings = RichText.normalizeToolbarSettings(value);
    show.checked = settings.showToolbar;
    hide.checked = settings.hideNativeToolbar;
    show.disabled = false;
    hide.disabled = !settings.showToolbar;
  }
  function fail(reason) {
    error.textContent = `Could not save settings: ${reason.message}`;
    error.hidden = false;
  }
  async function save() {
    const toolbarSettings = { showToolbar: show.checked, hideNativeToolbar: hide.checked };
    show.disabled = hide.disabled = true;
    error.hidden = true;
    try {
      await browser.storage.local.set({ toolbarSettings });
      render(toolbarSettings);
      status.textContent = "Settings saved.";
    } catch (reason) {
      fail(reason);
      show.disabled = false;
      hide.disabled = !show.checked;
    }
  }
  show.addEventListener("change", save);
  hide.addEventListener("change", save);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.toolbarSettings) render(changes.toolbarSettings.newValue);
  });
  browser.storage.local.get("toolbarSettings").then(({ toolbarSettings }) => {
    render(toolbarSettings);
    status.textContent = "Changes are saved automatically.";
  }).catch(reason => {
    error.textContent = `Could not load settings: ${reason.message}`;
    error.hidden = false;
    status.textContent = "Reopen this page to try again.";
  });
})();
