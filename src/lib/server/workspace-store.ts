import 'server-only';
import postgres, { type Sql } from 'postgres';
import {
  defaultWorkspacePreferences,
  summarizePlan,
  type SavedPlan,
  type SavedPlanSummary,
  type Workspace,
  type WorkspacePreferences,
} from '@/lib/workspace';
import { getServerConfig } from './config';
import { decryptJson, encryptJson, hashSecret } from './crypto';
import { ServiceError } from './errors';

export const MAX_SAVED_PLANS = 30;
const ownerHash = (subject: string) => hashSecret(`balance:subject:${subject}`);
const workspaceContext = (owner: string) => `workspace:${owner}`;
const planContext = (owner: string, id: string) => `plan:${owner}:${id}`;
const emptyWorkspace = (): Workspace => ({
  version: 1,
  preferences: structuredClone(defaultWorkspacePreferences),
  updatedAt: null,
});
const planLimit = () =>
  new ServiceError(
    'plan_limit',
    409,
    'You have 30 saved plans. Delete an older plan before saving another.',
  );
const workspaceChanged = () =>
  new ServiceError(
    'workspace_changed',
    409,
    'Workspace data was deleted while this request was in progress. Refresh before saving again.',
  );

export interface WorkspaceStore {
  dataGeneration(subject: string): Promise<number>;
  readWorkspace(subject: string): Promise<Workspace>;
  writeWorkspace(
    subject: string,
    preferences: WorkspacePreferences,
    expectedGeneration?: number,
  ): Promise<Workspace>;
  deleteWorkspace(subject: string): Promise<void>;
  listPlans(subject: string): Promise<SavedPlanSummary[]>;
  readPlan(subject: string, id: string): Promise<SavedPlan | null>;
  createPlan(subject: string, plan: SavedPlan, expectedGeneration?: number): Promise<void>;
  deletePlan(subject: string, id: string): Promise<boolean>;
}

/** Selected only by the explicit, non-production SESSION_STORE=memory setting. */
export class MemoryWorkspaceStore implements WorkspaceStore {
  private workspaces = new Map<string, string>();
  private plans = new Map<string, Map<string, string>>();
  private generations = new Map<string, number>();
  constructor(
    private key: Buffer,
    private now = Date.now,
  ) {}

  async dataGeneration(subject: string): Promise<number> {
    return this.generations.get(ownerHash(subject)) ?? 0;
  }

  async readWorkspace(subject: string): Promise<Workspace> {
    const owner = ownerHash(subject);
    const payload = this.workspaces.get(owner);
    return payload
      ? decryptJson<Workspace>(payload, this.key, workspaceContext(owner))
      : emptyWorkspace();
  }

  async writeWorkspace(
    subject: string,
    preferences: WorkspacePreferences,
    expectedGeneration?: number,
  ): Promise<Workspace> {
    const owner = ownerHash(subject);
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== (this.generations.get(owner) ?? 0)
    )
      throw workspaceChanged();
    const workspace: Workspace = {
      version: 1,
      preferences,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.workspaces.set(owner, encryptJson(workspace, this.key, workspaceContext(owner)));
    return structuredClone(workspace);
  }

  async listPlans(subject: string): Promise<SavedPlanSummary[]> {
    const owner = ownerHash(subject);
    return [...(this.plans.get(owner)?.entries() ?? [])]
      .map(([id, payload]) =>
        summarizePlan(decryptJson<SavedPlan>(payload, this.key, planContext(owner, id))),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async deleteWorkspace(subject: string): Promise<void> {
    const owner = ownerHash(subject);
    this.workspaces.delete(owner);
    this.plans.delete(owner);
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1);
  }

  async readPlan(subject: string, id: string): Promise<SavedPlan | null> {
    const owner = ownerHash(subject);
    const payload = this.plans.get(owner)?.get(id);
    return payload ? decryptJson<SavedPlan>(payload, this.key, planContext(owner, id)) : null;
  }

  async createPlan(subject: string, plan: SavedPlan, expectedGeneration?: number): Promise<void> {
    const owner = ownerHash(subject);
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== (this.generations.get(owner) ?? 0)
    )
      throw workspaceChanged();
    const plans = this.plans.get(owner) ?? new Map<string, string>();
    if (plans.has(plan.id)) throw new Error('Immutable plan already exists');
    if (plans.size >= MAX_SAVED_PLANS) throw planLimit();
    plans.set(plan.id, encryptJson(plan, this.key, planContext(owner, plan.id)));
    this.plans.set(owner, plans);
  }

  async deletePlan(subject: string, id: string): Promise<boolean> {
    return this.plans.get(ownerHash(subject))?.delete(id) ?? false;
  }
}

