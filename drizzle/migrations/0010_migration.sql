CREATE TABLE public.kb_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT '',
  site text NOT NULL DEFAULT '',
  repo text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_clients TO authenticated;
GRANT ALL ON public.kb_clients TO service_role;
ALTER TABLE public.kb_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage kb clients" ON public.kb_clients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX kb_clients_updated_idx ON public.kb_clients (updated_at DESC);