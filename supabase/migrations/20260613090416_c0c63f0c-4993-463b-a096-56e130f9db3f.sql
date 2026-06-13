
CREATE TABLE public.vc_writer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  format text NOT NULL,
  model text NOT NULL,
  topic text NOT NULL,
  thesis text,
  audience text,
  tone text,
  length_target integer,
  target_query text,
  seo_mode boolean DEFAULT false,
  client_links jsonb DEFAULT '[]'::jsonb,
  title text,
  subtitle text,
  tags jsonb DEFAULT '[]'::jsonb,
  ps_question text,
  markdown text,
  cover_url text,
  checklist jsonb DEFAULT '[]'::jsonb,
  links_report jsonb,
  chars integer,
  is_favorite boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vc_writer_history TO authenticated;
GRANT ALL ON public.vc_writer_history TO service_role;

ALTER TABLE public.vc_writer_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own vc history"
  ON public.vc_writer_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own vc history"
  ON public.vc_writer_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own vc history"
  ON public.vc_writer_history FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own vc history"
  ON public.vc_writer_history FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_vc_writer_history_user_created
  ON public.vc_writer_history(user_id, created_at DESC);

CREATE TRIGGER trg_vc_writer_history_updated
  BEFORE UPDATE ON public.vc_writer_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
