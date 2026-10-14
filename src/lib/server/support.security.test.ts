import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSupportInput, SupportThread } from '@/lib/support';
import { GET as list, POST as create, DELETE as removeAll } from '@/app/api/support/route';
import { GET as detail, PATCH as status, DELETE as remove } from '@/app/api/support/[id]/route';
import { POST as reply } from '@/app/api/support/[id]/messages/route';
import { randomSecret } from './crypto';
import { getSessionStore } from './store';
import { supportOwnerHash } from './support-auth';
import { getSupportStore } from './support-store';

const origin = 'http://localhost:3000';
const operatorSubject = 'synthetic-security-operator';
const input = (): CreateSupportInput => ({
  clientRequestId: randomUUID(),
  topic: 'planning',
  title: 'Synthetic private title',
  message: 'Synthetic private report: no customer data.',
  requestReference: null,
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SNAPTRADE_CLIENT_ID', 'synthetic-client');
  vi.stubEnv('SNAPTRADE_CLIENT_SECRET', 'synthetic-client-secret');
  vi.stubEnv('APP_URL', origin);
  vi.stubEnv('SESSION_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SESSION_STORE', 'memory');
  vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', supportOwnerHash(operatorSubject));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function session(subject: string = randomUUID()) {
  const id = randomSecret();
  await getSessionStore().createSession(id, {
    subject,
    scope: 'openid read',
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    accessExpiresAt: Date.now() + 3600_000,
  });
  return { id, subject };
}

function request(
  path: string,
  id?: string,
  method = 'GET',
  body?: unknown,
  requestOrigin: string | null = origin,
  extra: Record<string, string> = {},
) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      ...(id ? { cookie: `balance_session=${id}` } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function error(response: Response, expectedStatus: number, code: string) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['code', 'error', 'requestId']);
  expect(body.code).toBe(code);
  expect(body.requestId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  expect(response.headers.get('x-request-id')).toBe(body.requestId);
  return { code: body.code, error: body.error };
}

async function opened(id: string, value = input()): Promise<SupportThread> {
  const response = await create(request('/api/support', id, 'POST', value));
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return (await response.json()).thread;
}

describe('private support HTTP security boundaries', () => {
  it('keeps customer identities isolated for lists, detail, replies, status and deletion', async () => {
    const a = await session();
    const b = await session();
    const thread = await opened(a.id);
    const mine = await list(request('/api/support', a.id));
    const collection = await mine.json();
    expect(collection.threads).toHaveLength(1);
    expect(collection.threads[0]).not.toHaveProperty('messages');
    expect(JSON.stringify(collection)).not.toContain(thread.messages[0].body);
    expect(JSON.stringify(collection)).not.toContain(a.subject);
    expect((await (await list(request('/api/support', b.id))).json()).threads).toEqual([]);
    const nextLogin = await session(a.subject);
    expect(
      (
        await (
          await detail(request(`/api/support/${thread.id}`, nextLogin.id), context(thread.id))
        ).json()
      ).thread,
    ).toEqual(thread);
    const operations = [
      (id: string) => detail(request(`/api/support/${id}`, b.id), context(id)),
      (id: string) =>
        reply(
          request(`/api/support/${id}/messages`, b.id, 'POST', {
            clientRequestId: randomUUID(),
            message: 'A forbidden reply.',
          }),
          context(id),
        ),
      (id: string) =>
        status(request(`/api/support/${id}`, b.id, 'PATCH', { status: 'resolved' }), context(id)),
      (id: string) => remove(request(`/api/support/${id}`, b.id, 'DELETE'), context(id)),
    ];
    for (const operation of operations) {
      const foreign = await error(await operation(thread.id), 404, 'support_not_found');
      const missing = await error(await operation(randomUUID()), 404, 'support_not_found');
      expect(foreign).toEqual(missing);
      expect(JSON.stringify(foreign)).not.toContain(thread.title);
    }
    await error(await list(request('/api/support')), 401, 'reconnect_required');
    await error(
      await detail(request(`/api/support/${thread.id}`), context(thread.id)),
      401,
      'reconnect_required',
    );
    const retained = (
      await (await detail(request(`/api/support/${thread.id}`, a.id), context(thread.id))).json()
    ).thread;
    expect(retained.status).toBe('open');
    expect(retained.messages).toHaveLength(1);
  });

  it('defaults operators to denied and trusts only the configured verified subject hash', async () => {
    const customer = await session();
    const operator = await session(operatorSubject);
    const thread = await opened(customer.id);
    vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', '');
    const denied = await (await list(request('/api/support', operator.id))).json();
    expect(denied).toMatchObject({ role: 'customer', acceptingRequests: false });
    await error(
      await list(request('/api/support?scope=all', operator.id)),
      403,
      'operator_required',
    );
    vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', `${supportOwnerHash(operatorSubject)},*`);
    expect(
      (await (await list(request('/api/support', operator.id))).json()).acceptingRequests,
    ).toBe(false);
    vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', supportOwnerHash(operatorSubject));
    await error(
      await list(
        request('/api/support?scope=all', customer.id, 'GET', undefined, null, {
          'x-support-role': 'operator',
          'x-support-subject': operatorSubject,
        }),
      ),
      403,
      'operator_required',
    );
    const all = await (await list(request('/api/support?scope=all', operator.id))).json();
    expect(all.role).toBe('operator');
    expect(all.threads[0].canDelete).toBe(false);
    const answered = await reply(
      request(`/api/support/${thread.id}/messages`, operator.id, 'POST', {
        clientRequestId: randomUUID(),
        message: 'A synthetic operator response.',
      }),
      context(thread.id),
    );
    expect(answered.status).toBe(200);
    expect((await answered.json()).thread.messages.at(-1).author).toBe('operator');
    await error(
      await remove(request(`/api/support/${thread.id}`, operator.id, 'DELETE'), context(thread.id)),
      404,
      'support_not_found',
    );
    await opened(operator.id);
    expect((await removeAll(request('/api/support', operator.id, 'DELETE'))).status).toBe(200);
    expect(
      (await detail(request(`/api/support/${thread.id}`, customer.id), context(thread.id))).status,
    ).toBe(200);
    vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', supportOwnerHash(customer.subject));
    await error(
      await detail(request(`/api/support/${thread.id}`, operator.id), context(thread.id)),
      404,
      'support_not_found',
    );
    await error(
      await list(request('/api/support?scope=all', operator.id)),
      403,
      'operator_required',
    );
  });

  it('requires a matching mutation origin and rejects client identity or role fields', async () => {
    const actor = await session();
    const thread = await opened(actor.id);
    for (const untrustedOrigin of [null, 'https://foreign.example', `${origin}.foreign.example`]) {
      const operations = [
        () => create(request('/api/support', actor.id, 'POST', input(), untrustedOrigin)),
        () =>
          reply(
            request(
              `/api/support/${thread.id}/messages`,
              actor.id,
              'POST',
              { clientRequestId: randomUUID(), message: 'Blocked.' },
              untrustedOrigin,
            ),
            context(thread.id),
          ),
        () =>
          status(
            request(
              `/api/support/${thread.id}`,
              actor.id,
              'PATCH',
              { status: 'resolved' },
              untrustedOrigin,
            ),
            context(thread.id),
          ),
        () =>
          remove(
            request(`/api/support/${thread.id}`, actor.id, 'DELETE', undefined, untrustedOrigin),
            context(thread.id),
          ),
        () => removeAll(request('/api/support', actor.id, 'DELETE', undefined, untrustedOrigin)),
      ];
      for (const operation of operations) await error(await operation(), 403, 'invalid_origin');
    }
    await error(
      await create(
        request('/api/support', actor.id, 'POST', {
          ...input(),
          subject: operatorSubject,
          role: 'operator',
          ownerHash: supportOwnerHash(operatorSubject),
        }),
      ),
      400,
      'invalid_input',
    );
    const retained = await (
      await detail(request(`/api/support/${thread.id}`, actor.id), context(thread.id))
    ).json();
    expect(retained.thread.messages).toHaveLength(1);
    expect(retained.thread.status).toBe('open');
  });

  it('scopes idempotency to an owner, rejects changed retries and cannot recreate a deleted request', async () => {
    const a = await session();
    const b = await session();
    const value = input();
    const original = await opened(a.id, value);
    const replay = await create(request('/api/support', a.id, 'POST', value));
    expect(replay.status).toBe(200);
    expect((await replay.json()).thread).toEqual(original);
    await error(
      await create(
        request('/api/support', a.id, 'POST', { ...value, message: 'Changed content.' }),
      ),
      409,
      'idempotency_conflict',
    );
    const other = await opened(b.id, value);
    expect(other.id).not.toBe(original.id);
    const message = { clientRequestId: randomUUID(), message: 'An idempotent synthetic reply.' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await reply(
        request(`/api/support/${original.id}/messages`, a.id, 'POST', message),
        context(original.id),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).thread.messages).toHaveLength(2);
    }
    await error(
      await reply(
        request(`/api/support/${original.id}/messages`, a.id, 'POST', {
          ...message,
          message: 'Changed reply.',
        }),
        context(original.id),
      ),
      409,
      'idempotency_conflict',
    );
    expect(
      (await remove(request(`/api/support/${original.id}`, a.id, 'DELETE'), context(original.id)))
        .status,
    ).toBe(200);
    await error(await create(request('/api/support', a.id, 'POST', value)), 410, 'request_deleted');
    expect(
      (await detail(request(`/api/support/${other.id}`, b.id), context(other.id))).status,
    ).toBe(200);
  });

  it('accepts no unmonitored creates, replies or reopen while retaining privacy and resolution controls', async () => {
    const actor = await session();
    const thread = await opened(actor.id);
    vi.stubEnv('SUPPORT_ADMIN_SUBJECT_HASHES', '');
    expect((await (await list(request('/api/support', actor.id))).json()).acceptingRequests).toBe(
      false,
    );
    await error(
      await create(request('/api/support', actor.id, 'POST', input())),
      503,
      'support_unavailable',
    );
    await error(
      await reply(
        request(`/api/support/${thread.id}/messages`, actor.id, 'POST', {
          clientRequestId: randomUUID(),
          message: 'Not accepted.',
        }),
        context(thread.id),
      ),
      503,
      'support_unavailable',
    );
    expect(
      (
        await status(
          request(`/api/support/${thread.id}`, actor.id, 'PATCH', { status: 'resolved' }),
          context(thread.id),
        )
      ).status,
    ).toBe(200);
    await error(
      await status(
        request(`/api/support/${thread.id}`, actor.id, 'PATCH', { status: 'open' }),
        context(thread.id),
      ),
      503,
      'support_unavailable',
    );
    const retained = await (
      await detail(request(`/api/support/${thread.id}`, actor.id), context(thread.id))
    ).json();
    expect(retained.thread.messages).toHaveLength(1);
    expect(retained.thread.status).toBe('resolved');
    expect(
      (await remove(request(`/api/support/${thread.id}`, actor.id, 'DELETE'), context(thread.id)))
        .status,
    ).toBe(200);
  });

  it('enforces per-owner create limits without charging rejected input or leaking private text', async () => {
    const a = await session();
    const b = await session();
    await error(
      await create(
        request('/api/support', a.id, 'POST', { ...input(), message: 'x'.repeat(4001) }),
      ),
      400,
      'invalid_input',
    );
    for (let index = 0; index < 3; index++) await opened(a.id);
    const response = await create(request('/api/support', a.id, 'POST', input()));
    await error(response, 429, 'support_rate_limited');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(response.headers.get('retry-after'))).toBeLessThanOrEqual(3600);
    await opened(b.id);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('Synthetic private');
  });

  it('returns a safe support reference without including raw database failures in responses or logs', async () => {
    const actor = await session();
    const secret = 'synthetic-password=not-a-real-secret; private-message-sentinel';
    vi.spyOn(getSupportStore(), 'listThreads').mockRejectedValueOnce(new Error(secret));
    const response = await list(request('/api/support', actor.id));
    await error(response, 503, 'service_unavailable');
    const logged = vi.mocked(console.warn).mock.calls;
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(secret);
    expect(Object.keys(JSON.parse(String(logged[0][0]))).sort()).toEqual([
      'code',
      'event',
      'requestId',
      'status',
    ]);
  });

  it('keeps delete-all final when a previously authorized create body finishes later', async () => {
    const actor = await session();
    const store = getSupportStore();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    let ready!: () => void;
    const captured = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const originalGeneration = store.dataGeneration.bind(store);
    vi.spyOn(store, 'dataGeneration').mockImplementationOnce(async (subject) => {
      const value = await originalGeneration(subject);
      ready();
      return value;
    });
    const pending = create(
      new NextRequest(`${origin}/api/support`, {
        method: 'POST',
        body,
        headers: {
          origin,
          cookie: `balance_session=${actor.id}`,
          'content-type': 'application/json',
        },
      }),
    );
    await captured;
    expect((await removeAll(request('/api/support', actor.id, 'DELETE'))).status).toBe(200);
    controller.enqueue(new TextEncoder().encode(JSON.stringify(input())));
    controller.close();
    await error(await pending, 409, 'support_changed');
    expect((await (await list(request('/api/support', actor.id))).json()).threads).toEqual([]);
  });
});
