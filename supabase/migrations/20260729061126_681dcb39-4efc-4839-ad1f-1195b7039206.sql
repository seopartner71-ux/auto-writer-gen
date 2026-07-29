
ALTER TABLE public.ecosystem_formats
  ADD COLUMN IF NOT EXISTS publication_slug text,
  ADD COLUMN IF NOT EXISTS generation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_ecosystem_format_id uuid NULL REFERENCES public.ecosystem_formats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public._eco_slugify(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  m jsonb := '{"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"j","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"shch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"}'::jsonb;
  k text;
BEGIN
  s := lower(coalesce(input, ''));
  FOR k IN SELECT jsonb_object_keys(m) LOOP
    s := replace(s, k, m->>k);
  END LOOP;
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  RETURN left(s, 60);
END;
$$;

WITH src AS (
  SELECT ef.id AS fid,
         coalesce(dt.slug, ef.format_type, 'doc') AS type_slug,
         coalesce(nullif(public._eco_slugify(coalesce(a.title, a.main_keyword, 'document')), ''), 'document') AS key_slug
  FROM public.ecosystem_formats ef
  JOIN public.content_ecosystems ce ON ce.id = ef.ecosystem_id
  LEFT JOIN public.articles a ON a.id = ce.source_article_id
  LEFT JOIN public.document_types dt ON dt.id = ef.document_type_id
  WHERE ef.publication_slug IS NULL
)
UPDATE public.ecosystem_formats ef
SET publication_slug = src.type_slug || '/' || src.key_slug || '-legacy-' || substr(replace(ef.id::text, '-', ''), 1, 8)
FROM src
WHERE ef.id = src.fid;

CREATE UNIQUE INDEX IF NOT EXISTS ecosystem_formats_pub_slug_active_uidx
  ON public.ecosystem_formats (ecosystem_id, publication_slug)
  WHERE publication_slug IS NOT NULL AND archived = false;

CREATE INDEX IF NOT EXISTS ecosystem_formats_ecosystem_type_version_idx
  ON public.ecosystem_formats (ecosystem_id, format_type, generation_version DESC);

CREATE INDEX IF NOT EXISTS ecosystem_formats_parent_idx
  ON public.ecosystem_formats (parent_ecosystem_format_id);

DROP FUNCTION IF EXISTS public._eco_slugify(text);
