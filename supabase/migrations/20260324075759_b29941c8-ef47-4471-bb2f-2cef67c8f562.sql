
-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt plaintext using ENCRYPTION_KEY from vault
CREATE OR REPLACE FUNCTION public.encrypt_sensitive(plaintext text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
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
  
  RETURN encode(pgp_sym_encrypt(plaintext, enc_key), 'base64');
END;
$$;

-- Decrypt ciphertext using ENCRYPTION_KEY from vault
CREATE OR REPLACE FUNCTION public.decrypt_sensitive(ciphertext text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  enc_key text;
BEGIN
  IF ciphertext IS NULL OR ciphertext = '' THEN
    RETURN ciphertext;
  END IF;
  
  RETURN pgp_sym_decrypt(decode(ciphertext, 'base64'), (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1
  ));
EXCEPTION
  WHEN OTHERS THEN
    -- If decryption fails, return as-is (plaintext legacy data)
    RETURN ciphertext;
END;
$$;
