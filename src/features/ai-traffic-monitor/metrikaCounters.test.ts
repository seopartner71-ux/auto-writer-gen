import { describe, expect, it, vi } from 'vitest'
import { listCounters } from '../../../supabase/functions/metrika-stats/counters'

describe('Metrika management pagination', () => {
  it('starts at counter 1 and includes the last counter on the next page', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `Site ${i + 1}`, site: '' }))
    const get = vi.fn()
      .mockResolvedValueOnce({ counters: firstPage, rows: 1001 })
      .mockResolvedValueOnce({ counters: [{ id: 1001, name: 'Last site', site: 'last.example' }], rows: 1001 })
    const counters = await listCounters(get)
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/management/v1/counters?per_page=1000&offset=1',
      '/management/v1/counters?per_page=1000&offset=1001',
    ])
    expect(counters).toHaveLength(1001)
    expect(counters.find(c => c.id === '1001')?.site).toBe('last.example')
  })
  it('stops after the final full page', async () => {
    const get = vi.fn().mockResolvedValue({ counters: [{ id: 92151903, name: 'РДР71', site: 'rdr71.ru' }], rows: 1 })
    expect(await listCounters(get)).toEqual([{ id: '92151903', name: 'РДР71', site: 'rdr71.ru' }])
    expect(get).toHaveBeenCalledTimes(1)
  })
})