CREATE TABLE public.document_source_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_format_id uuid NOT NULL REFERENCES public.ecosystem_formats(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_type text NOT NULL DEFAULT 'client_page',
  source_title text,
  source_content text,
  source_fetched_at timestamptz,
  source_content_hash text,
  extraction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_source_references TO authenticated;
GRANT ALL ON public.document_source_references TO service_role;

ALTER TABLE public.document_source_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own document source references"
ON public.document_source_references FOR ALL
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.ecosystem_formats ef
  JOIN public.content_ecosystems ce ON ce.id = ef.ecosystem_id
  WHERE ef.id = document_source_references.ecosystem_format_id
    AND ce.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ecosystem_formats ef
  JOIN public.content_ecosystems ce ON ce.id = ef.ecosystem_id
  WHERE ef.id = document_source_references.ecosystem_format_id
    AND ce.user_id = auth.uid()
));

CREATE INDEX idx_dsr_format ON public.document_source_references(ecosystem_format_id);
CREATE INDEX idx_dsr_url_hash ON public.document_source_references(source_url, source_content_hash);

CREATE TRIGGER update_dsr_updated_at
BEFORE UPDATE ON public.document_source_references
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.document_types ADD COLUMN IF NOT EXISTS reference_source_config jsonb;

UPDATE public.document_types
SET reference_source_config = jsonb_build_object(
  'required', false,
  'recommended', true,
  'source_types_allowed', jsonb_build_array('client_page', 'external_url', 'client_pages_list'),
  'extraction_strategy', 'full_content',
  'fallback_behavior', 'skip_if_missing',
  'min_source_word_count', 100,
  'max_source_word_count', 20000
),
post_checks_config = CASE
  WHEN post_checks_config @> '[{"type":"use_source_facts"}]'::jsonb THEN post_checks_config
  ELSE COALESCE(post_checks_config, '[]'::jsonb) || '[{"type": "use_source_facts", "minSourceReferences": 3}]'::jsonb
END
WHERE slug = 'catalog';