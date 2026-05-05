INSERT INTO public.changelog (version, title, release_date, is_major, items)
VALUES (
  '2.5.0',
  'Обновление тарифов - больше за те же деньги',
  CURRENT_DATE,
  false,
  '[
    {"type":"improvement","text":"NANO: добавлены 3 SEO-улучшения на статью и Тургенев проверка"},
    {"type":"improvement","text":"PRO: SEO-улучшения стали безлимитными, добавлена приоритетная очередь bulk"},
    {"type":"improvement","text":"FACTORY: добавлен второй пользователь в аккаунте и API доступ"}
  ]'::jsonb
)
ON CONFLICT (version) DO NOTHING;