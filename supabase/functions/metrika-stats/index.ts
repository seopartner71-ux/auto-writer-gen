import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = Deno.env.get('YANDEX_METRIKA_OAUTH_TOKEN')
  if (!token) return json({ error: 'metrika_not_configured' }, 500)

  const authHeader = req.headers.get('Authorization') || ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id)
  if (!roles?.some((r: { role: string }) => r.role === 'admin')) return json({ error: 'forbidden' }, 403)

  const body = await req.json().catch(() => ({}))
  const counterId = String(body.counter_id || '').replace(/[^0-9]/g, '')
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 90)
  if (!counterId) return json({ error: 'counter_id_required' }, 400)

  const date2 = new Date().toISOString().slice(0, 10)
  const d1 = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
  const base = 'https://api-metrika.yandex.net/stat/v1/data'
  const common = `ids=${counterId}&date1=${d1}&date2=${date2}&accuracy=full`

  const fetchM = async (params: string) => {
    const r = await fetch(`${base}?${common}&${params}`, { headers: { Authorization: `OAuth ${token}` } })
    if (!r.ok) return { error: `metrika_${r.status}` }
    return r.json()
  }

  const [summary, sources, pages] = await Promise.all([
    fetchM('metrics=ym:s:visits,ym:s:users,ym:s:pageviews&dimensions=ym:s:date&sort=ym:s:date'),
    fetchM('metrics=ym:s:visits,ym:s:users&dimensions=ym:s:lastTrafficSource&sort=-ym:s:visits&limit=10'),
    fetchM('metrics=ym:s:pageviews,ym:s:users&dimensions=ym:s:entrance&sort=-ym:s:pageviews&limit=10'),
  ])

  const err = summary.error || sources.error || pages.error
  if (err) return json({ error: err }, 502)

  const rows = (r: { data?: { dimensions: { name: string }[]; metrics: number[] }[] }) =>
    (r?.data || []).map((d) => ({ name: d.dimensions[0]?.name, metrics: d.metrics }))

  const daily = rows(summary).map((r) => ({ day: r.name, visits: r.metrics[0], users: r.metrics[1], pageviews: r.metrics[2] }))
  return json({
    counter_id: counterId,
    period: { from: d1, to: date2, days },
    totals: {
      visits: daily.reduce((a, b) => a + b.visits, 0),
      users: daily.reduce((a, b) => a + b.users, 0),
      pageviews: daily.reduce((a, b) => a + b.pageviews, 0),
    },
    daily,
    sources: rows(sources).map((r) => ({ name: r.name, visits: r.metrics[0], users: r.metrics[1] })),
    landing_pages: rows(pages).map((r) => ({ url: r.name, pageviews: r.metrics[0], users: r.metrics[1] })),
  })
})
