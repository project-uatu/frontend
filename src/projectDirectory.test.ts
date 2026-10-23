import { afterEach, expect, it, vi } from 'vitest'
import { loadProjectDirectory } from './projectDirectory'

const alex = { id: '00000000-0000-4000-8000-000000000001', display_name: 'Alex Rivera', created_at: '2026-01-01T00:00:00Z' }
const sam = { ...alex, id: '00000000-0000-4000-8000-000000000002', display_name: 'Sam Chen' }
afterEach(() => vi.unstubAllGlobals())

it('loads all roster and project pages and groups shared projects with contributors', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url)
    const next = url.includes('cursor=')
    if (url.startsWith('/api/persons?')) return Response.json(next
      ? { data: [sam], page: { has_more: false } }
      : { data: [alex], page: { has_more: true, next_cursor: 'roster next' } })
    if (url.includes(sam.id)) return Response.json({ data: [{ project: 'shared/project', count: 4 }], page: { has_more: false } })
    return Response.json(next
      ? { data: [{ project: 'other/project', count: 2 }], page: { has_more: false } }
      : { data: [{ project: 'shared/project', count: 3 }], page: { has_more: true, next_cursor: 'projects next' } })
  }))
  expect(await loadProjectDirectory(new AbortController().signal)).toEqual([
    { project: 'shared/project', count: 7, contributors: [alex, sam] },
    { project: 'other/project', count: 2, contributors: [alex] },
  ])
  expect(requests).toContain('/api/persons?limit=100&cursor=roster+next')
  expect(requests).toContain(`/api/persons/${alex.id}/projects?limit=100&cursor=projects+next`)
  expect(requests.every(url => !url.includes('from=') && !url.includes('to='))).toBe(true)
})

it('returns an empty directory for an empty roster', async () => {
  const fetch = vi.fn(async () => Response.json({ data: [], page: { has_more: false } }))
  vi.stubGlobal('fetch', fetch)
  expect(await loadProjectDirectory(new AbortController().signal)).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('rejects failures rather than returning partial organization results', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/persons?')) return Response.json({ data: [alex, sam], page: { has_more: false } })
    if (url.includes(sam.id)) return Response.json({ error: { message: 'Service unavailable' } }, { status: 503 })
    return Response.json({ data: [{ project: 'shared/project', count: 3 }], page: { has_more: false } })
  }))
  await expect(loadProjectDirectory(new AbortController().signal)).rejects.toThrow('Service unavailable')
})

it('rejects repeated continuation cursors instead of looping or double counting', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [alex], page: { has_more: true, next_cursor: 'same' } })))
  await expect(loadProjectDirectory(new AbortController().signal)).rejects.toThrow('invalid project directory pagination')
})

it('rejects duplicate per-person projects rather than inflating event counts', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith('/api/persons?')
    ? { data: [alex], page: { has_more: false } }
    : { data: [{ project: 'shared/project', count: 3 }, { project: 'shared/project', count: 3 }], page: { has_more: false } })))
  await expect(loadProjectDirectory(new AbortController().signal)).rejects.toThrow('duplicate projects')
})

it('passes cancellation through every request', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.signal).toBe(controller.signal)
    controller.abort()
    throw new DOMException('Request aborted', 'AbortError')
  }))
  await expect(loadProjectDirectory(controller.signal)).rejects.toThrow('Request aborted')
})
