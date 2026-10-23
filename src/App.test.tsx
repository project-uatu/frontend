import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { peopleSchema, safeLink } from './api'
import ChartBoundary from './ChartBoundary'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })
describe('dashboard', () => {
  it('shows organization sign-in for unauthenticated users', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Sign in' } }, { status: 401 })))
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Sign in with your organization' })).toHaveAttribute('href', '/auth/login')
  })
  it('shows service failures with a retry rather than a success-shaped login fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Session store unavailable' } }, { status: 500 })))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Session store unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
  it('searches the employee roster and handles empty results', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      return url === '/auth/session'
        ? Response.json({ user: { name: 'Reader' }, csrf: 'test-csrf' })
        : Response.json({ data: [], page: { has_more: false } })
    }))
    render(<App />)
    expect(await screen.findByText('No tracked employees found.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add employee' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => {
      expect(requests).toContain('/api/persons?limit=25')
      expect(requests).toContain('/api/persons?limit=25&q=Alex')
    })
    expect(await screen.findByText('No tracked employees found for this search.')).toBeVisible()
  })
  it('rejects incomplete pagination contracts', () => {
    expect(peopleSchema.safeParse({ data: [], page: { has_more: true } }).success).toBe(false)
  })
  it('shows the signed-in account profile without guessing a tracked contributor', async () => {
    window.history.replaceState({}, '', '/profile')
    const fetch = vi.fn(async () => Response.json({ user: { name: 'OSPO Reader' }, csrf: 'test-csrf' }))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeVisible()
    expect(screen.getByText('OSPO Reader', { exact: true })).toBeVisible()
    expect(screen.getByText('Organization SSO', { exact: true })).toBeVisible()
    expect(screen.getByText(/not linked to a tracked contributor/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Browse employees' })).toHaveAttribute('href', '/')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('organizes the profile with section links and on-demand coverage details', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    window.history.replaceState({}, '', `/persons/${id}`)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/auth/session') return Response.json({ user: { name: 'Reader' }, csrf: 'test-csrf' })
      if (url === `/api/persons/${id}`) return Response.json({ data: {
        id, display_name: 'Alex Rivera', created_at: '2025-01-01T00:00:00Z', sources: [],
      } })
      if (url.includes('/coverage?')) return Response.json({ data: [{
        forge_instance_id: id, source: 'github.com', from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z', status: 'partial', scope: 'known repositories',
        gap_reason: 'Repository limit reached', recorded_at: '2026-02-02T00:00:00Z',
      }] })
      return Response.json({ data: [], page: { has_more: false } })
    }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to employees' }).closest('.profile-header')).not.toBeNull()
    expect(document.querySelector('.page-context')).toBeNull()
    const trigger = await screen.findByRole('button', { name: /Collection coverage.*Incomplete collection/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    const disclosure = screen.getByRole('dialog', { hidden: true })
    expect(disclosure).not.toHaveAttribute('open')
    expect(screen.getByText('Gap: Repository limit reached')).not.toBeVisible()
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '#contribution-history')
    expect(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '#contributed-projects')
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '#recorded-activity')
    expect(screen.getByText('Public open-source contributions', { exact: false })).toHaveTextContent('Tracked since Jan 1, 2025')
  })
  it('never renders javascript activity URLs as links', () => {
    expect(safeLink('javascript:alert(1)')).toBeUndefined()
    expect(safeLink('https://github.com/project/repo')).toBe('https://github.com/project/repo')
  })
  it('keeps chart failures local to the chart panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function BrokenChart(): never { throw new Error('Chart chunk unavailable') }
    render(<><h1>Employee profile</h1><ChartBoundary><BrokenChart /></ChartBoundary></>)
    expect(screen.getByRole('heading', { name: 'Employee profile' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('chart could not be loaded')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible()
  })
})
