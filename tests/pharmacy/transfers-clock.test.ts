import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, dataOf as typedDataOf, makeBatch, makeProduct } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- action answers are read off the wire and checked by value */

/**
 * Phase 6 whole-phase review, minor: a server whose clock is a second behind the one that took the request must still be able to send and
 * receive. The CHECK PhTransfer_times_ordered (sentAt >= requestedAt, receivedAt >= sentAt) is held by stamping no earlier than the step before.
 */

const dataOf = (r: Parameters<typeof typedDataOf>[0]): any => typedDataOf(r);
let seq = 0;
const key = (l: string) => `${l}-${(seq += 1)}-${'x'.repeat(8)}`;
let rid = '';
let A = '';
let B = '';
let owner: Person;

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  const p = await pharmacy('Clock6', { branches: 2 });
  [A, B] = p.branchIds as [string, string];
  rid = p.id;
  owner = await person('ownerClock', { membership: [rid, 'OWNER'] });
  const P = await makeProduct(rid, 'Panadol');
  await prisma().phSettings.create({ data: { restaurantId: rid } });
  await makeBatch(rid, A, P.id, { lot: 'CK1', buckets: { available: 20 } });
}, 120_000);
afterAll(() => vi.useRealTimers());

describe('a clock a little behind', () => {
  it('sends and receives, and the stamps never run backwards', async () => {
    const productId = (await prisma().phProduct.findFirstOrThrow({ where: { restaurantId: rid } })).id;
    const t = dataOf(await act(owner, transferActions.request, { restaurantId: rid, clientKey: key('req'), fromBranchId: A, toBranchId: B, lines: [{ productId, qty: 5 }] }));
    vi.setSystemTime(new Date(NOW.getTime() - 1500));
    const sent = dataOf(await act(owner, transferActions.send, { restaurantId: rid, transferId: t.id, version: t.version, clientKey: key('send') }));
    vi.setSystemTime(new Date(NOW.getTime() - 3000));
    const lineId = sent.lines.map((l: any) => l.lineId)[0];
    dataOf(await act(owner, transferActions.receive, { restaurantId: rid, transferId: t.id, version: sent.version, clientKey: key('recv'), lines: [{ lineId, receivedQty: 5 }] }));
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe('RECEIVED');
    expect(row.sentAt!.getTime()).toBeGreaterThanOrEqual(row.requestedAt.getTime());
    expect(row.receivedAt!.getTime()).toBeGreaterThanOrEqual(row.sentAt!.getTime());
  });

  it('cancels a request the same way', async () => {
    const productId = (await prisma().phProduct.findFirstOrThrow({ where: { restaurantId: rid } })).id;
    vi.setSystemTime(NOW);
    const t = dataOf(await act(owner, transferActions.request, { restaurantId: rid, clientKey: key('req'), fromBranchId: A, toBranchId: B, lines: [{ productId, qty: 1 }] }));
    vi.setSystemTime(new Date(NOW.getTime() - 2000));
    dataOf(await act(owner, transferActions.cancel, { restaurantId: rid, transferId: t.id, version: t.version }));
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledAt!.getTime()).toBeGreaterThanOrEqual(row.requestedAt.getTime());
  });
});
