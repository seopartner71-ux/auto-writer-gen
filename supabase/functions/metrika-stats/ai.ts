// AI-chat referral detection over Metrika rows. Filtering happens here, not via
// Metrika filters, so an unsupported dimension can never break the whole report.
export type MetrikaDim = { name?: string | null; id?: string | null }
export type MetrikaRow = { dimensions: MetrikaDim[]; metrics: number[] }

const AI_SERVICES: [RegExp, string][] = [
  [/chatgpt|openai/i, 'ChatGPT'],
  [/perplexity/i, 'Perplexity'],
  [/gemini\.google|bard\.google|\bgemini\b/i, 'Gemini'],
  [/copilot\.microsoft|bing\.com\/chat|\bcopilot\b/i, 'Copilot'],
  [/claude\.ai|\bclaude\b/i, 'Claude'],
  [/deepseek/i, 'DeepSeek'],
  [/alice\.yandex|ya\.ru\/alice|алиса|\balice\b/i, 'Алиса'],
  [/giga\.chat|gigachat/i, 'GigaChat'],
  [/you\.com/i, 'You.com'],
  [/phind\.com/i, 'Phind'],
  [/poe\.com/i, 'Poe'],
  [/mistral\.ai|chat\.mistral/i, 'Mistral'],
  [/grok\.com|\bgrok\b/i, 'Grok'],
  [/meta\.ai/i, 'Meta AI'],
]

export function aiServiceOf(dims: MetrikaDim[]): string | null {
  const text = dims.map(d => `${d?.name ?? ''} ${d?.id ?? ''}`).join(' ')
  for (const [re, name] of AI_SERVICES) if (re.test(text)) return name
  return null
}

// Rows: dimensions [trafficSource, sourceEngine, referalSource, startURL], metrics [visits, users].
// Users are summed per row, so they are an upper estimate of unique people.
export function aggregateAi(rows: MetrikaRow[]) {
  const sources = new Map<string, { visits: number; users: number }>()
  const pages = new Map<string, { visits: number; users: number }>()
  let visits = 0, users = 0
  for (const r of rows) {
    const service = aiServiceOf(r.dimensions.slice(0, 3))
    if (!service) continue
    const v = Number(r.metrics[0]) || 0, u = Number(r.metrics[1]) || 0
    visits += v; users += u
    const s = sources.get(service) ?? { visits: 0, users: 0 }
    s.visits += v; s.users += u; sources.set(service, s)
    const url = r.dimensions[3]?.name || 'Не определена'
    const p = pages.get(url) ?? { visits: 0, users: 0 }
    p.visits += v; p.users += u; pages.set(url, p)
  }
  const sort = <T extends { visits: number }>(a: T[]) => a.sort((x, y) => y.visits - x.visits)
  return {
    visits, users,
    sources: sort([...sources].map(([name, m]) => ({ name, ...m }))),
    pages: sort([...pages].map(([url, m]) => ({ url, ...m }))).slice(0, 20),
  }
}
