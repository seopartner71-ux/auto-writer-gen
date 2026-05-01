
CREATE TABLE public.domain_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  domain text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  tf integer DEFAULT 0,
  cf integer DEFAULT 0,
  bl integer DEFAULT 0,
  age_years integer DEFAULT 0,
  archive_first_date text,
  archive_last_date text,
  archive_has_snapshots boolean DEFAULT false,
  google_indexed boolean DEFAULT false,
  google_results_count integer DEFAULT 0,
  spam_listed boolean DEFAULT false,
  status text NOT NULL DEFAULT 'available',
  assigned_project_id uuid,
  raw_csv_data jsonb DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_checks_user_domain ON public.domain_checks(user_id, domain);
CREATE INDEX idx_domain_checks_checked_at ON public.domain_checks(checked_at DESC);
CREATE INDEX idx_domain_checks_score ON public.domain_checks(user_id, score DESC);

ALTER TABLE public.domain_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own domain checks"
ON public.domain_checks FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all domain checks"
ON public.domain_checks FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
