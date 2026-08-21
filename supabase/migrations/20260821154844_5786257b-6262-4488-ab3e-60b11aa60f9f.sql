CREATE TABLE public.page_commercial_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  page_type text NOT NULL DEFAULT '',
  block_type text NOT NULL,
  title text,
  content text,
  missing_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'ready',
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registry_id, block_type)
);

CREATE INDEX idx_pcb_project ON public.page_commercial_blocks (project_id);
CREATE INDEX idx_pcb_registry ON public.page_commercial_blocks (registry_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_commercial_blocks TO authenticated;
GRANT ALL ON public.page_commercial_blocks TO service_role;

ALTER TABLE public.page_commercial_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage commercial blocks"
ON public.page_commercial_blocks FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_commercial_blocks.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_commercial_blocks.project_id AND p.user_id = auth.uid()));

CREATE POLICY "Admins manage commercial blocks"
ON public.page_commercial_blocks FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_pcb_updated_at
BEFORE UPDATE ON public.page_commercial_blocks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();