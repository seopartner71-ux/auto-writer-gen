INSERT INTO public.app_settings (key, value, description)
VALUES ('pbn_totop_position', 'left-bottom', 'Позиция кнопки "Наверх" на сайтах PBN-сетки: left-bottom | right-bottom | left-top | right-top | hidden')
ON CONFLICT (key) DO NOTHING;