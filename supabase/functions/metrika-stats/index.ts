import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'
import { fetchWithTimeout } from '../_shared/withTimeout.ts'
import { listCounters } from './counters.ts'
import { reportRange } from './report.ts'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const schema = z.object({
  action: z.enum(['stats', 'counters', 'bind']).default('stats'),
  site_id: z.string().uuid().optional(),
  counter_id: z.string().regex(/^\d+$/).nullable().optional(),
  days: z.number().int().min(1).max(90).default(7),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(v => Boolean(v.from) === Boolean(v.to))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !key) return json({ error: 'Сервис не настроен' }, 500)
    const client = createClient(url, key, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return json({ error: 'Войдите в аккаунт заново' }, 401)
    const { data: roles, error: roleError } = await client.from('user_roles').select('role').eq('user_id', user.id)
    if (roleError || !roles?.some((r: { role: string }) => r.role === 'admin')) return json({ error: 'Доступ только для администратора' }, 403)
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return json({ error: 'Некорректные параметры запроса' }, 400)
    const { action, counter_id: counterId, site_id: siteId, days } = parsed.data
    const token = Deno.env.get('YANDEX_METRIKA_OAUTH_TOKEN')
    if (!token) return json({ error: 'Токен Яндекс Метрики не настроен' }, 503)
    const get = async (path: string) => {
      const response = await fetchWithTimeout(`https://api-metrika.yandex.net${path}`, { headers: { Authorization: `OAuth ${token}` }, timeoutMs: 30000 })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code = payload.errors?.[0]?.error_type
        console.warn('Metrika request failed', { status: response.status, code, message: payload.errors?.[0]?.message ?? payload.message, path: path.split('?')[0], dims: /dimensions=([^&]+)/.exec(path)?.[1] })
        const message = response.status === 401 || code === 'invalid_token' ? 'Яндекс отклонил токен Метрики: он недействителен или выдан без доступа к Метрике. Нужен новый токен.' : response.status === 403 ? 'Нет доступа к счетчику. Выберите доступный счетчик в разделе «Сайты и подключения».' : response.status === 429 ? 'Яндекс ограничил частоту запросов. Повторите позже.' : `Ошибка Яндекс Метрики (${response.status}). Проверьте параметры счетчика.`
        throw new Error(message)
      }
      return payload
    }
    const counters = () => listCounters(get)
    if (action === 'counters') return json({ counters: await counters() })
    if (action === 'bind') {
      if (!siteId) return json({ error: 'Выберите сайт' }, 400)
      if (counterId && !(await counters()).some(c => c.id === counterId)) return json({ error: 'Этот счетчик недоступен текущему аккаунту Метрики' }, 403)
      const { data, error } = await client.from('monitor_sites').update({ metrika_counter_id: counterId ?? null }).eq('id', siteId).select('id').maybeSingle()
      if (error) return json({ error: 'Не удалось сохранить счетчик' }, 500)
      if (!data) return json({ error: 'Сайт не найден' }, 404)
      return json({ ok: true })
    }
    if (!counterId) return json({ error: 'Выберите счетчик Метрики' }, 400)
    const period = reportRange(days, parsed.data.from, parsed.data.to)
    if (!period) return json({ error: 'Выберите корректный период до 90 дней, не позднее сегодняшнего дня' }, 400)
    const common = `ids=${counterId}&date1=${period.from}&date2=${period.to}&accuracy=full&lang=ru`
    const aiFilter = encodeURIComponent("ym:s:refererDomain=~'(chatgpt\\.com|openai\\.com|perplexity\\.ai|gemini\\.google\\.com|bard\\.google\\.com|copilot\\.microsoft\\.com|bing\\.com/chat|claude\\.ai|deepseek\\.com|alice\\.yandex\\.ru|ya\\.ru/alice|giga\\.chat|you\\.com|phind\\.com|poe\\.com|mistral\\.ai|grok\\.com|meta\\.ai)'")
    const [summary, sources, pages, aiSources, aiPages] = await Promise.all([
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews&dimensions=ym:s:date&sort=ym:s:date&limit=100`),
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:lastTrafficSource,ym:s:lastSourceEngine,ym:s:lastReferalSource&sort=-ym:s:visits&limit=100`),
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:startURL&sort=-ym:s:visits&limit=10`),
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:refererDomain&filters=${aiFilter}&sort=-ym:s:visits&limit=50`),
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:startURL&filters=${aiFilter}&sort=-ym:s:visits&limit=20`),
    ])
    type Row = { dimensions: { name: string }[]; metrics: number[] }
    const rows = (r: { data?: Row[] }) => (r.data ?? []).map(d => ({ name: d.dimensions[0]?.name ?? '', metrics: d.metrics }))
    return json({ counter_id: counterId, period,
      totals: { visits: summary.totals?.[0] ?? 0, users: summary.totals?.[1] ?? 0, pageviews: summary.totals?.[2] ?? 0 },
      daily: rows(summary).map(r => ({ day: r.name, visits: r.metrics[0], users: r.metrics[1], pageviews: r.metrics[2] })),
      sources: (sources.data ?? []).map((r: Row) => ({ type: r.dimensions[0]?.name ?? 'Не определен', name: r.dimensions[2]?.name || r.dimensions[1]?.name || r.dimensions[0]?.name || 'Не определен', visits: r.metrics[0], users: r.metrics[1] })),
      ai: { visits: aiSources.totals?.[0] ?? 0, users: aiSources.totals?.[1] ?? 0,
        sources: rows(aiSources).map(r => ({ name: r.name, visits: r.metrics[0], users: r.metrics[1] })),
        pages: rows(aiPages).map(r => ({ url: r.name, visits: r.metrics[0], users: r.metrics[1] })) },
      landing_pages: rows(pages).map(r => ({ url: r.name, visits: r.metrics[0], users: r.metrics[1] })),
    })
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Не удалось загрузить Метрику' }, 502) }
})
