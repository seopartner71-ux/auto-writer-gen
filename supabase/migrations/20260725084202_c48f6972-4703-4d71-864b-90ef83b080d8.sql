DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ENCRYPTION_KEY') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'ENCRYPTION_KEY',
      'Master encryption key for sensitive client data'
    );
  END IF;
END $$;