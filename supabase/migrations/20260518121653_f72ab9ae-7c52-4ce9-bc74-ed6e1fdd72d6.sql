UPDATE public.tracked_keywords
SET target_domain = regexp_replace(regexp_replace(lower(target_domain), '^https?://', ''), '(/.*)?([?#].*)?$', '')
WHERE target_domain ~ '[/?#]';