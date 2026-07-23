
-- Allow staff/admin to view all clients, ecosystems, formats. Mutations still owner-only.

DROP POLICY IF EXISTS "Users manage own clients" ON public.clients;
CREATE POLICY "Owner or staff can view clients" ON public.clients FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Owner inserts clients" ON public.clients FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates clients" ON public.clients FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes clients" ON public.clients FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own ecosystems" ON public.content_ecosystems;
CREATE POLICY "Owner or staff can view ecosystems" ON public.content_ecosystems FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Owner inserts ecosystems" ON public.content_ecosystems FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates ecosystems" ON public.content_ecosystems FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes ecosystems" ON public.content_ecosystems FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage formats via ecosystem" ON public.ecosystem_formats;
CREATE POLICY "Owner or staff can view formats" ON public.ecosystem_formats FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.content_ecosystems e WHERE e.id = ecosystem_formats.ecosystem_id
            AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')))
  );
CREATE POLICY "Owner inserts formats" ON public.ecosystem_formats FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.content_ecosystems e WHERE e.id = ecosystem_formats.ecosystem_id AND e.user_id = auth.uid())
  );
CREATE POLICY "Owner updates formats" ON public.ecosystem_formats FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.content_ecosystems e WHERE e.id = ecosystem_formats.ecosystem_id AND e.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.content_ecosystems e WHERE e.id = ecosystem_formats.ecosystem_id AND e.user_id = auth.uid())
  );
CREATE POLICY "Owner deletes formats" ON public.ecosystem_formats FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.content_ecosystems e WHERE e.id = ecosystem_formats.ecosystem_id AND e.user_id = auth.uid())
  );
