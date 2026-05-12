
CREATE TABLE public.openrouter_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  note text,
  topped_up_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.openrouter_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage topups" ON public.openrouter_topups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_openrouter_topups_date ON public.openrouter_topups(topped_up_at DESC);
