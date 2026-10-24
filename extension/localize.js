/* Text-only localization for extension pages. Never interpret translations as HTML. */
(() => {
  "use strict";
  document.documentElement.lang = RichText.message("localeCode");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = RichText.message(element.dataset.i18n);
  }
  for (const [marker, attribute] of [["data-i18n-title", "title"], ["data-i18n-label", "aria-label"], ["data-i18n-placeholder", "placeholder"]]) {
    for (const element of document.querySelectorAll(`[${marker}]`)) {
      element.setAttribute(attribute, RichText.message(element.getAttribute(marker)));
    }
  }
})();
