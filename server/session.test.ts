import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp, finishApp } from './app.ts'
import { loadConfig } from './config.ts'

const databaseUrl = process.env.UATU_TEST_SESSION_DATABASE_URL
describe.skipIf(!databaseUrl)('PostgreSQL sessions', () => {
  it('shares a persistent session across BFF instances and invalidates it on logout', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
    const tableName = `test_session_${randomBytes(8).toString('hex')}`
    const PgStore = connectPgSimple(session)
    const stores = [new PgStore({ pool, tableName }), new PgStore({ pool, tableName })]
    const config = loadConfig({
      APP_URL: 'http://127.0.0.1:3000',
      UATU_BACKEND_URL: 'http://127.0.0.1:8080',
      UATU_API_KEY: 'test-only-backend-key-not-a-real-secret',
      SESSION_SECRET: 'test-only-session-key-not-a-real-secret',
      SESSION_DATABASE_URL: databaseUrl,
      OIDC_ISSUER: 'http://127.0.0.1:4000',
      OIDC_CLIENT_ID: 'test-client',
      OIDC_CLIENT_SECRET: 'test-secret',
      OIDC_ALLOWED_SUBJECTS: 'reader',
    })
    const servers = stores.map(store => {
      const app = createApp(config, store, {
        authorizationUrl: async () => new URL('https://idp.example/authorize'),
        authenticate: async () => ({ subject: 'reader', name: 'Reader' }),
      })
      finishApp(app)
      return app.listen(0, '127.0.0.1')
    })
    try {
      await pool.query(`CREATE TABLE "${tableName}" (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL)`)
      await Promise.all(servers.map(server => server.listening ? undefined : once(server, 'listening')))
      const urls = servers.map(server => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing listener')
        return `http://127.0.0.1:${address.port}`
      })
      const begin = await fetch(`${urls[0]}/auth/login`, { redirect: 'manual' })
      const pending = begin.headers.get('set-cookie')?.split(';')[0] ?? ''
      const callback = await fetch(`${urls[0]}/auth/callback?code=test`, { headers: { Cookie: pending }, redirect: 'manual' })
      const authenticated = callback.headers.get('set-cookie')?.split(';')[0] ?? ''
      expect(authenticated).not.toBe('')
      expect(authenticated).not.toBe(pending)
      const secondInstance = await fetch(`${urls[1]}/auth/session`, { headers: { Cookie: authenticated } })
      expect(secondInstance.status).toBe(200)
      const body = z.object({ csrf: z.string() }).parse(await secondInstance.json())
      const logout = await fetch(`${urls[1]}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: authenticated, Origin: config.appUrl.origin, 'X-CSRF-Token': body.csrf },
      })
      expect(logout.status).toBe(204)
      expect((await fetch(`${urls[0]}/auth/session`, { headers: { Cookie: authenticated } })).status).toBe(401)
    } finally {
      for (const store of stores) store.close()
      await Promise.all(servers.map(server => new Promise<void>((done, reject) => {
        server.close(error => error ? reject(error) : done())
        server.closeAllConnections()
      })))
      await pool.query(`DROP TABLE IF EXISTS "${tableName}"`)
      await pool.end()
    }
  })
})
