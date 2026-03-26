
CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  id int PRIMARY KEY,
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.telegram_messages (
  update_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  username text,
  first_name text,
  text text,
  raw_update jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_processed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id ON public.telegram_messages (chat_id);

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all on telegram_bot_state" ON public.telegram_bot_state
  FOR ALL TO authenticated USING (false);

CREATE POLICY "Admins can view telegram messages" ON public.telegram_messages
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update telegram messages" ON public.telegram_messages
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_messages;
