// ============================================================================
// Sample TemplateData for the import preview.
//
// Shapes mirror the existing HomeTemplateData / CategoryTemplateData /
// ProductTemplateData / HubTemplateData / ArticleTemplateData contracts.
// Used ONLY by the importer preview - the deploy runtime keeps using its own
// adapters (buildHomeTemplateData, buildCategoryTemplateData, ...).
// ============================================================================

import type { TemplateRow } from "./templateEngine.ts";

const THEME: TemplateRow = {
  accent: "#0ea5e9",
  bg: "#ffffff",
  ink: "#0f172a",
  muted: "#64748b",
  surface: "#f8fafc",
  border: "#e2e8f0",
  card_radius: "16px",
  btn_radius: "10px",
  shadow: "0 1px 2px rgba(15,23,42,.06)",
  section_pad: "72px",
  heading_font: "Inter",
  body_font: "Inter",
  site_name: "Демо Компания",
};

export function sampleHomeData(): TemplateRow {
  return {
    ...THEME,
    hero_badge: "Демо-данные",
    hero_title: "Заголовок главной страницы",
    hero_subtitle: "Подзаголовок для проверки вёрстки импортированного шаблона.",
    hero_image: "",
    cta_primary: "Оставить заявку",
    cta_secondary: "Каталог",
    label_benefits: "Преимущества",
    label_services: "Услуги",
    label_process: "Как работаем",
    label_team: "Команда",
    label_blog: "Блог",
    label_about: "О компании",
    label_contacts: "Контакты",
    label_address: "Адрес",
    label_phone: "Телефон",
    label_hours: "Часы работы",
    title_services: "Наши услуги",
    subtitle_services: "Полный цикл работ",
    title_process: "Процесс",
    title_team: "Команда",
    title_testimonials: "Отзывы",
    title_contacts: "Контакты",
    about_title: "О компании",
    about_text: "Короткий текст о компании для превью шаблона.",
    blog_title: "Статьи",
    blog_empty_text: "Пока нет статей",
    cta_section_title: "Нужна консультация?",
    cta_section_text: "Ответим в течение рабочего дня.",
    phone: "+7 000 000-00-00",
    phone_href: "tel:+70000000000",
    email: "hello@example.com",
    address: "Москва, ул. Примерная, 1",
    work_hours: "Пн-Пт 9:00-18:00",
    stats: [
      { value: "12", label: "лет на рынке" },
      { value: "480", label: "проектов" },
      { value: "24", label: "специалиста" },
    ],
    features: [
      { icon: "1", title: "Скорость", text: "Запуск за 3 дня." },
      { icon: "2", title: "Гарантия", text: "Договор и сроки." },
      { icon: "3", title: "支持".replace("支持", "Поддержка"), text: "Ведём после сдачи." },
    ],
    services: [
      { modifier: "", title: "Услуга A", price: "от 10 000 ₽", bullets_html: "<li>Пункт 1</li><li>Пункт 2</li>", cta: "Заказать" },
      { modifier: "", title: "Услуга B", price: "от 25 000 ₽", bullets_html: "<li>Пункт 1</li><li>Пункт 2</li>", cta: "Заказать" },
    ],
    process: [
      { icon: "1", title: "Заявка", text: "Обсуждаем задачу." },
      { icon: "2", title: "Смета", text: "Считаем стоимость." },
      { icon: "3", title: "Работа", text: "Выполняем и сдаём." },
    ],
    team: [{ name: "Иван Петров", role: "Руководитель", bio: "15 лет в отрасли.", image: "" }],
    testimonials: [{ stars: "★★★★★", rating: "5", text: "Хорошая работа.", name: "Ольга", role: "Клиент", image: "" }],
    posts: [
      { title: "Первая статья", excerpt: "Короткое описание.", url: "/posts/one.html", image: "" },
      { title: "Вторая статья", excerpt: "Короткое описание.", url: "/posts/two.html", image: "" },
    ],
    faq: [{ q: "Сколько стоит?", a: "Зависит от объёма работ." }],
  };
}

/**
 * Show/hide wrappers used by the page templates. Same convention as the
 * production adapters: one empty row = visible, empty array = hidden.
 */
