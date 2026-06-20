import { DEFAULT_LOCALE, LOCALES, type I18nNamespace, type Locale } from "./config";

type TranslateVars = Record<string, string | number>;

const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "Chinese",
};

function humanizeKey(key: string): string {
  const lastSegment = key.split(".").pop() || key;
  return lastSegment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getAvailableLocales(): Locale[] {
  return [...LOCALES];
}

export function getLocaleName(locale: Locale): string {
  return LOCALE_NAMES[locale] ?? locale;
}

export function translate(
  locale: Locale = DEFAULT_LOCALE,
  _namespace: I18nNamespace,
  key: string,
  vars?: TranslateVars,
): string {
  let value = humanizeKey(key);

  for (const [name, replacement] of Object.entries(vars ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }

  return locale === DEFAULT_LOCALE ? value : value;
}
