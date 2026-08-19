CREATE TABLE public.site_silos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  position smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  hub_article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

CREATE TABLE public.site_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  silo_id uuid NOT NULL REFERENCES public.site_silos(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.site_clusters(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  position smallint NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'cluster',
  status text NOT NULL DEFAULT 'draft',
  hub_article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (silo_id, slug)
);

CREATE TABLE public.internal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_article_id uuid REFERENCES public.articles(id) ON DELETE CASCADE,
  to_article_id uuid REFERENCES public.articles(id) ON DELETE CASCADE,
  to_path text,
  anchor text,
  type text NOT NULL DEFAULT 'contextual',
  is_silo_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX internal_links_pair_uidx
  ON public.internal_links (from_article_id, coalesce(to_article_id::text, to_path));
CREATE INDEX internal_links_project_idx ON public.internal_links (project_id);
CREATE INDEX site_clusters_silo_idx ON public.site_clusters (silo_id);
CREATE INDEX site_silos_project_idx ON public.site_silos (project_id);

ALTER TABLE public.articles
  ADD COLUMN silo_id uuid REFERENCES public.site_silos(id) ON DELETE SET NULL,
  ADD COLUMN site_cluster_id uuid REFERENCES public.site_clusters(id) ON DELETE SET NULL,
  ADD COLUMN slug text,
  ADD COLUMN url_path text;

CREATE INDEX articles_silo_idx ON public.articles (silo_id);
CREATE INDEX articles_site_cluster_idx ON public.articles (site_cluster_id);

ALTER TABLE public.projects ADD COLUMN url_scheme text NOT NULL DEFAULT 'legacy';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_silos TO authenticated;
GRANT ALL ON public.site_silos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_clusters TO authenticated;
GRANT ALL ON public.site_clusters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_links TO authenticated;
GRANT ALL ON public.internal_links TO service_role;

ALTER TABLE public.site_silos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage silos of own projects" ON public.site_silos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_silos.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_silos.project_id AND p.user_id = auth.uid()));

CREATE POLICY "Users manage clusters of own projects" ON public.site_clusters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_clusters.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_clusters.project_id AND p.user_id = auth.uid()));

CREATE POLICY "Users manage links of own projects" ON public.internal_links FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = internal_links.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = internal_links.project_id AND p.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.silo_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER site_silos_touch BEFORE UPDATE ON public.site_silos
  FOR EACH ROW EXECUTE FUNCTION public.silo_touch_updated_at();
CREATE TRIGGER site_clusters_touch BEFORE UPDATE ON public.site_clusters
  FOR EACH ROW EXECUTE FUNCTION public.silo_touch_updated_at();
CREATE TRIGGER internal_links_touch BEFORE UPDATE ON public.internal_links
  FOR EACH ROW EXECUTE FUNCTION public.silo_touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_article_silo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE sp uuid; cp uuid;
BEGIN
  IF NEW.silo_id IS NOT NULL THEN
    SELECT project_id INTO sp FROM public.site_silos WHERE id = NEW.silo_id;
    IF sp IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'silo belongs to another project';
    END IF;
  END IF;
  IF NEW.site_cluster_id IS NOT NULL THEN
    SELECT project_id INTO cp FROM public.site_clusters WHERE id = NEW.site_cluster_id;
    IF cp IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'cluster belongs to another project';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER articles_validate_silo BEFORE INSERT OR UPDATE OF silo_id, site_cluster_id, project_id
  ON public.articles FOR EACH ROW EXECUTE FUNCTION public.validate_article_silo();