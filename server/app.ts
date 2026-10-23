import { randomBytes, randomUUID } from 'node:crypto'
import { extname, resolve } from 'node:path'
import express from 'express'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import session from 'express-session'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import type { Config } from './config.ts'
import type { Identity, IdentityProvider, LoginAttempt } from './oidc.ts'
import { backendApi } from './api.ts'
import { onboarding } from './onboarding.ts'

declare module 'express-session' {
  interface SessionData {
    login?: LoginAttempt
    user?: Identity
    expiresAt?: number
    csrf?: string
  }
}

export function createApp(config: Config, store: session.Store, provider: IdentityProvider) {
  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)
  app.use(helmet({
    contentSecurityPolicy: config.production ? {
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
      },
    } : false,
    strictTransportSecurity: config.production ? undefined : false,
  }))
  app.use((_req, res, next) => {
    const requestId = randomUUID()
    res.locals.requestId = requestId
    res.setHeader('X-Request-ID', requestId)
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))

  const authenticated: RequestHandler = (req, res, next) => {
    if (
      !req.session.user || !req.session.expiresAt || req.session.expiresAt <= Date.now() ||
      !config.allowedSubjects.has(req.session.user.subject)
    ) {
      res.status(401).json({ error: { message: 'Sign in to continue' } })
      return
    }
    next()
  }
  const privateRoutes = express.Router()
  privateRoutes.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  privateRoutes.use(session({
    name: 'uatu.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.appUrl.protocol === 'https:',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000,
      path: '/',
    },
  }))
  const authLimit = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many sign-in attempts. Try again shortly.' } },
  })
  privateRoutes.get('/auth/login', authLimit, async (req, res) => {
    const attempt: LoginAttempt = {
      verifier: randomBytes(32).toString('base64url'),
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      createdAt: Date.now(),
    }
    const url = await provider.authorizationUrl(attempt)
    req.session.login = attempt
    await new Promise<void>((done, reject) => req.session.save(error => error ? reject(error) : done()))
    res.redirect(url.href)
  })
  privateRoutes.get('/auth/callback', authLimit, async (req, res) => {
    const attempt = req.session.login
    delete req.session.login
    await new Promise<void>((done, reject) => req.session.save(error => error ? reject(error) : done()))
    if (!attempt || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
      res.redirect('/?auth_error=expired')
      return
    }
    let user: Identity
    try {
      user = await provider.authenticate(new URL(req.originalUrl, config.appUrl), attempt)
    } catch {
      console.error(JSON.stringify({ event: 'oidc_callback_failed', requestId: res.locals.requestId }))
      res.redirect('/?auth_error=failed')
      return
    }
    if (!config.allowedSubjects.has(user.subject)) {
      console.warn(JSON.stringify({ event: 'oidc_access_denied', requestId: res.locals.requestId }))
      res.redirect('/?auth_error=denied')
      return
    }
    await new Promise<void>((done, reject) => req.session.regenerate(error => error ? reject(error) : done()))
    req.session.user = user
    req.session.csrf = randomBytes(32).toString('base64url')
    req.session.expiresAt = Date.now() + 60 * 60 * 1000
    await new Promise<void>((done, reject) => req.session.save(error => error ? reject(error) : done()))
    res.redirect('/')
  })
  privateRoutes.get('/auth/session', authenticated, (req, res) => {
    res.json({ user: { name: req.session.user?.name, canManageEmployees: Boolean(req.session.user && config.adminSubjects.has(req.session.user.subject)) }, csrf: req.session.csrf })
  })
  privateRoutes.post('/auth/logout', authenticated, async (req, res) => {
    if (req.headers.origin !== config.appUrl.origin || req.headers['x-csrf-token'] !== req.session.csrf) {
      res.status(403).json({ error: { message: 'Invalid logout request' } })
      return
    }
    await new Promise<void>((done, reject) => req.session.destroy(error => error ? reject(error) : done()))
    res.clearCookie('uatu.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: config.appUrl.protocol === 'https:' })
    res.sendStatus(204)
  })
  privateRoutes.use('/api', authenticated, onboarding(config), backendApi(config))
  privateRoutes.use((_req, res) => res.status(404).json({ error: { message: 'Route not found' } }))
  // Keep the full path on the router so OIDC callback and proxy routes share one session boundary.
  app.use((req, res, next) => {
    if (/^\/(?:auth|api)(?:\/|$)/.test(req.path)) privateRoutes(req, res, next)
    else next()
  })
  return app
}

export function serveWeb(app: express.Express, directory: string) {
  const root = resolve(directory)
  app.use(express.static(root, { index: false, dotfiles: 'deny' }))
  app.get('/{*path}', (req, res, next) => {
    if (extname(req.path) || req.path.split('/').some(part => part.startsWith('.')) || !req.accepts('html')) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(resolve(root, 'index.html'))
  })
}

export function finishApp(app: express.Express) {
  app.use((_req, res) => res.status(404).json({ error: { message: 'Route not found' } }))
  const onError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    console.error(JSON.stringify({ event: 'request_failed', requestId: res.locals.requestId }))
    if (res.headersSent) { next(error); return }
    res.status(500).json({ error: { message: 'Request failed', request_id: res.locals.requestId } })
  }
  app.use(onError)
}
