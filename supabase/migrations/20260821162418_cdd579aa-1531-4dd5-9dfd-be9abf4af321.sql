-- P16 BLOG / TOPIC AUTHORITY ENGINE

CREATE TABLE IF NOT EXISTS public.topic_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  main_entity text,
  commercial_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  commercial_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  commercial_pages_count integer NOT NULL DEFAULT 0,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords_count integer NOT NULL DEFAULT 0,
  authority_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_clusters_status_chk CHECK (status IN ('draft','approved','published'))
);
CREATE UNIQUE INDEX IF NOT EXISTS topic_clusters_project_name_uk ON public.topic_clusters(project_id, lower(name));
CREATE INDEX IF NOT EXISTS topic_clusters_project_idx ON public.topic_clusters(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_clusters TO authenticated;
GRANT ALL ON public.topic_clusters TO service_role;
ALTER TABLE public.topic_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their topic clusters" ON public.topic_clusters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = topic_clusters.project_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = topic_clusters.project_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.content_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_cluster_id uuid REFERENCES public.topic_clusters(id) ON DELETE CASCADE,
  title text NOT NULL,
  intent text NOT NULL DEFAULT 'informational',
  article_type text NOT NULL DEFAULT 'supporting_article',
  target_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'planned',
  scheduled_at timestamptz,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  url_path text,
  authority_score integer,
  quality jsonb,
  error text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_plan_status_chk CHECK (status IN ('planned','generating','ready','published','failed')),
  CONSTRAINT content_plan_type_chk CHECK (article_type IN ('supporting_article','expert_article','faq_article','comparison_article','guide_article','news_article'))
);
CREATE UNIQUE INDEX IF NOT EXISTS content_plan_project_title_uk ON public.content_plan(project_id, lower(title));
CREATE INDEX IF NOT EXISTS content_plan_project_status_idx ON public.content_plan(project_id, status);
CREATE INDEX IF NOT EXISTS content_plan_cluster_idx ON public.content_plan(topic_cluster_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plan TO authenticated;
GRANT ALL ON public.content_plan TO service_role;
ALTER TABLE public.content_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their content plan" ON public.content_plan
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = content_plan.project_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = content_plan.project_id AND p.user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER topic_clusters_set_updated_at BEFORE UPDATE ON public.topic_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER content_plan_set_updated_at BEFORE UPDATE ON public.content_plan
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS blog_engine_settings jsonb NOT NULL DEFAULT '{}'::jsonb;