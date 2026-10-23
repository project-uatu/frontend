import { describe, expect, it } from 'vitest'
import { displaySeries, forgeLabels, readableLabel } from './labels'

describe('display labels', () => {
  it('normalizes source cards and metrics without changing API keys', () => {
    expect(readableLabel('github_history')).toBe('GitHub contributions')
    expect(readableLabel('github_commits')).toBe('GitHub commits')
    expect(readableLabel('partial')).toBe('Partial coverage')
    expect(readableLabel('daily_total')).toBe('Total contributions')
    expect(readableLabel('new_source_kind')).toBe('New source kind')
  })
  it('uses coverage to resolve forge IDs and preserves separate kinds', () => {
    const labels = forgeLabels([{ forge_instance_id: 'id', source: 'github_history' }])
    expect(displaySeries([{ name: 'id / authored', values: [3] }], labels))
      .toEqual([{ name: 'GitHub / Authored', values: [3] }])
  })
  it('does not guess a forge when metadata is absent', () => {
    expect(displaySeries([{ name: 'unknown-id', values: [null] }], {})[0].name).toBe('Source 1')
  })
  it('disambiguates multiple instances of the same forge', () => {
    expect(displaySeries([{ name: 'a', values: [1] }, { name: 'b', values: [2] }],
      { a: 'GitLab', b: 'GitLab' }).map(item => item.name)).toEqual(['GitLab 1', 'GitLab 2'])
  })
})
