import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as expiryActions from '@/server/pharmacy/actions/expiry';
import * as expiryQueries from '@/server/pharmacy/queries/expiry';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf, stockInto } from './stock-helpers';

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld, 60_000);

const TODAY = '2026-10-27';
const plus = (days: number) => new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  return { a, owner, at: { restaurantId: a.id }, b1: a.branchIds[0]!, b2: a.branchIds[1]! };
}

/** A batch whose expiry is a month (stored as the month's last day). */
async function monthBatch(restaurantId: string, branchId: string, productId: string, lot: string, monthEnd: string, available: number) {
  const id = await makeBatch(restaurantId, branchId, productId, { lot, expiry: monthEnd, buckets: { available } });
  await prisma().phBatch.update({ where: { id }, data: { expiryPrecision: 'MONTH' } });
  return id;
}

describe('ph.stock.expiry', () => {
  it('lists expired first, then soonest, with band, days, buckets and status NEW', async () => {
    const { a, owner, at, b1 } = await world();
    const p = await makeProduct(a.id, 'Zeta');
    const q = await makeProduct(a.id, 'Alpha');
    const soon = await makeBatch(a.id, b1, p.id, { lot: 'SOON', expiry: plus(10), buckets: { available: 4, reserved: 1, quarantine: 2, damaged: 9 } });
    const old = await makeBatch(a.id, b1, p.id, { lot: 'OLD', expiry: plus(-5), buckets: { available: 3 } });
    await makeBatch(a.id, b1, q.id, { lot: 'SAMEDAY', expiry: plus(10), buckets: { available: 1 } });

    const res = dataOf(await ask(owner, expiryQueries.expiry, at));
    expect(res.days).toBe(90);
    // same expiry day: product name decides (Alpha before Zeta)
    expect(res.items.map((r) => r.batch.lot)).toEqual(['OLD', 'SAMEDAY', 'SOON']);
    expect(res.items[0]).toMatchObject({
      band: 'expired',
      daysToExpiry: -5,
      branchId: b1,
      buckets: { available: 3, reserved: 0, quarantine: 0 },
      action: { status: 'NEW', assigneeId: null, note: '' },
      product: { productId: p.id, tradeName: 'Zeta' },
      batch: { batchId: old, expiryDate: plus(-5), expiryPrecision: 'DAY', status: 'ACTIVE' },
    });
    const soonRow = res.items.find((r) => r.batch.batchId === soon)!;
    // damaged is not part of the row
    expect(soonRow).toMatchObject({ band: 'd30', daysToExpiry: 10, buckets: { available: 4, reserved: 1, quarantine: 2 } });
    expect(JSON.stringify(soonRow)).not.toContain('damaged');
    expect(res.totals).toEqual({ expired: 1, d30: 2, d60: 0, d90: 0, d180: 0 });
  });

  it('ACCEPTANCE: the 90 day alert equals an independent SQL calculation', async () => {
    const { a, owner, at, b1, b2 } = await world();
    const other = await pharmacy('B');
    const p = await makeProduct(a.id, 'Panadol');
    const po = await makeProduct(other.id, 'Panadol');
    const restaurantId = a.id;
    await makeBatch(a.id, b1, p.id, { lot: 'EXPIRED', expiry: plus(-30), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D30', expiry: plus(30), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D31', expiry: plus(31), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D90', expiry: plus(90), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D91', expiry: plus(91), buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D400', expiry: plus(400), buckets: { available: 5 } });
    await monthBatch(restaurantId, b1, p.id, 'M-THIS', '2026-10-31', 5);
    await monthBatch(restaurantId, b1, p.id, 'M-NOV', '2026-11-30', 5);
    await monthBatch(restaurantId, b1, p.id, 'M-JAN', '2027-01-31', 5);
    await monthBatch(restaurantId, b1, p.id, 'M-FEB', '2027-02-28', 5);
    await makeBatch(a.id, b1, p.id, { lot: 'RECALLED', expiry: plus(10), status: 'RECALLED', buckets: { available: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'DAMAGED-ONLY', expiry: plus(10), buckets: { damaged: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'NO-STOCK', expiry: plus(10), buckets: {} });
    await makeBatch(a.id, b1, p.id, { lot: 'QUAR', expiry: plus(20), buckets: { quarantine: 5 } });
    await makeBatch(a.id, b1, p.id, { lot: 'RESV', expiry: plus(20), buckets: { reserved: 5 } });
    const shared = await makeBatch(a.id, b1, p.id, { lot: 'TWO-BRANCHES', expiry: plus(40), buckets: { available: 5 } });
    await stockInto(a.id, b2, shared, { available: 2 });
    await makeBatch(other.id, other.branchId, po.id, { lot: 'OTHER-BUSINESS', expiry: plus(5), buckets: { available: 5 } });

    // The expected set, by plain date arithmetic over every balance row (no pharmacy helper, no band function): a MONTH
    // batch alerts from the 1st of its month, a DAY batch from its date; at most 90 days away counts, expired included.
    const all = await prisma().phStockBalance.findMany({ where: { restaurantId }, include: { batch: true } });
    const dayNumber = (d: Date) => Math.floor(d.getTime() / 86_400_000);
    const todayNumber = dayNumber(new Date(`${TODAY}T00:00:00.000Z`));
    const expected = all
      .filter((s) => s.available > 0 || s.reserved > 0 || s.quarantine > 0)
      .filter((s) => {
        const d = s.batch.expiryDate;
        const alertFrom = s.batch.expiryPrecision === 'MONTH' ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) : d;
        return dayNumber(alertFrom) - todayNumber <= 90;
      })
      .map((s) => `${s.batchId}|${s.branchId}`)
      .sort();
    expect(expected.length).toBeGreaterThan(10);

    const got = dataOf(await ask(owner, expiryQueries.expiry, { ...at, days: 90 }));
    expect(got.nextCursor).toBeNull();
    expect(got.items.map((r) => `${r.batch.batchId}|${r.branchId}`).sort()).toEqual(expected);
    const lots = got.items.map((r) => r.batch.lot);
    expect(lots).toEqual(expect.arrayContaining(['D90', 'M-JAN', 'M-THIS', 'RECALLED', 'QUAR', 'RESV', 'EXPIRED']));
    for (const missing of ['D91', 'D400', 'M-FEB', 'DAMAGED-ONLY', 'NO-STOCK', 'OTHER-BUSINESS']) expect(lots).not.toContain(missing);
    expect(got.items.filter((r) => r.batch.lot === 'TWO-BRANCHES')).toHaveLength(2);
    expect(got.totals.expired).toBe(1);
    expect(got.totals.expired + got.totals.d30 + got.totals.d60 + got.totals.d90).toBe(got.items.length);
  });

  it('days widens the horizon; includeExpired=false drops expired rows but not the totals', async () => {
    const { a, owner, at, b1 } = await world();
    const p = await makeProduct(a.id);
    await makeBatch(a.id, b1, p.id, { lot: 'X', expiry: plus(-1), buckets: { available: 1 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D90', expiry: plus(90), buckets: { available: 1 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D91', expiry: plus(91), buckets: { available: 1 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D180', expiry: plus(180), buckets: { available: 1 } });
    await makeBatch(a.id, b1, p.id, { lot: 'D181', expiry: plus(181), buckets: { available: 1 } });
    const read = async (input: Record<string, unknown>) => dataOf(await ask(owner, expiryQueries.expiry, { ...at, ...input }));
    expect((await read({ days: 30 })).items.map((r) => r.batch.lot)).toEqual(['X']);
    expect((await read({ days: 90 })).items.map((r) => r.batch.lot)).toEqual(['X', 'D90']);
    const wide = await read({ days: 180 });
    expect(wide.items.map((r) => r.batch.lot)).toEqual(['X', 'D90', 'D91', 'D180']);
    expect(wide.totals).toEqual({ expired: 1, d30: 0, d60: 0, d90: 1, d180: 2 });
    const noExpired = await read({ days: 180, includeExpired: false });
    expect(noExpired.items.map((r) => r.batch.lot)).toEqual(['D90', 'D91', 'D180']);
    expect(noExpired.totals.expired).toBe(1);
    expect(codeOf(await ask(owner, expiryQueries.expiry, { ...at, days: 45 }))).toBe('INVALID');
  });

  it('pages stably, also when a row disappears between pages', async () => {
    const { a, owner, at, b1 } = await world();
    const p = await makeProduct(a.id);
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) ids.push(await makeBatch(a.id, b1, p.id, { lot: `L${i}`, expiry: plus(i < 4 ? 20 : 20 + i), buckets: { available: 3 } }));
    const first = dataOf(await ask(owner, expiryQueries.expiry, { ...at, pageSize: 3 }));
    expect(first.items.map((r) => r.batch.lot)).toHaveLength(3);
    // The stock of a row already shown goes away, and so does one not yet shown: the next page still continues in order.
    await prisma().phStockBalance.updateMany({ where: { batchId: ids[1]! }, data: { available: 0 } });
    await prisma().phStockBalance.updateMany({ where: { batchId: ids[5]! }, data: { available: 0 } });
    const seen = first.items.map((r) => r.batch.lot);
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor) {
      const next = dataOf(await ask(owner, expiryQueries.expiry, { ...at, pageSize: 3, cursor }));
      seen.push(...next.items.map((r) => r.batch.lot));
      cursor = next.nextCursor;
      pages += 1;
    }
    expect(seen).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L6']);
    expect(pages).toBe(2);
    expect(codeOf(await ask(owner, expiryQueries.expiry, { ...at, cursor: '%%%' }))).toBe('INVALID');
  });

  it('a branch-limited actor sees only their branches; the place branch narrows the owner', async () => {
    const { a, owner, at, b1, b2 } = await world();
    const p = await makeProduct(a.id);
    await makeBatch(a.id, b1, p.id, { lot: 'ONE', expiry: plus(5), buckets: { available: 1 } });
    await makeBatch(a.id, b2, p.id, { lot: 'TWO', expiry: plus(6), buckets: { available: 1 } });
    const only1 = await person('only1', { staff: [a.id, 'PHARMACIST', [b1]] });
    expect(dataOf(await ask(only1, expiryQueries.expiry, at)).items.map((r) => r.batch.lot)).toEqual(['ONE']);
    expect(codeOf(await ask(only1, expiryQueries.expiry, { ...at, branchId: b2 }))).toBe('FORBIDDEN');
    expect(dataOf(await ask(owner, expiryQueries.expiry, at)).items.map((r) => r.batch.lot)).toEqual(['ONE', 'TWO']);
    expect(dataOf(await ask(owner, expiryQueries.expiry, { ...at, branchId: b2 })).items.map((r) => r.batch.lot)).toEqual(['TWO']);
  });

  it('every staff role reads it; a support actor does not; cost only with cost.view', async () => {
    const { a, at, b1 } = await world();
    const p = await makeProduct(a.id);
    await makeBatch(a.id, b1, p.id, { expiry: plus(5), buckets: { available: 1 }, cost: { unitCostMinor: 2500n, costUnitId: p.strip } });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'PHARMACIST', 'CASHIER', 'STOCK', 'ACCOUNTANT'] as const) {
      const who = await person(`r-${role.toLowerCase()}`, { staff: [a.id, role, [b1]] });
      const res = dataOf(await ask(who, expiryQueries.expiry, at));
      expect(res.items).toHaveLength(1);
      const withCost = ['OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'STOCK', 'ACCOUNTANT'].includes(role);
      if (withCost) expect(res.items[0]).toMatchObject({ unitCostMinor: '2500', currency: 'IQD', costUnitId: p.strip });
      else expect(JSON.stringify(res)).not.toMatch(/2500|unitCost|currency|costUnit/);
      expect(JSON.stringify(res)).not.toMatch(/valueAtRisk/);
    }
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id);
    expect(codeOf(await ask(admin, expiryQueries.expiry, at))).toBe('FORBIDDEN');
  });
});

describe('ph.stock.expiry.setStatus', () => {
  async function setup() {
    const w = await world();
    const p = await makeProduct(w.a.id);
    const batch = await makeBatch(w.a.id, w.b1, p.id, { lot: 'E', expiry: plus(-2), buckets: { available: 6, quarantine: 4, reserved: 1 } });
    return { ...w, p, batch };
  }
  const place = (w: { a: { id: string }; b1: string }) => ({ restaurantId: w.a.id, branchId: w.b1 });

  it('is allowed for stock.adjust holders only', async () => {
    const w = await setup();
    for (const role of ['BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.b1]] });
      expect(codeOf(await act(who, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('OK');
    }
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('OK');
    for (const role of ['PHARMACIST', 'CASHIER', 'STOCK', 'ACCOUNTANT'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.b1]] });
      expect(codeOf(await act(who, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('FORBIDDEN');
    }
  });

  it('upserts one row per batch and branch, is idempotent, and shows in the list', async () => {
    const w = await setup();
    const input = { ...place(w), batchId: w.batch, status: 'IN_PROGRESS', assigneeId: w.owner.userId, note: '  call the supplier ' };
    const first = dataOf(await act(w.owner, expiryActions.setStatus, input));
    expect(first).toMatchObject({ status: 'IN_PROGRESS', assigneeId: w.owner.userId, changed: true, disposedQty: 0, labelOnly: false });
    const again = dataOf(await act(w.owner, expiryActions.setStatus, input));
    expect(again).toMatchObject({ id: first.id, changed: false });
    expect(await prisma().phExpiryAction.count({ where: { batchId: w.batch } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.expiry.setStatus' } })).toBe(1);
    const row = dataOf(await ask(w.owner, expiryQueries.expiry, place(w))).items[0]!;
    expect(row.action).toEqual({ status: 'IN_PROGRESS', assigneeId: w.owner.userId, note: 'call the supplier' });
    // Omitted assignee and note stay; null clears the assignee.
    dataOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'NEW' }));
    expect(await prisma().phExpiryAction.findFirst({ where: { batchId: w.batch } })).toMatchObject({ status: 'NEW', assigneeId: w.owner.userId, note: 'call the supplier' });
    dataOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'NEW', assigneeId: null }));
    expect((await prisma().phExpiryAction.findFirst({ where: { batchId: w.batch } }))!.assigneeId).toBeNull();
    // The audit entry holds ids, status and a note length, never the note.
    const audits = await prisma().auditLog.findMany({ where: { action: 'ph.expiry.setStatus' }, orderBy: { occurredAt: 'asc' } });
    expect(JSON.stringify(audits.map((x) => x.changes))).not.toContain('supplier');
    expect(audits.some((x) => JSON.stringify(x.changes).includes('"noteLength":{"after":17'))).toBe(true);
  });

  it('says MOVED and RETURNED are labels only and moves no stock', async () => {
    const w = await setup();
    for (const status of ['MOVED', 'RETURNED'] as const) {
      expect(dataOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status }))).toMatchObject({ status, labelOnly: true });
    }
    expect(await balanceOf(w.batch, w.b1)).toEqual({ available: 6, reserved: 1, quarantine: 4, damaged: 0 });
  });

  it('refuses an assignee of another branch, of another business or deactivated; accepts the owner and branch staff', async () => {
    const w = await setup();
    const other = await pharmacy('B');
    const elsewhere = await person('elsewhere', { staff: [w.a.id, 'PHARMACIST', [w.b2]] });
    const foreign = await person('foreign', { staff: [other.id, 'PHARMACIST', [other.branchId]] });
    const gone = await person('gone', { staff: [w.a.id, 'PHARMACIST', [w.b1]] });
    await prisma().phStaff.updateMany({ where: { userId: gone.userId }, data: { deactivatedAt: NOW } });
    const here = await person('here', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    const send = (assigneeId: string) => act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'IN_PROGRESS', assigneeId });
    for (const bad of [elsewhere, foreign, gone]) expect(codeOf(await send(bad.userId))).toBe('INVALID');
    expect(codeOf(await send('nobody'))).toBe('INVALID');
    expect(await prisma().phExpiryAction.count()).toBe(0);
    expect(codeOf(await send(here.userId))).toBe('OK');
    expect(codeOf(await send(w.owner.userId))).toBe('OK');
    expect(await prisma().phExpiryAction.count()).toBe(1);
  });

  it('DISPOSED needs no stock in available and quarantine, or disposeQty that writes it off as damaged', async () => {
    const w = await setup();
    const call = (extra: Record<string, unknown>) => act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'DISPOSED', ...extra });
    expect(phCodeOf(await call({}))).toBe('STOCK_LEFT');
    expect(phCodeOf(await call({ disposeQty: 9 }))).toBe('STOCK_LEFT');
    expect(await prisma().phExpiryAction.count()).toBe(0);
    expect(await balanceOf(w.batch, w.b1)).toEqual({ available: 6, reserved: 1, quarantine: 4, damaged: 0 });

    const done = dataOf(await call({ disposeQty: 10, note: 'burned' }));
    expect(done).toMatchObject({ status: 'DISPOSED', changed: true, disposedQty: 10 });
    expect(await balanceOf(w.batch, w.b1)).toEqual({ available: 0, reserved: 1, quarantine: 0, damaged: 10 });
    const damages = await prisma().phStockMovement.findMany({ where: { batchId: w.batch, type: 'DAMAGE' } });
    expect(damages).toHaveLength(2);
    expect(damages.every((m) => m.reason.startsWith('Expiry disposal: burned'))).toBe(true);

    // The same call again: nothing left, nothing moves, nothing changes.
    expect(dataOf(await call({ disposeQty: 10, note: 'burned' }))).toMatchObject({ changed: false, disposedQty: 0 });
    expect(await prisma().phStockMovement.count({ where: { batchId: w.batch, type: 'DAMAGE' } })).toBe(2);

    // With nothing in stock, DISPOSED is accepted without a quantity.
    const empty = await makeBatch(w.a.id, w.b1, w.p.id, { lot: 'EMPTY', expiry: plus(-1), buckets: { damaged: 3 } });
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: empty, status: 'DISPOSED' }))).toBe('OK');
  });

  it('refuses another business batch, an unknown one, a batch without stock history here, and a missing branch', async () => {
    const w = await setup();
    const other = await pharmacy('B');
    const po = await makeProduct(other.id);
    const foreign = await makeBatch(other.id, other.branchId, po.id, { buckets: { available: 1 } });
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: foreign, status: 'IN_PROGRESS' }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: 'missing', status: 'IN_PROGRESS' }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), branchId: w.b2, batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { restaurantId: w.a.id, batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('INVALID');
    expect(codeOf(await act(w.owner, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'BOGUS' }))).toBe('INVALID');
    expect(await prisma().phExpiryAction.count()).toBe(0);
  });

  it('a branch-limited manager cannot act on another branch', async () => {
    const w = await setup();
    const manager = await person('mgr', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b2]] });
    expect(codeOf(await act(manager, expiryActions.setStatus, { ...place(w), batchId: w.batch, status: 'IN_PROGRESS' }))).toBe('FORBIDDEN');
  });
});
