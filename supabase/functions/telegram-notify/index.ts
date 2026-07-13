import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function nowMsk(): string {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function esc(s: unknown): string {
  return String(s ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY is not configured');

    const { type, data } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'telegram_admin_chat_id')
      .single();

    if (!setting?.value) {
      throw new Error('telegram_admin_chat_id not configured in app_settings');
    }

    const chatId = setting.value;
    const d = data || {};
    const ts = nowMsk();
    let text = '';

    switch (type) {
      case 'article_done': {
        text =
          `✅ <b>Написана статья</b>\n\n` +
          `👤 ${esc(d.user_name || d.email)}\n` +
          `📝 ${esc(d.title)}\n` +
          `🌐 ${esc(d.domain)}\n` +
          `📂 Источник: ${esc(d.source)}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'new_registration': {
        text =
          `🆕 <b>Новая регистрация</b>\n\n` +
          `👤 ${esc(d.full_name)}\n` +
          `📧 ${esc(d.email)}\n` +
          (d.niche ? `🎯 Тематика: ${esc(d.niche)}\n` : '') +
          (d.planned_articles ? `📊 Статей/мес: ${esc(d.planned_articles)}\n` : '') +
          (d.referral_source ? `📣 Источник: ${esc(d.referral_source)}\n` : '') +
          (d.ip ? `🌍 IP: ${esc(d.ip)}\n` : '') +
          `💳 Тариф: NANO, 3 кредита\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'user_activated': {
        text =
          `✅ <b>Пользователь активирован</b>\n\n` +
          `👤 ${esc(d.full_name)}\n` +
          `📧 ${esc(d.email)}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'payment_received': {
        let userName = d.full_name as string | undefined;
        if (!userName && d.email) {
          const { data: p } = await supabase
            .from('profiles').select('full_name').eq('email', d.email).maybeSingle();
          userName = p?.full_name || undefined;
        }
        text =
          `💳 <b>Оплата тарифа</b>\n\n` +
          `👤 ${esc(userName || d.email)}\n` +
          `📧 ${esc(d.email)}\n` +
          `💰 Тариф: ${esc(d.plan)}\n` +
          `💵 Сумма: ${esc(d.sum)} руб.\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'low_credits': {
        text =
          `⚠️ <b>Мало кредитов</b>\n\n` +
          `👤 ${esc(d.full_name || d.email)}\n` +
          `📧 ${esc(d.email)}\n` +
          `💳 Остаток: ${esc(d.balance)} кредитов\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'no_credits': {
        text =
          `🚨 <b>Кредиты закончились</b>\n\n` +
          `👤 ${esc(d.full_name || d.email)}\n` +
          `📧 ${esc(d.email)}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'article_error': {
        text =
          `❌ <b>Ошибка написания</b>\n\n` +
          `👤 ${esc(d.user_name || d.email)}\n` +
          `📝 ${esc(d.title)}\n` +
          `⚠️ ${esc(String(d.error || '').slice(0, 300))}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'plan_responded': {
        text =
          `✅ <b>Клиент согласовал темы</b>\n\n` +
          `🏢 Клиент: ${esc(d.client_name)}\n` +
          `🌐 Сайт: ${esc(d.domain)}\n` +
          `📅 План: ${esc(d.month)}/${esc(d.year)}\n` +
          `✅ Согласовано: ${esc(d.ok ?? 0)}\n` +
          `🔄 На доработке: ${esc(d.rev ?? 0)}\n` +
          `❌ Отклонено: ${esc(d.no ?? 0)}\n` +
          `🕐 ${ts}\n\n` +
          `👉 Можно запускать написание статей`;
        break;
      }
      case 'stuck_queue': {
        const mins = Math.round(Number(d.minutes ?? 0));
        text =
          `🚨 <b>Зависшая очередь</b>\n\n` +
          `📝 Тема: ${esc(d.title)}\n` +
          `🏢 Клиент: ${esc(d.client_name)}\n` +
          `⏱ Висит: ${mins} минут\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'daily_summary': {
        const dateStr = new Date().toLocaleDateString('ru-RU', {
          timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
        });
        text =
          `📊 <b>Сводка за ${dateStr}</b>\n\n` +
          `✅ Написано статей: ${esc(d.articles_today ?? 0)}\n` +
          `👥 Новых заявок: ${esc(d.new_pending ?? 0)}\n` +
          `✅ Активировано пользователей: ${esc(d.activated ?? 0)}\n` +
          `💳 Потрачено кредитов: ${esc(d.credits_spent ?? 0)}\n` +
          `💰 Оплат тарифов: ${esc(d.payments_count ?? 0)} на ${esc(d.payments_sum ?? 0)} руб.\n` +
          `❌ Ошибок написания: ${esc(d.errors ?? 0)}\n\n` +
          `📈 Всего активных пользователей: ${esc(d.total_active ?? 0)}\n` +
          `📝 Всего написано статей: ${esc(d.total_articles ?? 0)}`;
        break;
      }
      // Поддержка — не технический алерт, оставляем доступным.
      case 'new_support_ticket': {
        text =
          `🎫 <b>Новый запрос в поддержку</b>\n\n` +
          `📧 От: ${esc(d.email)}\n` +
          `📋 Тема: ${esc(d.subject)}\n` +
          `💬 ${esc(String(d.message || '').slice(0, 500))}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'support_user_reply': {
        text =
          `💬 <b>Ответ пользователя в тикете</b>\n\n` +
          `📧 От: ${esc(d.email)}\n` +
          `📋 Тема: ${esc(d.subject)}\n` +
          `💬 ${esc(String(d.message || '').slice(0, 500))}\n` +
          `🕐 ${ts}`;
        break;
      }
      case 'articles_digest': {
        // Digest text is fully pre-built by tg-daily-digest.
        text = String(d.text || '').slice(0, 3800);
        if (!text) {
          return new Response(JSON.stringify({ success: true, ignored: 'empty digest' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        break;
      }
      default: {
        // Неизвестный/устаревший тип — игнорируем, не шлём в чат.
        return new Response(JSON.stringify({ success: true, ignored: type }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    const responseData = await response.json();
    if (!response.ok) {
      throw new Error(`Telegram API failed [${response.status}]: ${JSON.stringify(responseData)}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('telegram-notify error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
