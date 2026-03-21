import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Lang = "ru" | "en";

const translations: Record<string, Record<Lang, string>> = {
  // Sidebar
  "nav.dashboard": { ru: "Дашборд", en: "Dashboard" },
  "nav.keywords": { ru: "Ключевые слова", en: "Keywords" },
  "nav.planBuilder": { ru: "Конструктор плана", en: "Plan Builder" },
  "nav.articles": { ru: "Статьи", en: "Articles" },
  "nav.calendar": { ru: "Календарь", en: "Calendar" },
  "nav.analytics": { ru: "Аналитика", en: "Analytics" },
  "nav.authorProfiles": { ru: "Профили авторов", en: "Author Profiles" },
  "nav.settings": { ru: "Настройки", en: "Settings" },
  "nav.admin": { ru: "Админ-панель", en: "Admin Panel" },
  "nav.main": { ru: "Основное", en: "Main" },
  "nav.tools": { ru: "Инструменты", en: "Tools" },
  "nav.administration": { ru: "Администрирование", en: "Administration" },
  "nav.plan": { ru: "Тариф", en: "Plan" },
  "nav.limit": { ru: "Лимит", en: "Limit" },
  "nav.perMonth": { ru: "/ мес", en: "/ mo" },

  // Common
  "common.save": { ru: "Сохранить", en: "Save" },
  "common.delete": { ru: "Удалить", en: "Delete" },
  "common.cancel": { ru: "Отмена", en: "Cancel" },
  "common.loading": { ru: "Загрузка...", en: "Loading..." },
  "common.noData": { ru: "Нет данных", en: "No data" },
  "common.words": { ru: "слов", en: "words" },
  "common.articles": { ru: "Статьи", en: "Articles" },

  // Dashboard
  "dashboard.title": { ru: "Дашборд", en: "Dashboard" },
  "dashboard.subtitle": { ru: "Обзор вашего контента и аналитики", en: "Overview of your content and analytics" },
  "dashboard.totalArticles": { ru: "Статьи", en: "Articles" },
  "dashboard.keywords": { ru: "Ключевые слова", en: "Keywords" },
  "dashboard.avgSeo": { ru: "Средний SEO", en: "Avg SEO" },
  "dashboard.generations": { ru: "Генерации", en: "Generations" },
  "dashboard.totalWords": { ru: "Всего слов", en: "Total Words" },
  "dashboard.aiTokens": { ru: "Токены AI", en: "AI Tokens" },
  "dashboard.allTime": { ru: "за всё время", en: "all time" },
  "dashboard.wordsPerArticle": { ru: "слов/статья", en: "words/article" },
  "dashboard.genPerMonth": { ru: "генераций/мес", en: "gen/month" },

  // Analytics
  "analytics.title": { ru: "Аналитика", en: "Analytics" },
  "analytics.subtitle": { ru: "SEO-аудит статей и общая статистика", en: "SEO audit and general statistics" },
  "analytics.selectArticle": { ru: "Выберите статью для анализа", en: "Select article for analysis" },
  "analytics.selectPlaceholder": { ru: "Выберите статью...", en: "Select article..." },
  "analytics.seoScore": { ru: "SEO Score", en: "SEO Score" },
  "analytics.contentMetrics": { ru: "Контент-метрики", en: "Content Metrics" },
  "analytics.seoMetrics": { ru: "SEO-метрики", en: "SEO Metrics" },
  "analytics.uniqueness": { ru: "Уникальность предложений", en: "Sentence Uniqueness" },
  "analytics.uniquenessCheck": { ru: "Проверка уникальности", en: "Uniqueness Check" },
  "analytics.checkUniqueness": { ru: "Проверить уникальность", en: "Check Uniqueness" },
  "analytics.checking": { ru: "Проверяем...", en: "Checking..." },
  "analytics.readability": { ru: "Читаемость (Flesch)", en: "Readability (Flesch)" },
  "analytics.waterLevel": { ru: "Водность", en: "Water Level" },
  "analytics.keywordDensity": { ru: "Плотность ключа", en: "Keyword Density" },
  "analytics.headingStructure": { ru: "Структура заголовков", en: "Heading Structure" },
  "analytics.lsiCoverage": { ru: "LSI-покрытие", en: "LSI Coverage" },
  "analytics.seoChecklist": { ru: "SEO-чеклист", en: "SEO Checklist" },
  "analytics.markerQuery": { ru: "Маркерный запрос", en: "Marker Query" },
  "analytics.excellent": { ru: "Отлично", en: "Excellent" },
  "analytics.normal": { ru: "Нормально", en: "Normal" },
  "analytics.weak": { ru: "Слабо", en: "Weak" },
  "analytics.easy": { ru: "Легко читается", en: "Easy to read" },
  "analytics.medium": { ru: "Средняя сложность", en: "Medium complexity" },
  "analytics.hard": { ru: "Сложный текст", en: "Complex text" },
  "analytics.totalArticles": { ru: "Всего статей", en: "Total articles" },
  "analytics.totalVolume": { ru: "Общий объём", en: "Total volume" },
  "analytics.aiTokens": { ru: "AI токены", en: "AI tokens" },
  "analytics.requests": { ru: "Запросы", en: "Requests" },
  "analytics.selectForAudit": { ru: "Выберите статью для SEO-аудита", en: "Select article for SEO audit" },
  "analytics.autoCalculated": { ru: "Все метрики рассчитываются автоматически", en: "All metrics are calculated automatically" },
  "analytics.noLinkedKeyword": { ru: "Нет привязанного ключевого слова", en: "No linked keyword" },
  "analytics.noLsiKeywords": { ru: "Нет LSI-ключевых слов для этой статьи", en: "No LSI keywords for this article" },

  // Settings
  "settings.title": { ru: "Настройки", en: "Settings" },
  "settings.profile": { ru: "Профиль", en: "Profile" },
  "settings.email": { ru: "Email", en: "Email" },
  "settings.name": { ru: "Имя", en: "Name" },
  "settings.plan": { ru: "Тариф", en: "Plan" },
  "settings.theme": { ru: "Тема", en: "Theme" },
  "settings.darkTheme": { ru: "Тёмная", en: "Dark" },
  "settings.lightTheme": { ru: "Светлая", en: "Light" },
  "settings.language": { ru: "Язык", en: "Language" },
  "settings.appearance": { ru: "Внешний вид", en: "Appearance" },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "ru",
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("app-lang") as Lang) || "ru";
    }
    return "ru";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("app-lang", l);
  };

  const t = (key: string): string => {
    return translations[key]?.[lang] || key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
