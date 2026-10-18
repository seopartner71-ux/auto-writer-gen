import { describe, expect, it } from 'vitest'
import { aggregateAi } from '../../../supabase/functions/metrika-stats/ai'

const row = (type: string, engine: string, ref: string, url: string, visits: number, users = visits) => ({
  dimensions: [{ name: type }, { name: engine }, { name: ref }, { name: url }], metrics: [visits, users],
})

describe('Metrika AI referrals', () => {
  it('counts only AI-chat referrals and groups them by service and page', () => {
    const res = aggregateAi([
      row('Переходы по ссылкам на сайтах', '', 'chatgpt.com', 'https://rdr71.ru/prices/', 3),
      row('Переходы по ссылкам на сайтах', '', 'perplexity.ai', 'https://rdr71.ru/', 2),
      row('Переходы из поисковых систем', 'Google', '', 'https://rdr71.ru/', 50),
      row('Прямые заходы', '', '', 'https://rdr71.ru/', 40),
    ])
    expect(res.visits).toBe(5)
    expect(res.sources).toEqual([{ name: 'ChatGPT', visits: 3, users: 3 }, { name: 'Perplexity', visits: 2, users: 2 }])
    expect(res.pages.map(p => p.url)).toEqual(['https://rdr71.ru/prices/', 'https://rdr71.ru/'])
  })
  it('does not treat ordinary Google search as Gemini', () => {
    expect(aggregateAi([row('Переходы из поисковых систем', 'Google', 'google.com', '/', 10)]).visits).toBe(0)
  })
})
