DELETE FROM public.seo_tips
WHERE source = 'book'
  AND tip ~* '\m(ispolzujte|sajt|polzovatel|kachestv|kontent|stranic|zaprosov|poiskov|ssylk|bystro|prosto|takzhe|chtoby|kotor|nuzhn|mozhno|reguljarno|proverjajte)\M';