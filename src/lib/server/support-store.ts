import 'server-only';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import {
  supportLimits,
  type CreateSupportInput,
  type ReplySupportInput,
  type SupportMessage,
  type SupportStatus,
  type SupportThread,
  type SupportThreadSummary,
} from '@/lib/support';
import { getServerConfig } from './config';
import { decryptJson, encryptJson, hashSecret } from './crypto';
import { ServiceError } from './errors';
import { supportOwnerHash, type SupportActor } from './support-auth';
import {
  encodeSupportCursor,
  validateCreateSupport,
  validateSupportReply,
  type SupportCursor,
} from './support-validation';

const hour = 3600_000;
const retention = supportLimits.retentionDays * 24 * hour;
const missing = () =>
  new ServiceError('support_not_found', 404, 'This support request could not be found.');
const changed = () =>
  new ServiceError(
    'support_changed',
    409,
    'Your support data was deleted while this request was in progress. Reload the inbox before saving again.',
  );
const conflict = () =>
  new ServiceError(
    'idempotency_conflict',
    409,
    'This request identifier was already used for different content. Edit the message before sending a new request.',
  );
const fullContext = (owner: string, id: string) => `support-thread:${owner}:${id}`;
const summaryContext = (owner: string, id: string) => `support-summary:${owner}:${id}`;
type StoredMessage = SupportMessage & { actorHash: string; requestKeyHash: string };
type StoredThread = Omit<
  SupportThread,
  'messages' | 'canDelete' | 'messageCount' | 'lastMessageRole'
> & {
  ownerHash: string;
  createKeyHash: string;
  createDigest: string;
  messages: StoredMessage[];
};
type StoredSummary = Omit<SupportThreadSummary, 'canDelete'>;
type Listed = { ownerHash: string; summary: StoredSummary };
type RateState = {
  generation: number;
  windowStart: number;
  createCount: number;
  writeCount: number;
};
interface Transaction {
  state: RateState;
  getThread(id: string): Promise<StoredThread | null>;
  getCreated(key: string): Promise<StoredThread | null>;
  wasDeleted(key: string): Promise<boolean>;
  countOwned(): Promise<number>;
  put(thread: StoredThread, create: boolean): Promise<void>;
  remove(thread: StoredThread): Promise<void>;
  removeOwned(): Promise<void>;
}
interface Adapter {
  generation(owner: string): Promise<number>;
  list(owner: string, all: boolean, cursor: SupportCursor | null, now: number): Promise<Listed[]>;
  read(id: string, now: number, owner: string, operator?: boolean): Promise<StoredThread | null>;
  prune(now: number): Promise<void>;
  transaction<T>(
    owner: string,
    locks: { thread?: string; allOwned?: boolean; operator?: boolean },
    now: number,
    action: (tx: Transaction) => Promise<T>,
  ): Promise<T>;
}
function summary(thread: StoredThread): StoredSummary {
  return {
    id: thread.id,
    topic: thread.topic,
    title: thread.title,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    expiresAt: thread.expiresAt,
    messageCount: thread.messages.length,
    lastMessageRole: thread.messages.at(-1)!.author,
    requestReference: thread.requestReference,
  };
}
function publicThread(thread: StoredThread, actor: SupportActor): SupportThread {
  return {
    ...summary(thread),
    canDelete: thread.ownerHash === supportOwnerHash(actor.subject),
    messages: thread.messages.map(({ id, author, body, createdAt }) => ({
      id,
      author,
      body,
      createdAt,
    })),
  };
}
function requireAccess(
  thread: StoredThread | null,
  actor: SupportActor,
): asserts thread is StoredThread {
  if (!thread || (thread.ownerHash !== supportOwnerHash(actor.subject) && !actor.operator))
    throw missing();
}
function charge(state: RateState, actor: SupportActor, creation: boolean, now: number) {
  if (now - state.windowStart >= hour) {
    state.windowStart = now;
    state.createCount = 0;
    state.writeCount = 0;
  }
  const maximum = actor.operator
    ? supportLimits.operatorWritesPerHour
    : supportLimits.customerWritesPerHour;
  if (
    (creation && state.createCount >= supportLimits.createRequestsPerHour) ||
    state.writeCount >= maximum
  )
    throw new ServiceError(
      'support_rate_limited',
      429,
      'Please wait before sending more support messages.',
      String(Math.max(1, Math.ceil((state.windowStart + hour - now) / 1000))),
    );
  if (creation) state.createCount++;
  state.writeCount++;
}
function digest(input: CreateSupportInput): string {
  return hashSecret(
    JSON.stringify({
      topic: input.topic,
      title: input.title,
      message: input.message,
      requestReference: input.requestReference,
    }),
  );
}

