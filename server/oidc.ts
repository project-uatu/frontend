import * as oidc from 'openid-client'
import type { Config } from './config.ts'

export interface LoginAttempt {
  verifier: string
  state: string
  nonce: string
  createdAt: number
}

export interface Identity {
  subject: string
  name: string
}

export interface IdentityProvider {
  authorizationUrl(attempt: LoginAttempt): Promise<URL>
  authenticate(url: URL, attempt: LoginAttempt): Promise<Identity>
}

export async function createIdentityProvider(config: Config): Promise<IdentityProvider> {
  const client = await oidc.discovery(
    config.issuer,
    config.clientId,
    config.clientSecret,
    undefined,
    config.issuer.protocol === 'http:'
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined,
  )
  return {
    async authorizationUrl(attempt) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: new URL('/auth/callback', config.appUrl).href,
        scope: 'openid profile',
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: 'S256',
      })
    },
    async authenticate(url, attempt) {
      const tokens = await oidc.authorizationCodeGrant(client, url, {
        pkceCodeVerifier: attempt.verifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      if (!claims) throw new Error('Missing ID token claims')
      return {
        subject: claims.sub,
        name: typeof claims.name === 'string' ? claims.name : 'Organization member',
      }
    },
  }
}
