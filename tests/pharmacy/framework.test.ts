import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { defineAction, runAction } from '@/server/studio/framework/action';
import { defineQuery, runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { phModelNames, phReferences } from '../helpers/ph-models';
import { DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.9', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

const studioActor = async (who: Person | null): Promise<Actor | null> => (who ? loadActor(prisma(), who.userId) : null);

const branchInput = z.object({ branchId: z.string().optional() });
const phTarget = (input: { branchId?: string }) => ({ kind: 'ph' as const, branchId: input?.branchId });

/** Writes the pharmacy's settings row and audits it, in one transaction; `fail` throws after both. */
const saveSettings = defineAction({
  name: 'test.ph.saveSettings',
  permission: null,
  ph: 'catalog.manage',
  input: branchInput.extend({ fail: z.boolean().optional(), audit: z.record(z.string(), z.unknown()).optional() }),
  target: phTarget,
  async run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const row = await tx.phSettings.create({ data: { restaurantId: ctx.restaurantId as string }, select: { id: true } });
      ctx.audit({
        action: 'ph.settings.save',
        entityType: 'PhSettings',
        entityId: row.id,
        changes: (input.audit as Record<string, { before: unknown; after: unknown }> | undefined) ?? {
          rxRetentionDays: { before: null, after: 30 },
        },
      });
      if (input.fail) throw new Error('boom');
      return { id: row.id, branches: await tx.phStaffBranch.count(), ph: ctx.ph?.role ?? null };
    });
  },
});

/** A catalog read: any role holding catalog.view, and a support actor with catalog.read. */
const viewCatalog = defineQuery({
  name: 'test.ph.viewCatalog',
  permission: null,
  ph: 'catalog.view',
  input: branchInput,
  target: phTarget,
  async run(ctx) {
    return { restaurantId: ctx.restaurantId, role: ctx.ph?.role ?? null, support: ctx.ph?.support !== null };
  },
});

/** A read-only action, such as an export that records itself. */
const exportCatalog = defineAction({
  name: 'test.ph.exportCatalog',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: branchInput,
  target: phTarget,
  async run(ctx) {
    ctx.audit({ action: 'ph.export', entityType: 'PhSettings', entityId: ctx.restaurantId as string });
    return 'exported';
  },
});

