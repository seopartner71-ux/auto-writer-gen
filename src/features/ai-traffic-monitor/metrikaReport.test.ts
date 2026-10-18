import { describe, expect, it } from 'vitest'
import { reportRange } from '../../../supabase/functions/metrika-stats/report'

describe('Metrika report dates', () => {
  const now = new Date('2026-10-18T10:00:00Z')
  it('today returns one day, not seven', () => {
    expect(reportRange(1, undefined, undefined, now)).toEqual({ from: '2026-10-18', to: '2026-10-18', days: 1 })
  })
  it('uses both selected dates inclusively', () => {
    expect(reportRange(7, '2026-09-12', '2026-09-20', now)).toEqual({ from: '2026-09-12', to: '2026-09-20', days: 9 })
  })
  it('rejects reversed dates and ranges exceeding 90 days', () => {
    expect(reportRange(7, '2026-10-18', '2026-10-17', now)).toBeNull()
    expect(reportRange(7, '2026-01-01', '2026-10-18', now)).toBeNull()
  })
})