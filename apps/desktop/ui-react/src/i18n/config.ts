export const LOCALE_STORAGE_KEY = "foom-locale";
export const DEFAULT_LOCALE = "en";

export const LOCALES = ["en"] as const;

export type Locale = (typeof LOCALES)[number];

export type I18nNamespace =
  | "common"
  | "dialogs"
  | "editor"
  | "export"
  | "launch"
  | "settings"
  | "shortcuts"
  | "timeline";