beforeAll(() => {
  useTestDatabase();
  // The framework reads the real clock; every pharmacy test runs at NOW.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);

const auditRows = (restaurantId: string) => prisma().auditLog.findMany({ where: { restaurantId } });

describe('the ph target', () => {
  it('a ph action runs for an owner and writes its audit row in the same transaction', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));

    const result = await runAction(prisma(), owner, saveSettings, {}, META);
    expect(result).toMatchObject({ ok: true, data: { ph: 'OWNER' } });
    const rows = await auditRows(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'ph.settings.save', entityType: 'PhSettings', menuId: null, actorId: owner!.userId });

    // A transaction that fails keeps neither the change nor its audit row.
    await prisma().phSettings.deleteMany({ where: { restaurantId: a.id } });
    await prisma().auditLog.deleteMany({ where: { restaurantId: a.id } });
    expect(codeOf(await runAction(prisma(), owner, saveSettings, { fail: true }, META))).toBe('INVALID');
    expect(await prisma().phSettings.count({ where: { restaurantId: a.id } })).toBe(0);
    expect(await auditRows(a.id)).toEqual([]);
  });

  it('runs the transaction on a client confined to the actor\'s branches', async () => {
    const a = await pharmacy('A', { branches: 2 });
    // Two staff rows give two PhStaffBranch rows, one per branch.
    await person('first', { staff: [a.id, 'CASHIER', [a.branchIds[0]!]] });
    const manager = await studioActor(await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchIds[1]!]] }));
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));

    expect(await runAction(prisma(), manager, saveSettings, {}, META)).toMatchObject({ ok: true, data: { branches: 1 } });
    await prisma().phSettings.deleteMany({ where: { restaurantId: a.id } });
    expect(await runAction(prisma(), owner, saveSettings, {}, META)).toMatchObject({ ok: true, data: { branches: 2 } });
  });

  it('a cashier is refused a catalog.manage action', async () => {
    const a = await pharmacy('A');
    const cashier = await studioActor(await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] }));
    expect(codeOf(await runAction(prisma(), cashier, saveSettings, {}, META))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), cashier, viewCatalog, {}))).toBe('OK');
    expect(await prisma().phSettings.count()).toBe(0);
  });

  it("a branch outside the actor's branches is refused FORBIDDEN", async () => {
    const a = await pharmacy('A', { branches: 2 });
    const b = await pharmacy('B');
    const manager = await studioActor(await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchIds[0]!]] }));
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));

    expect(codeOf(await runAction(prisma(), manager, saveSettings, { branchId: a.branchIds[0] }, META))).toBe('OK');
    await prisma().phSettings.deleteMany({});
    expect(codeOf(await runAction(prisma(), manager, saveSettings, { branchId: a.branchIds[1] }, META))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), manager, viewCatalog, { branchId: a.branchIds[1] }))).toBe('FORBIDDEN');
    // The owner holds every branch of their own pharmacy and none of another's.
    expect(codeOf(await runQuery(prisma(), owner, viewCatalog, { branchId: a.branchIds[1] }))).toBe('OK');
    expect(codeOf(await runQuery(prisma(), owner, viewCatalog, { branchId: b.branchId }))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), owner, viewCatalog, { branchId: 'no-such-branch' }))).toBe('FORBIDDEN');
  });

  it('a readOnly pharmacy refuses actions and allows queries and allowReadOnly actions', async () => {
    const a = await pharmacy('A', { subscription: 'ACTIVE', periodEndsInDays: -8, graceDays: 7 });
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));

    expect(codeOf(await runAction(prisma(), owner, saveSettings, {}, META))).toBe('FORBIDDEN');
    expect(await runQuery(prisma(), owner, viewCatalog, {})).toMatchObject({ ok: true, data: { restaurantId: a.id, role: 'OWNER' } });
    expect(await runAction(prisma(), owner, exportCatalog, {}, META)).toEqual({ ok: true, data: 'exported' });
    expect(await auditRows(a.id)).toHaveLength(1);
  });

  it('an archived pharmacy refuses everything', async () => {
    const a = await pharmacy('A', { subscription: 'ACTIVE', periodEndsInDays: -98, graceDays: 7 });
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));

    expect(codeOf(await runAction(prisma(), owner, saveSettings, {}, META))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), owner, viewCatalog, {}))).toBe('FORBIDDEN');
    expect(codeOf(await runAction(prisma(), owner, exportCatalog, {}, META))).toBe('FORBIDDEN');
  });

  it('a super admin without a grant gets the same refusal as a stranger', async () => {
    await pharmacy('A');
    const admin = await studioActor(await person('admin', { superAdmin: true }));
    const stranger = await studioActor(await person('stranger'));
    const closed = await pharmacy('Closed', { subscription: 'none' });
    const ownerOfClosed = await studioActor(await person('closedowner', { membership: [closed.id, 'OWNER'] }));

    const answers = [
      await runQuery(prisma(), admin, viewCatalog, {}),
      await runQuery(prisma(), stranger, viewCatalog, {}),
      await runQuery(prisma(), ownerOfClosed, viewCatalog, {}),
      await runAction(prisma(), admin, saveSettings, {}, META),
      await runAction(prisma(), stranger, saveSettings, {}, META),
      await runAction(prisma(), ownerOfClosed, saveSettings, {}, META),
    ];
    // No actor and a closed gate answer alike, so the answer never says which pharmacies exist or who works there.
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(codeOf(answers[0]!)).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), null, viewCatalog, {}))).toBe('UNAUTHENTICATED');
  });

  it('a support actor can run a catalog.view query and cannot run any action', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['catalog.read'] });
    const actor = await studioActor(admin);

    expect(await runQuery(prisma(), actor, viewCatalog, {})).toEqual({
      ok: true,
      data: { restaurantId: a.id, role: null, support: true },
    });
    expect(codeOf(await runAction(prisma(), actor, exportCatalog, {}, META))).toBe('FORBIDDEN');
    expect(codeOf(await runAction(prisma(), actor, saveSettings, {}, META))).toBe('FORBIDDEN');
    expect(await auditRows(a.id)).toEqual([]);
  });

  it('a support actor whose grant lacks the mapped read scope is refused the query', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['stock.read'] });
    expect(codeOf(await runQuery(prisma(), await studioActor(admin), viewCatalog, {}))).toBe('FORBIDDEN');
  });

  it('a support grant that has expired gives nothing', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['catalog.read'], startsAt: new Date(NOW.getTime() - 2 * DAY), expiresAt: new Date(NOW.getTime() - DAY) });
    expect(codeOf(await runQuery(prisma(), await studioActor(admin), viewCatalog, {}))).toBe('FORBIDDEN');
  });

  it('an audit entry with patientName fails the action', async () => {
    const a = await pharmacy('A');
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runAction(prisma(), owner, saveSettings, { audit: { patientName: { before: null, after: 'Sara' } } }, META);
      expect(codeOf(result)).toBe('INVALID');
      // The log names the field, never the value.
      expect(errors.mock.calls.flat().join(' ')).toContain('patientName');
      expect(errors.mock.calls.flat().join(' ')).not.toContain('Sara');
    } finally {
      errors.mockRestore();
    }
    expect(await prisma().phSettings.count()).toBe(0);
    expect(await auditRows(a.id)).toEqual([]);
  });

  it('a restaurant-target Studio action is not checked by audit-field rules', async () => {
    // The pharmacy rule applies to ph actions only: a Studio action's audit is unchanged.
    const a = await pharmacy('A', { sector: 'FOOD' });
    const owner = await studioActor(await person('owner', { membership: [a.id, 'OWNER'] }));
    const studio = defineAction({
      name: 'test.studio.note',
      permission: 'content.edit',
      input: z.object({ restaurantId: z.string() }),
      target: (input) => ({ kind: 'restaurant', restaurantId: input.restaurantId }),
      async run(ctx) {
        ctx.audit({ action: 'note', entityType: 'Restaurant', entityId: ctx.restaurantId as string, changes: { phone: { before: null, after: 'x' } } });
        return ctx.ph;
      },
    });
    expect(await runAction(prisma(), owner, studio, { restaurantId: a.id }, META)).toEqual({ ok: true, data: null });
  });
});

