CREATE TABLE public.radar_brand_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.radar_projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('brand_alias', 'product', 'domain_variant', 'legal_entity')),
  value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_brand_entities TO authenticated;
GRANT ALL ON public.radar_brand_entities TO service_role;

CREATE INDEX idx_radar_brand_entities_project ON public.radar_brand_entities(project_id);
CREATE INDEX idx_radar_brand_entities_user ON public.radar_brand_entities(user_id);
CREATE UNIQUE INDEX idx_radar_brand_entities_unique ON public.radar_brand_entities(project_id, entity_type, lower(value));

ALTER TABLE public.radar_brand_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own brand entities"
  ON public.radar_brand_entities
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_radar_brand_entities_updated_at
  BEFORE UPDATE ON public.radar_brand_entities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();