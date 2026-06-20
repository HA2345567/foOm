export const LOCALE_STORAGE_KEY = "foom-locale";
export const DEFAULT_LOCALE = "zh-CN";

export const LOCALES = ["zh-CN"] as const;

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
