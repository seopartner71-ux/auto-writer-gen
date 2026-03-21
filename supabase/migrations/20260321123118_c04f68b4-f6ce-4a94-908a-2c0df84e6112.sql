
-- API Keys vault (admin-only, stores encrypted keys)
CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL, -- 'openai', 'anthropic', 'gemini', 'serper'
    api_key text NOT NULL,
    label text,
    is_valid boolean DEFAULT true,
    last_checked_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(provider)
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can manage api_keys" ON public.api_keys
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Task-to-model assignments
CREATE TABLE public.task_model_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_key text NOT NULL UNIQUE, -- 'researcher', 'writer_basic', 'writer_pro'
    model_key text NOT NULL,
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.task_model_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view assignments" ON public.task_model_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins can manage assignments" ON public.task_model_assignments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Seed default assignments
INSERT INTO public.task_model_assignments (task_key, model_key) VALUES
  ('researcher', 'google/gemini-2.5-flash'),
  ('writer_basic', 'google/gemini-2.5-flash-lite'),
  ('writer_pro', 'google/gemini-2.5-pro');

-- Seed default AI models
INSERT INTO public.ai_models (model_key, display_name, tier, is_active) VALUES
  ('google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 'basic', true),
  ('google/gemini-2.5-flash', 'Gemini 2.5 Flash', 'pro', true),
  ('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 'pro', true),
  ('openai/gpt-5-nano', 'GPT-5 Nano', 'basic', true),
  ('openai/gpt-5', 'GPT-5', 'pro', true),
  ('openai/gpt-5-mini', 'GPT-5 Mini', 'pro', true),
  ('google/gemini-3-flash-preview', 'Gemini 3 Flash Preview', 'pro', true);

-- Add admin policy for profiles (admin can view all)
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Add admin policy for usage_logs insert (edge functions insert on behalf)
CREATE POLICY "Service can insert usage logs" ON public.usage_logs
  FOR INSERT WITH CHECK (true);

-- Allow admins to update profiles (change plan/limits)
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- Add monthly_limit column to profiles
ALTER TABLE public.profiles ADD COLUMN monthly_limit integer DEFAULT 30;

-- Update trigger for api_keys
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_task_model_assignments_updated_at
  BEFORE UPDATE ON public.task_model_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
