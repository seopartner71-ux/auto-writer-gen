
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'nano';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

UPDATE public.profiles SET is_internal = true
WHERE email IN (
  'sinitsin3@yandex.ru',
  'anastasiapostolskaya@yandex.ru',
  'shaginovaleysana@gmail.com',
  'admin@seoengine.test'
);
