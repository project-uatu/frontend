import type { Count } from './api'

export function heatLevel(value: number | null, maximum: number) {
  if (value === null) return 'unknown'
  if (value === 0) return 'zero'
  return `level-${Math.max(1, Math.ceil(value / maximum * 4))}`
}

export function dateRange(from: string, through: string): { from: string; to: string } | undefined {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${through}T00:00:00Z`)
  if (
    !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
    start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== through
  ) return undefined
  end.setUTCDate(end.getUTCDate() + 1)
  const days = (end.getTime() - start.getTime()) / 86400000
  if (days <= 0 || days > 366) return undefined
  return { from: start.toISOString(), to: end.toISOString() }
}

export function defaultDates() {
  const end = new Date()
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - 1)
  if (start.getUTCMonth() !== end.getUTCMonth()) start.setUTCDate(0)
  start.setUTCDate(start.getUTCDate() + 1)
  return { from: start.toISOString().slice(0, 10), through: end.toISOString().slice(0, 10) }
}

export function yearToDate() {
  const today = new Date().toISOString().slice(0, 10)
  return { from: `${today.slice(0, 4)}-01-01`, through: today }
}

export function latestCounts(counts: Count[]): Count[] {
  const latest = new Map<string, Count>()
  for (const count of counts) {
    const day = new Date(count.date).toISOString().slice(0, 10)
    const key = JSON.stringify([count.forge_instance_id, day, count.metric, count.kind ?? ''])
    const previous = latest.get(key)
    if (!previous || Date.parse(count.observed_at) > Date.parse(previous.observed_at)) latest.set(key, count)
  }
  return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function dailySeries(counts: Count[], from: string, to: string, metric: string) {
  const latest = latestCounts(counts).filter(count => count.metric === metric)
  const groups = new Map<string, { forge: string; kind: string }>()
  for (const count of latest) {
    const group = { forge: count.forge_instance_id, kind: count.kind ?? '' }
    groups.set(JSON.stringify([group.forge, group.kind]), group)
  }
  const days: string[] = []
  for (let date = Date.parse(from); date < Date.parse(to); date += 86400000) {
    days.push(new Date(date).toISOString().slice(0, 10))
  }
  return {
    days,
    series: [...groups.values()].map(({ forge, kind }) => ({
      name: kind ? `${forge} / ${kind}` : forge,
      values: days.map(day => {
        const observation = latest.find(count =>
          count.forge_instance_id === forge && (count.kind ?? '') === kind &&
          new Date(count.date).toISOString().slice(0, 10) === day,
        )
        return observation?.value ?? null
      }),
    })),
  }
}
