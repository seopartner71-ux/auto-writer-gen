
-- 1) error_logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view error_logs" ON public.error_logs;
CREATE POLICY "Admins can view error_logs"
ON public.error_logs FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role can insert error_logs" ON public.error_logs;
CREATE POLICY "Service role can insert error_logs"
ON public.error_logs FOR INSERT
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_error_logs_context_created
  ON public.error_logs (context, created_at DESC);

-- 2) idempotency_key on generation_queue
ALTER TABLE public.generation_queue
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS generation_queue_idempotency_key_idx
  ON public.generation_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3) decrypt_sensitive: log + NULL on error (was: return ciphertext)
CREATE OR REPLACE FUNCTION public.decrypt_sensitive(ciphertext text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  enc_key text;
BEGIN
  IF ciphertext IS NULL OR ciphertext = '' THEN
    RETURN ciphertext;
  END IF;

  SELECT decrypted_secret INTO enc_key
  FROM vault.decrypted_secrets
  WHERE name = 'ENCRYPTION_KEY' LIMIT 1;

  IF enc_key IS NULL THEN
    INSERT INTO public.error_logs(context, message)
    VALUES ('decrypt_sensitive', 'ENCRYPTION_KEY missing in vault');
    RETURN NULL;
  END IF;

  RETURN pgp_sym_decrypt(decode(ciphertext, 'base64'), enc_key);
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs(context, message)
      VALUES ('decrypt_sensitive', SQLERRM);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
END;
$function$;
