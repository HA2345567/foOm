import { DEFAULT_LOCALE, LOCALES, type I18nNamespace, type Locale } from "./config";
import { en } from "./locales/en";

type TranslateVars = Record<string, string | number>;
type Catalog = Record<I18nNamespace, Record<string, string>>;

const CATALOGS: Record<Locale, Catalog> = {
  en,
};

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
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
  namespace: I18nNamespace,
  key: string,
  vars?: TranslateVars,
): string {
  const defaultValue = typeof vars?.defaultValue === "string" ? vars.defaultValue : undefined;
  let value = CATALOGS[locale]?.[namespace]?.[key] ?? defaultValue ?? humanizeKey(key);

  for (const [name, replacement] of Object.entries(vars ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }

  return value;
}
