import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as rxActions from '@/server/pharmacy/actions/prescriptions';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Selling a controlled medicine (phase 7, task 2; R7-1, R7-2): off by default, then only a pharmacist with a valid prescription of
 * the same business and branch, within the quantity limit, with one register row per batch taken, reversed by a return. Hand
 * figures: product R sells by the tablet at 100 IQD; batch L1 (expires 2027-01-31) holds 15 and batch L2 (2028-03-31) 40, so FEFO
 * takes L1 first; 20 tablets are 15 from L1 and 5 from L2 and cost 2000.
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b: { id: string; branchId: string };
  b1: string;
  b2: string;
  owner: Person;
  manager: Person;
  pharmacist: Person;
  cashier: Person;
  ownerB: Person;
  support: Person;
  r: { id: string; tablet: string; strip: string };
  otc: { id: string; tablet: string; strip: string };
  l1: string;
  l2: string;
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function price(restaurantId: string, p: { id: string; tablet: string; strip: string }) {
  for (const [unitId, amountMinor] of [[p.tablet, 100n], [p.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
}
const openShift = (restaurantId: string, branchId: string, who: Person) =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency: 'IQD', openingFloatMinor: 0n }, select: { id: true } });

async function world(over: { enabled?: boolean; maxQty?: number } = {}): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
  const support = await person('support', { superAdmin: true });
  await grant(support, a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  await prisma().phSettings.create({ data: { restaurantId: a.id, controlledEnabled: over.enabled ?? true, controlledMaxQty: over.maxQty ?? 30 } });
  await prisma().phSettings.create({ data: { restaurantId: b.id } });
  const r = await makeProduct(a.id, 'Morphex');
  await prisma().phProduct.update({ where: { id: r.id }, data: { rxLevel: 'RESTRICTED' } });
  const otc = await makeProduct(a.id, 'Panadol');
  await price(a.id, r);
  await price(a.id, otc);
  const l1 = await makeBatch(a.id, b1, r.id, { lot: 'L1', expiry: '2027-01-31', buckets: { available: 15 } });
  const l2 = await makeBatch(a.id, b1, r.id, { lot: 'L2', expiry: '2028-03-31', buckets: { available: 40 } });
  await makeBatch(a.id, b1, otc.id, { lot: 'P1', expiry: '2028-03-31', buckets: { available: 100 } });
  for (const who of [owner, manager, pharmacist, cashier]) await openShift(a.id, b1, who);
  await openShift(a.id, b2, owner);
  return { a, b, b1, b2, owner, manager, pharmacist, cashier, ownerB, support, r, otc, l1, l2 };
}

const rx = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('rx'),
  number: 'AB 1234',
  prescriberName: 'Dr Strange',
  patientName: 'Layla Hassan',
  patientIdNote: 'National ID: 4821',
  issuedOn: '2026-10-20',
  ...over,
});
const newRx = async (w: World, over: Record<string, unknown> = {}, who: Person = w.pharmacist) => dataOf(await act(who, rxActions.create, rx(w, over))).id;

const sale = (w: World, prescriptionId: string | undefined, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('sale'),
  currency: 'IQD',
  lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 20 }],
  payments: [{ method: 'CASH', amountMinor: 2000n, clientKey: key('pay') }],
  ...(prescriptionId ? { prescriptionId } : {}),
  ...over,
});
const cashFor = (amount: bigint) => [{ method: 'CASH', amountMinor: amount, clientKey: key('pay') }];

