import 'server-only';
import { ServiceError, UpstreamError } from './errors';

export type Fetcher = typeof fetch;

export function retryAfterHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{1,7}$/.test(value)) return value;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toUTCString() : undefined;
}

/** No automatic network retries: token grants are single use and refresh tokens rotate. */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ServiceError(
      'upstream_timeout',
      504,
      'SnapTrade did not respond in time. Please try again.',
    );
  }
  if (!response.ok)
    throw new UpstreamError(response.status, retryAfterHeader(response.headers.get('retry-after')));
  if (Number(response.headers.get('content-length')) > 2_000_000)
    throw new ServiceError('invalid_response');
  const body = await response.text();
  if (body.length > 2_000_000) throw new ServiceError('invalid_response');
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ServiceError('invalid_response');
  }
}
