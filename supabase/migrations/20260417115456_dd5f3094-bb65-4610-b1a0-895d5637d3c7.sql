-- Auto-correct hosting_platform based on actual domain suffix
UPDATE public.projects SET hosting_platform = 'vercel' WHERE lower(domain) LIKE '%vercel.app%' AND hosting_platform IS DISTINCT FROM 'vercel';
UPDATE public.projects SET hosting_platform = 'cloudflare' WHERE lower(domain) LIKE '%pages.dev%' AND hosting_platform IS DISTINCT FROM 'cloudflare';
UPDATE public.projects SET hosting_platform = 'netlify' WHERE (lower(domain) LIKE '%netlify.app%' OR lower(domain) LIKE '%netlify.com%') AND hosting_platform IS DISTINCT FROM 'netlify';