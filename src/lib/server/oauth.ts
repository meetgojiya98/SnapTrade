import 'server-only';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { getServerConfig, type ServerConfig } from './config';
import { hashSecret, pkceChallenge, randomSecret, secretsEqual, validSecret } from './crypto';
import { reconnectError, ServiceError, UpstreamError } from './errors';
import { requestJson, type Fetcher } from './http';
import { getSessionStore, type Session, type SessionStore } from './store';

const ISSUER = 'https://api.snaptrade.com';
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
  code_challenge_methods_supported: string[];
  id_token_signing_alg_values_supported: string[];
}
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}
type AccessResult = { token: string } | { error: ServiceError };

function trustedEndpoint(value: unknown, origin: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function tokenSession(tokens: TokenResponse, subject: string, previousScope?: string): Session {
  if (
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token ||
    tokens.access_token.length > 16_384 ||
    typeof tokens.refresh_token !== 'string' ||
    !tokens.refresh_token ||
    tokens.refresh_token.length > 16_384 ||
    typeof tokens.token_type !== 'string' ||
    tokens.token_type.toLowerCase() !== 'bearer' ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0 ||
    tokens.expires_in > 86_400
  ) {
    throw new ServiceError('invalid_token_response');
  }
  const scope = typeof tokens.scope === 'string' ? tokens.scope : (previousScope ?? '');
  if (!scope.split(' ').includes('read'))
    throw new ServiceError(
      'missing_read_scope',
      403,
      'Read access was not granted. Connect again and approve read access.',
    );
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    subject,
    scope,
  };
}

export class OAuthService {
  private metadataCache?: { value: OidcMetadata; expires: number };
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(
    private config: ServerConfig,
    private store: SessionStore,
    private fetcher: Fetcher = fetch,
  ) {}

  private async metadata(): Promise<OidcMetadata> {
    if (this.metadataCache && this.metadataCache.expires > Date.now())
      return this.metadataCache.value;
    const metadata = await requestJson<OidcMetadata>(
      DISCOVERY,
      { headers: { Accept: 'application/json' } },
      this.fetcher,
    );
    if (
      metadata.issuer !== ISSUER ||
      !trustedEndpoint(metadata.authorization_endpoint, 'https://dashboard.snaptrade.com') ||
      !trustedEndpoint(metadata.token_endpoint, ISSUER) ||
      !trustedEndpoint(metadata.revocation_endpoint, ISSUER) ||
      !trustedEndpoint(metadata.jwks_uri, ISSUER) ||
      !metadata.code_challenge_methods_supported?.includes('S256') ||
      !metadata.id_token_signing_alg_values_supported?.includes('RS256')
    ) {
      throw new ServiceError('invalid_discovery');
    }
    this.metadataCache = { value: metadata, expires: Date.now() + 10 * 60 * 1000 };
    return metadata;
  }

  private basicAuthorization(): string {
    const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    return `Basic ${Buffer.from(`${formEncode(this.config.clientId)}:${formEncode(this.config.clientSecret)}`).toString('base64')}`;
  }

