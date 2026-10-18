ALTER TABLE public.monitor_sites ADD COLUMN IF NOT EXISTS metrika_counter_id text;
UPDATE public.monitor_sites SET metrika_counter_id = '92151903' WHERE domain = 'rdr71.ru';