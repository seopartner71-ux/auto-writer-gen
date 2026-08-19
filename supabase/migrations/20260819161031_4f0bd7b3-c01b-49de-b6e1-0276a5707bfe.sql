-- Manual dedupe of 6 word-order duplicate clusters in E2E test project
DO $$
DECLARE
  proj uuid := 'c690340c-719b-4c24-a54d-9f1ca5e3c804';
  pairs text[][] := ARRAY[
    ARRAY['3ba29ae3-d39b-47a2-8b07-3327120cf834','3ae576c5-e92a-4751-a299-7cbf7e69123f'],
    ARRAY['4ed6e69e-b34f-4b45-9e36-77e6ca13e5af','897c6124-b0b4-41d2-b4ad-92e4380e6913'],
    ARRAY['11dfdf83-da7d-4320-97c2-f4f5540408ac','c6994d52-ba01-4613-8d3c-ed16f25b9c50'],
    ARRAY['f22f096f-1ecf-4488-aba7-e1397e4c1c1a','b0cc6824-63cd-4b54-9fcd-ea0d2b0576a3'],
    ARRAY['7da778bb-2e00-4ec7-8796-031a98c19306','242c4b59-29f2-4b5f-9f5b-b36023b93c3b'],
    ARRAY['5c2a19a1-7357-42a1-a3e7-c11e94dd9f14','c99f0549-6e6f-4efb-95dd-2787f05c41b1']
  ];
  keep uuid; drop_id uuid; keep_silo uuid; i int;
BEGIN
  FOR i IN 1..array_length(pairs,1) LOOP
    keep := pairs[i][1]::uuid;
    drop_id := pairs[i][2]::uuid;
    SELECT silo_id INTO keep_silo FROM site_clusters WHERE id = keep;

    UPDATE site_products SET site_cluster_id = keep, silo_id = keep_silo
      WHERE site_cluster_id = drop_id AND project_id = proj;
    UPDATE site_keywords SET site_cluster_id = keep, silo_id = keep_silo
      WHERE site_cluster_id = drop_id AND project_id = proj;

    UPDATE site_clusters k
      SET seo_content = COALESCE(NULLIF(k.seo_content, '{}'::jsonb), d.seo_content)
      FROM site_clusters d
      WHERE k.id = keep AND d.id = drop_id AND (k.seo_content IS NULL OR k.seo_content = '{}'::jsonb);

    UPDATE site_clusters SET status = 'archived' WHERE id = drop_id;
  END LOOP;

  -- Move remaining live cluster out of the archived duplicate silo
  UPDATE site_clusters SET silo_id = 'be549d53-38db-4310-bd33-b2c7b5ae77fc'
    WHERE id = '5ce2f530-ef19-4ceb-a303-c94788ff4010' AND status <> 'archived';
  UPDATE site_products SET silo_id = 'be549d53-38db-4310-bd33-b2c7b5ae77fc'
    WHERE site_cluster_id = '5ce2f530-ef19-4ceb-a303-c94788ff4010';
END $$;