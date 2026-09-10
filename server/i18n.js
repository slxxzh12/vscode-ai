import { translate, normalizeLocale, DEFAULT_LOCALE } from '@devflow/shared/i18n';

let currentLocale = DEFAULT_LOCALE;

export function setLocale(x) {
  currentLocale = normalizeLocale(x);
  return currentLocale;
}
export function getLocale() { return currentLocale; }
export function t(key, params) { return translate(currentLocale, key, params); }
