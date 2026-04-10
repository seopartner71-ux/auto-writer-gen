
CREATE TABLE public.payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  plan_id text,
  amount_rub numeric NOT NULL DEFAULT 0,
  order_id text,
  status text NOT NULL DEFAULT 'success',
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payment_logs"
  ON public.payment_logs
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_payment_logs_user_id ON public.payment_logs(user_id);
CREATE INDEX idx_payment_logs_created_at ON public.payment_logs(created_at DESC);
