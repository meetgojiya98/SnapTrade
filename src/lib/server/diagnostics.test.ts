import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from './errors';
import { errorResponse } from './routes';

afterEach(() => vi.restoreAllMocks());

describe('safe failure diagnostics', () => {
  it('correlates response and logs without recording raw errors, secrets, or financial payloads', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = errorResponse(
      new Error('postgres://admin:SECRET@private/holdings?account=123456789'),
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'balance.request.failed',
        requestId: body.requestId,
        code: 'service_unavailable',
        status: 503,
      }),
    );
    expect(JSON.stringify(body)).not.toMatch(/SECRET|123456789|postgres/);
  });
  it('preserves retry behavior and generates independent references for failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new ServiceError('rate_limited', 429, 'Please wait before trying again.', '60');
    const first = errorResponse(error);
    const second = errorResponse(error);
    expect(first.headers.get('retry-after')).toBe('60');
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });
  it('does not create noisy logs for routine invalid or signed-out requests', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = errorResponse(new ServiceError('reconnect_required', 401, 'Connect again.'));
    expect((await response.json()).requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(log).not.toHaveBeenCalled();
  });
});
