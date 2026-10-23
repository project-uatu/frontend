import { fileURLToPath } from 'node:url'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import pg from 'pg'
import { loadConfig } from './config.ts'
import { createIdentityProvider } from './oidc.ts'
import { createApp, finishApp, serveWeb } from './app.ts'

const dev = process.argv.includes('--dev')
if (dev && process.env.NODE_ENV === 'production') throw new Error('Development middleware cannot run in production')
const config = loadConfig({ ...process.env, NODE_ENV: dev ? 'development' : 'production' })
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  query_timeout: 5000,
})
pool.on('error', () => console.error(JSON.stringify({ event: 'session_database_error' })))
// Provision the session table explicitly before startup; serving never runs schema changes.
await pool.query('SELECT sid FROM session LIMIT 0')
const PgStore = connectPgSimple(session)
const store = new PgStore({
  pool,
  errorLog: () => console.error(JSON.stringify({ event: 'session_store_error' })),
})
const provider = await createIdentityProvider(config)
const app = createApp(config, store, provider)
app.get('/readyz', async (_req, res) => {
  try {
    await pool.query('SELECT sid FROM session LIMIT 0')
    res.json({ status: 'ready' })
  } catch {
    console.error(JSON.stringify({ event: 'readiness_failed' }))
    res.status(503).json({ status: 'unavailable' })
  }
})
const vite = dev ? await (await import('vite')).createServer({
  configLoader: 'native',
  server: { middlewareMode: true },
  appType: 'spa',
}) : undefined
if (vite) app.use(vite.middlewares)
else serveWeb(app, fileURLToPath(new URL('../dist', import.meta.url)))
finishApp(app)
const server = app.listen(config.port, config.host, () => {
  console.info(`Uatu listening on ${config.appUrl.origin}`)
})
server.on('error', () => {
  console.error(JSON.stringify({ event: 'listen_failed' }))
  process.exit(1)
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 10000)
  deadline.unref()
  server.close(async () => {
    await vite?.close()
    store.close()
    await pool.end()
    clearTimeout(deadline)
  })
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
