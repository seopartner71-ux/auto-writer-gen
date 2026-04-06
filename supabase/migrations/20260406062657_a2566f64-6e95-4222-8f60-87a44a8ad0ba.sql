
-- Create generation queue table
CREATE TABLE public.generation_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  keyword_id uuid REFERENCES public.keywords(id) ON DELETE SET NULL,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  author_profile_id uuid REFERENCES public.author_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  error_message text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for efficient queue processing
CREATE INDEX idx_generation_queue_status ON public.generation_queue(status);
CREATE INDEX idx_generation_queue_priority ON public.generation_queue(priority DESC, created_at ASC);
CREATE INDEX idx_generation_queue_user ON public.generation_queue(user_id);

-- Enable RLS
ALTER TABLE public.generation_queue ENABLE ROW LEVEL SECURITY;

-- Users can view own queue items
CREATE POLICY "Users can view own queue items"
ON public.generation_queue FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert own queue items
CREATE POLICY "Users can insert own queue items"
ON public.generation_queue FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can delete own queued items (only if still queued)
CREATE POLICY "Users can delete own queued items"
ON public.generation_queue FOR DELETE
USING (auth.uid() = user_id AND status = 'queued');

-- Admins can manage all queue items
CREATE POLICY "Admins can manage all queue items"
ON public.generation_queue FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_queue;

-- Trigger for updated_at
CREATE TRIGGER update_generation_queue_updated_at
BEFORE UPDATE ON public.generation_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
