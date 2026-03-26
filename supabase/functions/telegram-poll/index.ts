import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

Deno.serve(async () => {
  const startTime = Date.now();

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY is not configured');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let totalProcessed = 0;
  let currentOffset: number;

  // Read initial offset
  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) {
    return new Response(JSON.stringify({ error: stateErr.message }), { status: 500 });
  }

  currentOffset = state.update_offset;

  // Get admin chat_id to filter out admin messages
  const { data: adminSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'telegram_admin_chat_id')
    .single();

  const adminChatId = adminSetting?.value;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;

    if (remainingMs < MIN_REMAINING_MS) break;

    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const response = await fetch(`${GATEWAY_URL}/getUpdates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        offset: currentOffset,
        timeout,
        allowed_updates: ['message'],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: data }), { status: 502 });
    }

    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    // Process messages - store support messages and handle /start
    const rows = [];
    for (const u of updates) {
      if (!u.message) continue;

      const msg = u.message;
      const chatId = String(msg.chat.id);

      // Handle /start command
      if (msg.text === '/start') {
        await fetch(`${GATEWAY_URL}/sendMessage`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': TELEGRAM_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: '👋 Добро пожаловать в службу поддержки SERPblueprint!\n\nНапишите ваш вопрос, и мы ответим вам в ближайшее время.',
            parse_mode: 'HTML',
          }),
        });
        continue;
      }

      // Skip messages from admin (they are replies)
      if (chatId === adminChatId) continue;

      rows.push({
        update_id: u.update_id,
        chat_id: msg.chat.id,
        username: msg.from?.username ?? null,
        first_name: msg.from?.first_name ?? null,
        text: msg.text ?? null,
        raw_update: u,
      });

      // Also create a support ticket
      const ticketMessage = msg.text || '[медиа-сообщение]';
      const userName = msg.from?.first_name || msg.from?.username || 'Telegram user';

      await supabase.from('support_tickets').insert({
        user_id: '00000000-0000-0000-0000-000000000000', // placeholder for telegram users
        subject: `Telegram: ${userName}`,
        message: `[chat_id: ${chatId}] ${ticketMessage}`,
        status: 'open',
      }).then(() => {
        // Notify admin about new support message
        fetch(`${GATEWAY_URL}/sendMessage`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': TELEGRAM_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: adminChatId,
            text: `📩 <b>Новое сообщение поддержки</b>\n\n` +
              `👤 ${userName} (@${msg.from?.username || 'нет username'})\n` +
              `💬 ${ticketMessage}\n\n` +
              `Chat ID: <code>${chatId}</code>`,
            parse_mode: 'HTML',
          }),
        });
      });
    }

    if (rows.length > 0) {
      const { error: insertErr } = await supabase
        .from('telegram_messages')
        .upsert(rows, { onConflict: 'update_id' });

      if (insertErr) {
        return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
      }

      totalProcessed += rows.length;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;

    const { error: offsetErr } = await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);

    if (offsetErr) {
      return new Response(JSON.stringify({ error: offsetErr.message }), { status: 500 });
    }

    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed, finalOffset: currentOffset }));
});