export class SupportStore {
  constructor(
    private adapter: Adapter,
    private now = Date.now,
  ) {}
  dataGeneration(subject: string) {
    return this.adapter.generation(supportOwnerHash(subject));
  }
  pruneExpired() {
    return this.adapter.prune(this.now());
  }
  async listThreads(
    actor: SupportActor,
    scope: 'mine' | 'all',
    cursor: SupportCursor | null = null,
  ) {
    if (scope === 'all' && !actor.operator)
      throw new ServiceError('operator_required', 403, 'Operator access is required.');
    await this.pruneExpired();
    const owner = supportOwnerHash(actor.subject);
    const rows = await this.adapter.list(owner, scope === 'all', cursor, this.now());
    const visible = rows.slice(0, supportLimits.pageSize);
    const last = visible.at(-1);
    return {
      threads: visible.map(({ summary, ownerHash }) => ({
        ...summary,
        canDelete: ownerHash === owner,
      })),
      nextCursor:
        rows.length > supportLimits.pageSize && last
          ? encodeSupportCursor({ updatedAt: last.summary.updatedAt, id: last.summary.id })
          : null,
    };
  }
  async readThread(actor: SupportActor, id: string): Promise<SupportThread> {
    await this.pruneExpired();
    const record = await this.adapter.read(
      id,
      this.now(),
      supportOwnerHash(actor.subject),
      actor.operator,
    );
    requireAccess(record, actor);
    return publicThread(record, actor);
  }
  async createThread(actor: SupportActor, raw: CreateSupportInput, generation: number) {
    const input = validateCreateSupport(raw);
    await this.pruneExpired();
    const owner = supportOwnerHash(actor.subject);
    const key = hashSecret(input.clientRequestId);
    const now = this.now();
    return this.adapter.transaction(owner, {}, now, async (tx) => {
      if (tx.state.generation !== generation) throw changed();
      const existing = await tx.getCreated(key);
      if (existing) {
        if (existing.createDigest !== digest(input)) throw conflict();
        return { thread: publicThread(existing, actor), replayed: true };
      }
      if (await tx.wasDeleted(key))
        throw new ServiceError(
          'request_deleted',
          410,
          'This support request was deleted. Start a new request if you need help again.',
        );
      if ((await tx.countOwned()) >= supportLimits.maxThreads)
        throw new ServiceError(
          'support_limit',
          409,
          'You have 20 support requests. Delete an older request before starting another.',
        );
      charge(tx.state, actor, true, now);
      const createdAt = new Date(now).toISOString();
      const record: StoredThread = {
        id: randomUUID(),
        ownerHash: owner,
        createKeyHash: key,
        createDigest: digest(input),
        topic: input.topic,
        title: input.title,
        status: 'open',
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(now + retention).toISOString(),
        requestReference: input.requestReference,
        messages: [
          {
            id: randomUUID(),
            author: 'customer',
            body: input.message,
            createdAt,
            actorHash: owner,
            requestKeyHash: hashSecret(`${owner}:${input.clientRequestId}`),
          },
        ],
      };
      await tx.put(record, true);
      return { thread: publicThread(record, actor), replayed: false };
    });
  }
  async reply(actor: SupportActor, id: string, raw: ReplySupportInput): Promise<SupportThread> {
    const input = validateSupportReply(raw);
    await this.pruneExpired();
    const owner = supportOwnerHash(actor.subject);
    const now = this.now();
    return this.adapter.transaction(
      owner,
      { thread: id, operator: actor.operator },
      now,
      async (tx) => {
        const record = await tx.getThread(id);
        requireAccess(record, actor);
        const requestKeyHash = hashSecret(`${owner}:${input.clientRequestId}`);
        const previous = record.messages.find(
          (message) => message.requestKeyHash === requestKeyHash,
        );
        if (previous) {
          if (previous.body !== input.message) throw conflict();
          return publicThread(record, actor);
        }
        if (record.messages.length >= supportLimits.maxMessages)
          throw new ServiceError(
            'support_message_limit',
            409,
            'This conversation has 50 messages. Start a new request to continue.',
          );
        charge(tx.state, actor, false, now);
        record.updatedAt = new Date(now).toISOString();
        record.expiresAt = new Date(now + retention).toISOString();
        record.status = 'open';
        record.messages.push({
          id: randomUUID(),
          author: record.ownerHash === owner ? 'customer' : 'operator',
          body: input.message,
          createdAt: record.updatedAt,
          actorHash: owner,
          requestKeyHash,
        });
        await tx.put(record, false);
        return publicThread(record, actor);
      },
    );
  }
  async setStatus(actor: SupportActor, id: string, status: SupportStatus): Promise<SupportThread> {
    if (status !== 'open' && status !== 'resolved')
      throw new ServiceError('invalid_input', 400, 'Choose open or resolved.');
    await this.pruneExpired();
    const owner = supportOwnerHash(actor.subject);
    const now = this.now();
    return this.adapter.transaction(
      owner,
      { thread: id, operator: actor.operator },
      now,
      async (tx) => {
        const record = await tx.getThread(id);
        requireAccess(record, actor);
        if (record.status === status) return publicThread(record, actor);
        charge(tx.state, actor, false, now);
        record.status = status;
        record.updatedAt = new Date(now).toISOString();
        record.expiresAt = new Date(now + retention).toISOString();
        await tx.put(record, false);
        return publicThread(record, actor);
      },
    );
  }
  async deleteThread(actor: SupportActor, id: string): Promise<void> {
    const owner = supportOwnerHash(actor.subject);
    await this.adapter.transaction(owner, { thread: id }, this.now(), async (tx) => {
      const record = await tx.getThread(id);
      if (!record || record.ownerHash !== owner) throw missing();
      await tx.remove(record);
    });
  }
  async deleteAll(actor: SupportActor): Promise<void> {
    await this.adapter.transaction(
      supportOwnerHash(actor.subject),
      { allOwned: true },
      this.now(),
      async (tx) => {
        tx.state.generation++;
        await tx.removeOwned();
      },
    );
  }
}

