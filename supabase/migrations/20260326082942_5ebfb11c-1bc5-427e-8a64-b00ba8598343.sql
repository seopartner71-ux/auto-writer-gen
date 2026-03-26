
-- Create ticket_messages table for conversation threads
CREATE TABLE public.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_role text NOT NULL DEFAULT 'user' CHECK (sender_role IN ('user', 'admin')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

-- Users can view messages on their own tickets
CREATE POLICY "Users can view own ticket messages"
ON public.ticket_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets st
    WHERE st.id = ticket_messages.ticket_id AND st.user_id = auth.uid()
  )
);

-- Users can insert messages on their own open tickets
CREATE POLICY "Users can insert own ticket messages"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_role = 'user' AND
  EXISTS (
    SELECT 1 FROM public.support_tickets st
    WHERE st.id = ticket_messages.ticket_id AND st.user_id = auth.uid()
  )
);

-- Admins can view all ticket messages
CREATE POLICY "Admins can view all ticket messages"
ON public.ticket_messages
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert messages on any ticket
CREATE POLICY "Admins can insert ticket messages"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_role = 'admin' AND has_role(auth.uid(), 'admin'::app_role)
);

-- Admins can delete ticket messages
CREATE POLICY "Admins can delete ticket messages"
ON public.ticket_messages
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
