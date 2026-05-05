ALTER TABLE public.author_profiles
  ADD COLUMN IF NOT EXISTS stealth_profile jsonb;

DO $$
DECLARE
  v_blogger int; v_academic int; v_practitioner int; v_skeptic int; v_provocateur int; v_neutral int; v_default int;
BEGIN
  WITH updated AS (
    UPDATE public.author_profiles SET stealth_profile =
      CASE
        WHEN name ILIKE ANY(ARRAY['%блог%','%blogger%','%лайфстайл%'])
          THEN '{"target_sigma": 13, "type": "blogger"}'::jsonb
        WHEN name ILIKE ANY(ARRAY['%академик%','%аналитик%','%academic%'])
          THEN '{"target_sigma": 10, "type": "academic"}'::jsonb
        WHEN name ILIKE ANY(ARRAY['%практик%','%прораб%','%мастер%','%developer%'])
          THEN '{"target_sigma": 8, "type": "practitioner"}'::jsonb
        WHEN name ILIKE ANY(ARRAY['%скептик%','%инвестор%'])
          THEN '{"target_sigma": 11, "type": "skeptic"}'::jsonb
        WHEN name ILIKE ANY(ARRAY['%провокац%','%копирайт%'])
          THEN '{"target_sigma": 15, "type": "provocateur"}'::jsonb
        WHEN name ILIKE ANY(ARRAY['%miralinks%','%gogetlinks%','%телеграф%'])
          THEN '{"target_sigma": 7, "type": "neutral"}'::jsonb
        ELSE '{"target_sigma": 10, "type": "default"}'::jsonb
      END
    WHERE stealth_profile IS NULL OR stealth_profile = '{}'::jsonb
    RETURNING stealth_profile->>'type' AS t
  )
  SELECT
    count(*) FILTER (WHERE t='blogger'),
    count(*) FILTER (WHERE t='academic'),
    count(*) FILTER (WHERE t='practitioner'),
    count(*) FILTER (WHERE t='skeptic'),
    count(*) FILTER (WHERE t='provocateur'),
    count(*) FILTER (WHERE t='neutral'),
    count(*) FILTER (WHERE t='default')
  INTO v_blogger, v_academic, v_practitioner, v_skeptic, v_provocateur, v_neutral, v_default
  FROM updated;

  RAISE NOTICE 'stealth_profile backfill: blogger=%, academic=%, practitioner=%, skeptic=%, provocateur=%, neutral=%, default=%',
    v_blogger, v_academic, v_practitioner, v_skeptic, v_provocateur, v_neutral, v_default;
END $$;

CREATE OR REPLACE FUNCTION public.claim_queue_items(batch_size int)
RETURNS SETOF public.generation_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.generation_queue q
  SET status = 'processing',
      started_at = now(),
      updated_at = now()
  WHERE q.id IN (
    SELECT id FROM public.generation_queue
    WHERE status IN ('queued', 'retry')
    ORDER BY priority DESC, created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_queue_items(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_queue_items(int) TO service_role;