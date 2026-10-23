import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ContributionHeatmap from './ContributionHeatmap'
import { heatLevel } from './history'

describe('contribution heatmap', () => {
  it('distinguishes unknown, observed zero, and relative intensity', () => {
    expect(heatLevel(null, 4)).toBe('unknown')
    expect(heatLevel(0, 4)).toBe('zero')
    expect(heatLevel(1, 4)).toBe('level-1')
    expect(heatLevel(4, 4)).toBe('level-4')
  })
  it('labels UTC values accessibly and pads the first week from Monday', () => {
    const { container } = render(<ContributionHeatmap
      days={['2026-01-01', '2026-01-02', '2026-01-03']}
      series={[{ name: 'forge / authored', values: [null, 0, 4] }]}
      metric="commits"
    />)
    expect(container.querySelectorAll('.outside')).toHaveLength(3)
    expect(screen.getByRole('img', { name: '2026-01-01 (UTC): Unknown' })).toHaveClass('unknown')
    expect(screen.getByRole('img', { name: '2026-01-02 (UTC): 0 commits' })).toHaveClass('zero')
    expect(screen.getByRole('img', { name: '2026-01-03 (UTC): 4 commits' })).toHaveClass('level-4')
  })
  it('keeps source series separate instead of adding overlapping counts', () => {
    render(<ContributionHeatmap days={['2026-01-05']} series={[
      { name: 'forge-a', values: [2] }, { name: 'forge-b', values: [3] },
    ]} metric="daily_total" />)
    expect(screen.getByRole('heading', { name: 'forge-a' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'forge-b' })).toBeVisible()
    expect(screen.getByRole('img', { name: '2026-01-05 (UTC): 2 daily total' })).toBeVisible()
    expect(screen.getByRole('img', { name: '2026-01-05 (UTC): 3 daily total' })).toBeVisible()
  })
})
