import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'
import { fetchWithTimeout } from '../_shared/withTimeout.ts'
import { listCounters } from './counters.ts'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const schema = z.object({
  action: z.enum(['stats', 'counters', 'bind']).default('stats'),
  site_id: z.string().uuid().optional(),
  counter_id: z.string().regex(/^\d+$/).nullable().optional(),
  days: z.number().int().min(1).max(90).default(7),
})

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
        console.warn('Metrika request failed', { status: response.status, code })
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
    const date2 = new Date().toISOString().slice(0, 10)
    const d1 = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
    const common = `ids=${counterId}&date1=${d1}&date2=${date2}&accuracy=full`
    const [summary, sources, pages] = await Promise.all([
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews&dimensions=ym:s:date&sort=ym:s:date&limit=100`),
      get(`/stat/v1/data?${common}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:lastTrafficSource&sort=-ym:s:visits&limit=10`),
      get(`/stat/v1/data?${common}&metrics=ym:s:pageviews,ym:s:users&dimensions=ym:s:startURL&sort=-ym:s:pageviews&limit=10`),
    ])
    type Row = { dimensions: { name: string }[]; metrics: number[] }
    const rows = (r: { data?: Row[] }) => (r.data ?? []).map(d => ({ name: d.dimensions[0]?.name ?? '', metrics: d.metrics }))
    return json({ counter_id: counterId, period: { from: d1, to: date2, days },
      totals: { visits: summary.totals?.[0] ?? 0, users: summary.totals?.[1] ?? 0, pageviews: summary.totals?.[2] ?? 0 },
      daily: rows(summary).map(r => ({ day: r.name, visits: r.metrics[0], users: r.metrics[1], pageviews: r.metrics[2] })),
      sources: rows(sources).map(r => ({ name: r.name, visits: r.metrics[0], users: r.metrics[1] })),
      landing_pages: rows(pages).map(r => ({ url: r.name, pageviews: r.metrics[0], users: r.metrics[1] })),
    })
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Не удалось загрузить Метрику' }, 502) }
})