const ON: TemplateRow[] = [{}];
const OFF: TemplateRow[] = [];

export function sampleCategoryData(): TemplateRow {
  return {
    ...THEME,
    h1: "Категория товаров",
    intro: "Описание категории для превью.",
    hero_title: "Категория товаров",
    hero_subtitle: "Описание категории для превью.",
    cta_title: "Не нашли нужное?",
    cta_text: "Подберём аналог и посчитаем стоимость.",
    cta_primary: "Оставить заявку",
    cta_primary_url: "#form",
    cta_secondary: "Позвонить",
    cta_secondary_url: "tel:+70000000000",
    label_filters: "Фильтры",
    label_subcategories: "Подкатегории",
    label_products: "Товары",
    label_products_count: "позиций",
    label_details: "Подробнее",
    label_faq: "Вопросы и ответы",
    products_count: "2",
    image_placeholder: "нет фото",
    has_intro: ON,
    has_filters: ON,
    has_subcategories: ON,
    has_products: ON,
    has_body: ON,
    has_faq: ON,
    breadcrumbs: [
      { label: "Главная", url: "/" },
      { label: "Каталог", url: "/catalog/" },
    ],
    filters: [
      { label: "По цене", url: "#", count: "24" },
      { label: "По бренду", url: "#", count: "12" },
    ],
    subcategories: [
      { name: "Подкатегория 1", url: "#", count: "8" },
      { name: "Подкатегория 2", url: "#", count: "16" },
    ],
    products: [
      {
        name: "Товар 1", url: "#", image: "", price: "1 200 ₽", currency: "₽", brand: "Бренд",
        availability: "В наличии", availability_mod: "in", sku: "SKU-1",
        short_description: "Короткое описание.", count: "8",
        has_image: OFF, no_image: ON, has_brand: ON, has_short_description: ON, has_count: ON,
      },
      {
        name: "Товар 2", url: "#", image: "", price: "2 400 ₽", currency: "₽", brand: "Бренд",
        availability: "Под заказ", availability_mod: "out", sku: "SKU-2",
        short_description: "Короткое описание.", count: "16",
        has_image: OFF, no_image: ON, has_brand: ON, has_short_description: ON, has_count: ON,
      },
    ],
    body_blocks: [{ heading: "О категории", text: "Текстовый блок категории.", has_heading: ON }],
    faq: [{ q: "Есть доставка?", a: "Да, по всей стране." }],
  };
}

export function sampleProductData(): TemplateRow {
  return {
    ...THEME,
    h1: "Товар для превью",
    intro: "Короткое вступление о товаре.",
    hero_title: "Товар для превью",
    description: "Подробное описание товара для проверки типографики.",
    price: "1 990 ₽",
    availability: "В наличии",
    availability_mod: "in",
    brand: "Бренд",
    sku: "SKU-100",
    gallery_main: "",
    image_placeholder: "нет фото",
    cta_primary: "Купить",
    cta_primary_url: "#form",
    cta_secondary: "Задать вопрос",
    cta_secondary_url: "tel:+70000000000",
    cta_note: "Отвечаем в рабочее время.",
    label_brand: "Бренд",
    label_sku: "Артикул",
    label_description: "Описание",
    label_specs: "Характеристики",
    label_delivery: "Доставка",
    label_related: "Похожие товары",
    label_details: "Подробнее",
    label_faq: "Вопросы и ответы",
    has_intro: ON,
    has_brand: ON,
    has_sku: ON,
    has_description: ON,
    has_specs: ON,
    has_delivery: ON,
    has_related: ON,
    has_body: ON,
    has_faq: ON,
    has_gallery: OFF,
    no_gallery: ON,
    has_thumbs: ON,
    breadcrumbs: [
      { label: "Главная", url: "/" },
      { label: "Каталог", url: "/catalog/" },
      { label: "Товар", url: "#" },
    ],
    gallery: [{ src: "", alt: "Фото товара" }],
    gallery_thumbs: [{ src: "", alt: "Фото товара" }],
    key_specs: [
      { key: "Материал", value: "Сталь" },
      { key: "Размер", value: "М10" },
    ],
    specs: [
      { key: "Вес", value: "0,4 кг" },
      { key: "Покрытие", value: "Цинк" },
    ],
    delivery: [{ text: "Доставка по РФ 1-3 дня" }],
    related: [
      {
        name: "Похожий товар", title: "Похожий товар", url: "#", image: "", price: "990 ₽",
        availability: "В наличии", availability_mod: "in", brand: "Бренд",
        has_image: OFF, no_image: ON, has_brand: ON,
      },
    ],
    body_blocks: [{ heading: "Описание", text: "Подробный текст о товаре.", has_heading: ON }],
    faq: [{ q: "Есть гарантия?", a: "12 месяцев." }],
  };
}

