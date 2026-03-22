
-- Bulk generation jobs table
CREATE TABLE public.bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_profile_id uuid REFERENCES public.author_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  total_items integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Individual items in a bulk job
CREATE TABLE public.bulk_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES public.bulk_jobs(id) ON DELETE CASCADE,
  seed_keyword text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  keyword_id uuid REFERENCES public.keywords(id) ON DELETE SET NULL,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bulk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_job_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for bulk_jobs
CREATE POLICY "Users can view own bulk jobs" ON public.bulk_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bulk jobs" ON public.bulk_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own bulk jobs" ON public.bulk_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own bulk jobs" ON public.bulk_jobs FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for bulk_job_items (join through bulk_jobs)
CREATE POLICY "Users can view own bulk job items" ON public.bulk_job_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.bulk_jobs bj WHERE bj.id = bulk_job_items.bulk_job_id AND bj.user_id = auth.uid()));
CREATE POLICY "Users can insert own bulk job items" ON public.bulk_job_items FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.bulk_jobs bj WHERE bj.id = bulk_job_items.bulk_job_id AND bj.user_id = auth.uid()));
CREATE POLICY "Users can update own bulk job items" ON public.bulk_job_items FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.bulk_jobs bj WHERE bj.id = bulk_job_items.bulk_job_id AND bj.user_id = auth.uid()));

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_job_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_jobs;

-- Update trigger
CREATE TRIGGER update_bulk_jobs_updated_at BEFORE UPDATE ON public.bulk_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bulk_job_items_updated_at BEFORE UPDATE ON public.bulk_job_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
