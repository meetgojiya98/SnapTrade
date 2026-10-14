import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateSupportInput } from '@/lib/support';
import { supportOwnerHash, type SupportActor } from './support-auth';
import { PostgresSupportStore } from './support-store';
import { parseSupportCursor } from './support-validation';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('private support (Postgres integration)', () => {
  const key = randomBytes(32);
  const schema = `support_test_${randomUUID().replaceAll('-', '')}`;
  const actors: SupportActor[] = [];
  let firstSql: ReturnType<typeof postgres>;
  let secondSql: ReturnType<typeof postgres>;
  let first: PostgresSupportStore;
  let second: PostgresSupportStore;
  const actor = (operator = false) => {
    const value = { subject: randomUUID(), operator };
    actors.push(value);
    return value;
  };
  const input = (): CreateSupportInput => ({
    clientRequestId: randomUUID(),
    topic: 'portfolio',
    title: 'Private support title for missing holding',
    message: 'My private holding is missing from the snapshot.',
    requestReference: randomUUID(),
  });
  const save = (owner: SupportActor, content = input()) => first.createThread(owner, content, 0);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/balance_test')
    )
      throw new Error(
        'Integration tests require a loopback Postgres database named balance_test*.',
      );
    firstSql = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    secondSql = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    await firstSql.unsafe(`CREATE SCHEMA ${schema}`);
    await firstSql.unsafe(
      await readFile(new URL('../../../migrations/004_support.sql', import.meta.url), 'utf8'),
    );
    first = new PostgresSupportStore(firstSql, key);
    second = new PostgresSupportStore(secondSql, key);
  });
  afterAll(async () => {
    if (!firstSql) return;
    await firstSql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await Promise.all([firstSql.end(), secondSql.end()]);
  });

  it('restores encrypted content across connections and returns transcript-free summaries', async () => {
    const owner = actor();
    const { thread } = await save(owner);
    expect(await second.readThread(owner, thread.id)).toEqual(thread);
    const [row] =
      await firstSql`SELECT owner_hash, payload, summary_payload FROM balance_support_threads WHERE id = ${thread.id}`;
    expect(row.owner_hash).toBe(supportOwnerHash(owner.subject));
    expect(row.owner_hash).not.toBe(owner.subject);
    for (const ciphertext of [row.payload, row.summary_payload]) {
      expect(ciphertext).toMatch(/^v1\./);
      expect(ciphertext).not.toContain('"title":"Private support title for missing holding"');
      expect(ciphertext).not.toContain('"body":"My private holding is missing from the snapshot."');
      expect(ciphertext).not.toContain(
        `"requestReference":${JSON.stringify(thread.requestReference)}`,
      );
    }
    const list = await second.listThreads(owner, 'mine');
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0]).toMatchObject({ id: thread.id, title: thread.title, messageCount: 1 });
    expect(list.threads[0]).not.toHaveProperty('messages');
  });

  it('does not decrypt corrupted foreign content for an unauthorized customer', async () => {
    const owner = actor();
    const other = actor();
    const { thread } = await save(owner);
    await firstSql`UPDATE balance_support_threads SET payload = 'unreadable-encrypted-record' WHERE id = ${thread.id}`;
    await expect(second.readThread(other, thread.id)).rejects.toMatchObject({
      code: 'support_not_found',
      status: 404,
    });
    await expect(
      second.reply(other, thread.id, { clientRequestId: randomUUID(), message: 'Spoofed reply.' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(second.deleteThread(other, thread.id)).rejects.toMatchObject({ status: 404 });
    await expect(second.readThread(owner, thread.id)).rejects.toThrow();
  });

  it('binds authenticated ciphertext to both the owner and request ID', async () => {
    const owner = actor();
    const other = actor();
    const one = await save(owner);
    const two = await save(other);
    await firstSql`UPDATE balance_support_threads SET payload = (SELECT payload FROM balance_support_threads WHERE id = ${one.thread.id}) WHERE id = ${two.thread.id}`;
    await expect(second.readThread(other, two.thread.id)).rejects.toThrow();
    const another = await save(owner);
    await firstSql`UPDATE balance_support_threads SET summary_payload = (SELECT summary_payload FROM balance_support_threads WHERE id = ${one.thread.id}) WHERE id = ${another.thread.id}`;
    await expect(second.listThreads(owner, 'mine')).rejects.toThrow();
    await first.deleteAll(owner);
    await first.deleteAll(other);
  });

  it('coalesces concurrent create and reply retries across connections without charging them twice', async () => {
    const owner = actor();
    const content = input();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).createThread(owner, content, 0),
      ),
    );
    expect(new Set(results.map((result) => result.thread.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    const thread = results[0].thread;
    const reply = { clientRequestId: randomUUID(), message: 'Additional private context.' };
    const replies = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).reply(owner, thread.id, reply),
      ),
    );
    expect(replies.every((result) => result.messageCount === 2)).toBe(true);
    const [rate] =
      await firstSql`SELECT create_count, write_count FROM balance_support_actors WHERE actor_hash = ${supportOwnerHash(owner.subject)}`;
    expect(rate).toMatchObject({ create_count: 1, write_count: 2 });
    await expect(
      second.createThread(owner, { ...content, message: 'Different content.' }, 0),
    ).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('enforces per-subject creation quotas atomically across separate instances', async () => {
    const owner = actor();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 ? first : second).createThread(owner, input(), 0),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'support_rate_limited', status: 429 });
    expect((await second.listThreads(owner, 'mine')).threads).toHaveLength(3);
  });

  it('serializes replies on one conversation across different authenticated actors', async () => {
    const owner = actor();
    const operator = actor(true);
    const { thread } = await save(owner);
    await Promise.all([
      first.reply(owner, thread.id, {
        clientRequestId: randomUUID(),
        message: 'Customer follow-up.',
      }),
      second.reply(operator, thread.id, {
        clientRequestId: randomUUID(),
        message: 'Operator response.',
      }),
    ]);
    const result = await first.readThread(owner, thread.id);
    expect(result.messageCount).toBe(3);
    expect(result.messages.map((message) => message.body)).toEqual(
      expect.arrayContaining(['Customer follow-up.', 'Operator response.']),
    );
    expect(result.messages.filter((message) => message.author === 'operator')).toHaveLength(1);
  });

  it('keeps deletion final against replies/status changes and preserves unrelated customers', async () => {
    const owner = actor();
    const operator = actor(true);
    const other = actor();
    const { thread } = await save(owner);
    const retained = await save(other);
    await Promise.allSettled([
      first.reply(operator, thread.id, {
        clientRequestId: randomUUID(),
        message: 'A response in flight.',
      }),
      second.deleteAll(owner),
      first.setStatus(operator, thread.id, 'resolved'),
    ]);
    await expect(first.readThread(owner, thread.id)).rejects.toMatchObject({ status: 404 });
    await expect(second.readThread(operator, thread.id)).rejects.toMatchObject({ status: 404 });
    expect((await first.readThread(other, retained.thread.id)).messageCount).toBe(1);
    const rows =
      await firstSql`SELECT id FROM balance_support_threads WHERE owner_hash = ${supportOwnerHash(owner.subject)}`;
    expect(rows).toHaveLength(0);
  });

  it('rejects pending creates after deletion and prevents replay from restoring deleted cases', async () => {
    const owner = actor();
    const content = input();
    const { thread } = await save(owner, content);
    await second.deleteThread(owner, thread.id);
    await expect(first.createThread(owner, content, 0)).rejects.toMatchObject({
      code: 'request_deleted',
      status: 410,
    });
    const generation = await first.dataGeneration(owner.subject);
    await second.deleteAll(owner);
    await expect(first.createThread(owner, input(), generation)).rejects.toMatchObject({
      code: 'support_changed',
      status: 409,
    });
    await second.createThread(owner, input(), await first.dataGeneration(owner.subject));
    expect((await first.listThreads(owner, 'mine')).threads).toHaveLength(1);
  });

  it('physically removes expired encrypted content and expired deletion tombstones', async () => {
    const owner = actor();
    const content = input();
    const { thread } = await save(owner, content);
    const expired = new Date(Date.now() - 1000);
    await firstSql`UPDATE balance_support_threads SET expires_at = ${expired} WHERE id = ${thread.id}`;
    await second.pruneExpired();
    expect(
      await firstSql`SELECT id FROM balance_support_threads WHERE id = ${thread.id}`,
    ).toHaveLength(0);
    const active = await save(owner);
    await second.deleteThread(owner, active.thread.id);
    await firstSql`UPDATE balance_support_deleted_requests SET expires_at = ${expired} WHERE owner_hash = ${supportOwnerHash(owner.subject)}`;
    await first.pruneExpired();
    expect(
      await firstSql`SELECT owner_hash FROM balance_support_deleted_requests WHERE owner_hash = ${supportOwnerHash(owner.subject)}`,
    ).toHaveLength(0);
    // The generation marker remains even when content is gone, to reject previously authorized writes.
    expect(
      await firstSql`SELECT actor_hash FROM balance_support_actors WHERE actor_hash = ${supportOwnerHash(owner.subject)}`,
    ).toHaveLength(1);
  });

  it('paginates an operator inbox by a stable timestamp and UUID boundary', async () => {
    const owners = Array.from({ length: 28 }, () => actor());
    const now = Date.now();
    const frozen = new PostgresSupportStore(firstSql, key, () => now);
    for (const owner of owners) await frozen.createThread(owner, input(), 0);
    const operator = actor(true);
    const ownedIds = new Set(
      (await Promise.all(owners.map((owner) => second.listThreads(owner, 'mine')))).flatMap(
        (page) => page.threads.map(({ id }) => id),
      ),
    );
    const seen = new Set<string>();
    let cursor = null;
    do {
      const page = await second.listThreads(operator, 'all', parseSupportCursor(cursor));
      for (const thread of page.threads) {
        expect(seen.has(thread.id)).toBe(false);
        seen.add(thread.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect([...ownedIds].every((id) => seen.has(id))).toBe(true);
    expect((await first.listThreads(operator, 'mine')).threads).toEqual([]);
  });
});
