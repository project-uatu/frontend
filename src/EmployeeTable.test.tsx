import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import EmployeeTable from './EmployeeTable'

const person = { id: '00000000-0000-4000-8000-000000000001', display_name: 'Alex Rivera', created_at: '2025-01-01T00:00:00Z' }
afterEach(() => vi.unstubAllGlobals())

it('shows source coverage and counts all recorded project pages rather than the first page', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url)
    if (!url.includes('/projects')) return Response.json({ data: { ...person, sources: [{
      source: 'github_commits', status: 'partial', gap_count: 2, recorded_at: '2026-01-01T00:00:00Z',
    }] } })
    return Response.json(url.includes('cursor=')
      ? { data: [{ project: 'second/project', count: 20 }], page: { has_more: false } }
      : { data: [{ project: 'first/project', count: 10 }], page: { has_more: true, next_cursor: 'next' } })
  }))
  render(<EmployeeTable people={[person]} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading employee details')
  expect(await screen.findByTitle('GitHub commits: Partial coverage; 2 gaps')).toBeVisible()
  const row = screen.getByRole('row', { name: /Alex Rivera/ })
  expect(within(row).getByRole('cell', { name: '2' })).toHaveClass('numeric')
  expect(requests).toContain(`/api/persons/${person.id}/projects?limit=100&cursor=next`)
  expect(screen.getByRole('link', { name: /Alex Rivera/ })).toHaveAttribute('href', `/persons/${person.id}`)
})

it('does not present failed enrichment as zero projects and supports retry', async () => {
  let failing = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (failing) return Response.json({ error: { message: 'Source details unavailable' } }, { status: 503 })
    return Response.json(url.includes('/projects')
      ? { data: [], page: { has_more: false } }
      : { data: { ...person, sources: [] } })
  }))
  render(<EmployeeTable people={[person]} />)
  expect(await screen.findByText('Source details unavailable')).toBeVisible()
  expect(screen.queryByRole('cell', { name: '0' })).not.toBeInTheDocument()
  failing = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry details' }))
  expect(await screen.findByRole('cell', { name: '0' })).toBeVisible()
  expect(screen.getByText('No coverage reported')).toBeVisible()
})