const register = () => prisma().phControlledEntry.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const registerByLot = async (w: World) => {
  const rows = await register();
  const lot = (batchId: string) => (batchId === w.l1 ? 'L1' : batchId === w.l2 ? 'L2' : 'other');
  const sums: Record<string, number> = {};
  for (const row of rows) sums[lot(row.batchId)] = (sums[lot(row.batchId)] ?? 0) + row.baseQty;
  return sums;
};
const nothingWritten = async (w: World) => {
  expect(await register()).toEqual([]);
  expect(await prisma().phSale.count()).toBe(0);
  expect((await balanceOf(w.l1, w.b1))?.available).toBe(15);
  expect((await balanceOf(w.l2, w.b1))?.available).toBe(40);
};

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('with controlled sales switched off (the default)', () => {
  it('refuses a controlled medicine to everyone, with the prescription or without, and writes nothing', async () => {
    const w = await world({ enabled: false });
    const id = await newRx(w);
    for (const who of [w.cashier, w.pharmacist, w.owner]) {
      for (const input of [sale(w, id), sale(w, undefined)]) {
        const r = await act(who, saleActions.create, input);
        expect([codeOf(r), phCodeOf(r)], who.email).toEqual(['CONFLICT', 'RESTRICTED_NOT_AVAILABLE']);
      }
    }
    await nothingWritten(w);
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id } })).saleId).toBeNull();
  });

  it('leaves an ordinary sale exactly as it was', async () => {
    const w = await world({ enabled: false });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, undefined, { lines: [{ productId: w.otc.id, unitId: w.otc.tablet, qty: 2 }], payments: cashFor(200n) })));
    expect(made).toMatchObject({ status: 'COMPLETED', totalMinor: '200', replayed: false });
    expect(await register()).toEqual([]);
  });
});

