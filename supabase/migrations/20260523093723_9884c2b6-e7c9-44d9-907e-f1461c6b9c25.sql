CREATE TABLE public.commercial_brief_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  page_type text NOT NULL,
  brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_brief_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own brief templates"
  ON public.commercial_brief_templates
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all brief templates"
  ON public.commercial_brief_templates
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_brief_templates_user ON public.commercial_brief_templates(user_id, created_at DESC);

CREATE TRIGGER set_brief_templates_updated_at
BEFORE UPDATE ON public.commercial_brief_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();