type PayloadRow = { payload: string };
type PlanRow = PayloadRow & { id: string };

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(
    private sql: Sql,
    private key: Buffer,
  ) {}

  async dataGeneration(subject: string): Promise<number> {
    const rows = await this.sql<
      { generation: number }[]
    >`SELECT generation FROM balance_workspace_generations
      WHERE owner_hash = ${ownerHash(subject)}`;
    return rows[0]?.generation ?? 0;
  }

  async readWorkspace(subject: string): Promise<Workspace> {
    const owner = ownerHash(subject);
    const rows = await this.sql<
      PayloadRow[]
    >`SELECT payload FROM balance_workspaces WHERE owner_hash = ${owner}`;
    return rows[0]
      ? decryptJson<Workspace>(rows[0].payload, this.key, workspaceContext(owner))
      : emptyWorkspace();
  }

  async writeWorkspace(
    subject: string,
    preferences: WorkspacePreferences,
    expectedGeneration?: number,
  ): Promise<Workspace> {
    const owner = ownerHash(subject);
    const workspace: Workspace = { version: 1, preferences, updatedAt: new Date().toISOString() };
    const payload = encryptJson(workspace, this.key, workspaceContext(owner));
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [owner]);
      if (expectedGeneration !== undefined) {
        const rows = await transaction.unsafe<{ generation: number }[]>(
          'SELECT generation FROM balance_workspace_generations WHERE owner_hash = $1',
          [owner],
        );
        if ((rows[0]?.generation ?? 0) !== expectedGeneration) throw workspaceChanged();
      }
      await transaction.unsafe(
        `INSERT INTO balance_workspaces (owner_hash, payload, updated_at)
        VALUES ($1, $2, $3) ON CONFLICT (owner_hash) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [owner, payload, workspace.updatedAt],
      );
    });
    return workspace;
  }

  async listPlans(subject: string): Promise<SavedPlanSummary[]> {
    const owner = ownerHash(subject);
    const rows = await this.sql<PlanRow[]>`SELECT id, payload FROM balance_plans
      WHERE owner_hash = ${owner} ORDER BY created_at DESC, id DESC LIMIT ${MAX_SAVED_PLANS}`;
    return rows.map((row) =>
      summarizePlan(decryptJson<SavedPlan>(row.payload, this.key, planContext(owner, row.id))),
    );
  }

  async deleteWorkspace(subject: string): Promise<void> {
    const owner = ownerHash(subject);
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [owner]);
      await transaction.unsafe('DELETE FROM balance_plans WHERE owner_hash = $1', [owner]);
      await transaction.unsafe('DELETE FROM balance_workspaces WHERE owner_hash = $1', [owner]);
      await transaction.unsafe(
        `INSERT INTO balance_workspace_generations (owner_hash, generation)
        VALUES ($1, 1) ON CONFLICT (owner_hash) DO UPDATE
        SET generation = balance_workspace_generations.generation + 1`,
        [owner],
      );
    });
  }

  async readPlan(subject: string, id: string): Promise<SavedPlan | null> {
    const owner = ownerHash(subject);
    const rows = await this.sql<
      PayloadRow[]
    >`SELECT payload FROM balance_plans WHERE owner_hash = ${owner} AND id = ${id}`;
    return rows[0]
      ? decryptJson<SavedPlan>(rows[0].payload, this.key, planContext(owner, id))
      : null;
  }

  async createPlan(subject: string, plan: SavedPlan, expectedGeneration?: number): Promise<void> {
    const owner = ownerHash(subject);
    const payload = encryptJson(plan, this.key, planContext(owner, plan.id));
    await this.sql.begin(async (transaction) => {
      // The subject lock enforces the cap across server instances and simultaneous requests.
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [owner]);
      if (expectedGeneration !== undefined) {
        const rows = await transaction.unsafe<{ generation: number }[]>(
          'SELECT generation FROM balance_workspace_generations WHERE owner_hash = $1',
          [owner],
        );
        if ((rows[0]?.generation ?? 0) !== expectedGeneration) throw workspaceChanged();
      }
      const rows = await transaction.unsafe<{ count: number }[]>(
        'SELECT count(*)::integer AS count FROM balance_plans WHERE owner_hash = $1',
        [owner],
      );
      if (rows[0].count >= MAX_SAVED_PLANS) throw planLimit();
      await transaction.unsafe(
        'INSERT INTO balance_plans (id, owner_hash, payload, created_at) VALUES ($1, $2, $3, $4)',
        [plan.id, owner, payload, plan.createdAt],
      );
    });
  }

  async deletePlan(subject: string, id: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`DELETE FROM balance_plans
      WHERE owner_hash = ${ownerHash(subject)} AND id = ${id} RETURNING id`;
    return rows.length === 1;
  }
}

let cached: { fingerprint: string; store: WorkspaceStore } | undefined;

export function getWorkspaceStore(): WorkspaceStore {
  const config = getServerConfig();
  const fingerprint = hashSecret(
    `${config.databaseUrl ?? 'memory'}:${config.encryptionKey.toString('base64')}`,
  );
  if (cached?.fingerprint === fingerprint) return cached.store;
  const store = config.memoryStore
    ? new MemoryWorkspaceStore(config.encryptionKey)
    : new PostgresWorkspaceStore(
        postgres(config.databaseUrl!, {
          max: 5,
          idle_timeout: 20,
          connect_timeout: 10,
          prepare: false,
          onnotice: () => {},
        }),
        config.encryptionKey,
      );
  cached = { fingerprint, store };
  return store;
}
