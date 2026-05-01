// Server-side language metadata for Site Factory.
// Mirrors src/shared/utils/siteLanguages.ts (kept in sync manually).

export type SiteLanguageCode =
  | "ru" | "en" | "de" | "es" | "fr" | "it" | "pl" | "uk" | "tr" | "pt";

export interface SiteLangMeta {
  code: SiteLanguageCode;
  englishName: string;
  geo: string;
  htmlLocale: string;
  // Hints used directly inside AI prompts so generated content stays on-locale.
  cityExamples: string;     // e.g. "Berlin, Munich, Hamburg"
  phoneFormat: string;      // e.g. "+49 XXX XXXXXXX"
  nameExamples: string;     // e.g. "Hans Meier, Anna Schmidt"
  domainTld: string;        // for fallback domain composition
}

export const SITE_LANG_META: Record<SiteLanguageCode, SiteLangMeta> = {
  ru: { code: "ru", englishName: "Russian",    geo: "RU", htmlLocale: "ru-RU",
        cityExamples: "Москва, Санкт-Петербург, Екатеринбург, Новосибирск",
        phoneFormat: "+7 (XXX) XXX-XX-XX", nameExamples: "Алексей Смирнов, Мария Иванова, Дмитрий Соколов",
        domainTld: "ru" },
  en: { code: "en", englishName: "English",    geo: "US", htmlLocale: "en-US",
        cityExamples: "New York, London, Chicago, Boston",
        phoneFormat: "+1 (XXX) XXX-XXXX", nameExamples: "John Carter, Sarah Mitchell, David Brooks",
        domainTld: "com" },
  de: { code: "de", englishName: "German",     geo: "DE", htmlLocale: "de-DE",
        cityExamples: "Berlin, München, Hamburg, Köln",
        phoneFormat: "+49 XXX XXXXXXX", nameExamples: "Hans Meier, Anna Schmidt, Lukas Weber",
        domainTld: "de" },
  es: { code: "es", englishName: "Spanish",    geo: "ES", htmlLocale: "es-ES",
        cityExamples: "Madrid, Barcelona, Valencia, Sevilla",
        phoneFormat: "+34 XXX XXX XXX", nameExamples: "Carlos García, María Fernández, Javier López",
        domainTld: "es" },
  fr: { code: "fr", englishName: "French",     geo: "FR", htmlLocale: "fr-FR",
        cityExamples: "Paris, Lyon, Marseille, Bordeaux",
        phoneFormat: "+33 X XX XX XX XX", nameExamples: "Pierre Durand, Sophie Martin, Julien Bernard",
        domainTld: "fr" },
  it: { code: "it", englishName: "Italian",    geo: "IT", htmlLocale: "it-IT",
        cityExamples: "Roma, Milano, Napoli, Torino",
        phoneFormat: "+39 XXX XXX XXXX", nameExamples: "Marco Rossi, Giulia Bianchi, Luca Romano",
        domainTld: "it" },
  pl: { code: "pl", englishName: "Polish",     geo: "PL", htmlLocale: "pl-PL",
        cityExamples: "Warszawa, Kraków, Wrocław, Gdańsk",
        phoneFormat: "+48 XXX XXX XXX", nameExamples: "Piotr Kowalski, Anna Nowak, Tomasz Wiśniewski",
        domainTld: "pl" },
  uk: { code: "uk", englishName: "Ukrainian",  geo: "UA", htmlLocale: "uk-UA",
        cityExamples: "Київ, Львів, Одеса, Харків",
        phoneFormat: "+380 XX XXX XX XX", nameExamples: "Олександр Шевченко, Оксана Коваленко, Андрій Бондаренко",
        domainTld: "ua" },
  tr: { code: "tr", englishName: "Turkish",    geo: "TR", htmlLocale: "tr-TR",
        cityExamples: "İstanbul, Ankara, İzmir, Bursa",
        phoneFormat: "+90 XXX XXX XX XX", nameExamples: "Mehmet Yılmaz, Ayşe Demir, Mustafa Kaya",
        domainTld: "com.tr" },
  pt: { code: "pt", englishName: "Portuguese", geo: "BR", htmlLocale: "pt-BR",
        cityExamples: "São Paulo, Rio de Janeiro, Belo Horizonte, Brasília",
        phoneFormat: "+55 (XX) XXXXX-XXXX", nameExamples: "João Silva, Maria Santos, Pedro Oliveira",
        domainTld: "com.br" },
};

export function normalizeSiteLang(input: unknown): SiteLanguageCode {
  const raw = String(input || "ru").trim().toLowerCase().slice(0, 2);
  return (raw in SITE_LANG_META ? raw : "ru") as SiteLanguageCode;
}

export function getSiteLangMeta(input: unknown): SiteLangMeta {
  return SITE_LANG_META[normalizeSiteLang(input)];
}