ALTER TABLE public.profiles ADD COLUMN is_active boolean NOT NULL DEFAULT false;

-- Create edge function to delete user (admin only)
-- Admin can delete users via edge function since we can't directly delete from auth.users