CREATE OR REPLACE FUNCTION public.tg_send_daily_summary()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start timestamptz := date_trunc('day', (now() AT TIME ZONE 'Europe/Moscow')) AT TIME ZONE 'Europe/Moscow';
  v_articles_today int; v_new_pending int; v_activated int; v_credits_spent int;
  v_payments_count int; v_payments_sum numeric; v_errors int; v_total_active int; v_total_articles int;
BEGIN
  SELECT COUNT(*) INTO v_articles_today FROM public.articles
    WHERE status IN ('completed','done','published') AND COALESCE(updated_at, created_at) >= v_day_start;
  SELECT COUNT(*) INTO v_new_pending FROM public.profiles WHERE created_at >= v_day_start AND status = 'pending';
  SELECT COUNT(*) INTO v_activated FROM public.profiles WHERE status = 'active' AND created_at >= v_day_start;
  SELECT COALESCE(SUM(-amount), 0) INTO v_credits_spent FROM public.credit_transactions WHERE amount < 0 AND created_at >= v_day_start;
  SELECT COUNT(*), COALESCE(SUM(amount_rub), 0) INTO v_payments_count, v_payments_sum
    FROM public.payment_logs WHERE status = 'success' AND created_at >= v_day_start;
  SELECT COUNT(*) INTO v_errors FROM public.articles
    WHERE status IN ('error','failed') AND COALESCE(updated_at, created_at) >= v_day_start;
  SELECT COUNT(*) INTO v_total_active FROM public.profiles WHERE status = 'active';
  SELECT COUNT(*) INTO v_total_articles FROM public.articles WHERE status IN ('completed','done','published');
  PERFORM public.tg_notify('daily_summary', jsonb_build_object(
    'articles_today', v_articles_today, 'new_pending', v_new_pending, 'activated', v_activated,
    'credits_spent', v_credits_spent, 'payments_count', v_payments_count, 'payments_sum', v_payments_sum,
    'errors', v_errors, 'total_active', v_total_active, 'total_articles', v_total_articles));
END;
$function$;