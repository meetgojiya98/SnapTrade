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
  expect(Object.keys(body).sort()).toEqual(['code', 'error', 'requestId']);
  expect(['configuration', 'reconnect_required']).toContain(body.code);
  expect(typeof body.error).toBe('string');
  expect(body.requestId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  expect(response.headers()['x-request-id']).toBe(body.requestId);
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
    expect(destination.pathname).toBe('/app');
    expect([...destination.searchParams.entries()]).toEqual([['error', 'configuration']]);
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
}

test('workspace and plan APIs reject anonymous requests without exposing user records', async ({
  request,
}) => {
  for (const route of [
    '/api/workspace',
    '/api/plans',
    '/api/plans?id=00000000-0000-4000-8000-000000000001',
  ]) {
    const response = await request.get(route);
    expect([401, 503]).toContain(response.status());
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'requestId']);
    expect(['configuration', 'reconnect_required']).toContain(body.code);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(response.headers()['x-request-id']).toBe(body.requestId);
    expect(body).not.toHaveProperty('preferences');
    expect(body).not.toHaveProperty('plans');
    expect(body).not.toHaveProperty('source');
  }
});

test('workspace and plan mutations reject foreign origins or unavailable configuration', async ({
  request,
}) => {
  const hostile = { Origin: 'https://unrelated.example' };
  const responses = [
    await request.put('/api/workspace', { headers: hostile, data: { preferences: {} } }),
    await request.delete('/api/workspace', { headers: hostile }),
    await request.post('/api/plans', { headers: hostile, data: { name: 'Unauthorized plan' } }),
    await request.delete('/api/plans/00000000-0000-4000-8000-000000000001', { headers: hostile }),
  ];
  for (const response of responses) {
    expect([403, 503]).toContain(response.status());
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json();
    expect(['configuration', 'invalid_origin']).toContain(body.code);
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('deleted');
  }
});
