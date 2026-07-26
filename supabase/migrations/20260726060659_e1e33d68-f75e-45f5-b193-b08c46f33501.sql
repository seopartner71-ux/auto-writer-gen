
-- 1. document_types catalog
CREATE TABLE public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'pdf',
  target_length_words jsonb NOT NULL DEFAULT '{"min":300,"max":600}'::jsonb,
  target_pages jsonb NOT NULL DEFAULT '{"min":3,"max":5}'::jsonb,
  system_prompt_template text,
  post_checks_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_template_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  html_landing_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  anchors_config jsonb NOT NULL DEFAULT '{"count_min":1,"count_max":2,"placement":"body"}'::jsonb,
  client_pages_config jsonb NOT NULL DEFAULT '{"count_min":0,"count_max":4,"placement_rules":"by_h2"}'::jsonb,
  preferred_distribution_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_model text NOT NULL DEFAULT 'anthropic/claude-opus-4',
  primary_model text NOT NULL DEFAULT 'anthropic/claude-haiku-4.5',
  ui_priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_types TO anon, authenticated;
GRANT ALL ON public.document_types TO service_role;

ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_types readable by everyone"
  ON public.document_types FOR SELECT
  USING (true);

CREATE POLICY "document_types staff/admin can insert"
  ON public.document_types FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "document_types staff/admin can update"
  ON public.document_types FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "document_types staff/admin can delete"
  ON public.document_types FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER document_types_updated_at
  BEFORE UPDATE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed the single checklist document type
INSERT INTO public.document_types (
  slug, name, description, category,
  target_length_words, target_pages,
  system_prompt_template,
  post_checks_config,
  pdf_template_config,
  html_landing_config,
  anchors_config,
  client_pages_config,
  preferred_distribution_platforms,
  primary_model, fallback_model, ui_priority, is_active
) VALUES (
  'checklist',
  'Чек-лист',
  'Практический чек-лист на 10-14 пунктов с финальным блоком напоминаний. Публикуется PDF-документом и HTML-лендингом на GitHub Pages.',
  'pdf',
  '{"min":600,"max":900}'::jsonb,
  '{"min":3,"max":5}'::jsonb,
  -- Placeholder-based template. The generate-document dispatcher inlines the current
  -- generate-checklist system prompt when this slug is invoked. Kept in DB for
  -- future editability by admins without redeploy.
  E'Ты редактор-методолог. Из исходной статьи собираешь премиум-чек-лист на 600-900 слов.\nВерни СТРОГО Markdown в фиксированной структуре: `# Чек-лист: [тема]`, вводный абзац 3-5 предложений, 10-14 пунктов `- [ ] Заголовок - описание`, финальный блок `## Что важно помнить` c 2-3 напоминаниями.\nПлейсхолдеры: {{article}}, {{client}}, {{anchors}}, {{client_pages}}.',
  '{"has_title":true,"has_final_block":"## Что важно помнить","min_checkboxes":8,"context_links":{"min":1,"max":2}}'::jsonb,
  '{"template":"checklist_v1","cover_banner":true,"final_image":true,"author_card":true,"cta":true,"font":"roboto"}'::jsonb,
  '{"template":"checklist_landing_v1","include_pdf_button":true,"include_author_block":true,"seo":{"meta_keywords_from":["main_keyword","lsi","brand","slug"]}}'::jsonb,
  '{"count_min":1,"count_max":2,"placement":"body"}'::jsonb,
  '{"count_min":0,"count_max":4,"placement_rules":"by_h2"}'::jsonb,
  '["github_pages"]'::jsonb,
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-opus-4',
  100,
  true
);

-- 3. Link ecosystem_formats to document_types (nullable for legacy Dzen rows)
ALTER TABLE public.ecosystem_formats
  ADD COLUMN document_type_id uuid REFERENCES public.document_types(id) ON DELETE SET NULL;

CREATE INDEX ecosystem_formats_document_type_id_idx
  ON public.ecosystem_formats(document_type_id);

-- 4. Backfill existing checklist rows
UPDATE public.ecosystem_formats
SET document_type_id = (SELECT id FROM public.document_types WHERE slug = 'checklist')
WHERE format_type = 'checklist' AND document_type_id IS NULL;
