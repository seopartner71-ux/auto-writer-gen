CREATE TABLE public.rag_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rag_releases TO authenticated;
GRANT ALL ON public.rag_releases TO service_role;

ALTER TABLE public.rag_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rag releases"
ON public.rag_releases FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_rag_releases_user_updated ON public.rag_releases (user_id, updated_at DESC);

CREATE TRIGGER update_rag_releases_updated_at
BEFORE UPDATE ON public.rag_releases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();