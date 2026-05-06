CREATE TABLE public.ai_assistant_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_ai_assistant_usage_user_date ON public.ai_assistant_usage(user_id, date);

ALTER TABLE public.ai_assistant_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own assistant usage"
ON public.ai_assistant_usage FOR SELECT
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage assistant usage"
ON public.ai_assistant_usage FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