describe('with controlled sales switched on', () => {
  it('lets a pharmacist sell with a valid prescription: one register row per batch, linked, stock and cash right', async () => {
    const w = await world();
    const id = await newRx(w);
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w, id)));
    expect(made).toMatchObject({ status: 'COMPLETED', subtotalMinor: '2000', totalMinor: '2000', paidMinor: '2000', changeMinor: '0', lineCount: 1, replayed: false });

    // 20 tablets: 15 from L1 (the earlier expiry) and 5 from L2.
    expect((await balanceOf(w.l1, w.b1))?.available).toBe(0);
    expect((await balanceOf(w.l2, w.b1))?.available).toBe(35);
    const rows = await register();
    expect(rows.map((r) => [r.batchId === w.l1 ? 'L1' : 'L2', r.baseQty, r.kind]).sort()).toEqual([['L1', 15, 'SALE'], ['L2', 5, 'SALE']]);
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } });
    for (const row of rows) {
      expect(row).toMatchObject({ restaurantId: w.a.id, branchId: w.b1, saleId: made.id, saleLineId: line.id, productId: w.r.id, prescriptionId: id, dispensedById: w.pharmacist.userId });
    }
    expect(line).toMatchObject({ rxLevel: 'RESTRICTED', pharmacistId: w.pharmacist.userId, baseQty: 20 });
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: made.id } })).pharmacistId).toBe(w.pharmacist.userId);
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id } })).saleId).toBe(made.id);
  });

  it('audits the units dispensed and no prescription, patient or prescriber text', async () => {
    const w = await world();
    const id = await newRx(w);
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id)));
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.create' } });
    expect((audit.changes as Record<string, { after: unknown }>).controlledQty).toEqual({ before: null, after: 20 });
    const everything = JSON.stringify(await prisma().auditLog.findMany());
    for (const secret of ['Dr Strange', 'Layla', '4821', 'AB 1234']) expect(everything, secret).not.toContain(secret);
  });

  it('refuses a cashier, a seller without a prescription, and support, and writes nothing', async () => {
    const w = await world();
    const id = await newRx(w);
    const cashier = await act(w.cashier, saleActions.create, sale(w, id));
    expect([codeOf(cashier), phCodeOf(cashier)]).toEqual(['INVALID', 'RX_NEEDS_PHARMACIST']);
    const none = await act(w.pharmacist, saleActions.create, sale(w, undefined));
    expect([codeOf(none), phCodeOf(none)]).toEqual(['INVALID', 'PRESCRIPTION_REQUIRED']);
    expect(codeOf(await act(w.support, saleActions.create, sale(w, id)))).toBe('FORBIDDEN');
    await nothingWritten(w);
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id } })).saleId).toBeNull();
  });

  it('refuses more than the limit in one sale, counted per product across its lines, and 0 means no limit', async () => {
    const w = await world();
    const id = await newRx(w);
    const over = await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 31 }], payments: cashFor(3100n) }));
    expect([codeOf(over), phCodeOf(over)]).toEqual(['CONFLICT', 'CONTROLLED_QTY_LIMIT']);
    expect(over.ok ? null : over.error.fields).toMatchObject({ max: '30', total: '31', productName: 'Morphex' });
    // Two lines of 20 and 11 are 31 tablets of one product: still over.
    const split = await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 20 }, { productId: w.r.id, unitId: w.r.tablet, qty: 11 }], payments: cashFor(3100n) }));
    expect(phCodeOf(split)).toBe('CONTROLLED_QTY_LIMIT');
    await nothingWritten(w);

    // Exactly the limit is fine: 30 tablets = 15 from L1 and 15 from L2.
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 30 }], payments: cashFor(3000n) })));
    expect(await registerByLot(w)).toEqual({ L1: 15, L2: 15 });

    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { controlledMaxQty: 0 } });
    const id2 = await newRx(w, { number: 'CD 99' });
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id2, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }], payments: cashFor(500n) })));
    expect(await registerByLot(w)).toEqual({ L1: 15, L2: 20 });
  });

  it('with the limit at 0 sells more than the old limit of 30 in one sale', async () => {
    const w = await world({ maxQty: 0 });
    const id = await newRx(w);
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 35 }], payments: cashFor(3500n) })));
    expect(await registerByLot(w)).toEqual({ L1: 15, L2: 20 });
  });

  it('judges the prescription date on the Baghdad day: at 22:30 UTC (01:30 next day) day 30 is the 28th minus 30, and today is not the future', async () => {
    const w = await world();
    vi.setSystemTime(new Date('2026-10-27T22:30:00.000Z'));
    const today = await newRx(w, { issuedOn: '2026-10-28', number: 'BG TODAY' }).catch(() => null);
    expect(today).not.toBeNull();
    const edge = await newRx(w, { issuedOn: '2026-09-28', number: 'BG EDGE' });
    const old = await newRx(w, { issuedOn: '2026-09-27', number: 'BG OLD' });
    expect(codeOf(await act(w.pharmacist, saleActions.create, sale(w, today!)))).toBe('OK');
    const expired = await act(w.pharmacist, saleActions.create, sale(w, old));
    expect([codeOf(expired), phCodeOf(expired)]).toEqual(['INVALID', 'RX_EXPIRED']);
    expect(codeOf(await act(w.pharmacist, saleActions.create, sale(w, edge, { clientKey: key('edge') })))).toBe('OK');
  });

  it('lets only one of two parallel sales use the same prescription', async () => {
    const w = await world();
    const id = await newRx(w);
    const lines = [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }];
    const [one, two] = await Promise.all([
      act(w.pharmacist, saleActions.create, sale(w, id, { lines, payments: cashFor(500n), clientKey: key('par1') })),
      act(w.pharmacist, saleActions.create, sale(w, id, { lines, payments: cashFor(500n), clientKey: key('par2') })),
    ]);
    expect([one, two].map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect([one, two].map(phCodeOf)).toContain('PRESCRIPTION_USED');
    expect(await prisma().phSale.count()).toBe(1);
  });

  it('refuses a prescription that is too old (31 days) or dated in the future, and accepts day 30', async () => {
    const w = await world();
    const old = await newRx(w, { issuedOn: '2026-09-26', number: 'OLD 1' });
    const edge = await newRx(w, { issuedOn: '2026-09-27', number: 'EDGE 1' });
    const future = (await prisma().phPrescription.create({
      data: { restaurantId: w.a.id, branchId: w.b1, number: 'FUT 1', prescriberName: 'Dr X', patientName: 'P', issuedOn: new Date('2026-10-28T00:00:00.000Z'), clientKey: key('fut'), payloadHash: 'h', createdById: w.pharmacist.userId },
      select: { id: true },
    })).id;
    const expired = await act(w.pharmacist, saleActions.create, sale(w, old));
    expect([codeOf(expired), phCodeOf(expired)]).toEqual(['INVALID', 'RX_EXPIRED']);
    expect(phCodeOf(await act(w.pharmacist, saleActions.create, sale(w, future)))).toBe('RX_DATE_FUTURE');
    await nothingWritten(w);
    expect(codeOf(await act(w.pharmacist, saleActions.create, sale(w, edge)))).toBe('OK');
  });

  it('refuses a prescription with no patient name', async () => {
    const w = await world();
    const id = await newRx(w, { patientName: '' });
    const r = await act(w.pharmacist, saleActions.create, sale(w, id));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['INVALID', 'PATIENT_REQUIRED']);
    await nothingWritten(w);
  });

  it('uses a prescription once: a second sale with it is refused', async () => {
    const w = await world();
    const id = await newRx(w);
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }], payments: cashFor(500n) })));
    const again = await act(w.pharmacist, saleActions.create, sale(w, id, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }], payments: cashFor(500n) }));
    expect([codeOf(again), phCodeOf(again)]).toEqual(['CONFLICT', 'PRESCRIPTION_USED']);
    expect(await register()).toHaveLength(1);
  });

  it('refuses a prescription number used before for the same medicine, even spelled differently, but not for another medicine', async () => {
    const w = await world();
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, await newRx(w), { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }], payments: cashFor(500n) })));
    for (const spelled of ['AB 1234', ' ab   1234 ']) {
      const copy = await newRx(w, { number: spelled });
      const r = await act(w.pharmacist, saleActions.create, sale(w, copy, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 5 }], payments: cashFor(500n) }));
      expect([codeOf(r), phCodeOf(r)], spelled).toEqual(['CONFLICT', 'DUPLICATE_PRESCRIPTION']);
    }
    expect(await register()).toHaveLength(1);

    // Another controlled medicine under the same number is a different dispensing.
    const r2 = await makeProduct(w.a.id, 'Fentanex');
    await prisma().phProduct.update({ where: { id: r2.id }, data: { rxLevel: 'RESTRICTED' } });
    await price(w.a.id, r2);
    await makeBatch(w.a.id, w.b1, r2.id, { lot: 'F1', expiry: '2028-03-31', buckets: { available: 10 } });
    const other = await newRx(w, { number: 'AB 1234' });
    expect(codeOf(await act(w.pharmacist, saleActions.create, sale(w, other, { lines: [{ productId: r2.id, unitId: r2.tablet, qty: 2 }], payments: cashFor(200n) })))).toBe('OK');
  });

  it('sees a number used in another branch of the business, though the seller works in one branch only', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b2, w.r.id, { lot: 'L9', expiry: '2028-03-31', buckets: { available: 10 } });
    const elsewhere = await newRx(w, { branchId: w.b2, number: 'XY 5' }, w.owner);
    dataOf(await act(w.owner, saleActions.create, sale(w, elsewhere, { branchId: w.b2, lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 2 }], payments: cashFor(200n) })));
    const here = await newRx(w, { number: 'XY 5' });
    const r = await act(w.pharmacist, saleActions.create, sale(w, here, { lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 2 }], payments: cashFor(200n) }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'DUPLICATE_PRESCRIPTION']);
  });

  it('treats a prescription of another branch or another business as not found', async () => {
    const w = await world();
    const otherBranch = await newRx(w, { branchId: w.b2, number: 'B2 1' }, w.owner);
    const otherBusiness = dataOf(await act(w.ownerB, rxActions.create, { ...rx(w, { number: 'BB 1' }), restaurantId: w.b.id, branchId: w.b.branchId })).id;
    for (const id of [otherBranch, otherBusiness, 'does-not-exist']) {
      const r = await act(w.pharmacist, saleActions.create, sale(w, id));
      expect([codeOf(r), phCodeOf(r)], id).toEqual(['NOT_FOUND', 'PRESCRIPTION_NOT_FOUND']);
    }
    await nothingWritten(w);
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id: otherBranch } })).saleId).toBeNull();
  });

  it('gives one winner when two sales race for the last controlled units, and the register holds only the winner’s rows', async () => {
    const w = await world();
    // Only 10 tablets left in total: take L2 down to 0 and L1 to 10.
    await prisma().phStockBalance.updateMany({ where: { batchId: w.l2 }, data: { available: 0 } });
    await prisma().phStockBalance.updateMany({ where: { batchId: w.l1 }, data: { available: 10 } });
    const one = await newRx(w, { number: 'RACE 1' });
    const two = await newRx(w, { number: 'RACE 2' }, w.owner);
    const lines = [{ productId: w.r.id, unitId: w.r.tablet, qty: 10 }];
    const [first, second] = await Promise.all([
      act(w.pharmacist, saleActions.create, sale(w, one, { lines, payments: cashFor(1000n) })),
      act(w.owner, saleActions.create, sale(w, two, { lines, payments: cashFor(1000n) })),
    ]);
    expect([codeOf(first), codeOf(second)].sort()).toEqual(['CONFLICT', 'OK']);
    const loser = first.ok ? second : first;
    expect(phCodeOf(loser)).toBe('INSUFFICIENT_STOCK');
    expect(await registerByLot(w)).toEqual({ L1: 10 });
    expect((await balanceOf(w.l1, w.b1))?.available).toBe(0);
    expect(await prisma().phSale.count()).toBe(1);
    // The loser’s prescription is untouched and can be used for another sale.
    const loserRx = first.ok ? two : one;
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id: loserRx } })).saleId).toBeNull();
  });

  it('replays a sale with the same key without a second register row, and refuses the key for another prescription', async () => {
    const w = await world();
    const id = await newRx(w);
    const input = sale(w, id);
    const made = dataOf(await act(w.pharmacist, saleActions.create, input));
    const again = dataOf(await act(w.pharmacist, saleActions.create, input));
    expect(again).toMatchObject({ id: made.id, replayed: true });
    expect(await register()).toHaveLength(2);
    const other = await newRx(w, { number: 'ZZ 9' });
    expect(phCodeOf(await act(w.pharmacist, saleActions.create, { ...input, prescriptionId: other }))).toBe('CLIENT_KEY_MISMATCH');
  });

  it('takes a prescription on an RX line without requiring one, and writes no register row for it', async () => {
    const w = await world();
    const rxDrug = await makeProduct(w.a.id, 'Amoxil');
    await prisma().phProduct.update({ where: { id: rxDrug.id }, data: { rxLevel: 'RX' } });
    await price(w.a.id, rxDrug);
    await makeBatch(w.a.id, w.b1, rxDrug.id, { lot: 'A1', expiry: '2028-03-31', buckets: { available: 50 } });
    const lines = [{ productId: rxDrug.id, unitId: rxDrug.tablet, qty: 3 }];
    // Without one: as before.
    expect(codeOf(await act(w.pharmacist, saleActions.create, sale(w, undefined, { lines, payments: cashFor(300n) })))).toBe('OK');
    // With a 100-day-old prescription (valid for RX, not for a controlled drug).
    const id = await newRx(w, { issuedOn: '2026-07-19', number: 'RX 7', patientName: '' });
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w, id, { lines, payments: cashFor(300n) })));
    expect((await prisma().phPrescription.findUniqueOrThrow({ where: { id } })).saleId).toBe(made.id);
    expect(await register()).toEqual([]);
    // A cashier still cannot sell it.
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, undefined, { lines, payments: cashFor(300n) })))).toBe('RX_NEEDS_PHARMACIST');
  });
});

