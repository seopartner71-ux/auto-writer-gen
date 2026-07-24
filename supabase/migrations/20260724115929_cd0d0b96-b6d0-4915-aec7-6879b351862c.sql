
-- 1) Extend clients with GitHub distribution fields
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS github_username text,
  ADD COLUMN IF NOT EXISTS github_repo text DEFAULT 'docs',
  ADD COLUMN IF NOT EXISTS github_token_encrypted text,
  ADD COLUMN IF NOT EXISTS github_pages_url text;

-- 2) format_deployments table
CREATE TABLE IF NOT EXISTS public.format_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_format_id uuid NOT NULL REFERENCES public.ecosystem_formats(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'github_pages',
  status text NOT NULL DEFAULT 'pending',
  published_url text,
  error_reason text,
  deployed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_format_deployments_format ON public.format_deployments(ecosystem_format_id);
CREATE INDEX IF NOT EXISTS idx_format_deployments_status ON public.format_deployments(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.format_deployments TO authenticated;
GRANT ALL ON public.format_deployments TO service_role;

ALTER TABLE public.format_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner or staff view deployments" ON public.format_deployments
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.ecosystem_formats ef
    JOIN public.content_ecosystems e ON e.id = ef.ecosystem_id
    WHERE ef.id = format_deployments.ecosystem_format_id
      AND (e.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'staff'::app_role))
  )
);

CREATE POLICY "Owner inserts deployments" ON public.format_deployments
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ecosystem_formats ef
    JOIN public.content_ecosystems e ON e.id = ef.ecosystem_id
    WHERE ef.id = format_deployments.ecosystem_format_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Owner updates deployments" ON public.format_deployments
FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.ecosystem_formats ef
    JOIN public.content_ecosystems e ON e.id = ef.ecosystem_id
    WHERE ef.id = format_deployments.ecosystem_format_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Owner deletes deployments" ON public.format_deployments
FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.ecosystem_formats ef
    JOIN public.content_ecosystems e ON e.id = ef.ecosystem_id
    WHERE ef.id = format_deployments.ecosystem_format_id
      AND e.user_id = auth.uid()
  )
);

CREATE TRIGGER format_deployments_updated_at
BEFORE UPDATE ON public.format_deployments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Secure RPC to save (encrypt) the GitHub token for a client
CREATE OR REPLACE FUNCTION public.set_client_github_token(
  p_client_id uuid,
  p_token text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.clients WHERE id = p_client_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    UPDATE public.clients SET github_token_encrypted = NULL WHERE id = p_client_id;
  ELSE
    UPDATE public.clients
    SET github_token_encrypted = public.encrypt_sensitive(p_token)
    WHERE id = p_client_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_github_token(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_client_github_token(uuid, text) TO authenticated;