type MemoryRow = {
  ownerHash: string;
  createKeyHash: string;
  payload: string;
  summary: string;
  updatedAt: string;
  expiresAt: number;
};
class MemoryAdapter implements Adapter {
  rows = new Map<string, MemoryRow>();
  actors = new Map<string, RateState>();
  deleted = new Map<string, number>();
  private locks = new Map<string, Promise<void>>();
  constructor(private key: Buffer) {}
  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.locks.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
  async generation(owner: string) {
    return this.actors.get(owner)?.generation ?? 0;
  }
  async prune(now: number) {
    let count = 0;
    for (const [id, row] of this.rows)
      if (row.expiresAt <= now && count++ < 100) {
        await this.locked(`thread:${id}`, async () => {
          if ((this.rows.get(id)?.expiresAt ?? Infinity) <= now) this.rows.delete(id);
        });
      }
    count = 0;
    for (const [key, expires] of this.deleted)
      if (expires <= now && count++ < 100) this.deleted.delete(key);
  }
  async list(
    owner: string,
    all: boolean,
    cursor: SupportCursor | null,
    now: number,
  ): Promise<Listed[]> {
    return [...this.rows.entries()]
      .filter(
        ([id, row]) =>
          row.expiresAt > now &&
          (all || row.ownerHash === owner) &&
          (!cursor ||
            row.updatedAt < cursor.updatedAt ||
            (row.updatedAt === cursor.updatedAt && id < cursor.id)),
      )
      .sort(
        ([a, first], [b, second]) =>
          second.updatedAt.localeCompare(first.updatedAt) || b.localeCompare(a),
      )
      .slice(0, supportLimits.pageSize + 1)
      .map(([id, row]) => ({
        ownerHash: row.ownerHash,
        summary: decryptJson<StoredSummary>(
          row.summary,
          this.key,
          summaryContext(row.ownerHash, id),
        ),
      }));
  }
  async read(id: string, now: number, owner: string, operator = false) {
    const row = this.rows.get(id);
    return row && row.expiresAt > now && (operator || row.ownerHash === owner)
      ? decryptJson<StoredThread>(row.payload, this.key, fullContext(row.ownerHash, id))
      : null;
  }
  async transaction<T>(
    owner: string,
    locks: { thread?: string; allOwned?: boolean; operator?: boolean },
    now: number,
    action: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.locked(`actor:${owner}`, async () => {
      const ids = locks.thread
        ? [locks.thread]
        : locks.allOwned
          ? [...this.rows]
              .filter(([, row]) => row.ownerHash === owner)
              .map(([id]) => id)
              .sort()
          : [];
      const run = async (): Promise<T> => {
        const state = structuredClone(
          this.actors.get(owner) ?? {
            generation: 0,
            windowStart: now,
            createCount: 0,
            writeCount: 0,
          },
        );
        const pending = new Map<string, MemoryRow | null>();
        const tombstones = new Map<string, number>();
        const remove = async (thread: StoredThread) => {
          pending.set(thread.id, null);
          tombstones.set(`${owner}:${thread.createKeyHash}`, now + retention);
        };
        const tx: Transaction = {
          state,
          getThread: (id) => this.read(id, now, owner, locks.operator),
          getCreated: async (key) => {
            const match = [...this.rows].find(
              ([, row]) =>
                row.ownerHash === owner && row.createKeyHash === key && row.expiresAt > now,
            );
            return match ? this.read(match[0], now, owner) : null;
          },
          wasDeleted: async (key) => (this.deleted.get(`${owner}:${key}`) ?? 0) > now,
          countOwned: async () =>
            [...this.rows.values()].filter((row) => row.ownerHash === owner && row.expiresAt > now)
              .length,
          put: async (thread, create) => {
            if (create && this.rows.has(thread.id))
              throw new Error('Support request already exists');
            pending.set(thread.id, {
              ownerHash: thread.ownerHash,
              createKeyHash: thread.createKeyHash,
              payload: encryptJson(thread, this.key, fullContext(thread.ownerHash, thread.id)),
              summary: encryptJson(
                summary(thread),
                this.key,
                summaryContext(thread.ownerHash, thread.id),
              ),
              updatedAt: thread.updatedAt,
              expiresAt: Date.parse(thread.expiresAt),
            });
          },
          remove,
          removeOwned: async () => {
            for (const [id, row] of this.rows)
              if (row.ownerHash === owner) {
                pending.set(id, null);
                tombstones.set(`${owner}:${row.createKeyHash}`, now + retention);
              }
          },
        };
        const result = await action(tx);
        for (const [id, row] of pending)
          if (row) this.rows.set(id, row);
          else this.rows.delete(id);
        for (const [key, expires] of tombstones) this.deleted.set(key, expires);
        this.actors.set(owner, state);
        return result;
      };
      const hold = (index: number): Promise<T> =>
        index < ids.length ? this.locked(`thread:${ids[index]}`, () => hold(index + 1)) : run();
      return hold(0);
    });
  }
}

