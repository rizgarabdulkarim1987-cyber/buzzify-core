import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isTransferKeyUnique } from '@/server/pharmacy/transfers';
import { pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

/**
 * Phase 6 whole-phase review, minor: only a unique violation on one of the transfer's own keys means "this key was already used".
 * Any other unique violation (the per-branch number) is a conflict to retry. The errors below are the real ones the database gives.
 */

let rid = '';
let a = '';
let b = '';

const base = (clientKey: string, number: string) => ({ restaurantId: rid, fromBranchId: a, toBranchId: b, number, clientKey, payloadHash: 'h', requestedById: 'u' });

beforeAll(async () => {
  useTestDatabase();
  await resetWorld();
  const p = await pharmacy('Keyed6', { branches: 2 });
  rid = p.id;
  [a, b] = p.branchIds as [string, string];
  await prisma().phTransfer.create({ data: base('k1', 'T-AAAA-20261031-0001') });
});
afterAll(async () => {
  await prisma().subscription.deleteMany({ where: { restaurantId: rid } });
  await prisma().restaurant.deleteMany({ where: { id: rid } });
});

const caught = async (data: ReturnType<typeof base>) => {
  try {
    await prisma().phTransfer.create({ data });
  } catch (error) {
    return error;
  }
  throw new Error('no violation');
};

describe('isTransferKeyUnique', () => {
  it('is true for a repeated client key', async () => {
    expect(isTransferKeyUnique(await caught(base('k1', 'T-AAAA-20261031-0002')))).toBe(true);
  });
  it('is false for a repeated number of one branch', async () => {
    expect(isTransferKeyUnique(await caught(base('k2', 'T-AAAA-20261031-0001')))).toBe(false);
  });
  it('is false for anything that is not a unique violation', () => {
    expect(isTransferKeyUnique(new Error('boom'))).toBe(false);
    expect(isTransferKeyUnique(null)).toBe(false);
  });
});
