import { Wrench, LayoutGrid, Tag, MapPin } from "lucide-react";

export type PageType = "service" | "category" | "product" | "local";

export const PAGE_TYPES: { id: PageType; title: string; desc: string; icon: any; proOnly?: boolean }[] = [
  { id: "service", title: "Страница услуги", desc: "Лендинг под конкретную услугу компании", icon: Wrench },
  { id: "category", title: "Категория магазина", desc: "SEO-текст для категории интернет-магазина", icon: LayoutGrid, proOnly: true },
  { id: "product", title: "Карточка товара", desc: "Описание товара с характеристиками и выгодами", icon: Tag, proOnly: true },
  { id: "local", title: "Локальный бизнес", desc: "Страница под запрос услуга + город", icon: MapPin },
];

export const TONES: Record<PageType, string[]> = {
  service: ["Официальный", "Дружелюбный", "Экспертный", "Продающий"],
  category: ["Нейтральный", "Продающий"],
  product: ["Технический", "Lifestyle", "Продающий"],
  local: ["Доверительный", "Экспертный", "Дружелюбный"],
};

export interface BlockDef {
  type: string;
  title: string;
  desc: string;
  words: number;
  proOnly?: boolean;
  conditional?: (brief: any) => boolean;
}

export const BLOCKS: Record<PageType, BlockDef[]> = {
  service: [
    { type: "h1_lead", title: "H1 + лид-абзац", desc: "Заголовок и вводный абзац", words: 100 },
    { type: "benefits", title: "Выгоды", desc: "Список с описаниями", words: 150 },
    { type: "how_we_work", title: "Как мы работаем", desc: "Этапы работы", words: 200 },
    { type: "utp", title: "Почему мы", desc: "УТП-блок", words: 150 },
    { type: "prices", title: "Цены / пакеты", desc: "Тарифы и стоимость", words: 100, proOnly: true, conditional: (b) => b.has_prices === true },
    { type: "faq", title: "FAQ", desc: "5 вопросов и ответов", words: 300 },
    { type: "cta", title: "CTA-блок", desc: "Призыв к действию", words: 80 },
    { type: "seo_text", title: "SEO-текст внизу", desc: "Развернутый текст", words: 500, proOnly: true },
    { type: "geo", title: "Гео-абзац", desc: "Под город", words: 100, conditional: (b) => !!b.city },
  ],
  category: [
    { type: "intro", title: "H1 + вводный текст", desc: "Заголовок категории", words: 250 },
    { type: "benefits", title: "Преимущества магазина", desc: "Чем хорош магазин", words: 150 },
    { type: "category_desc", title: "Описание категории", desc: "Что входит, как выбрать", words: 300 },
    { type: "seo_text", title: "SEO-текст внизу", desc: "Развернутый текст", words: 600, proOnly: true },
    { type: "faq", title: "FAQ по категории", desc: "Вопросы и ответы", words: 250 },
  ],
  product: [
    { type: "short_desc", title: "Краткое описание", desc: "Лид товара", words: 150 },
    { type: "features_benefits", title: "Характеристики → выгоды", desc: "Таблица", words: 200 },
    { type: "full_desc", title: "Полное описание", desc: "Детально о товаре", words: 600 },
    { type: "for_whom", title: "Кому подходит", desc: "Аудитория", words: 150 },
    { type: "faq", title: "FAQ по товару", desc: "Вопросы и ответы", words: 200 },
  ],
  local: [
    { type: "h1_lead", title: "H1 + лид", desc: "Заголовок и вводный абзац", words: 120 },
    { type: "services_list", title: "Услуги компании", desc: "Список услуг", words: 250 },
    { type: "utp", title: "Почему выбирают нас", desc: "Преимущества", words: 150 },
    { type: "coverage", title: "Зона охвата", desc: "Районы и как добраться", words: 100 },
    { type: "faq", title: "FAQ", desc: "Вопросы и ответы", words: 250 },
    { type: "cta", title: "CTA", desc: "Призыв к действию", words: 80 },
    { type: "geo_seo", title: "Гео SEO-текст", desc: "Услуга + город", words: 400, proOnly: true },
  ],
};
