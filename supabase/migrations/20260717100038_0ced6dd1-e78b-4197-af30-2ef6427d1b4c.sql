
-- Author profile sharing: owner can grant read access to other users
CREATE TABLE public.author_profile_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_profile_id uuid NOT NULL REFERENCES public.author_profiles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  shared_with_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (author_profile_id, shared_with_user_id)
);

CREATE INDEX idx_aps_shared_with ON public.author_profile_shares(shared_with_user_id);
CREATE INDEX idx_aps_author ON public.author_profile_shares(author_profile_id);

GRANT SELECT, INSERT, DELETE ON public.author_profile_shares TO authenticated;
GRANT ALL ON public.author_profile_shares TO service_role;

ALTER TABLE public.author_profile_shares ENABLE ROW LEVEL SECURITY;

-- Owner can see, add, remove their own shares
CREATE POLICY "Owner manages shares"
ON public.author_profile_shares
FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Recipient can see rows granted to them (needed to list shared-with-me authors)
CREATE POLICY "Recipient views own shares"
ON public.author_profile_shares
FOR SELECT
TO authenticated
USING (auth.uid() = shared_with_user_id);

-- Extend author_profiles SELECT: user can view profiles shared with them
CREATE POLICY "Users can view author profiles shared with them"
ON public.author_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.author_profile_shares s
    WHERE s.author_profile_id = author_profiles.id
      AND s.shared_with_user_id = auth.uid()
  )
);
