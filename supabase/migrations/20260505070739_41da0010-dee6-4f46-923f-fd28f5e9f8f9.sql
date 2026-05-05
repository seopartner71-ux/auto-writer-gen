CREATE TABLE public.changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  release_date date NOT NULL DEFAULT CURRENT_DATE,
  is_major boolean NOT NULL DEFAULT false,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read changelog"
ON public.changelog FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage changelog"
ON public.changelog FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_changelog_release_date ON public.changelog(release_date DESC);

INSERT INTO public.changelog (version, title, release_date, is_major, items) VALUES
('2.4.0', 'Мажорное обновление качества текстов', CURRENT_DATE, true, '[
  {"type":"new","text":"NLP Terms панель - живой SEO-scoring в редакторе vs топ-10 конкурентов"},
  {"type":"new","text":"Кнопка Улучшить SEO - автоматическая органичная вставка терминов через ИИ"},
  {"type":"new","text":"Индивидуальные Stealth-профили для каждого автора (Блогер, Академик, Практик, Скептик, Провокатор)"},
  {"type":"new","text":"Автоматическая проверка качества после генерации - AI Score, Burstiness, Плотность ключа"},
  {"type":"new","text":"Светофор качества в карточке статьи с кнопкой Улучшить автоматически"},
  {"type":"improvement","text":"Bulk-генерация выровнена до уровня single - полный Stealth и авторский профиль"},
  {"type":"improvement","text":"generate-article рефакторинг: с 1303 до 371 строки, логика вынесена в _shared/promptBuilder.ts"},
  {"type":"improvement","text":"Компактный вид авторов на странице генерации с быстрым редактированием"},
  {"type":"fix","text":"Кредиты больше не списываются дважды при ретрае bulk-задач (idempotency key)"},
  {"type":"fix","text":"decrypt_sensitive логирует ошибку и возвращает NULL вместо зашифрованного текста"},
  {"type":"fix","text":"6 точек вызова decrypt больше не подставляют ciphertext как реальный ключ"}
]'::jsonb),
('2.3.0', 'Realtime и инфраструктура', CURRENT_DATE - INTERVAL '30 days', false, '[
  {"type":"improvement","text":"Realtime заменил polling в AutoQualityBadge - снижение нагрузки на БД"},
  {"type":"improvement","text":"RLS модель через user_roles + has_role() - каноническая без рекурсии"},
  {"type":"improvement","text":"Vault для ключей OpenRouter с ротацией"},
  {"type":"new","text":"htmlIntegrityOk() в improve-article - авто-rollback при поломке rewrite"},
  {"type":"new","text":"Smart Interlinking + Site Factory - programmatic SEO"},
  {"type":"new","text":"AI Radar - мониторинг бренда в 7 моделях одновременно"}
]'::jsonb);