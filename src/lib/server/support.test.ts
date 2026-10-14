import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { supportLimits, type CreateSupportInput } from '@/lib/support';
import { supportOperatorHashes, supportOwnerHash, type SupportActor } from './support-auth';
import { MemorySupportStore } from './support-store';
import {
  encodeSupportCursor,
  parseSupportCursor,
  readSupportJson,
  validateCreateSupport,
  validateSupportReply,
  validateSupportStatus,
} from './support-validation';

const hour = 3600_000;
const customer = (): SupportActor => ({ subject: randomUUID(), operator: false });
const create = (overrides: Partial<CreateSupportInput> = {}): CreateSupportInput => ({
  clientRequestId: randomUUID(),
  topic: 'connection',
  title: 'Help connecting a brokerage',
  message: 'The connection ends before my accounts appear.',
  requestReference: null,
  ...overrides,
});
function fixture() {
  let now = Date.now();
  const store = new MemorySupportStore(randomBytes(32), () => now);
  const actor = customer();
  return {
    store,
    actor,
    advance: (ms: number) => {
      now += ms;
    },
    save: (input = create(), owner = actor) => store.createThread(owner, input, 0),
  };
}

describe('private support domain', () => {
  it('returns only customer content and public metadata, with matching role for operators owning a case', async () => {
    const { store, actor, save } = fixture();
    const operator = { ...actor, operator: true };
    const { thread } = await save(create(), operator);
    const result = await store.reply(operator, thread.id, {
      clientRequestId: randomUUID(),
      message: 'Additional detail.',
    });
    expect(result.messages.map((message) => message.author)).toEqual(['customer', 'customer']);
    expect(result.canDelete).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /ownerHash|actorHash|requestKeyHash|createDigest|createKeyHash/,
    );
    const list = await store.listThreads(actor, 'mine');
    expect(list.threads[0]).toMatchObject({
      id: thread.id,
      messageCount: 2,
      lastMessageRole: 'customer',
    });
    expect(list.threads[0]).not.toHaveProperty('messages');
  });

  it('allows operator replies while reserving deletion for the owner', async () => {
    const { store, actor, save } = fixture();
    const { thread } = await save();
    const operator = { ...customer(), operator: true };
    const reply = await store.reply(operator, thread.id, {
      clientRequestId: randomUUID(),
      message: 'Please reconnect and share the safe request reference.',
    });
    expect(reply.messages.at(-1)?.author).toBe('operator');
    expect(reply.canDelete).toBe(false);
    await expect(store.deleteThread(operator, thread.id)).rejects.toMatchObject({
      code: 'support_not_found',
      status: 404,
    });
    expect((await store.readThread(actor, thread.id)).messageCount).toBe(2);
  });

  it('charges successful new mutations once and replays normalized create/reply safely', async () => {
    const { store, save, actor } = fixture();
    const input = create();
    const results = await Promise.all(Array.from({ length: 12 }, () => save(input)));
    expect(new Set(results.map((result) => result.thread.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    const id = results[0].thread.id;
    const reply = { clientRequestId: randomUUID(), message: 'More context.' };
    const replies = await Promise.all(
      Array.from({ length: 12 }, () => store.reply(actor, id, reply)),
    );
    expect(replies.every((result) => result.messageCount === 2)).toBe(true);
    expect((await save({ ...input, title: ` ${input.title} ` })).replayed).toBe(true);
    await expect(save({ ...input, message: 'Different message.' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
      status: 409,
    });
    await expect(
      store.reply(actor, id, { ...reply, message: 'Changed reply.' }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await save();
    await save();
    await expect(save()).rejects.toMatchObject({
      code: 'support_rate_limited',
      status: 429,
      retryAfter: '3600',
    });
    expect((await save(input)).replayed).toBe(true);
  });

  it('atomically enforces create and write quotas, with retries and same status outside quota', async () => {
    const { store, actor, save, advance } = fixture();
    const starts = await Promise.allSettled(Array.from({ length: 10 }, () => save()));
    expect(starts.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    const id = (await store.listThreads(actor, 'mine')).threads[0].id;
    const writes = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        store.reply(actor, id, { clientRequestId: randomUUID(), message: 'New detail.' }),
      ),
    );
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(
      supportLimits.customerWritesPerHour - 3,
    );
    expect((await store.setStatus(actor, id, 'open')).status).toBe('open');
    await expect(store.setStatus(actor, id, 'resolved')).rejects.toMatchObject({ status: 429 });
    advance(hour);
    expect((await store.setStatus(actor, id, 'resolved')).status).toBe('resolved');
    expect(
      (
        await store.reply(actor, id, {
          clientRequestId: randomUUID(),
          message: 'I still need help.',
        })
      ).status,
    ).toBe('open');
  });

  it('caps transcripts and retained customer requests without preventing deletions', async () => {
    const { store, actor, save, advance } = fixture();
    const { thread } = await save();
    const operator = { ...customer(), operator: true };
    for (let index = 1; index < supportLimits.maxMessages; index++)
      await store.reply(operator, thread.id, {
        clientRequestId: randomUUID(),
        message: `Reply ${index}.`,
      });
    await expect(
      store.reply(operator, thread.id, { clientRequestId: randomUUID(), message: 'Overflow.' }),
    ).rejects.toMatchObject({ code: 'support_message_limit', status: 409 });
    for (let index = 1; index < supportLimits.maxThreads; index++) {
      advance(hour);
      await save();
    }
    advance(hour);
    await expect(save()).rejects.toMatchObject({ code: 'support_limit', status: 409 });
    await store.deleteThread(actor, thread.id);
    expect((await save()).thread.id).not.toBe(thread.id);
  });

  it('keeps deletion final against uncertain create retries and pending stale creation', async () => {
    const { store, actor, save } = fixture();
    const input = create();
    const { thread } = await save(input);
    await store.deleteThread(actor, thread.id);
    await expect(save(input)).rejects.toMatchObject({ code: 'request_deleted', status: 410 });
    const generation = await store.dataGeneration(actor.subject);
    await store.deleteAll(actor);
    await expect(store.createThread(actor, create(), generation)).rejects.toMatchObject({
      code: 'support_changed',
      status: 409,
    });
    expect((await store.listThreads(actor, 'mine')).threads).toEqual([]);
    await store.createThread(actor, create(), await store.dataGeneration(actor.subject));
    expect((await store.listThreads(actor, 'mine')).threads).toHaveLength(1);
  });

  it('does not resurrect a deleted request when replies and status updates race', async () => {
    const { store, actor, save } = fixture();
    const { thread } = await save();
    const operator = { ...customer(), operator: true };
    await Promise.allSettled([
      store.reply(operator, thread.id, {
        clientRequestId: randomUUID(),
        message: 'Concurrent reply.',
      }),
      store.deleteAll(actor),
      store.setStatus(operator, thread.id, 'resolved'),
    ]);
    await expect(store.readThread(operator, thread.id)).rejects.toMatchObject({ status: 404 });
  });

  it('expires content after inactivity and separates support deletion from other owners', async () => {
    const { store, actor, save, advance } = fixture();
    const { thread } = await save();
    const another = customer();
    const other = await save(create(), another);
    await store.deleteAll(actor);
    expect((await store.readThread(another, other.thread.id)).messageCount).toBe(1);
    advance(supportLimits.retentionDays * 24 * hour);
    expect((await store.listThreads(another, 'mine')).threads).toEqual([]);
    await expect(store.readThread(another, other.thread.id)).rejects.toMatchObject({ status: 404 });
    await expect(store.readThread(actor, thread.id)).rejects.toMatchObject({ status: 404 });
  });

  it('paginates the operator inbox without leaking other customers to mine scope', async () => {
    const { store, actor, save } = fixture();
    for (let index = 0; index < 31; index++) await save(create(), customer());
    expect((await store.listThreads(actor, 'mine')).threads).toEqual([]);
    await expect(store.listThreads(actor, 'all')).rejects.toMatchObject({ status: 403 });
    const operator = { ...actor, operator: true };
    const first = await store.listThreads(operator, 'all');
    const second = await store.listThreads(operator, 'all', parseSupportCursor(first.nextCursor));
    expect(first.threads).toHaveLength(25);
    expect(second.threads).toHaveLength(6);
    expect(new Set([...first.threads, ...second.threads].map(({ id }) => id)).size).toBe(31);
    expect(second.nextCursor).toBeNull();
  });
});

describe('support inputs and operator configuration', () => {
  it('requires explicit complete operator hashes and shares the workspace namespace', () => {
    const hash = supportOwnerHash('verified-subject');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      supportOperatorHashes({ SUPPORT_ADMIN_SUBJECT_HASHES: hash.toUpperCase() }).has(hash),
    ).toBe(true);
    for (const value of [
      '',
      'verified-subject',
      `${hash},`,
      `${hash},invalid`,
      Array(21).fill(hash).join(','),
    ])
      expect(supportOperatorHashes({ SUPPORT_ADMIN_SUBJECT_HASHES: value }).size).toBe(0);
  });

  it('bounds and normalizes text, topics, UUID references and rejects role or owner spoofing', () => {
    expect(
      validateCreateSupport({ ...create(), title: '  Help  ', message: '  line 1\nline 2  ' }),
    ).toMatchObject({ title: 'Help', message: 'line 1\nline 2' });
    const id = randomUUID();
    expect(
      validateCreateSupport(create({ requestReference: id.toUpperCase() })).requestReference,
    ).toBe(id);
    for (const bad of [
      null,
      [],
      { ...create(), owner: 'other' },
      { ...create(), operator: true },
      { ...create(), topic: 'billing' },
      { ...create(), clientRequestId: 'bad' },
      create({ title: 'x'.repeat(101) }),
      create({ message: 'x'.repeat(4001) }),
      create({ message: 'bad\u0000message' }),
      create({ title: 'line\nbreak' }),
      create({ requestReference: 'raw-token' }),
    ])
      expect(() => validateCreateSupport(bad)).toThrow();
    expect(() =>
      validateSupportReply({ clientRequestId: id, message: 'hello', author: 'operator' }),
    ).toThrow();
    expect(() => validateSupportStatus({ status: 'closed' })).toThrow();
    expect(() => validateSupportStatus({ status: 'open', role: 'operator' })).toThrow();
  });

  it('validates pagination tokens rather than accepting SQL or malformed dates', () => {
    const cursor = { updatedAt: new Date().toISOString(), id: randomUUID() };
    expect(parseSupportCursor(encodeSupportCursor(cursor))).toEqual(cursor);
    expect(parseSupportCursor(null)).toBeNull();
    for (const bad of [
      '',
      'x'.repeat(161),
      "' OR 1=1",
      Buffer.from('{"id":"bad","updatedAt":"today"}').toString('base64url'),
      encodeSupportCursor({ ...cursor, updatedAt: '2026-01-01' }),
    ])
      expect(() => parseSupportCursor(bad)).toThrow();
  });

  it('enforces streamed byte limits, content type and safe JSON errors', async () => {
    const request = (body: string, contentType = 'application/json') =>
      new NextRequest('http://localhost/api/support', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      });
    expect(await readSupportJson(request('{"message":"hello"}'))).toEqual({ message: 'hello' });
    await expect(readSupportJson(request('bad JSON'))).rejects.toMatchObject({
      code: 'invalid_input',
      status: 400,
    });
    await expect(readSupportJson(request('{}', 'text/plain'))).rejects.toMatchObject({
      status: 415,
    });
    await expect(readSupportJson(request('x'.repeat(24001)))).rejects.toMatchObject({
      status: 413,
    });
  });
});