describe('ph definitions', () => {
  // Definitions the types already refuse, built anyway to show the checks refuse them when the module loads.
  const action = (spec: Record<string, unknown>) => () =>
    (defineAction as (spec: unknown) => unknown)({ name: 'test.ph.bad', input: branchInput, run: async () => 1, ...spec });
  const query = (spec: Record<string, unknown>) => () =>
    (defineQuery as (spec: unknown) => unknown)({ name: 'test.ph.bad', input: branchInput, run: async () => 1, ...spec });

  it('a ph permission needs a ph target, and a ph target needs a ph permission', () => {
    expect(query({ permission: null, ph: 'catalog.view', target: () => ({ kind: 'self' }) })).toThrow(/ph target/);
    expect(query({ permission: 'view', target: phTarget })).toThrow(/ph target/);
    expect(action({ permission: null, target: phTarget })).toThrow(/ph target/);
    expect(action({ permission: null, pos: 'order.handle', target: phTarget })).toThrow();
  });

  it('refuses an unknown ph permission, a Studio permission beside it, a feature, and allowReadOnly elsewhere', () => {
    expect(action({ permission: null, ph: 'menu.eat', target: phTarget })).toThrow(/unknown pharmacy permission/);
    expect(action({ permission: 'content.edit', ph: 'catalog.view', target: phTarget })).toThrow(/Studio permission is null/);
    expect(action({ permission: null, ph: 'catalog.view', feature: 'qr.branded', target: phTarget })).toThrow(/feature/);
    expect(action({ permission: 'content.edit', allowReadOnly: true, target: () => ({ kind: 'platform' }) })).toThrow(/allowReadOnly/);
    expect(action({ permission: null, ph: 'catalog.view', allowLapsed: true, target: phTarget })).toThrow(/lapsed/);
    expect(action({ permission: null, ph: 'catalog.view', target: phTarget })).not.toThrow();
  });
});

/** Repository-relative source files under `dir`. */
function sourceFiles(dir: string): string[] {
  const start = join(process.cwd(), dir);
  if (!existsSync(start)) return [];
  const found: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry)) found.push(relative(process.cwd(), full).split(sep).join('/'));
    }
  };
  visit(start);
  return found;
}

describe('the Studio and pharmacy data', () => {
  it('no restaurant-target Studio action can read a Ph model', () => {
    const names = phModelNames();
    expect(names).toEqual(expect.arrayContaining(['phSettings', 'phStaff', 'phStaffBranch', 'phStaffs']));
    const offenders = sourceFiles('src/server/studio').flatMap((path) =>
      phReferences(readFileSync(join(process.cwd(), path), 'utf8'), names).map((name) => `${path}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});