describe('the register', () => {
  it('shows the rows to a pharmacist with the product and lot and no patient field, and is closed to the other roles and support', async () => {
    const w = await world();
    const id = await newRx(w);
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, id)));
    const rows = dataOf(await ask(w.pharmacist, rxQueries.register, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(rows.map((r) => [r.productName, r.lot, r.baseQty, r.kind]).sort()).toEqual([['Morphex', 'L1', 15, 'SALE'], ['Morphex', 'L2', 5, 'SALE']]);
    expect(JSON.stringify(rows)).not.toMatch(/Layla|Strange|4821|AB 1234/);
    for (const who of [w.cashier, w.support]) expect(codeOf(await ask(who, rxQueries.register, { restaurantId: w.a.id })), who.email).toBe('FORBIDDEN');
    expect(dataOf(await ask(w.ownerB, rxQueries.register, { restaurantId: w.b.id }))).toEqual([]);
  });

  it('cannot be changed or deleted, even by a direct write', async () => {
    const w = await world();
    dataOf(await act(w.pharmacist, saleActions.create, sale(w, await newRx(w))));
    const [row] = await register();
    await expect(prisma().phControlledEntry.update({ where: { id: row!.id }, data: { baseQty: 1 } })).rejects.toThrow();
    await expect(prisma().phControlledEntry.delete({ where: { id: row!.id } })).rejects.toThrow();
    expect(await register()).toHaveLength(2);
  });
});

