import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { Config } from './config.ts'

const inputSchema = z.strictObject({
  forge: z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/i),
  login: z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/i),
  display_name: z.string().trim().min(1).max(200).refine(value => !value.includes('\0')),
})
const responseSchema = z.object({
  data: z.object({
    person: z.object({ id: z.uuid(), display_name: z.string().optional() }),
    job: z.object({ id: z.uuid(), status: z.string() }),
  }),
})

export function onboarding(config: Config) {
  const router = express.Router()
  router.post('/persons', (req, res, next) => {
    if (!req.session.user || !config.adminSubjects.has(req.session.user.subject)) {
      res.status(403).json({ error: { message: 'Administrator access is required to add employees' } })
      return
    }
    if (req.headers.origin !== config.appUrl.origin || !req.session.csrf || req.headers['x-csrf-token'] !== req.session.csrf) {
      res.status(403).json({ error: { message: 'Invalid employee onboarding request' } })
      return
    }
    next()
  }, rateLimit({
    windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { message: 'Too many onboarding requests. Try again shortly.' } },
  }), express.json({ limit: '4kb' }), async (req, res) => {
    const input = inputSchema.safeParse(req.body)
    if (!input.success || Object.keys(req.query).length || !req.is('application/json')) {
      res.status(400).json({ error: { message: 'Provide a forge hostname, account login and display name as JSON' } })
      return
    }
    try {
      const upstream = await fetch(new URL('/v1/persons', config.backendUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(input.data), signal: AbortSignal.timeout(10000), redirect: 'error',
      })
      if (upstream.status !== 201) {
        console.error(JSON.stringify({ event: 'onboarding_rejected', status: upstream.status, requestId: res.locals.requestId }))
        const status = [400, 409, 429, 503].includes(upstream.status) ? upstream.status : 502
        res.status(status).json({ error: { message: status === 409 ? 'This account is already assigned to a tracked employee.'
          : status === 400 ? 'The backend rejected this forge or account login. Check that the forge is configured and the login is valid.'
            : 'Onboarding could not be confirmed. Check the employee directory before trying again.' } })
        return
      }
      const result = responseSchema.parse(await upstream.json())
      console.info(JSON.stringify({ event: 'employee_onboarded', personId: result.data.person.id, requestId: res.locals.requestId }))
      res.status(201).json(result)
    } catch {
      console.error(JSON.stringify({ event: 'onboarding_unconfirmed', requestId: res.locals.requestId }))
      res.status(502).json({ error: { message: 'Onboarding could not be confirmed. Check the employee directory before trying again.' } })
    }
  })
  const onError: express.ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { message: 'Invalid JSON request' } })
    } else if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: { message: 'Employee onboarding request is too large' } })
    } else next(error)
  }
  router.use(onError)
  return router
}
