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

export function sampleCategoryData(): TemplateRow {
  return {
    ...THEME,
    hero_title: "Категория товаров",
    hero_subtitle: "Описание категории для превью.",
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
      { name: "Товар 1", url: "#", image: "", price: "1 200", currency: "₽", brand: "Бренд", availability: "В наличии", availability_mod: "in", sku: "SKU-1", short_description: "Короткое описание." },
      { name: "Товар 2", url: "#", image: "", price: "2 400", currency: "₽", brand: "Бренд", availability: "Под заказ", availability_mod: "out", sku: "SKU-2", short_description: "Короткое описание." },
    ],
    body_blocks: [{ heading: "О категории", text: "Текстовый блок категории." }],
    faq: [{ q: "Есть доставка?", a: "Да, по всей стране." }],
  };
}

export function sampleProductData(): TemplateRow {
  return {
    ...THEME,
    hero_title: "Товар для превью",
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
      { name: "Похожий товар", url: "#", image: "", price: "990", availability: "В наличии", availability_mod: "in", brand: "Бренд" },
    ],
    body_blocks: [{ heading: "Описание", text: "Подробный текст о товаре." }],
    faq: [{ q: "Есть гарантия?", a: "12 месяцев." }],
  };
}

export function sampleHubData(): TemplateRow {
  return {
    ...THEME,
    hero_title: "Раздел (Hub)",
    hero_subtitle: "Вводный текст раздела.",
    breadcrumbs: [{ label: "Главная", url: "/" }],
    categories: [
      { name: "Категория 1", url: "#", description: "Описание", image: "", count: "10" },
      { name: "Категория 2", url: "#", description: "Описание", image: "", count: "7" },
    ],
    articles: [
      { title: "Статья раздела", url: "#", excerpt: "Короткое описание.", image: "", date: "2026-08-01" },
    ],
    facts: [
      { label: "Позиций", value: "320" },
      { label: "Складов", value: "4" },
    ],
  };
}

export function sampleArticleData(): TemplateRow {
  return {
    ...THEME,
    hero_title: "Заголовок статьи",
    breadcrumbs: [
      { label: "Главная", url: "/" },
      { label: "Блог", url: "/blog/" },
    ],
    toc: [
      { id: "s1", title: "Первый раздел" },
      { id: "s2", title: "Второй раздел" },
    ],
    body_blocks: [
      { heading: "Первый раздел", text: "Абзац текста статьи для проверки типографики." },
      { heading: "Второй раздел", text: "Ещё один абзац текста статьи." },
    ],
    related: [{ name: "Похожая статья", url: "#", image: "", price: "", availability: "", availability_mod: "", brand: "" }],
    faq: [{ q: "Вопрос?", a: "Ответ." }],
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
