
ALTER TABLE public.profiles
ADD COLUMN last_ip text,
ADD COLUMN last_login_at timestamp with time zone;
