## Цель

Перевести публичный лендинг (`/`) в строгий премиум-минимализм по образцу Linear/Vercel/Raycast - плоский дизайн, ультра-тонкие бордеры, выверенная типографика, без градиентов и свечений.

## Что сделать

### 1. Новые секции (заменяют существующие)

- `LandingNavV3` - минимальная шапка: логотип слева, навигация по центру (`text-sm text-muted-foreground hover:text-foreground`), Log in (ghost) + Get Started (primary) справа, `border-b border-border`.
- `LandingHeroV3` - бейдж "Announcing ..." сверху по центру, гигантский H1 `text-5xl md:text-7xl font-bold tracking-tighter`, подзаголовок `text-muted-foreground text-lg`, две кнопки (primary + outline), мокап дашборда в карточке `bg-card border rounded-xl` без теней.
- `LandingTrustV3` - "Trusted by ...", логотипы `grayscale opacity-50`.
- `LandingBentoV3` - асимметричная Bento Grid с 5-6 фичами: иконка Lucide → заголовок → описание. Одна карточка с гигантской метрикой `text-5xl font-mono`. Все карточки `bg-card border-border`, никаких цветных фонов.
- `LandingPricingV3` - 3 строгие карточки, Pro с `border-primary`, кнопка default только в Pro.
- `LandingFinalCtaV3` - финальный плоский CTA блок.
- `LandingFooterV3` - текущий футер привести к `text-sm text-muted-foreground`, без украшений.

### 2. Index.tsx

- Удалить фоновый noise, два размытых пятна `blur-[250px]`, лишние z-index слои.
- Заменить список lazy-секций на новый набор V3.
- Старые секции (`SectionResearch`, `SectionPersona`, `SectionGeo`, `SectionRankTracker`, `SectionStealthEngine`, `SectionComparison`, `LandingSandbox`, `SectionVideoDemo`, `SectionRealCase`, `SectionQualityProof`, `SectionFinalCta`, `SectionPricing`, `SectionHero`, `LandingNav`, `LandingFooter`) - оставить в репо как fallback, но не импортировать.
- Сохранить SEO/JSON-LD, `CookieConsent`, `ScrollToTop`, `FloatingCTA`.

### 3. Стили

- Не править токены - использовать существующие `--background --card --border --primary --muted-foreground`.
- Внутри лендинга только flat: никаких `shadow-*`, `bg-gradient-*`, `blur-*`, `drop-shadow-*`.
- Hover на карточках: только `hover:border-foreground/20` или `hover:bg-card/80`, без `translate`.
- Анимация: `animate-fade-in` на секциях через IntersectionObserver или CSS `@starting-style`.

### 4. Контент

Сохранить смысловые блоки текущего лендинга (Research, Persona, GEO, Stealth) - переупаковать их как карточки внутри Bento Grid, а не как отдельные большие секции. Сохранить локализацию RU/EN через `useI18n`.

### 5. Что НЕ трогаю

- Дашборд и приложение.
- Auth / payments / edge functions.
- Floating CTA, Cookie consent, Scroll to top - визуально уже в этом стиле, оставляю.

## Технические детали

- Файлы создаю с суффиксом `V3` рядом со старыми - проще откатить.
- `Index.tsx` переписывается полностью.
- Mockup дашборда в Hero - схематичный JSX (sidebar + header + 3 KPI карточки + график-плейсхолдер) в одной карточке, без сторонних библиотек.
- Bento grid: `grid grid-cols-1 md:grid-cols-3 gap-px bg-border` с `col-span-2` / `row-span-2` для асимметрии (классика Linear).
- Шрифты уже подключены (Inter + JetBrains Mono из мемори).
