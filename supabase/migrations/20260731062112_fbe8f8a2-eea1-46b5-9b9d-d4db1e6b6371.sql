ALTER TABLE public.document_source_references
  ADD COLUMN IF NOT EXISTS extracted_images jsonb,
  ADD COLUMN IF NOT EXISTS use_images boolean NOT NULL DEFAULT true;