export function reportRange(days: number, from?: string, to?: string, now = new Date()) {
  const end = to ?? now.toISOString().slice(0, 10)
  const start = from ?? new Date(new Date(`${end}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10)
  const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (!Number.isInteger(count) || count < 1 || count > 90 || end > now.toISOString().slice(0, 10)) return null
  if (new Date(start).toISOString().slice(0, 10) !== start || new Date(end).toISOString().slice(0, 10) !== end) return null
  return { from: start, to: end, days: count }
}