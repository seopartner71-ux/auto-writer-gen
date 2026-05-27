ALTER TABLE public.radar_results
  ADD COLUMN IF NOT EXISTS is_branded_query BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_radar_results_branded
  ON public.radar_results(is_branded_query)
  WHERE is_branded_query = false;