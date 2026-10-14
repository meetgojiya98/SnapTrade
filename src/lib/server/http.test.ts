import { describe, expect, it } from 'vitest';
import { requestJson, type Fetcher } from './http';

const from =
  (response: Response): Fetcher =>
  async () =>
    response;
const url = 'https://api.snaptrade.com/accounts';

describe('bounded upstream responses', () => {
  it('decodes valid chunked JSON across multibyte character boundaries', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ label: 'Café €', values: [1, 2] }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(await requestJson(url, {}, from(new Response(stream)))).toEqual({
      label: 'Café €',
      values: [1, 2],
    });
  });

  it('cancels an oversized streaming response without consuming its remainder', async () => {
    let chunks = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(700_000));
        if (chunks === 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(requestJson(url, {}, from(new Response(stream)))).rejects.toMatchObject({
      code: 'invalid_response',
      status: 502,
    });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThan(20);
  });

  it('applies the limit to bytes rather than JavaScript string length', async () => {
    const response = new Response(JSON.stringify({ text: '€'.repeat(700_000) }));
    await expect(requestJson(url, {}, from(response))).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects a declared oversized body before reading and closes it', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      requestJson(
        url,
        {},
        from(new Response(stream, { headers: { 'Content-Length': '2000001' } })),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(cancelled).toBe(true);
  });

  it('keeps rate-limit semantics while releasing the error response body', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      requestJson(
        url,
        {},
        from(new Response(stream, { status: 429, headers: { 'Retry-After': '60' } })),
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: '60' });
    expect(cancelled).toBe(true);
  });

  it('maps mid-body aborts to a safe timeout and hides other stream failure details', async () => {
    const failing = (error: Error) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        }),
      );
    const timeout = new Error('private upstream details');
    timeout.name = 'AbortError';
    await expect(requestJson(url, {}, from(failing(timeout)))).rejects.toMatchObject({
      code: 'upstream_timeout',
      status: 504,
    });
    await expect(
      requestJson(url, {}, from(failing(new Error('Bearer SECRET account=123456')))),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'SnapTrade is temporarily unavailable. Please try again.',
    });
  });
});
