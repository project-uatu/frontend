import { describe, expect, it, vi } from 'vitest'
import { dailySeries, dateRange, defaultDates, latestCounts, yearToDate } from './history'
import type { Count } from './api'

const observation: Count = {
  forge_instance_id: '00000000-0000-4000-8000-000000000001',
  date: '2026-01-01T00:00:00Z',
  metric: 'commits',
  value: 10,
  observed_at: '2026-01-02T00:00:00Z',
}
describe('contribution history', () => {
  it.each([
    ['2026-10-22T22:00:00Z', '2025-10-23', '2026-10-22'],
    ['2024-02-29T10:00:00Z', '2023-03-01', '2024-02-29'],
    ['2025-02-28T10:00:00Z', '2024-02-29', '2025-02-28'],
  ])('defaults to a calendar year through today at %s', (now, from, through) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(now))
      expect(defaultDates()).toEqual({ from, through })
      expect(dateRange(from, through)).toBeDefined()
      expect(yearToDate()).toEqual({ from: `${through.slice(0, 4)}-01-01`, through })
    } finally { vi.useRealTimers() }
  })
  it('keeps the latest observation without summing repeated collection runs', () => {
    const counts = [observation, { ...observation, value: 3, observed_at: '2026-01-03T00:00:00Z' }]
    expect(latestCounts(counts)).toEqual([counts[1]])
  })
  it('preserves forge, metric and kind boundaries', () => {
    expect(latestCounts([
      observation,
      { ...observation, forge_instance_id: '00000000-0000-4000-8000-000000000002' },
      { ...observation, metric: 'daily_total' },
      { ...observation, kind: 'coauthor' },
    ])).toHaveLength(4)
  })
  it('does not turn unknown days into zero or combine daily totals with commits', () => {
    const result = dailySeries([
      observation, { ...observation, metric: 'daily_total', value: 20 },
      { ...observation, date: '2026-01-03T00:00:00Z', value: 0 },
    ], '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', 'commits')
    expect(result.series[0].values).toEqual([10, null, 0])
  })
  it('normalizes observation dates to UTC', () => {
    const result = latestCounts([observation, {
      ...observation, date: '2025-12-31T19:00:00-05:00', value: 2, observed_at: '2026-01-03T00:00:00Z',
    }])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(2)
  })
  it('keeps different kinds separate rather than adding potentially overlapping scopes', () => {
    const result = dailySeries([observation, { ...observation, kind: 'authored', value: 3 }],
      '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'commits')
    expect(result.series.map(series => series.values)).toEqual([[10], [3]])
  })
  it('converts inclusive date inputs to an exclusive UTC end', () => {
    expect(dateRange('2026-01-01', '2026-01-01')).toEqual({
      from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z',
    })
  })
  it.each([['2026-02-30', '2026-03-01'], ['', ''], ['2026-02-01', '2026-01-01'], ['2020-01-01', '2026-01-01']])(
    'rejects invalid or excessive date range %s to %s', (from, to) => {
      expect(dateRange(from, to)).toBeUndefined()
    },
  )
})
