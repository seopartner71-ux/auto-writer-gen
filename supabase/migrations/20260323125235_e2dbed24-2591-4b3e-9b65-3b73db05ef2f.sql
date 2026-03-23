
-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- RPC: admin_add_credits
CREATE OR REPLACE FUNCTION public.admin_add_credits(
  p_user_id uuid,
  p_amount integer,
  p_notify boolean DEFAULT true,
  p_comment text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  -- Check caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Add credits
  UPDATE public.profiles
  SET credits_amount = credits_amount + p_amount
  WHERE id = p_user_id
  RETURNING credits_amount INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Create notification if requested
  IF p_notify THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      p_user_id,
      'Баланс пополнен! 🎉',
      'Вам начислено ' || p_amount || ' кредитов.' ||
      CASE WHEN p_comment <> '' THEN ' Комментарий: ' || p_comment ELSE '' END ||
      ' Текущий баланс: ' || v_new_balance || ' кредитов.'
    );
  END IF;

  RETURN jsonb_build_object('new_balance', v_new_balance);
END;
$$;
