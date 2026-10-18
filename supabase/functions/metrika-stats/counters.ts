type Counter = { id: string; name: string; site: string }
type CounterPage = { counters?: { id: number; name: string; site: string }[]; rows?: number }

export async function listCounters(get: (path: string) => Promise<CounterPage>): Promise<Counter[]> {
  const result: Counter[] = []
  // Management API uses one-based offsets, unlike most paginated APIs.
  let offset = 1
  while (true) {
    const data = await get(`/management/v1/counters?per_page=1000&offset=${offset}`)
    const page = data.counters ?? []
    result.push(...page.map(c => ({ id: String(c.id), name: c.name, site: c.site })))
    offset += page.length
    if (!page.length || (data.rows !== undefined ? offset > data.rows : page.length < 1000)) break
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}