describe('returning a controlled medicine', () => {
  const ret = (w: World, saleId: string, lines: Array<{ saleLineId: string; baseQty: number }>) => ({
    restaurantId: w.a.id,
    branchId: w.b1,
    saleId,
    lines,
    reason: 'wrong strength',
    refundMethod: 'CASH',
    clientKey: key('ret'),
  });

  it('writes reversing rows with the returned quantities and nets the register to zero when everything is back', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w, await newRx(w))));
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } });

    // 12 of 20 back: the register still shows 8 dispensed.
    dataOf(await act(w.manager, returnActions.create, ret(w, made.id, [{ saleLineId: line.id, baseQty: 12 }])));
    let rows = await register();
    expect(rows.filter((r) => r.kind === 'RETURN').reduce((s, r) => s + r.baseQty, 0)).toBe(-12);
    expect(rows.reduce((s, r) => s + r.baseQty, 0)).toBe(8);
    for (const r of rows.filter((x) => x.kind === 'RETURN')) {
      expect(r).toMatchObject({ saleId: made.id, saleLineId: line.id, productId: w.r.id, dispensedById: w.manager.userId, branchId: w.b1 });
      expect(r.baseQty).toBeLessThan(0);
    }

    // The other 8 back: every batch nets to zero, and the units are in quarantine, not for sale.
    dataOf(await act(w.manager, returnActions.create, ret(w, made.id, [{ saleLineId: line.id, baseQty: 8 }])));
    rows = await register();
    expect(await registerByLot(w)).toEqual({ L1: 0, L2: 0 });
    expect(rows.reduce((s, r) => s + r.baseQty, 0)).toBe(0);
    expect(rows.filter((r) => r.kind === 'SALE')).toHaveLength(2);
    expect((await balanceOf(w.l1, w.b1))).toMatchObject({ available: 0, quarantine: 15 });
    expect((await balanceOf(w.l2, w.b1))).toMatchObject({ available: 35, quarantine: 5 });
  });

  it('cancels a whole sale: the reversal mirrors the sale batch by batch', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w, await newRx(w))));
    dataOf(await act(w.manager, returnActions.cancel, { restaurantId: w.a.id, branchId: w.b1, saleId: made.id, reason: 'entered by mistake', refundMethod: 'CASH', clientKey: key('can') }));
    expect(await registerByLot(w)).toEqual({ L1: 0, L2: 0 });
    expect((await register()).filter((r) => r.kind === 'RETURN').map((r) => r.baseQty).sort((x, y) => x - y)).toEqual([-15, -5]);
  });

  it('writes register rows only for the controlled line of a mixed sale', async () => {
    const w = await world();
    const mixed = sale(w, await newRx(w), {
      lines: [{ productId: w.r.id, unitId: w.r.tablet, qty: 2 }, { productId: w.otc.id, unitId: w.otc.tablet, qty: 3 }],
      payments: cashFor(500n),
    });
    const made = dataOf(await act(w.pharmacist, saleActions.create, mixed));
    expect(await register()).toHaveLength(1);
    const otcLine = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id, productId: w.otc.id } });
    dataOf(await act(w.manager, returnActions.create, ret(w, made.id, [{ saleLineId: otcLine.id, baseQty: 1 }])));
    expect((await register()).filter((r) => r.kind === 'RETURN')).toEqual([]);
  });

  it('still reverses after the owner has switched controlled sales off', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w, await newRx(w))));
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { controlledEnabled: false } });
    dataOf(await act(w.manager, returnActions.cancel, { restaurantId: w.a.id, branchId: w.b1, saleId: made.id, reason: 'entered by mistake', refundMethod: 'CASH', clientKey: key('can') }));
    expect(await registerByLot(w)).toEqual({ L1: 0, L2: 0 });
  });
});
