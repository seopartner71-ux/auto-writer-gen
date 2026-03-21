-- Allow admins to view all keywords
CREATE POLICY "Admins can view all keywords"
ON public.keywords FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all articles
CREATE POLICY "Admins can view all articles"
ON public.articles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all serp_results
CREATE POLICY "Admins can view all serp results"
ON public.serp_results FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));