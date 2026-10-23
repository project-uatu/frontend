import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Config } from './config.ts'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const personPath = new RegExp(`^/persons/${uuid}(?:/(activity|projects|counts|coverage))?$`, 'i')
const timestamp = z.iso.datetime({ offset: true })

export function validateQuery(path: string, query: URLSearchParams): string | undefined {
  const route = path === '/persons' ? 'directory' : path.split('/')[3] ?? 'person'
  const allowed: Record<string, string[]> = {
    directory: ['q', 'limit', 'cursor'],
    person: [],
    activity: ['from', 'to', 'source', 'kind', 'limit', 'cursor'],
    projects: ['from', 'to', 'limit', 'cursor'],
    counts: ['from', 'to'],
    coverage: ['from', 'to'],
  }
  for (const [key, value] of query) {
    if (!allowed[route]?.includes(key) || query.getAll(key).length !== 1) return 'Unsupported or repeated query parameter'
    const max = key === 'cursor' ? 2048 : 100
    if (value.length > max) return 'Query parameter is too long'
  }
  const limit = query.get('limit')
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > (route === 'directory' ? 100 : 500))) {
    return 'Invalid page size'
  }
  const from = query.get('from')
  const to = query.get('to')
  if (from !== null || to !== null || ['counts', 'coverage'].includes(route)) {
    if (!from || !to || !timestamp.safeParse(from).success || !timestamp.safeParse(to).success) return 'Provide RFC3339 from and to timestamps'
    const duration = Date.parse(to) - Date.parse(from)
    if (!Number.isFinite(duration) || duration <= 0 || duration > 366 * 86400000) {
      return 'Date range must be positive and no longer than 366 days'
    }
  }
}

export function backendApi(config: Config): RequestHandler {
  return async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      res.status(405).json({ error: { message: 'This API route only supports GET requests' } })
      return
    }
    if (req.path !== '/persons' && !personPath.test(req.path)) {
      res.status(404).json({ error: { message: 'API route not found' } })
      return
    }
    const input = new URL(req.originalUrl, config.appUrl)
    const invalid = validateQuery(req.path, input.searchParams)
    if (invalid) {
      res.status(400).json({ error: { message: invalid } })
      return
    }
    const url = new URL(`/v1${req.path}`, config.backendUrl)
    url.search = input.search
    if (req.path.endsWith('/activity') && !input.searchParams.has('from')) {
      // Span the backend's date domain at PostgreSQL precision, excluding Go's invalid zero time.
      url.searchParams.set('from', '0001-01-01T00:00:00.000001Z')
      url.searchParams.set('to', '9999-12-31T23:59:59.999999Z')
    }
    try {
      const upstream = await fetch(url, {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      })
      if (!upstream.ok) {
        const status = [400, 404, 429, 503].includes(upstream.status) ? upstream.status : 502
        console.error(JSON.stringify({ event: 'backend_rejected', status: upstream.status, requestId: res.locals.requestId }))
        res.status(status).json({ error: { message: status === 404 ? 'Record not found' : 'Contribution service is unavailable' } })
        return
      }
      res.json(await upstream.json())
    } catch {
      console.error(JSON.stringify({ event: 'backend_unavailable', requestId: res.locals.requestId }))
      res.status(502).json({ error: { message: 'Contribution service is unavailable' } })
    }
  }
}
