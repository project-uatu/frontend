import { once } from 'node:events'
import type { Server } from 'node:http'
import session from 'express-session'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, finishApp } from './app.ts'
import { loadConfig } from './config.ts'
import type { IdentityProvider } from './oidc.ts'

const config = loadConfig({
  APP_URL: 'http://127.0.0.1:3000',
  UATU_BACKEND_URL: 'http://127.0.0.1:8080',
  UATU_API_KEY: 'test-only-backend-key-not-a-real-secret',
  SESSION_SECRET: 'test-only-session-key-not-a-real-secret',
  SESSION_DATABASE_URL: 'postgres://localhost/test',
  OIDC_ISSUER: 'http://127.0.0.1:4000',
  OIDC_CLIENT_ID: 'test-client',
  OIDC_CLIENT_SECRET: 'test-secret',
  OIDC_ALLOWED_SUBJECTS: 'reader',
})
const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((done, reject) => {
    server.close(error => error ? reject(error) : done())
    server.closeAllConnections()
  })))
})
async function start(subject = 'reader', store: session.Store = new session.MemoryStore(), adminSubjects: string[] = []) {
  const provider: IdentityProvider = {
    authorizationUrl: vi.fn(async () => new URL('https://idp.example/authorize')),
    authenticate: vi.fn(async () => ({ subject, name: 'OSPO reader' })),
  }
  const app = createApp({ ...config, adminSubjects: new Set(adminSubjects) }, store, provider)
  finishApp(app)
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  return { base: `http://127.0.0.1:${address.port}`, provider }
}
function cookie(response: Response) {
  const value = response.headers.get('set-cookie')?.split(';')[0]
  if (!value) throw new Error('Missing session cookie')
  return value
}
async function login(base: string) {
  const begin = await fetch(`${base}/auth/login`, { redirect: 'manual' })
  const response = await fetch(`${base}/auth/callback?code=test`, { headers: { Cookie: cookie(begin) }, redirect: 'manual' })
  expect(response.headers.get('location')).toBe('/')
  return cookie(response)
}

