ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS build_product_cap integer;
UPDATE public.projects SET build_product_cap = 800 WHERE id = '907ba9e4-afda-41c9-bd19-9286e56d27cc';