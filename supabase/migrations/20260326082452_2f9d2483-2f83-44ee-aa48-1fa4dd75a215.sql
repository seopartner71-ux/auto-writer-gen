
-- Add admin_reply column to support_tickets
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS admin_reply text;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS replied_at timestamptz;

-- Allow admins to delete tickets
CREATE POLICY "Admins can delete tickets"
ON public.support_tickets
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
