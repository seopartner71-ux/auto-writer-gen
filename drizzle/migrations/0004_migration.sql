CREATE TABLE public.monitor_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'not_connected',
  sources text[] NOT NULL DEFAULT '{}',
  last_event_at timestamptz,
  last_verified_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_sites TO authenticated;
GRANT ALL ON public.monitor_sites TO service_role;
ALTER TABLE public.monitor_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all monitor_sites" ON public.monitor_sites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.monitor_ingest_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.monitor_sites(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE, DELETE ON public.monitor_ingest_keys TO authenticated;
GRANT ALL ON public.monitor_ingest_keys TO service_role;
ALTER TABLE public.monitor_ingest_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read keys" ON public.monitor_ingest_keys FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin update keys" ON public.monitor_ingest_keys FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete keys" ON public.monitor_ingest_keys FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.monitor_bot_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ua_pattern text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'ai_crawler',
  vendor text,
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_bot_signatures TO authenticated;
GRANT ALL ON public.monitor_bot_signatures TO service_role;
ALTER TABLE public.monitor_bot_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all bots" ON public.monitor_bot_signatures FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.monitor_ai_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  referrer_pattern text NOT NULL UNIQUE,
  utm_pattern text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_ai_sources TO authenticated;
GRANT ALL ON public.monitor_ai_sources TO service_role;
ALTER TABLE public.monitor_ai_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all sources" ON public.monitor_ai_sources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.monitor_events (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.monitor_sites(id) ON DELETE CASCADE,
  kind text NOT NULL,
  bot_id uuid REFERENCES public.monitor_bot_signatures(id) ON DELETE SET NULL,
  bot_name text,
  bot_category text,
  source_id uuid REFERENCES public.monitor_ai_sources(id) ON DELETE SET NULL,
  source_name text,
  detection text,
  url text NOT NULL,
  http_status int,
  user_agent text,
  referrer text,
  visitor_hash text,
  ingest_method text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitor_events_site_time ON public.monitor_events(site_id, occurred_at DESC);
CREATE INDEX monitor_events_site_kind ON public.monitor_events(site_id, kind, occurred_at DESC);
GRANT SELECT, DELETE ON public.monitor_events TO authenticated;
GRANT ALL ON public.monitor_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.monitor_events_id_seq TO service_role;
ALTER TABLE public.monitor_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read events" ON public.monitor_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete events" ON public.monitor_events FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

INSERT INTO public.monitor_bot_signatures(name, ua_pattern, category, vendor, priority) VALUES
 ('OAI-SearchBot','oai-searchbot','ai_search','OpenAI',10),
 ('ChatGPT-User','chatgpt-user','ai_user_fetch','OpenAI',10),
 ('GPTBot','gptbot','ai_crawler','OpenAI',20),
 ('Claude-SearchBot','claude-searchbot','ai_search','Anthropic',10),
 ('Claude-User','claude-user','ai_user_fetch','Anthropic',10),
 ('ClaudeBot','claudebot','ai_crawler','Anthropic',20),
 ('Perplexity-User','perplexity-user','ai_user_fetch','Perplexity',10),
 ('PerplexityBot','perplexitybot','ai_search','Perplexity',20),
 ('Google-Extended','google-extended','ai_crawler','Google',10),
 ('Googlebot','googlebot','search','Google',50),
 ('Bingbot','bingbot','search','Microsoft',50),
 ('YandexBot','yandexbot','search','Yandex',50),
 ('Applebot','applebot','search','Apple',60);

INSERT INTO public.monitor_ai_sources(name, referrer_pattern, utm_pattern) VALUES
 ('ChatGPT','chatgpt.com','chatgpt'),
 ('ChatGPT','chat.openai.com',NULL),
 ('Perplexity','perplexity.ai','perplexity'),
 ('Claude','claude.ai','claude'),
 ('Gemini','gemini.google.com','gemini'),
 ('Microsoft Copilot','copilot.microsoft.com','copilot'),
 ('DeepSeek','chat.deepseek.com','deepseek'),
 ('Алиса (Яндекс)','alice.yandex.ru',NULL);

CREATE OR REPLACE FUNCTION public.monitor_stats(p_site uuid, p_from timestamptz, p_to timestamptz, p_kind text DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH e AS (
    SELECT * FROM monitor_events
    WHERE NOT is_test AND occurred_at >= p_from AND occurred_at < p_to
      AND (p_site IS NULL OR site_id = p_site)
      AND (p_kind IS NULL OR kind = p_kind)
      AND (p_name IS NULL OR bot_name = p_name OR source_name = p_name)
  )
  SELECT jsonb_build_object(
    'bot_requests', (SELECT count(*) FROM e WHERE kind='bot'),
    'bot_unique_urls', (SELECT count(DISTINCT url) FROM e WHERE kind='bot'),
    'referral_visits', (SELECT count(*) FROM e WHERE kind='referral'),
    'referral_visitors', (SELECT count(DISTINCT visitor_hash) FROM e WHERE kind='referral' AND visitor_hash IS NOT NULL),
    'referral_sources', (SELECT count(DISTINCT source_name) FROM e WHERE kind='referral'),
    'last_event_at', (SELECT max(received_at) FROM e),
    'daily', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
        SELECT jsonb_build_object('day', to_char(date_trunc('day', occurred_at),'YYYY-MM-DD'),
          'bot', count(*) FILTER (WHERE kind='bot'), 'referral', count(*) FILTER (WHERE kind='referral')) d
        FROM e GROUP BY date_trunc('day', occurred_at)) x), '[]'::jsonb),
    'bots', COALESCE((SELECT jsonb_agg(b ORDER BY (b->>'requests')::int DESC) FROM (
        SELECT jsonb_build_object('name', bot_name, 'category', max(bot_category), 'requests', count(*),
          'unique_urls', count(DISTINCT url), 'last', max(occurred_at)) b
        FROM e WHERE kind='bot' GROUP BY bot_name) x), '[]'::jsonb),
    'bot_pages', COALESCE((SELECT jsonb_agg(p ORDER BY (p->>'requests')::int DESC) FROM (
        SELECT jsonb_build_object('url', url, 'requests', count(*), 'bots', count(DISTINCT bot_name)) p
        FROM e WHERE kind='bot' GROUP BY url ORDER BY count(*) DESC LIMIT 50) x), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(s ORDER BY (s->>'visits')::int DESC) FROM (
        SELECT jsonb_build_object('name', source_name, 'visits', count(*),
          'visitors', count(DISTINCT visitor_hash), 'last', max(occurred_at),
          'detection', string_agg(DISTINCT detection, ', ')) s
        FROM e WHERE kind='referral' GROUP BY source_name) x), '[]'::jsonb),
    'landing_pages', COALESCE((SELECT jsonb_agg(p ORDER BY (p->>'visits')::int DESC) FROM (
        SELECT jsonb_build_object('url', url, 'visits', count(*), 'sources', string_agg(DISTINCT source_name, ', ')) p
        FROM e WHERE kind='referral' GROUP BY url ORDER BY count(*) DESC LIMIT 50) x), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.monitor_stats(uuid,timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monitor_stats(uuid,timestamptz,timestamptz,text,text) TO authenticated;