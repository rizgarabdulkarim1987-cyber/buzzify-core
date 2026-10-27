import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHARMACY_BRANCH_SCOPED_MODELS, scopedClient, withBranchScopedModels } from '@/server/data/tenant-db';
import { resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

/**
 * PhStaffBranch is the real model with a required `branchId` (and a `restaurantId`), so it stands in for every later
 * branch-scoped model: the throwaway list is injected through the `withBranchScopedModels` seam.
 */
describe('branch scope', () => {
  let restaurantA: string;
  let restaurantB: string;
  let a1: string;
  let a2: string;
  let b1: string;
  let staffA: string;
  let staffB: string;
  let restore: () => void;

  beforeAll(async () => {
    await resetTestData(prisma);
  });

  beforeEach(async () => {
    await resetTestData(prisma);
    restore = withBranchScopedModels(['PhStaffBranch']);
    restaurantA = (await prisma.restaurant.create({ data: { name: 'A' } })).id;
    restaurantB = (await prisma.restaurant.create({ data: { name: 'B' } })).id;
    a1 = (await prisma.branch.create({ data: { restaurantId: restaurantA, name: 'A1' } })).id;
    a2 = (await prisma.branch.create({ data: { restaurantId: restaurantA, name: 'A2' } })).id;
    b1 = (await prisma.branch.create({ data: { restaurantId: restaurantB, name: 'B1' } })).id;
    for (const [id, tag] of [
      ['u-a', 'a'],
      ['u-b', 'b'],
    ] as const) {
      await prisma.user.create({ data: { id, name: tag, email: `${tag}@example.test` } });
    }
    staffA = (await prisma.phStaff.create({ data: { restaurantId: restaurantA, userId: 'u-a', role: 'CASHIER' } })).id;
    staffB = (await prisma.phStaff.create({ data: { restaurantId: restaurantB, userId: 'u-b', role: 'CASHIER' } })).id;
    await prisma.phStaffBranch.createMany({
      data: [
        { restaurantId: restaurantA, staffId: staffA, branchId: a1 },
        { restaurantId: restaurantA, staffId: staffA, branchId: a2 },
        { restaurantId: restaurantB, staffId: staffB, branchId: b1 },
      ],
    });
  });

  afterEach(() => restore());

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('lists PhStaffBranch among the branch-scoped models', () => {
    expect(PHARMACY_BRANCH_SCOPED_MODELS).toContain('PhStaffBranch');
  });

  it('reads only the rows of the branches in scope', async () => {
    const db = scopedClient(prisma, { restaurantId: restaurantA, branchIds: [a1] });
    const rows = await db.phStaffBranch.findMany();
    expect(rows.map((row) => row.branchId)).toEqual([a1]);
    expect(await db.phStaffBranch.count()).toBe(1);
    expect((await db.phStaffBranch.aggregate({ _count: true }))._count).toBe(1);
    const other = await prisma.phStaffBranch.findFirstOrThrow({ where: { branchId: a2 } });
    expect(await db.phStaffBranch.findUnique({ where: { id: other.id } })).toBeNull();
    await expect(db.phStaffBranch.update({ where: { id: other.id }, data: { createdAt: new Date() } })).rejects.toThrow();
    expect((await db.phStaffBranch.deleteMany({})).count).toBe(1);
    expect(await prisma.phStaffBranch.count({ where: { branchId: a2 } })).toBe(1);
  });

  it('refuses to create a row for a branch outside the scope', async () => {
    const db = scopedClient(prisma, { restaurantId: restaurantA, branchIds: [a1] });
    await prisma.phStaffBranch.deleteMany({ where: { branchId: a1 } });
    await expect(db.phStaffBranch.create({ data: { restaurantId: restaurantA, staffId: staffA, branchId: a2 } })).rejects.toThrow(/branch/i);
    await expect(db.phStaffBranch.createMany({ data: [{ restaurantId: restaurantA, staffId: staffA, branchId: a2 }] })).rejects.toThrow(/branch/i);
    const created = await db.phStaffBranch.create({ data: { restaurantId: restaurantA, staffId: staffA, branchId: a1 } });
    expect(created.branchId).toBe(a1);
    await expect(db.phStaffBranch.updateMany({ data: { branchId: a2 } })).rejects.toThrow(/branch/i);
  });

  it('an allBranches client reads every branch of its restaurant', async () => {
    const db = scopedClient(prisma, { restaurantId: restaurantA, allBranches: true });
    const rows = await db.phStaffBranch.findMany();
    expect(rows.map((row) => row.branchId).sort()).toEqual([a1, a2].sort());
  });

  it('a client with neither branchIds nor allBranches refuses a branch-scoped model', async () => {
    const db = scopedClient(prisma, { restaurantId: restaurantA });
    await expect(db.phStaffBranch.findMany()).rejects.toThrow(/branch/i);
    await expect(db.phStaffBranch.create({ data: { restaurantId: restaurantA, staffId: staffA, branchId: a1 } })).rejects.toThrow(/branch/i);
  });

  it('a branch of another restaurant is never reachable even if listed', async () => {
    const db = scopedClient(prisma, { restaurantId: restaurantA, branchIds: [a1, b1] });
    const rows = await db.phStaffBranch.findMany();
    expect(rows.map((row) => row.branchId)).toEqual([a1]);
    await expect(db.phStaffBranch.create({ data: { restaurantId: restaurantB, staffId: staffB, branchId: b1 } })).rejects.toThrow();
  });

  it('an unlisted model is not confined by branch (the seam swaps the list)', async () => {
    restore();
    restore = withBranchScopedModels([]);
    const db = scopedClient(prisma, { restaurantId: restaurantA });
    expect((await db.phStaffBranch.findMany()).length).toBe(2);
  });

  it('refuses a scope that is both allBranches and branch-limited', () => {
    expect(() => scopedClient(prisma, { restaurantId: restaurantA, allBranches: true, branchIds: [a1] })).toThrow();
  });
});
