import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDemoPortfolio } from '@/lib/demo';
import { defaultWorkspacePreferences, type SavedPlan } from '@/lib/workspace';
import { hashSecret } from './crypto';
import { createSavedPlan } from './workspace';
import { MemoryWorkspaceStore, PostgresWorkspaceStore } from './workspace-store';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('encrypted product persistence (Postgres integration)', () => {
  const key = randomBytes(32);
  const subjects: string[] = [];
  let firstSql: ReturnType<typeof postgres>;
  let secondSql: ReturnType<typeof postgres>;
  let first: PostgresWorkspaceStore;
  let second: PostgresWorkspaceStore;
  let template: SavedPlan;
  const owner = (subject: string) => hashSecret(`balance:subject:${subject}`);
  const subject = () => {
    const value = randomUUID();
    subjects.push(value);
    return value;
  };
  const newPlan = (): SavedPlan => ({ ...structuredClone(template), id: randomUUID() });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/balance_test')
    )
      throw new Error(
        'Integration tests require a loopback Postgres database named balance_test*.',
      );
    firstSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    secondSql = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
    await firstSql.unsafe(
      await readFile(new URL('../../../migrations/002_product.sql', import.meta.url), 'utf8'),
    );
    first = new PostgresWorkspaceStore(firstSql, key);
    second = new PostgresWorkspaceStore(secondSql, key);
    const portfolio = { ...makeDemoPortfolio(), mode: 'live' as const, warnings: [] };
    template = await createSavedPlan(
      { subject: 'fixture', sessionId: 'fixture-session' },
      {
        name: 'Private October review',
        preferences: {
          ...structuredClone(defaultWorkspacePreferences),
          selectedAccountIds: portfolio.accounts.map((account) => account.id),
        },
        contributionCents: 0,
        contributionAccountId: null,
      },
      { store: new MemoryWorkspaceStore(key), loadPortfolio: async () => portfolio },
    );
  });

  afterAll(async () => {
    if (!firstSql) return;
    for (const value of subjects) {
      await firstSql`DELETE FROM balance_plans WHERE owner_hash = ${owner(value)}`;
      await firstSql`DELETE FROM balance_workspaces WHERE owner_hash = ${owner(value)}`;
      await firstSql`DELETE FROM balance_workspace_generations WHERE owner_hash = ${owner(value)}`;
    }
    await Promise.all([firstSql.end(), secondSql.end()]);
  });

  it('restores an encrypted policy across independent server connections', async () => {
    const user = subject();
    const saved = await first.writeWorkspace(user, template.preferences);
    expect(await second.readWorkspace(user)).toEqual(saved);
    const [row] =
      await firstSql`SELECT owner_hash, payload FROM balance_workspaces WHERE owner_hash = ${owner(user)}`;
    expect(row.owner_hash).not.toBe(user);
    expect(row.payload).toMatch(/^v1\./);
    expect(row.payload).not.toContain('"selectedAccountIds":["demo-fidelity"');
    expect((await second.readWorkspace(subject())).updatedAt).toBeNull();
  });

  it('retains immutable encrypted source snapshots and exposes only metadata in lists', async () => {
    const user = subject();
    const plan = newPlan();
    await first.createPlan(user, plan);
    expect(await second.readPlan(user, plan.id)).toEqual(plan);
    const [row] = await firstSql`SELECT payload FROM balance_plans WHERE id = ${plan.id}`;
    expect(row.payload).not.toContain('"broker":"Fidelity"');
    expect(row.payload).not.toContain(`"name":${JSON.stringify(plan.name)}`);
    expect(row.payload).not.toContain('"symbol":"VTI"');
    const list = await second.listPlans(user);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: plan.id, historical: true, executable: false });
    expect(list[0]).not.toHaveProperty('source');
    expect(list[0]).not.toHaveProperty('result');
    await expect(second.createPlan(user, { ...plan, name: 'Overwritten' })).rejects.toThrow();
    expect((await first.readPlan(user, plan.id))?.name).toBe(plan.name);
  });

  it('scopes plan detail and deletion to the authenticated subject', async () => {
    const user = subject();
    const other = subject();
    const plan = newPlan();
    await first.createPlan(user, plan);
    expect(await second.readPlan(other, plan.id)).toBeNull();
    expect(await second.deletePlan(other, plan.id)).toBe(false);
    expect(await first.readPlan(user, plan.id)).not.toBeNull();
    expect(await second.deletePlan(user, plan.id)).toBe(true);
    expect(await first.readPlan(user, plan.id)).toBeNull();
  });

  it('rejects ciphertext copied into a different user or plan row', async () => {
    const user = subject();
    const other = subject();
    const original = newPlan();
    const copied = newPlan();
    await first.createPlan(user, original);
    await first.createPlan(other, copied);
    await firstSql`UPDATE balance_plans SET payload = (SELECT payload FROM balance_plans WHERE id = ${original.id}) WHERE id = ${copied.id}`;
    await expect(second.readPlan(other, copied.id)).rejects.toThrow();
  });

  it('enforces the 30-plan limit when requests race across server connections', async () => {
    const user = subject();
    for (let index = 0; index < 29; index++) await first.createPlan(user, newPlan());
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).createPlan(user, newPlan()),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'plan_limit', status: 409 });
    expect(await first.listPlans(user)).toHaveLength(30);
  });

  it('deletes all policy and saved financial data for one user atomically', async () => {
    const user = subject();
    const other = subject();
    await first.writeWorkspace(user, template.preferences);
    await first.createPlan(user, newPlan());
    const otherPlan = newPlan();
    await first.createPlan(other, otherPlan);
    await second.deleteWorkspace(user);
    expect((await first.readWorkspace(user)).updatedAt).toBeNull();
    expect(await first.listPlans(user)).toHaveLength(0);
    expect(await first.readPlan(other, otherPlan.id)).not.toBeNull();
  });

  it('rejects a save authorized before deletion, across separate server connections', async () => {
    const user = subject();
    const generation = await first.dataGeneration(user);
    await second.deleteWorkspace(user);
    await expect(first.createPlan(user, newPlan(), generation)).rejects.toMatchObject({
      code: 'workspace_changed',
      status: 409,
    });
    expect(await second.listPlans(user)).toHaveLength(0);
    await first.createPlan(user, newPlan(), await first.dataGeneration(user));
    expect(await second.listPlans(user)).toHaveLength(1);
  });

  it('prevents a pending preferences write from restoring deleted data across server connections', async () => {
    const user = subject();
    await first.writeWorkspace(user, template.preferences);
    const generation = await first.dataGeneration(user);
    await second.deleteWorkspace(user);
    await expect(
      first.writeWorkspace(user, template.preferences, generation),
    ).rejects.toMatchObject({ code: 'workspace_changed', status: 409 });
    expect((await second.readWorkspace(user)).updatedAt).toBeNull();
    const currentGeneration = await first.dataGeneration(user);
    await first.writeWorkspace(user, template.preferences, currentGeneration);
    expect((await second.readWorkspace(user)).preferences).toEqual(template.preferences);
  });
});
