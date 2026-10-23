import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'

export const testEnv = {
  APP_URL: 'http://127.0.0.1:3000',
  UATU_BACKEND_URL: 'http://127.0.0.1:8080',
  UATU_API_KEY: 'test-only-backend-key-not-a-real-secret',
  SESSION_SECRET: 'test-only-session-key-not-a-real-secret',
  SESSION_DATABASE_URL: 'postgres://localhost/test',
  OIDC_ISSUER: 'http://127.0.0.1:4000',
  OIDC_CLIENT_ID: 'test-client',
  OIDC_CLIENT_SECRET: 'test-secret',
  OIDC_ALLOWED_SUBJECTS: 'reader',
}

describe('server configuration', () => {
  it('disables onboarding by default and requires admins to be approved subjects', () => {
    expect(loadConfig(testEnv).adminSubjects.size).toBe(0)
    expect(loadConfig({ ...testEnv, OIDC_ADMIN_SUBJECTS: ' reader ' }).adminSubjects.has('reader')).toBe(true)
    expect(() => loadConfig({ ...testEnv, OIDC_ADMIN_SUBJECTS: 'outsider' })).toThrow('subset')
  })
  it('loads development configuration without exposing secret values in validation messages', () => {
    expect(loadConfig(testEnv).port).toBe(3000)
    expect(() => loadConfig({ ...testEnv, UATU_API_KEY: 'short' })).toThrow('at least 32 bytes')
  })
  it.each(['UATU_API_KEY', 'SESSION_SECRET', 'OIDC_CLIENT_SECRET', 'OIDC_ALLOWED_SUBJECTS', 'SESSION_DATABASE_URL'])(
    'requires %s', name => {
      expect(() => loadConfig({ ...testEnv, [name]: '' })).toThrow(`${name} is required`)
    },
  )
  it('requires HTTPS in production', () => {
    expect(() => loadConfig({ ...testEnv, NODE_ENV: 'production' })).toThrow('HTTPS')
    expect(() => loadConfig({
      ...testEnv, NODE_ENV: 'production', APP_URL: 'https://uatu.example', OIDC_ISSUER: 'https://idp.example',
    })).not.toThrow()
  })
  it.each(['https://user:password@example.com', 'https://example.com/path', 'https://example.com/?q=x'])(
    'rejects non-origin backend URL %s', url => {
      expect(() => loadConfig({ ...testEnv, UATU_BACKEND_URL: url })).toThrow('UATU_BACKEND_URL')
    },
  )
  it('rejects non-loopback HTTP issuers even in development', () => {
    expect(() => loadConfig({ ...testEnv, OIDC_ISSUER: 'http://idp.example' })).toThrow('HTTPS')
  })
  it.each(['0', '1.5', '65536', 'NaN'])('rejects invalid port %s', port => {
    expect(() => loadConfig({ ...testEnv, PORT: port })).toThrow('PORT')
  })
})
