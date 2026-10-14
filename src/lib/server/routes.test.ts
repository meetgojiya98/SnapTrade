import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { configurationRequirements } from './config';
import { GET as status } from '@/app/api/status/route';
import { GET as login } from '@/app/api/auth/login/route';
import { GET as portfolio } from '@/app/api/portfolio/route';
import { GET as health } from '@/app/api/health/route';
import { POST as logout } from '@/app/api/auth/logout/route';

afterEach(() => vi.unstubAllEnvs());
const key = Buffer.alloc(32, 1).toString('base64');
function configured() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SNAPTRADE_CLIENT_ID', 'client');
  vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'very-secret-client');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('SESSION_ENCRYPTION_KEY', key);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SESSION_STORE', 'memory');
}

describe('server route security', () => {
  it('rejects memory sessions and plain HTTP in production', () => {
    const requirements = configurationRequirements({
      NODE_ENV: 'production',
      SNAPTRADE_CLIENT_ID: 'client',
      SNAPTRADE_CLIENT_SECRET: 'secret',
      APP_URL: 'http://localhost:3000',
      SESSION_ENCRYPTION_KEY: key,
      SESSION_STORE: 'memory',
    });
    expect(requirements.some((item) => item.startsWith('DATABASE_URL'))).toBe(true);
    expect(requirements.some((item) => item.startsWith('APP_URL'))).toBe(true);
  });
  it('supports explicitly configured loopback memory sessions without exposing secret values', async () => {
    configured();
    const response = await status(new NextRequest('http://localhost:3000/api/status'));
    expect(await response.json()).toEqual({ configured: true, connected: false, requirements: [] });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('redirects to setup when credentials are absent', async () => {
    configured();
    vi.stubEnv('SNAPTRADE_CLIENT_ID', '');
    const response = await login(new NextRequest('http://localhost:3000/api/auth/login'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/?error=configuration');
  });
  it('requires an opaque cookie for live data and does not leak configuration secrets', async () => {
    configured();
    const response = await portfolio(new NextRequest('http://localhost:3000/api/portfolio'));
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain('reconnect_required');
    expect(body).not.toContain('very-secret-client');
  });
  it.each([undefined, 'https://evil.example'])(
    'rejects logout with an invalid Origin %s',
    async (origin) => {
      configured();
      const request = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: origin ? { origin } : {},
      });
      const response = await logout(request);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('invalid_origin');
    },
  );
  it('clears HttpOnly same-site cookies on an authorized logout', async () => {
    configured();
    const response = await logout(
      new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ disconnected: true, revoked: true });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Max-Age=0');
  });
  it('keeps health output minimal and secret-free', async () => {
    configured();
    expect(await health().json()).toEqual({ status: 'ok', service: 'balance', version: 1 });
  });
});