describe('BFF session boundary', () => {
  it('serves health without sessions and denies anonymous API access', async () => {
    const { base } = await start()
    const health = await fetch(`${base}/healthz`)
    expect(health.status).toBe(200)
    expect(health.headers.get('set-cookie')).toBeNull()
    const response = await fetch(`${base}/api/persons`)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
  it('rejects unsolicited callbacks and unapproved identities', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { base, provider } = await start('outsider')
    const unsolicited = await fetch(`${base}/auth/callback?code=test`, { redirect: 'manual' })
    expect(unsolicited.headers.get('location')).toContain('expired')
    expect(provider.authenticate).not.toHaveBeenCalled()
    const begin = await fetch(`${base}/auth/login`, { redirect: 'manual' })
    const denied = await fetch(`${base}/auth/callback?code=test`, { headers: { Cookie: cookie(begin) }, redirect: 'manual' })
    expect(denied.headers.get('location')).toContain('denied')
    expect((await fetch(`${base}/auth/session`, { headers: { Cookie: cookie(begin) } })).status).toBe(401)
  })
  it('rotates the session, requires CSRF and origin checks, and invalidates logout', async () => {
    const { base } = await start()
    const authenticated = await login(base)
    const response = await fetch(`${base}/auth/session`, { headers: { Cookie: authenticated } })
    const body = z.object({ user: z.object({ name: z.string() }), csrf: z.string() }).parse(await response.json())
    expect(body.user.name).toBe('OSPO reader')
    const forbidden = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: authenticated } })
    expect(forbidden.status).toBe(403)
    const crossOrigin = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: authenticated, Origin: 'https://untrusted.example', 'X-CSRF-Token': body.csrf },
    })
    expect(crossOrigin.status).toBe(403)
    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: authenticated, Origin: config.appUrl.origin, 'X-CSRF-Token': body.csrf },
    })
    expect(logout.status).toBe(204)
    expect((await fetch(`${base}/auth/session`, { headers: { Cookie: authenticated } })).status).toBe(401)
  })
  it('rejects expired server sessions', async () => {
    const store = new session.MemoryStore()
    const { base } = await start('reader', store)
    const authenticated = await login(base)
    const records = await new Promise<{ [sid: string]: session.SessionData }>((done, reject) => {
      store.all((error, sessions) => {
        if (error) reject(error)
        else if (sessions && !Array.isArray(sessions)) done(sessions)
        else reject(new Error('Unexpected store result'))
      })
    })
    for (const [id, record] of Object.entries(records)) {
      record.expiresAt = Date.now() - 1
      await new Promise<void>((done, reject) => store.set(id, record, error => error ? reject(error) : done()))
    }
    expect((await fetch(`${base}/api/persons`, { headers: { Cookie: authenticated } })).status).toBe(401)
  })
  it('fails explicitly if session storage is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new session.MemoryStore()
    const { base } = await start('reader', store)
    const authenticated = await login(base)
    vi.spyOn(store, 'get').mockImplementation((_id, callback) => callback(new Error('private connection details')))
    const response = await fetch(`${base}/api/persons`, { headers: { Cookie: authenticated } })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private connection details')
    expect(log).toHaveBeenCalled()
  })
  it('only forwards allowlisted GET routes and injects the key server-side', async () => {
    const { base } = await start()
    const authenticated = await login(base)
    const headers = { Cookie: authenticated }
    expect((await fetch(`${base}/api/jobs/test`, { headers })).status).toBe(404)
    expect((await fetch(`${base}/api/persons`, { headers, method: 'POST' })).status).toBe(403)
    expect((await fetch(`${base}/api/persons?token=secret`, { headers })).status).toBe(400)
    const originalFetch = globalThis.fetch
    const upstream = vi.fn(async (_url: URL, _options: RequestInit) => Response.json({ data: [], page: { has_more: false } }))
    vi.stubGlobal('fetch', upstream)
    const response = await originalFetch(`${base}/api/persons?q=alex`, { headers })
    expect(response.status).toBe(200)
    const [url, options] = upstream.mock.calls[0]
    expect(url.href).toBe('http://127.0.0.1:8080/v1/persons?q=alex')
    expect(options.headers).toEqual({ Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' })
    expect(JSON.stringify(await response.json())).not.toContain(config.apiKey)
  })

  describe('employee onboarding', () => {
    async function admin() {
      const { base } = await start('reader', new session.MemoryStore(), ['reader'])
      const authenticated = await login(base)
      const sessionResponse = await fetch(`${base}/auth/session`, { headers: { Cookie: authenticated } })
      const current = z.object({ csrf: z.string(), user: z.object({ canManageEmployees: z.boolean() }) }).parse(await sessionResponse.json())
      expect(current.user.canManageEmployees).toBe(true)
      return { base, headers: { Cookie: authenticated, Origin: config.appUrl.origin, 'X-CSRF-Token': current.csrf, 'Content-Type': 'application/json' } }
    }
    const input = { forge: 'github.com', login: 'example-user', display_name: 'Example Employee' }
    const created = { data: {
      person: { id: '00000000-0000-4000-8000-000000000001', display_name: 'Example Employee' },
      job: { id: '00000000-0000-4000-8000-000000000002', status: 'queued' },
    } }
    it('denies anonymous and non-admin writes and reports read-only capability', async () => {
      const { base } = await start()
      expect((await fetch(`${base}/api/persons`, { method: 'POST' })).status).toBe(401)
      const authenticated = await login(base)
      const response = await fetch(`${base}/auth/session`, { headers: { Cookie: authenticated } })
      expect(await response.json()).toMatchObject({ user: { canManageEmployees: false } })
      expect((await fetch(`${base}/api/persons`, { method: 'POST', headers: { Cookie: authenticated }, body: JSON.stringify(input) })).status).toBe(403)
    })
    it('rejects missing CSRF, wrong origins, unsupported queries and invalid bodies without forwarding', async () => {
      const { base, headers } = await admin()
      const originalFetch = globalThis.fetch
      const upstream = vi.fn()
      vi.stubGlobal('fetch', upstream)
      const post = (path: string, override: Record<string, string> = {}, body = JSON.stringify(input)) =>
        originalFetch(`${base}${path}`, { method: 'POST', headers: { ...headers, ...override }, body })
      expect((await post('/api/persons', { 'X-CSRF-Token': '' })).status).toBe(403)
      expect((await post('/api/persons', { Origin: 'https://evil.example' })).status).toBe(403)
      expect((await post('/api/persons?unexpected=1')).status).toBe(400)
      expect((await post('/api/persons', {}, '{"login":')).status).toBe(400)
      expect((await post('/api/persons', {}, JSON.stringify({ ...input, admin: true }))).status).toBe(400)
      expect((await post('/api/persons', {}, JSON.stringify({ ...input, login: 'https://github.com/user' }))).status).toBe(400)
      expect((await post('/api/persons', {}, JSON.stringify({ ...input, display_name: 'x'.repeat(5000) }))).status).toBe(413)
      expect(upstream).not.toHaveBeenCalled()
    })
    it('only forwards validated onboarding to the fixed backend endpoint and returns confirmed creation', async () => {
      const { base, headers } = await admin()
      const originalFetch = globalThis.fetch
      const upstream = vi.fn(async (_url: URL, _options: RequestInit) => Response.json(created, { status: 201 }))
      vi.stubGlobal('fetch', upstream)
      vi.spyOn(console, 'info').mockImplementation(() => {})
      const response = await originalFetch(`${base}/api/persons`, { method: 'POST', headers, body: JSON.stringify(input) })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(created)
      const [url, options] = upstream.mock.calls[0]
      expect(url.href).toBe('http://127.0.0.1:8080/v1/persons')
      expect(options.method).toBe('POST')
      expect(options.redirect).toBe('error')
      expect(options.body).toBe(JSON.stringify(input))
      expect(options.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` })
      expect((await originalFetch(`${base}/api/persons/${created.data.person.id}`, { method: 'DELETE', headers })).status).toBe(405)
    })
    it('reports identity conflicts safely and never retries uncertain writes', async () => {
      const { base, headers } = await admin()
      const originalFetch = globalThis.fetch
      const upstream = vi.fn()
        .mockResolvedValueOnce(Response.json({ secret: 'private backend details' }, { status: 409 }))
        .mockRejectedValueOnce(new Error('private connection details'))
        .mockResolvedValueOnce(Response.json({ secret: 'unexpected response' }, { status: 201 }))
      vi.stubGlobal('fetch', upstream)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const post = () => originalFetch(`${base}/api/persons`, { method: 'POST', headers, body: JSON.stringify(input) })
      const conflict = await post()
      expect(conflict.status).toBe(409)
      expect(await conflict.text()).toContain('already assigned')
      for (let index = 0; index < 2; index++) {
        const uncertain = await post()
        expect(uncertain.status).toBe(502)
        expect(await uncertain.text()).toContain('Check the employee directory')
      }
      expect(upstream).toHaveBeenCalledTimes(3)
    })
  })
  it('expands all-history activity bounds and preserves filters and cursors', async () => {
    const { base } = await start()
    const authenticated = await login(base)
    const originalFetch = globalThis.fetch
    const upstream = vi.fn(async (_url: URL) => Response.json({ data: [], page: { has_more: false } }))
    vi.stubGlobal('fetch', upstream)
    const path = '/api/persons/00000000-0000-4000-8000-000000000001/activity'
    const response = await originalFetch(`${base}${path}?limit=25&cursor=next&kind=commit_authored`, { headers: { Cookie: authenticated } })
    expect(response.status).toBe(200)
    const [url] = upstream.mock.calls[0]
    expect(url.searchParams.get('from')).toBe('0001-01-01T00:00:00.000001Z')
    expect(url.searchParams.get('to')).toBe('9999-12-31T23:59:59.999999Z')
    expect(url.searchParams.get('cursor')).toBe('next')
    expect(url.searchParams.get('kind')).toBe('commit_authored')
    const ranged = await originalFetch(`${base}${path}?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`, { headers: { Cookie: authenticated } })
    expect(ranged.status).toBe(200)
    expect(upstream.mock.calls[1][0].searchParams.get('from')).toBe('2026-01-01T00:00:00Z')
  })
  it('redacts backend failures and never follows redirects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { base } = await start()
    const authenticated = await login(base)
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sensitive backend details', { status: 500 })))
    const response = await originalFetch(`${base}/api/persons`, { headers: { Cookie: authenticated } })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('sensitive')
  })
})