type DbRow = { id: string; owner_hash: string; payload: string; summary_payload: string };
class PostgresAdapter implements Adapter {
  constructor(
    private sql: Sql,
    private key: Buffer,
  ) {}
  async generation(owner: string) {
    const rows = await this.sql<
      { generation: number }[]
    >`SELECT generation FROM balance_support_actors WHERE actor_hash = ${owner}`;
    return rows[0]?.generation ?? 0;
  }
  async prune(now: number) {
    await this
      .sql`DELETE FROM balance_support_threads WHERE expires_at <= ${new Date(now)} AND id IN
      (SELECT id FROM balance_support_threads WHERE expires_at <= ${new Date(now)} ORDER BY expires_at LIMIT 100)`;
    await this
      .sql`DELETE FROM balance_support_deleted_requests WHERE expires_at <= ${new Date(now)} AND (owner_hash, create_key_hash) IN
      (SELECT owner_hash, create_key_hash FROM balance_support_deleted_requests WHERE expires_at <= ${new Date(now)} ORDER BY expires_at LIMIT 100)`;
  }
  async list(
    owner: string,
    all: boolean,
    cursor: SupportCursor | null,
    now: number,
  ): Promise<Listed[]> {
    const boundary = cursor?.updatedAt ?? '9999-12-31T23:59:59.999Z';
    const id = cursor?.id ?? 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const rows = await this.sql<
      DbRow[]
    >`SELECT id, owner_hash, summary_payload FROM balance_support_threads
      WHERE (${all} OR owner_hash = ${owner}) AND expires_at > ${new Date(now)}
        AND (updated_at, id) < (${boundary}::timestamptz, ${id}::uuid)
      ORDER BY updated_at DESC, id DESC LIMIT ${supportLimits.pageSize + 1}`;
    return rows.map((row) => ({
      ownerHash: row.owner_hash,
      summary: decryptJson<StoredSummary>(
        row.summary_payload,
        this.key,
        summaryContext(row.owner_hash, row.id),
      ),
    }));
  }
  private decrypt(row?: DbRow) {
    return row
      ? decryptJson<StoredThread>(row.payload, this.key, fullContext(row.owner_hash, row.id))
      : null;
  }
  async read(id: string, now: number, owner: string, operator = false) {
    const rows = await this.sql<
      DbRow[]
    >`SELECT id, owner_hash, payload FROM balance_support_threads WHERE id = ${id} AND expires_at > ${new Date(now)} AND (${operator} OR owner_hash = ${owner})`;
    return this.decrypt(rows[0]);
  }
  async transaction<T>(
    owner: string,
    locks: { thread?: string; allOwned?: boolean; operator?: boolean },
    now: number,
    action: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const result = await this.sql.begin(async (sql) => {
      await sql.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `support-actor:${owner}`,
      ]);
      await sql.unsafe(
        `INSERT INTO balance_support_actors (actor_hash, window_start) VALUES ($1, $2) ON CONFLICT (actor_hash) DO NOTHING`,
        [owner, new Date(now)],
      );
      const states = await sql.unsafe<
        { generation: number; window_start: Date; create_count: number; write_count: number }[]
      >(
        'SELECT generation, window_start, create_count, write_count FROM balance_support_actors WHERE actor_hash = $1',
        [owner],
      );
      const state: RateState = {
        generation: states[0].generation,
        windowStart: states[0].window_start.getTime(),
        createCount: states[0].create_count,
        writeCount: states[0].write_count,
      };
      const remove = async (thread: StoredThread) => {
        await sql.unsafe(
          `INSERT INTO balance_support_deleted_requests (owner_hash, create_key_hash, expires_at) VALUES ($1, $2, $3)
          ON CONFLICT (owner_hash, create_key_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
          [owner, thread.createKeyHash, new Date(now + retention)],
        );
        await sql.unsafe('DELETE FROM balance_support_threads WHERE id = $1 AND owner_hash = $2', [
          thread.id,
          owner,
        ]);
      };
      const tx: Transaction = {
        state,
        getThread: async (id) =>
          this.decrypt(
            (
              await sql.unsafe<DbRow[]>(
                'SELECT id, owner_hash, payload FROM balance_support_threads WHERE id = $1 AND expires_at > $2 AND ($3 OR owner_hash = $4) FOR UPDATE',
                [id, new Date(now), locks.operator ?? false, owner],
              )
            )[0],
          ),
        getCreated: async (key) =>
          this.decrypt(
            (
              await sql.unsafe<DbRow[]>(
                'SELECT id, owner_hash, payload FROM balance_support_threads WHERE owner_hash = $1 AND create_key_hash = $2 AND expires_at > $3 FOR UPDATE',
                [owner, key, new Date(now)],
              )
            )[0],
          ),
        wasDeleted: async (key) =>
          (
            await sql.unsafe(
              'SELECT 1 FROM balance_support_deleted_requests WHERE owner_hash = $1 AND create_key_hash = $2 AND expires_at > $3',
              [owner, key, new Date(now)],
            )
          ).length > 0,
        countOwned: async () =>
          (
            await sql.unsafe<{ count: number }[]>(
              'SELECT count(*)::integer AS count FROM balance_support_threads WHERE owner_hash = $1 AND expires_at > $2',
              [owner, new Date(now)],
            )
          )[0].count,
        put: async (thread, create) => {
          const payload = encryptJson(thread, this.key, fullContext(thread.ownerHash, thread.id));
          const brief = encryptJson(
            summary(thread),
            this.key,
            summaryContext(thread.ownerHash, thread.id),
          );
          if (create)
            await sql.unsafe(
              `INSERT INTO balance_support_threads (id, owner_hash, create_key_hash, payload, summary_payload, status, created_at, updated_at, expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                thread.id,
                thread.ownerHash,
                thread.createKeyHash,
                payload,
                brief,
                thread.status,
                thread.createdAt,
                thread.updatedAt,
                thread.expiresAt,
              ],
            );
          else
            await sql.unsafe(
              `UPDATE balance_support_threads SET payload=$1, summary_payload=$2, status=$3, updated_at=$4, expires_at=$5 WHERE id=$6 AND owner_hash=$7`,
              [
                payload,
                brief,
                thread.status,
                thread.updatedAt,
                thread.expiresAt,
                thread.id,
                thread.ownerHash,
              ],
            );
        },
        remove,
        removeOwned: async () => {
          await sql.unsafe(
            `INSERT INTO balance_support_deleted_requests (owner_hash, create_key_hash, expires_at)
            SELECT owner_hash, create_key_hash, $2 FROM balance_support_threads WHERE owner_hash=$1
            ON CONFLICT (owner_hash, create_key_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at`,
            [owner, new Date(now + retention)],
          );
          await sql.unsafe('DELETE FROM balance_support_threads WHERE owner_hash=$1', [owner]);
        },
      };
      const value = await action(tx);
      await sql.unsafe(
        'UPDATE balance_support_actors SET generation=$1, window_start=$2, create_count=$3, write_count=$4 WHERE actor_hash=$5',
        [state.generation, new Date(state.windowStart), state.createCount, state.writeCount, owner],
      );
      return { value };
    });
    return result.value as T;
  }
}

export class MemorySupportStore extends SupportStore {
  constructor(key: Buffer, now = Date.now) {
    super(new MemoryAdapter(key), now);
  }
}
export class PostgresSupportStore extends SupportStore {
  constructor(sql: Sql, key: Buffer, now = Date.now) {
    super(new PostgresAdapter(sql, key), now);
  }
}
let cached: { fingerprint: string; store: SupportStore } | undefined;
export function getSupportStore(): SupportStore {
  const config = getServerConfig();
  const fingerprint = hashSecret(
    `${config.databaseUrl ?? 'memory'}:${config.encryptionKey.toString('base64')}`,
  );
  if (cached?.fingerprint === fingerprint) return cached.store;
  const store = config.memoryStore
    ? new MemorySupportStore(config.encryptionKey)
    : new PostgresSupportStore(
        postgres(config.databaseUrl!, {
          max: 4,
          prepare: false,
          idle_timeout: 20,
          connect_timeout: 10,
          onnotice: () => {},
        }),
        config.encryptionKey,
      );
  cached = { fingerprint, store };
  return store;
}
