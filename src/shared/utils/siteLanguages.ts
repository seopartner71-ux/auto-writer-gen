// Supported languages for Site Factory projects.
// Used both in UI (language picker) and on the server (prompts, locales).

export type SiteLanguageCode =
  | "ru" | "en" | "de" | "es" | "fr" | "it" | "pl" | "uk" | "tr" | "pt";

export interface SiteLanguageMeta {
  code: SiteLanguageCode;
  name: string;        // Native UI label, e.g. "Русский"
  englishName: string; // For AI prompts
  iso: string;         // 2-3 char ISO label shown instead of emoji flags (Windows-friendly)
  geo: string;         // Default GEO code (RU, US, DE, ES, FR, IT, PL, UA, TR, BR)
  htmlLocale: string;  // BCP 47 locale, e.g. "ru-RU"
}

export const SITE_LANGUAGES: SiteLanguageMeta[] = [
  { code: "ru", name: "Русский",     englishName: "Russian",    iso: "RU", geo: "RU", htmlLocale: "ru-RU" },
  { code: "en", name: "English",     englishName: "English",    iso: "EN", geo: "US", htmlLocale: "en-US" },
  { code: "de", name: "Deutsch",     englishName: "German",     iso: "DE", geo: "DE", htmlLocale: "de-DE" },
  { code: "es", name: "Español",     englishName: "Spanish",    iso: "ES", geo: "ES", htmlLocale: "es-ES" },
  { code: "fr", name: "Français",    englishName: "French",     iso: "FR", geo: "FR", htmlLocale: "fr-FR" },
  { code: "it", name: "Italiano",    englishName: "Italian",    iso: "IT", geo: "IT", htmlLocale: "it-IT" },
  { code: "pl", name: "Polski",      englishName: "Polish",     iso: "PL", geo: "PL", htmlLocale: "pl-PL" },
  { code: "uk", name: "Українська",  englishName: "Ukrainian",  iso: "UA", geo: "UA", htmlLocale: "uk-UA" },
  { code: "tr", name: "Türkçe",      englishName: "Turkish",    iso: "TR", geo: "TR", htmlLocale: "tr-TR" },
  { code: "pt", name: "Português",   englishName: "Portuguese", iso: "PT", geo: "BR", htmlLocale: "pt-BR" },
];

const LANG_MAP: Record<string, SiteLanguageMeta> = Object.fromEntries(
  SITE_LANGUAGES.map((l) => [l.code, l]),
);

export function normalizeSiteLanguage(input: unknown): SiteLanguageCode {
  const raw = String(input || "ru").trim().toLowerCase().slice(0, 2);
  return (LANG_MAP[raw]?.code) || "ru";
}

export function getSiteLanguageMeta(code: unknown): SiteLanguageMeta {
  const c = normalizeSiteLanguage(code);
  return LANG_MAP[c];
}