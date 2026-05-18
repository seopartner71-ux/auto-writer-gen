REVOKE EXECUTE ON FUNCTION public.get_project_github_config(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_project_articles(uuid, vector, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_project_views(uuid) FROM PUBLIC, anon, authenticated;