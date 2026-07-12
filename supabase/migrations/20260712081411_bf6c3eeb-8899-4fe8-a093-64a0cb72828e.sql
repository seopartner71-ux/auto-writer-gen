CREATE TABLE public.activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  session_id text,
  time_since_prev_ms bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activation_events_user ON public.activation_events(user_id, created_at DESC);
CREATE INDEX idx_activation_events_event ON public.activation_events(event_name, created_at DESC);

GRANT SELECT, INSERT ON public.activation_events TO authenticated;
GRANT ALL ON public.activation_events TO service_role;

ALTER TABLE public.activation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own activation events"
  ON public.activation_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own activation events"
  ON public.activation_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all activation events"
  ON public.activation_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));