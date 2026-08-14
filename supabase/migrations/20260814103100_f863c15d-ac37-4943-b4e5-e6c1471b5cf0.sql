CREATE TABLE public.site_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_dna TO authenticated;
GRANT ALL ON public.site_dna TO service_role;
ALTER TABLE public.site_dna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_dna_own" ON public.site_dna FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "site_dna_admin" ON public.site_dna FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_site_dna_user ON public.site_dna(user_id);

CREATE TABLE public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  role text,
  description text,
  status text NOT NULL DEFAULT 'draft',
  version text NOT NULL DEFAULT '1.0',
  site_url text,
  site_dna_id uuid REFERENCES public.site_dna(id) ON DELETE SET NULL,
  persona_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_fingerprint jsonb,
  quality_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  master_prompt text,
  health_score integer NOT NULL DEFAULT 0,
  articles_generated integer NOT NULL DEFAULT 0,
  project_ids uuid[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'ru',
  change_log text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personas TO authenticated;
GRANT ALL ON public.personas TO service_role;
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personas_own" ON public.personas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personas_admin" ON public.personas FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_personas_user ON public.personas(user_id);
CREATE INDEX idx_personas_status ON public.personas(status);

CREATE TABLE public.persona_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version text NOT NULL,
  snapshot jsonb NOT NULL,
  change_log text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_versions TO authenticated;
GRANT ALL ON public.persona_versions TO service_role;
ALTER TABLE public.persona_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "persona_versions_own" ON public.persona_versions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_persona_versions_persona ON public.persona_versions(persona_id);

CREATE TABLE public.persona_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  article_id uuid,
  task text,
  output_text text,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_score integer NOT NULL DEFAULT 0,
  deviations jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_evaluations TO authenticated;
GRANT ALL ON public.persona_evaluations TO service_role;
ALTER TABLE public.persona_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "persona_evaluations_own" ON public.persona_evaluations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_persona_evaluations_persona ON public.persona_evaluations(persona_id);

CREATE TABLE public.persona_style_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'positive',
  content text NOT NULL,
  reason text,
  fingerprint jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_style_examples TO authenticated;
GRANT ALL ON public.persona_style_examples TO service_role;
ALTER TABLE public.persona_style_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "persona_style_examples_own" ON public.persona_style_examples FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_persona_style_examples_persona ON public.persona_style_examples(persona_id);

CREATE TRIGGER update_site_dna_updated_at BEFORE UPDATE ON public.site_dna FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_personas_updated_at BEFORE UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();