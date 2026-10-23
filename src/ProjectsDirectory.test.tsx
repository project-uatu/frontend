import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ProjectsDirectory from './ProjectsDirectory'

const person = { id: '00000000-0000-4000-8000-000000000001', display_name: 'Alex Rivera', created_at: '2026-01-01T00:00:00Z' }
afterEach(() => vi.unstubAllGlobals())

it('searches projects and contributors and resets local pagination', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith('/api/persons?')
    ? { data: [person], page: { has_more: false } }
    : { data: Array.from({ length: 26 }, (_, index) => ({ project: `example/project-${String(index).padStart(2, '0')}`, count: 1 })), page: { has_more: false } })))
  render(<ProjectsDirectory />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading projects')
  expect(await screen.findByText('26 projects recorded')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('example/project-25')).toBeVisible()
  expect(screen.queryByText('example/project-00')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'project-00' } })
  expect(screen.getByText('example/project-00')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', `/persons/${person.id}`)
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alex' } })
  expect(screen.getByText('26 projects matching your search')).toBeVisible()
  expect(screen.getByText('Page 1 of 2')).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
  expect(screen.getByText('No projects match this search.')).toBeVisible()
})

it('shows request failures and supports retry', async () => {
  let failing = true
  vi.stubGlobal('fetch', vi.fn(async () => failing
    ? Response.json({ error: { message: 'Contribution service is unavailable' } }, { status: 503 })
    : Response.json({ data: [], page: { has_more: false } })))
  render(<ProjectsDirectory />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Contribution service is unavailable')
  failing = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No contributed projects recorded yet.')).toBeVisible()
})

it('sorts all projects before pagination, toggles direction and resets the page', async () => {
  const sam = { ...person, id: '00000000-0000-4000-8000-000000000002', display_name: 'Sam Chen' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith('/api/persons?')
    ? { data: [person, sam], page: { has_more: false } }
    : url.includes(sam.id)
      ? { data: [{ project: 'shared/project', count: 1 }], page: { has_more: false } }
      : { data: [
        ...Array.from({ length: 26 }, (_, index) => ({ project: `example/project-${String(index).padStart(2, '0')}`, count: index + 1 })),
        { project: 'shared/project', count: 1 },
      ], page: { has_more: false } })))
  render(<ProjectsDirectory />)
  expect(await screen.findByText('27 projects recorded')).toBeVisible()
  const firstProject = () => screen.getAllByRole('row')[1].querySelector('.project-open')?.textContent
  expect(firstProject()).toBe('shared/project')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Project' }))
  expect(firstProject()).toBe('example/project-00')
  expect(screen.getByText('Page 1 of 2')).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'ascending')
  fireEvent.click(screen.getByRole('button', { name: 'Project' }))
  expect(firstProject()).toBe('shared/project')
  fireEvent.click(screen.getByRole('button', { name: 'Recorded events' }))
  expect(firstProject()).toBe('example/project-25')
  fireEvent.click(screen.getByRole('button', { name: 'Recorded events' }))
  expect(firstProject()).toBe('example/project-00')
  fireEvent.click(screen.getByRole('button', { name: 'Employee contributors' }))
  expect(firstProject()).toBe('shared/project')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'project-0' } })
  expect(firstProject()).toBe('example/project-09')
})
