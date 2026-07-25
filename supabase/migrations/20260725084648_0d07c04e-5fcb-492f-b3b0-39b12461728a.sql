CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.encrypt_sensitive(plaintext text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  enc_key text;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN plaintext;
  END IF;

  SELECT decrypted_secret INTO enc_key
  FROM vault.decrypted_secrets
  WHERE name = 'ENCRYPTION_KEY'
  LIMIT 1;

  IF enc_key IS NULL THEN
    RAISE EXCEPTION 'ENCRYPTION_KEY not found in vault';
  END IF;

  RETURN encode(extensions.pgp_sym_encrypt(plaintext, enc_key), 'base64');
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrypt_sensitive(ciphertext text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

  RETURN extensions.pgp_sym_decrypt(decode(ciphertext, 'base64'), enc_key);
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