export function sampleHubData(): TemplateRow {
  return {
    ...THEME,
    h1: "Раздел (Hub)",
    intro: "Вводный текст раздела.",
    hero_title: "Раздел (Hub)",
    hero_subtitle: "Вводный текст раздела.",
    cta_title: "Нужна консультация?",
    cta_text: "Поможем выбрать решение под задачу.",
    cta_primary: "Оставить заявку",
    cta_primary_url: "#form",
    cta_secondary: "Каталог",
    cta_secondary_url: "/catalog/",
    label_categories: "Категории",
    label_articles: "Статьи раздела",
    label_open: "Открыть",
    label_count_unit: "позиций",
    label_faq: "Вопросы и ответы",
    image_placeholder: "нет фото",
    has_intro: ON,
    has_categories: ON,
    has_articles: ON,
    has_facts: ON,
    has_body: ON,
    has_faq: ON,
    has_cta_secondary: ON,
    breadcrumbs: [{ label: "Главная", url: "/" }],
    categories: [
      {
        name: "Категория 1", url: "#", description: "Описание", image: "", count: "10",
        has_image: OFF, no_image: ON, has_description: ON, has_count: ON, label_open: "Открыть",
      },
      {
        name: "Категория 2", url: "#", description: "Описание", image: "", count: "7",
        has_image: OFF, no_image: ON, has_description: ON, has_count: ON, label_open: "Открыть",
      },
    ],
    articles: [
      {
        title: "Статья раздела", url: "#", excerpt: "Короткое описание.", image: "", date: "01.08.2026",
        has_image: OFF, no_image: ON, has_excerpt: ON, has_date: ON,
      },
    ],
    facts: [
      { label: "Позиций", value: "320" },
      { label: "Складов", value: "4" },
    ],
    body_blocks: [{ heading: "О разделе", text: "Текстовый блок раздела.", has_heading: ON }],
    faq: [{ q: "Как заказать?", a: "Оставьте заявку в форме." }],
  };
}

export function sampleArticleData(): TemplateRow {
  return {
    ...THEME,
    h1: "Заголовок статьи",
    hero_title: "Заголовок статьи",
    excerpt: "Короткий лид статьи для превью шаблона.",
    author: "Иван Петров",
    author_image: "",
    date: "01.08.2026",
    date_iso: "2026-08-01",
    reading_time: "5 мин",
    image: "",
    image_placeholder: "нет фото",
    label_toc: "Содержание",
    label_related: "Читайте также",
    has_excerpt: ON,
    has_author: ON,
    has_author_image: OFF,
    has_date: ON,
    has_reading_time: ON,
    has_toc: ON,
    has_related: ON,
    has_image: OFF,
    no_image: ON,
    html: "<h2 id=\"s1\">Первый раздел</h2><p>Абзац текста статьи для проверки типографики.</p>" +
      "<h2 id=\"s2\">Второй раздел</h2><p>Ещё один абзац текста статьи.</p>",
    breadcrumbs: [
      { label: "Главная", url: "/" },
      { label: "Блог", url: "/blog/" },
    ],
    toc: [
      { id: "s1", title: "Первый раздел" },
      { id: "s2", title: "Второй раздел" },
    ],
    related: [
      {
        title: "Похожая статья", name: "Похожая статья", url: "#", image: "", excerpt: "Короткое описание.",
        has_image: OFF, no_image: ON,
      },
    ],
  };
}


export function sampleDataFor(page: string): TemplateRow {
  switch (page) {
    case "category": return sampleCategoryData();
    case "product": return sampleProductData();
    case "hub": return sampleHubData();
    case "article": return sampleArticleData();
    default: return sampleHomeData();
  }
}
