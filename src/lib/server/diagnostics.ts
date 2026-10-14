import 'server-only';
import { randomUUID } from 'node:crypto';
import { safeError } from './errors';

/** Log only a generated reference and bounded service classification, never source errors. */
export function failureReference(error: unknown): string {
  const safe = safeError(error);
  const requestId = randomUUID();
  if (safe.status >= 500 || safe.status === 429) {
    console.warn(
      JSON.stringify({
        event: 'balance.request.failed',
        requestId,
        code: /^[a-z_]{1,48}$/.test(safe.code) ? safe.code : 'service_unavailable',
        status: safe.status,
      }),
    );
  }
  return requestId;
}
