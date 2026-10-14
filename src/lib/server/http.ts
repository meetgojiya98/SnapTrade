import 'server-only';
import { ServiceError, UpstreamError } from './errors';

export type Fetcher = typeof fetch;
const MAX_RESPONSE_BYTES = 2_000_000;

const timeoutError = () =>
  new ServiceError('upstream_timeout', 504, 'SnapTrade did not respond in time. Please try again.');

async function limitedBody(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new ServiceError('invalid_response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceError('invalid_response');
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ServiceError('invalid_response');
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      throw timeoutError();
    throw new ServiceError('invalid_response');
  } finally {
    reader.releaseLock();
  }
}

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
    throw timeoutError();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(response.status, retryAfterHeader(response.headers.get('retry-after')));
  }
  const body = await limitedBody(response);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ServiceError('invalid_response');
  }
}
