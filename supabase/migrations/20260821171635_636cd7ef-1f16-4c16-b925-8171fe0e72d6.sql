insert into public.design_profiles (project_id, name, industry, style, color_scheme, typography, layout_type, components_config, is_active)
select 'b143d3a1-0acd-4884-93aa-da0f913696b7', 'Industrial B2B', 'b2b_catalog', 'industrial',
 '{"primary":"#1F3A5F","accent":"#F59E0B","background":"#FFFFFF","surface":"#F4F6F8","text":"#111827","muted":"#6B7280"}'::jsonb,
 '{"heading_font":"IBM Plex Sans","body_font":"Inter","scale":"compact"}'::jsonb,
 'wide',
 '{"templates":{"home":"industrial_home_v1","hub":"hub_v1","category":"industrial_catalog_v1","product":"industrial_product_v1","service":"service_v1","article":"article_v1","informational":"informational_v1","local":"local_v1","system":"system_v1"},"blocks":{},"header_variant":"catalog_bar","footer_variant":"with_requisites","sticky_mobile_cta":true}'::jsonb,
 true
where not exists (select 1 from public.design_profiles where project_id='b143d3a1-0acd-4884-93aa-da0f913696b7');