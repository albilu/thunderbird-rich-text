import { readFile } from 'node:fs/promises';

export const catalogs = Object.fromEntries(await Promise.all(['en', 'fr'].map(async locale =>
  [locale, JSON.parse(await readFile(new URL(`../../extension/_locales/${locale}/messages.json`, import.meta.url), 'utf8'))]
)));

// A small browser.i18n double for unit tests. Native tests exercise Thunderbird's
// actual locale negotiation, manifest localization, and placeholder handling.
export function translator(locale = 'en') {
  const catalog = catalogs[locale.split('-')[0]] || catalogs.en;
  return (key, substitutions = []) => {
    const entry = catalog[key] || catalogs.en[key];
    if (!entry) return '';
    const args = Array.isArray(substitutions) ? substitutions : [substitutions];
    return entry.message.replace(/\$([A-Z]+)\$/g, (_, name) =>
      entry.placeholders[name.toLowerCase()].content.replace(/\$(\d+)/g, (_, index) => args[Number(index) - 1] ?? ''));
  };
}
