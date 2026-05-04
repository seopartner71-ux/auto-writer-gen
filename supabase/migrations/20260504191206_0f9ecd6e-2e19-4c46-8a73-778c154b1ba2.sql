DELETE FROM public.seo_tips
WHERE source = 'book'
  AND (
    tip ILIKE '%DrMax%'
    OR tip ILIKE '%Храповицк%'
    OR tip ILIKE '%Доказательное SEO%'
    OR tip ILIKE '%@DrMaxSEO%'
  );