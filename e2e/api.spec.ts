import { expect, test } from '@playwright/test';

test('health exposes service readiness without caching or configuration details', async ({
  request,
}) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok', service: 'balance', version: 1 });
});

test('status reports configuration without authenticating an anonymous visitor', async ({
  request,
}) => {
  const response = await request.get('/api/status');
  expect([200, 503]).toContain(response.status());
  expect(response.headers()['cache-control']).toContain('no-store');
  const status = await response.json();
  expect(Object.keys(status).sort()).toEqual(['configured', 'connected', 'requirements']);
  expect(typeof status.configured).toBe('boolean');
  expect(status.connected).toBe(false);
  expect(Array.isArray(status.requirements)).toBe(true);
  if (!status.configured) expect(status.requirements.length).toBeGreaterThan(0);
  else expect(status.requirements).toEqual([]);
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('portfolio rejects anonymous data access without returning account data', async ({
  request,
}) => {
  const response = await request.get('/api/portfolio');
  expect([401, 503]).toContain(response.status());
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['code', 'error']);
  expect(['configuration', 'reconnect_required']).toContain(body.code);
  expect(typeof body.error).toBe('string');
  expect(body).not.toHaveProperty('accounts');
  expect(body).not.toHaveProperty('access_token');
  expect(body).not.toHaveProperty('refresh_token');
});

for (const route of ['/api/auth/login', '/api/auth/callback']) {
  test(`${route} returns an unconfigured instance to setup without setting credentials`, async ({
    request,
  }) => {
    const status = await (await request.get('/api/status')).json();
    test.skip(status.configured, 'This check requires an instance without OAuth configuration.');
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['cache-control']).toContain('no-store');
    const destination = new URL(response.headers().location);
    expect(destination.pathname).toBe('/');
    expect([...destination.searchParams.entries()]).toEqual([['error', 'configuration']]);
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
}
