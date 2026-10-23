import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { Server } from 'node:http'
import express from 'express'
import session from 'express-session'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createApp, finishApp, serveWeb } from '../../server/app.ts'
import { loadConfig } from '../../server/config.ts'
import { createIdentityProvider } from '../../server/oidc.ts'

// Fixtures are local-only. --idp-only provides test SSO for a separately configured real BFF.
const idpOnly = process.argv.includes('--idp-only')
const issuer = 'http://127.0.0.1:4301'
const config = loadConfig({
  APP_URL: idpOnly ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:4300',
  UATU_BACKEND_URL: 'http://127.0.0.1:4302',
  UATU_API_KEY: 'fixture-backend-key-not-a-real-secret',
  SESSION_SECRET: 'fixture-session-key-not-a-real-secret',
  SESSION_DATABASE_URL: 'postgres://localhost/unused',
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: 'fixture-client',
  OIDC_CLIENT_SECRET: 'fixture-client-secret',
  OIDC_ALLOWED_SUBJECTS: 'ospo-reader',
  OIDC_ADMIN_SUBJECTS: 'ospo-reader',
})
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'fixture-signing-key', use: 'sig', alg: 'RS256' }
const grants = new Map<string, { nonce: string; challenge: string; subject: string }>()
const idp = express()
idp.use(express.urlencoded({ extended: false }))
idp.get('/.well-known/openid-configuration', (_req, res) => res.json({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  token_endpoint_auth_methods_supported: ['client_secret_post'],
  code_challenge_methods_supported: ['S256'],
}))
idp.get('/jwks', (_req, res) => res.json({ keys: [jwk] }))
idp.get('/authorize', (req, res) => {
  const url = new URL(req.originalUrl, issuer)
  if (
    url.searchParams.get('client_id') !== config.clientId ||
    url.searchParams.get('redirect_uri') !== new URL('/auth/callback', config.appUrl).href ||
    url.searchParams.get('code_challenge_method') !== 'S256'
  ) { res.sendStatus(400); return }
  const inputs = [...url.searchParams].map(([key, value]) =>
    `<input type="hidden" name="${key.replaceAll('"', '&quot;')}" value="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}">`,
  ).join('')
  res.type('html').send(`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Uatu test identity provider</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f6f8fb;color:#253047;font:14px/1.7 system-ui,sans-serif}
      main{width:100%;max-width:440px;padding:36px;background:white;border:1px solid #e8ecf3;border-radius:16px;box-shadow:0 12px 48px #25304708}
      .badge{display:inline-block;background:#fff8e8;color:#886115;border:1px solid #f2e3bc;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600}
      h1{font-size:26px;letter-spacing:-1px;line-height:1.2;margin:24px 0 12px}p{color:#65718a}button{width:100%;padding:12px;margin-top:12px;border:0;border-radius:8px;background:#4057d6;color:white;font:600 14px system-ui;cursor:pointer}
      button:hover{background:#3348bc}button:focus-visible,a:focus-visible{outline:3px solid #9daaf0;outline-offset:3px}.secondary{background:#f0f3fc;color:#44516c}.secondary:hover{background:#e5eafa}
      small{display:block;margin-top:24px;color:#65718a}a{color:#4057d6}
    </style></head><body><main>
    <span class="badge">Local test provider</span>
    <h1>Choose a test identity</h1>
    <p>This screen simulates your organization's SSO. No password or real account is needed.</p>
    <form action="/approve">${inputs}
      <button name="subject" value="ospo-reader">Continue as OSPO member</button>
      <button class="secondary" name="subject" value="outsider">Continue as outsider</button>
    </form><small>The OSPO member can access the dashboard. The outsider demonstrates access denial.</small>
    <p><a href="${config.appUrl.origin}/">Back to Uatu</a></p>
    </main></body></html>`)
})
idp.get('/approve', (req, res) => {
  const params = new URL(req.originalUrl, issuer).searchParams
  const code = randomUUID()
  grants.set(code, {
    nonce: params.get('nonce') ?? '',
    challenge: params.get('code_challenge') ?? '',
    subject: params.get('subject') ?? '',
  })
  const redirect = new URL('/auth/callback', config.appUrl)
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', params.get('state') ?? '')
  res.redirect(redirect.href)
})
idp.post('/token', async (req, res) => {
  const body: Record<string, string> = req.body
  const grant = grants.get(body.code)
  grants.delete(body.code)
  if (
    !grant || body.client_id !== config.clientId || body.client_secret !== config.clientSecret ||
    body.redirect_uri !== new URL('/auth/callback', config.appUrl).href ||
    createHash('sha256').update(body.code_verifier ?? '').digest('base64url') !== grant.challenge
  ) { res.status(400).json({ error: 'invalid_grant' }); return }
  const idToken = await new SignJWT({ nonce: grant.nonce, name: 'OSPO Reader' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience(config.clientId)
    .setSubject(grant.subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  res.json({ access_token: 'fixture-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken })
})
const store = new session.MemoryStore()
idp.post('/test/expire', async (_req, res) => {
  const records = await new Promise<Record<string, session.SessionData>>((done, reject) => {
    store.all((error, sessions) => {
      if (error) reject(error)
      else if (sessions && !Array.isArray(sessions)) done(sessions)
      else reject(new Error('Unexpected store result'))
    })
  })
  for (const [id, record] of Object.entries(records)) {
    record.expiresAt = 0
    await new Promise<void>((done, reject) => store.set(id, record, error => error ? reject(error) : done()))
  }
  res.sendStatus(204)
})
const personId = '00000000-0000-4000-8000-000000000001'
const forgeId = '00000000-0000-4000-8000-000000000002'
const person = { id: personId, display_name: 'Alex Rivera', created_at: '2025-01-01T00:00:00Z' }
const now = new Date().toISOString()
const day = `${now.slice(0, 10)}T00:00:00Z`
let unavailable = false
let onboardedPerson: typeof person | undefined
const onboardedId = '00000000-0000-4000-8000-000000000006'
const backend = express()
backend.use(express.json())
backend.post('/test/failure/:state', (req, res) => { unavailable = req.params.state === 'on'; res.sendStatus(204) })
backend.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${config.apiKey}`) { res.sendStatus(401); return }
  if (unavailable) { res.sendStatus(503); return }
  next()
})
backend.post('/v1/persons', (req, res) => {
  if (req.body.login === 'already-tracked') {
    res.status(409).json({ error: { message: 'Identity conflict' } })
    return
  }
  onboardedPerson = { id: onboardedId, display_name: req.body.display_name, created_at: now }
  res.status(201).json({ data: {
    person: onboardedPerson,
    job: { id: '00000000-0000-4000-8000-000000000005', status: 'queued' },
  } })
})
backend.get('/v1/persons', (req, res) => {
  if (req.query.q === '') {
    res.status(400).json({ error: { message: 'q must not be empty' } })
    return
  }
  if (req.query.q && !person.display_name.toLowerCase().includes(String(req.query.q).toLowerCase())) {
    res.json({ data: [], page: { has_more: false } })
    return
  }
  res.json(req.query.cursor
    ? { data: [{ ...person, id: '00000000-0000-4000-8000-000000000003', display_name: 'Sam Chen' }], page: { has_more: false } }
    : { data: [person], page: { has_more: true, next_cursor: 'second-page' } })
})
backend.get(`/v1/persons/${personId}`, (_req, res) => res.json({
  data: { ...person, sources: [{ source: 'github.com', status: 'partial', gap_count: 1, recorded_at: now }] },
}))
backend.get('/v1/persons/00000000-0000-4000-8000-000000000003', (_req, res) => res.json({
  data: { ...person, id: '00000000-0000-4000-8000-000000000003', display_name: 'Sam Chen', sources: [] },
}))
backend.get(`/v1/persons/${onboardedId}`, (_req, res) => {
  if (!onboardedPerson) { res.sendStatus(404); return }
  res.json({ data: { ...onboardedPerson, sources: [] } })
})
for (const resource of ['counts', 'coverage', 'activity', 'projects']) {
  backend.get(`/v1/persons/${onboardedId}/${resource}`, (_req, res) => res.json({ data: [], page: { has_more: false } }))
}
backend.get(`/v1/persons/${personId}/counts`, (_req, res) => res.json({
  data: [
    { forge_instance_id: forgeId, date: day, metric: 'commits', value: 999, observed_at: '2025-01-01T00:00:00Z' },
    { forge_instance_id: forgeId, date: day, metric: 'commits', value: 3, observed_at: now },
  ],
}))
backend.get(`/v1/persons/${personId}/coverage`, (_req, res) => res.json({
  data: [{
    forge_instance_id: forgeId, source: 'github.com', from: day, to: now,
    status: 'partial', scope: 'known public repositories', gap_reason: 'Repository scan limit reached', recorded_at: now,
  }],
}))
backend.get(`/v1/persons/${personId}/activity`, (req, res) => res.json({
  data: [{
    event_id: '00000000-0000-4000-8000-000000000004',
    kind: 'commit_authored', role: 'author', occurred_at: now, project: 'example/project',
    title: req.query.cursor ? 'Earlier recorded commit' : 'Recorded commit abc123',
    url: 'https://github.com/example/project/commit/abc123',
  }],
  page: req.query.cursor ? { has_more: false } : { has_more: true, next_cursor: 'earlier' },
}))
backend.get(`/v1/persons/${personId}/projects`, (_req, res) => res.json({
  data: [{ project: 'example/project', count: 3 }], page: { has_more: false },
}))
backend.get('/v1/persons/00000000-0000-4000-8000-000000000003/projects', (_req, res) => res.json({
  data: [{ project: 'example/project', count: 2 }, { project: 'another/project', count: 1 }], page: { has_more: false },
}))

const servers: Server[] = []
async function listen(app: express.Express, port: number) {
  const server = app.listen(port, '127.0.0.1')
  servers.push(server)
  await once(server, 'listening')
}
await listen(idp, 4301)
if (!idpOnly) await listen(backend, 4302)
if (!idpOnly && !process.argv.includes('--services-only')) {
  const provider = await createIdentityProvider(config)
  const app = createApp(config, store, provider)
  serveWeb(app, 'dist')
  finishApp(app)
  await listen(app, 4300)
}
console.info('Fixture services ready')
function stop() {
  for (const server of servers) {
    server.close()
    server.closeAllConnections()
  }
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