  private async token(body: URLSearchParams): Promise<TokenResponse> {
    const metadata = await this.metadata();
    return requestJson<TokenResponse>(
      metadata.token_endpoint,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: this.basicAuthorization(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      this.fetcher,
    );
  }

  async beginLogin() {
    const metadata = await this.metadata();
    const state = randomSecret();
    const browser = randomSecret();
    const verifier = randomSecret();
    const nonce = randomSecret();
    await this.store.putLogin(state, browser, { verifier, nonce });
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid read',
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), browser };
  }

  async finishLogin(input: {
    state: string | null;
    browser: string | undefined;
    code: string | null;
    issuer: string | null;
    error: string | null;
  }) {
    if (!validSecret(input.state) || !validSecret(input.browser))
      throw new ServiceError(
        'invalid_state',
        400,
        'This connection attempt expired. Please connect again.',
      );
    const attempt = await this.store.consumeLogin(input.state, input.browser);
    if (!attempt)
      throw new ServiceError(
        'invalid_state',
        400,
        'This connection attempt expired. Please connect again.',
      );
    // State is consumed before exchanging the one-time code, including denied attempts.
    if (input.error)
      throw new ServiceError('access_denied', 400, 'SnapTrade connection was cancelled.');
    if (
      !input.code ||
      input.code.length > 4096 ||
      (input.issuer !== null && input.issuer !== ISSUER)
    )
      throw new ServiceError('invalid_callback', 400);
    const metadata = await this.metadata();
    const tokens = await this.token(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: attempt.verifier,
        redirect_uri: this.config.redirectUri,
      }),
    );
    if (!tokens.id_token || typeof tokens.id_token !== 'string')
      throw new ServiceError('missing_id_token');
    this.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
      timeoutDuration: 10_000,
      cooldownDuration: 30_000,
      [customFetch]: (url, init) =>
        this.fetcher(url, { ...init, redirect: 'error', cache: 'no-store' }),
    });
    let subject: string;
    try {
      const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: ISSUER,
        audience: this.config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
        maxTokenAge: '10 minutes',
        clockTolerance: 5,
      });
      if (
        typeof payload.nonce !== 'string' ||
        !secretsEqual(payload.nonce, attempt.nonce) ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        payload.sub.length > 255
      )
        throw new Error('Invalid claims');
      subject = payload.sub;
    } catch {
      throw new ServiceError(
        'invalid_id_token',
        400,
        'SnapTrade could not verify this sign-in. Please connect again.',
      );
    }
    const id = randomSecret();
    await this.store.createSession(id, tokenSession(tokens, subject));
    // The ID token is intentionally discarded after verification.
    return id;
  }

  async getAccessToken(id: string, rejectedToken?: string): Promise<string> {
    if (!validSecret(id)) throw reconnectError();
    const result = await this.store.withSession<AccessResult>(id, async (session) => {
      if (!session) return { session: null, value: { error: reconnectError() } };
      const refreshNeeded = rejectedToken
        ? session.accessToken === rejectedToken
        : session.accessExpiresAt <= Date.now() + 60_000;
      if (!refreshNeeded) return { session, value: { token: session.accessToken } };
      try {
        const tokens = await this.token(
          new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
        );
        const updated = tokenSession(tokens, session.subject, session.scope);
        return { session: updated, value: { token: updated.accessToken } };
      } catch (error) {
        if (error instanceof UpstreamError && [400, 401, 403].includes(error.upstreamStatus)) {
          return { session: null, value: { error: reconnectError() } };
        }
        // Preserve credentials for transient errors, including 429, rather than attempting a second refresh.
        return {
          session,
          value: {
            error: error instanceof ServiceError ? error : new ServiceError('refresh_failed'),
          },
        };
      }
    });
    if ('error' in result) throw result.error;
    return result.token;
  }

  async api<T>(id: string, path: string): Promise<T> {
    if (
      (!/^\/accounts(?:\/|$)/.test(path) && path !== '/authorizations') ||
      path.includes('..') ||
      path.includes('?')
    )
      throw new ServiceError('invalid_api_path', 400);
    const call = (token: string) =>
      requestJson<T>(
        `${ISSUER}${path}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
        this.fetcher,
      );
    const originalToken = await this.getAccessToken(id);
    try {
      return await call(originalToken);
    } catch (error) {
      if (!(error instanceof UpstreamError) || error.upstreamStatus !== 401) throw error;
      const refreshedToken = await this.getAccessToken(id, originalToken);
      try {
        return await call(refreshedToken);
      } catch (retryError) {
        if (retryError instanceof UpstreamError && retryError.upstreamStatus === 401) {
          // A late rejection must not revoke credentials another request has already rotated.
          const invalidated = await this.store.withSession(id, async (current) => {
            const failedCurrentToken = !current || current.accessToken === refreshedToken;
            return { session: failedCurrentToken ? null : current, value: failedCurrentToken };
          });
          if (invalidated) throw reconnectError();
        }
        throw retryError;
      }
    }
  }

  async disconnect(id: string): Promise<{ revoked: boolean }> {
    if (!validSecret(id)) return { revoked: true };
    return this.store.withSession(id, async (session) => {
      if (!session) return { session: null, value: { revoked: true } };
      let revoked = false;
      try {
        const metadata = await this.metadata();
        const response = await this.fetcher(metadata.revocation_endpoint, {
          method: 'POST',
          headers: {
            Authorization: this.basicAuthorization(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: session.refreshToken,
            token_type_hint: 'refresh_token',
          }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
        });
        revoked = response.ok;
      } catch {
        /* Local credentials are still deleted if remote revocation is unavailable. */
      }
      return { session: null, value: { revoked } };
    });
  }
}

let serviceCache: { fingerprint: string; service: OAuthService } | undefined;
export function getOAuthService() {
  const config = getServerConfig();
  const fingerprint = hashSecret(
    `${config.clientId}:${config.clientSecret}:${config.appUrl}:${config.databaseUrl}:${config.encryptionKey.toString('base64')}`,
  );
  if (serviceCache?.fingerprint === fingerprint) return serviceCache.service;
  const service = new OAuthService(config, getSessionStore());
  serviceCache = { fingerprint, service };
  return service;
}
