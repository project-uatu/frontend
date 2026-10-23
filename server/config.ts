export interface Config {
  production: boolean
  host: string
  port: number
  appUrl: URL
  backendUrl: URL
  apiKey: string
  sessionSecret: string
  databaseUrl: string
  issuer: URL
  clientId: string
  clientSecret: string
  allowedSubjects: Set<string>
  adminSubjects: Set<string>
  trustProxy: boolean
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function origin(value: string, name: string, production: boolean): URL {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !production))
  ) throw new Error(`${name} must use HTTPS (HTTP loopback is allowed only outside production)`)
  return url
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const production = env.NODE_ENV === 'production'
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }
  const appUrl = origin(required(env, 'APP_URL'), 'APP_URL', production)
  if (appUrl.pathname !== '/') throw new Error('APP_URL must be an origin without a path')
  const backendUrl = new URL(required(env, 'UATU_BACKEND_URL'))
  if (
    !['http:', 'https:'].includes(backendUrl.protocol) || backendUrl.username ||
    backendUrl.password || backendUrl.search || backendUrl.hash || backendUrl.pathname !== '/'
  ) throw new Error('UATU_BACKEND_URL must be an HTTP(S) origin without credentials or a path')
  const apiKey = required(env, 'UATU_API_KEY')
  const sessionSecret = required(env, 'SESSION_SECRET')
  if (Buffer.byteLength(apiKey) < 32 || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('UATU_API_KEY and SESSION_SECRET must each contain at least 32 bytes')
  }
  const databaseUrl = required(env, 'SESSION_DATABASE_URL')
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('SESSION_DATABASE_URL must be a PostgreSQL URL')
  }
  const allowedSubjects = new Set(required(env, 'OIDC_ALLOWED_SUBJECTS').split(',').map(s => s.trim()).filter(Boolean))
  if (allowedSubjects.size === 0) throw new Error('OIDC_ALLOWED_SUBJECTS must contain at least one subject')
  const adminSubjects = new Set((env.OIDC_ADMIN_SUBJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean))
  if ([...adminSubjects].some(subject => !allowedSubjects.has(subject))) {
    throw new Error('OIDC_ADMIN_SUBJECTS must be a subset of OIDC_ALLOWED_SUBJECTS')
  }
  if (env.TRUST_PROXY && !['true', 'false'].includes(env.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY must be true or false')
  }
  return {
    production,
    host: env.HOST ?? '127.0.0.1',
    port,
    appUrl,
    backendUrl,
    apiKey,
    sessionSecret,
    databaseUrl,
    issuer: origin(required(env, 'OIDC_ISSUER'), 'OIDC_ISSUER', production),
    clientId: required(env, 'OIDC_CLIENT_ID'),
    clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
    allowedSubjects,
    adminSubjects,
    trustProxy: env.TRUST_PROXY === 'true',
  }
}
