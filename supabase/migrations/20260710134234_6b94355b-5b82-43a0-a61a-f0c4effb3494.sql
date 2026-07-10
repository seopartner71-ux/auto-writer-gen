
CREATE OR REPLACE FUNCTION public.rewrite_start(
  p_content text,
  p_language text,
  p_main_keyword text,
  p_source_url text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_article_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_lang text := CASE WHEN p_language = 'en' THEN 'en' ELSE 'ru' END;
  v_chars int := length(coalesce(p_content, ''));
  v_cost int := greatest(5, ceil(v_chars::numeric / 1500)::int);
  v_article_id uuid := p_article_id;
  v_derived_title text := coalesce(nullif(btrim(p_title), ''), left(btrim(p_main_keyword), 200));
  v_ded jsonb;
  v_existing_qd jsonb;
  v_next_qd jsonb;
  v_bypassed boolean := false;
  v_charged int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF v_chars < 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'content_too_short');
  END IF;
  IF v_chars > 60000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'content_too_long');
  END IF;
  IF coalesce(btrim(p_main_keyword), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'main_keyword_required');
  END IF;

  IF v_article_id IS NOT NULL THEN
    -- Ownership check
    IF NOT EXISTS (SELECT 1 FROM articles WHERE id = v_article_id AND user_id = v_user) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'article_not_found');
    END IF;
    UPDATE articles
       SET source = 'rewrite',
           humanize_profile = 'conservative',
           language = v_lang,
           main_keyword = btrim(p_main_keyword),
           source_url = p_source_url,
           content = p_content
     WHERE id = v_article_id;
  ELSE
    INSERT INTO articles (user_id, title, content, language, source, humanize_profile,
                          main_keyword, source_url, keywords, status)
    VALUES (v_user, v_derived_title, p_content, v_lang, 'rewrite', 'conservative',
            btrim(p_main_keyword), p_source_url, ARRAY[btrim(p_main_keyword)], 'draft')
    RETURNING id INTO v_article_id;
  END IF;

  -- Deduct credits (admins bypass inside deduct_credits_v2)
  SELECT public.deduct_credits_v2(
    v_user, v_cost, 'rewrite_start', NULL, v_article_id,
    jsonb_build_object('chars', v_chars, 'language', v_lang)
  ) INTO v_ded;

  IF (v_ded ->> 'ok')::boolean = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_ded ->> 'reason',
                              'balance', v_ded -> 'balance', 'article_id', v_article_id);
  END IF;
  v_bypassed := coalesce((v_ded ->> 'bypassed')::boolean, false);
  v_charged := CASE WHEN v_bypassed THEN 0 ELSE v_cost END;

  -- Stamp quality_details.rewrite for refund tracking
  SELECT quality_details INTO v_existing_qd FROM articles WHERE id = v_article_id;
  v_next_qd := coalesce(v_existing_qd, '{}'::jsonb) || jsonb_build_object(
    'rewrite', jsonb_build_object(
      'credits_charged', v_charged,
      'bypassed', v_bypassed,
      'started_at', now(),
      'chars', v_chars
    )
  );
  UPDATE articles SET quality_details = v_next_qd WHERE id = v_article_id;

  RETURN jsonb_build_object('ok', true, 'article_id', v_article_id,
                            'cost', v_cost, 'bypassed', v_bypassed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rewrite_start(text, text, text, text, text, uuid) TO authenticated;
