export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
    message = 'SnapTrade is temporarily unavailable. Please try again.',
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class UpstreamError extends ServiceError {
  constructor(
    public readonly upstreamStatus: number,
    retryAfter?: string,
  ) {
    super(
      upstreamStatus === 429 ? 'rate_limited' : 'upstream_unavailable',
      upstreamStatus === 429 ? 429 : 502,
      upstreamStatus === 429
        ? 'SnapTrade is receiving too many requests. Please wait before refreshing.'
        : 'SnapTrade could not provide this data. Please try again.',
      retryAfter,
    );
  }
}

export const reconnectError = () =>
  new ServiceError(
    'reconnect_required',
    401,
    'Your SnapTrade session has ended. Connect again to continue.',
  );

export function safeError(error: unknown): ServiceError {
  return error instanceof ServiceError
    ? error
    : new ServiceError(
        'service_unavailable',
        503,
        'The connection service is unavailable. Please try again.',
      );
}
