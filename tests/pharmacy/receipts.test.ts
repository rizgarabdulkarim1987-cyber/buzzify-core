import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as productActions from '@/server/pharmacy/actions/products';
import * as receiptQueries from '@/server/pharmacy/queries/receipts';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.19', userAgent: 'vitest' };
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 30, sellable: false },
];

async function product(restaurantId: string, who: Person, tradeName = 'Panadol') {
  const created = dataOf(
    await act(who, productActions.create, { restaurantId, tradeName, strength: '500 mg', form: 'tablet', manufacturer: 'GSK', levels: LADDER }),
  );
  const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
  return { id: created.id, tablet: units[0]!.id, strip: units[1]!.id, box: units[2]!.id };
}

type P = Awaited<ReturnType<typeof product>>;
const line = (p: P, over: Record<string, unknown> = {}) => ({
  productId: p.id,
  unitId: p.strip,
  qty: 5,
  lot: 'l-100',
  expiry: '2028-03-15',
  unitCostMinor: 2500n,
  currency: 'IQD',
  ...over,
});
let keySeq = 0;
const draft = (restaurantId: string, branchId: string, lines: unknown[], over: Record<string, unknown> = {}) => ({
  restaurantId,
  branchId,
  clientKey: `client-key-${(keySeq += 1)}`,
  supplierName: 'Acme',
  reference: 'INV-1',
  receivedOn: '2026-10-27',
  lines,
  ...over,
});

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const p = await product(a.id, owner);
  return { a, owner, p };
}

const place = (a: { id: string; branchId: string }, receiptId: string) => ({ restaurantId: a.id, branchId: a.branchId, receiptId });
const balances = () => prisma().phStockBalance.findMany({ orderBy: { batchId: 'asc' } });

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

describe('receipt drafts', () => {
  it('creates a draft with lines (month expiry stored as the last day) and audits it', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { expiry: '03/2028', lot: ' ab-1 ' })])));
    expect(made).toMatchObject({ status: 'DRAFT', replayed: false });
    const row = await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    expect(row).toMatchObject({ status: 'DRAFT', branchId: a.branchId, supplierName: 'Acme', invoiceRef: 'INV-1', number: null });
    expect(row.lines[0]).toMatchObject({ lot: 'AB-1', qty: 5, baseQty: 50, bonusQty: 0, expiryPrecision: 'MONTH', unitCostMinor: 2500n, costCurrency: 'IQD' });
    expect(row.lines[0]!.expiryDate.toISOString().slice(0, 10)).toBe('2028-03-31');
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.create', entityId: made.id } })).toBe(1);
  });

  it('is idempotent by clientKey: a repeat returns the same receipt', async () => {
    const { a, owner, p } = await world();
    const input = draft(a.id, a.branchId, [line(p)]);
    const first = dataOf(await act(owner, receiptActions.create, input));
    const again = dataOf(await act(owner, receiptActions.create, input));
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    expect(await prisma().phReceipt.count()).toBe(1);
    const parallel = await Promise.all([1, 2, 3].map(() => act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)], { clientKey: 'same-key-1' }))));
    expect(new Set(parallel.map((r) => dataOf(r).id)).size).toBe(1);
    expect(await prisma().phReceipt.count()).toBe(2);
  });

  it('refuses a unit of another product and a product of another business', async () => {
    const { a, owner, p } = await world();
    const other = await product(a.id, owner, 'Brufen');
    const wrongUnit = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { unitId: other.strip })]));
    expect(codeOf(wrongUnit)).toBe('INVALID');
    expect(wrongUnit.ok ? null : wrongUnit.error.fields).toHaveProperty('lines.0.unitId');

    const b = await pharmacy('B');
    const bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
    const bp = await product(b.id, bOwner);
    const foreign = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(bp)]));
    expect(codeOf(foreign)).toBe('INVALID');
    expect(foreign.ok ? null : foreign.error.fields).toHaveProperty('lines.0.productId');
    expect(await prisma().phReceipt.count()).toBe(0);
  });

  it('validates lot, expiry, quantities, cost and the line count', async () => {
    const { a, owner, p } = await world();
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, over)]));
      expect(codeOf(r), JSON.stringify(over, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).toBe('INVALID');
      expect(r.ok ? null : r.error.fields).toHaveProperty(field);
    };
    await bad({ lot: '   ' }, 'lines.0.lot');
    await bad({ lot: 'x'.repeat(41) }, 'lines.0.lot');
    await bad({ expiry: '' }, 'lines.0.expiry');
    await bad({ expiry: '2028-02-30' }, 'lines.0.expiry');
    await bad({ expiry: 'soon' }, 'lines.0.expiry');
    await bad({ qty: 0 }, 'lines.0.qty');
    await bad({ qty: 1.5 }, 'lines.0.qty');
    await bad({ bonusQty: -1 }, 'lines.0.bonusQty');
    await bad({ currency: 'EUR' }, 'lines.0.currency');
    await bad({ unitCostMinor: -1n }, 'lines.0.unitCostMinor');
    await bad({ unitCostMinor: 0n }, 'lines.0.unitCostMinor');
    await bad({ qty: 2_000_000_000 }, 'lines.0.qty');
    expect(codeOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [])))).toBe('INVALID');
    const many = await act(owner, receiptActions.create, draft(a.id, a.branchId, Array.from({ length: 201 }, () => line(p))));
    expect(codeOf(many)).toBe('INVALID');
    const ok200 = await act(owner, receiptActions.create, draft(a.id, a.branchId, Array.from({ length: 200 }, (_, i) => line(p, { lot: `L${i}` }))));
    expect(codeOf(ok200)).toBe('OK');
    const free = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { unitCostMinor: 0n, freeOfCharge: true })]));
    expect(codeOf(free)).toBe('OK');
  });

  it('accepts BigInt cost up to the column maximum and refuses one past it', async () => {
    const { a, owner, p } = await world();
    const MAX = 9_223_372_036_854_775_807n;
    const ok = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { unitCostMinor: MAX })])));
    const row = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: ok.id } });
    expect(row.unitCostMinor).toBe(MAX);
    const over = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { unitCostMinor: MAX + 1n })]));
    expect(codeOf(over)).toBe('INVALID');
    const text = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { unitCostMinor: '12500' })]));
    expect(codeOf(text)).toBe('OK');
  });

  it('updates a draft with the version it started from, replacing the lines', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p), line(p, { lot: 'L2' })])));
    const input = { ...draft(a.id, a.branchId, [line(p, { lot: 'L3', qty: 7 })], { supplierName: 'Beta' }), receiptId: made.id, expectedVersion: made.version };
    const updated = dataOf(await act(owner, receiptActions.update, input));
    expect(updated.version).toBe(made.version + 1);
    const lines = await prisma().phReceiptLine.findMany({ where: { receiptId: made.id } });
    expect(lines.map((l) => [l.lot, l.qty])).toEqual([['L3', 7]]);
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).supplierName).toBe('Beta');
    expect(codeOf(await act(owner, receiptActions.update, input))).toBe('CONFLICT');
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.update', entityId: made.id } })).toBe(1);
  });
});

describe('batch identity, load and replays', () => {
  it('a second supplier with the same lot and expiry adds to the existing batch', async () => {
    const { a, owner, p } = await world();
    for (const supplierName of ['Acme', 'Beta']) {
      const r = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)], { supplierName })));
      dataOf(await act(owner, receiptActions.confirm, place(a, r.id)));
    }
    const batches = await prisma().phBatch.findMany();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.supplierName).toBe('Acme');
    expect((await balances())[0]).toMatchObject({ available: 100 });
  });

  it('two confirms of the same new lot in two branches at once make one batch and sum the stock', async () => {
    const { a, owner, p } = await world();
    for (let round = 0; round < 3; round += 1) {
      const lot = `RACE${round}`;
      const ids: string[] = [];
      for (const i of [0, 1]) {
        ids.push(dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchIds[i]!, [line(p, { lot })], { supplierName: `S${i}` }))).id);
      }
      const results = await Promise.all(
        ids.map((id, i) => act(owner, receiptActions.confirm, { restaurantId: a.id, branchId: a.branchIds[i]!, receiptId: id })),
      );
      expect(results.map(codeOf)).toEqual(['OK', 'OK']);
      const batches = await prisma().phBatch.findMany({ where: { lot } });
      expect(batches).toHaveLength(1);
      const rows = await prisma().phStockBalance.findMany({ where: { batchId: batches[0]!.id } });
      expect(rows.map((r) => r.available)).toEqual([50, 50]);
    }
  });

  it('confirms a 200-line receipt', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, Array.from({ length: 200 }, (_, i) => line(p, { lot: `B${i}` })))));
    const done = dataOf(await act(owner, receiptActions.confirm, place(a, made.id)));
    expect(done.lines).toBe(200);
    expect(await prisma().phStockMovement.count()).toBe(200);
  }, 90_000);

  it('a repeated clientKey with another branch or other lines is refused', async () => {
    const { a, owner, p } = await world();
    const input = draft(a.id, a.branchId, [line(p)]);
    dataOf(await act(owner, receiptActions.create, input));
    const otherBranch = await act(owner, receiptActions.create, { ...input, branchId: a.branchIds[1] });
    expect(codeOf(otherBranch)).toBe('CONFLICT');
    expect(otherBranch.ok ? null : otherBranch.error.fields).toMatchObject({ phCode: 'CLIENT_KEY_MISMATCH' });
    const otherLines = await act(owner, receiptActions.create, { ...input, lines: [line(p, { qty: 9 })] });
    expect(otherLines.ok ? null : otherLines.error.fields).toMatchObject({ phCode: 'CLIENT_KEY_MISMATCH' });
    expect(codeOf(await act(owner, receiptActions.create, input))).toBe('OK');
    expect(await prisma().phReceipt.count()).toBe(1);
  });

  it('refuses an archived product on a line', async () => {
    const { a, owner, p } = await world();
    await prisma().phProduct.update({ where: { id: p.id }, data: { active: false } });
    const r = await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)]));
    expect(codeOf(r)).toBe('INVALID');
    expect(r.ok ? null : r.error.fields).toHaveProperty('lines.0.productId');
  });

  it('a confirm that fails on a later line leaves nothing behind', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(
      await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { lot: 'OKAY' }), line(p, { lot: 'OLD', expiry: '2026-01-01' })])),
    );
    const r = await act(owner, receiptActions.confirm, place(a, made.id));
    expect(r.ok ? null : r.error.fields).toHaveProperty('lines.1.expiry');
    expect(await prisma().phBatch.count()).toBe(0);
    expect(await prisma().phStockMovement.count()).toBe(0);
    expect(await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ status: 'DRAFT', number: null });
  });
});

describe('confirming a receipt', () => {
  it('creates the batch, the balance and a RECEIPT movement, numbers the receipt and audits it', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 5, bonusQty: 1 })])));
    const done = dataOf(await act(owner, receiptActions.confirm, place(a, made.id)));
    expect(done).toMatchObject({ status: 'CONFIRMED', number: 'R-000001', warnings: [] });
    const batch = await prisma().phBatch.findFirstOrThrow({ where: { productId: p.id } });
    expect(batch).toMatchObject({ lot: 'L-100', unitCostMinor: 2500n, costCurrency: 'IQD', costUnitId: p.strip, expiryPrecision: 'DAY' });
    const [bal] = await balances();
    expect(bal).toMatchObject({ batchId: batch.id, branchId: a.branchId, available: 60, quarantine: 0 });
    const moves = await prisma().phStockMovement.findMany();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: 'RECEIPT', availableDelta: 60, receiptId: made.id, branchId: a.branchId, userId: owner.userId });
    const row = await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    expect(row).toMatchObject({ status: 'CONFIRMED', number: 'R-000001', confirmedById: owner.userId });
    expect(row.lines[0]!.batchId).toBe(batch.id);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.confirm', entityId: made.id } })).toBe(1);

    const second = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { lot: 'Z' })])));
    expect(dataOf(await act(owner, receiptActions.confirm, place(a, second.id))).number).toBe('R-000002');
  });

  it('adds a second receipt of the same lot and expiry to the same batch, and warns when its cost differs', async () => {
    const { a, owner, p } = await world();
    const one = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 2 })])));
    expect(dataOf(await act(owner, receiptActions.confirm, place(a, one.id))).warnings).toEqual([]);
    const two = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 3, lot: 'l-100', unitCostMinor: 3000n })])));
    const done = dataOf(await act(owner, receiptActions.confirm, place(a, two.id)));
    expect(await prisma().phBatch.count()).toBe(1);
    const batch = await prisma().phBatch.findFirstOrThrow();
    expect(batch.unitCostMinor).toBe(2500n);
    expect((await balances())[0]).toMatchObject({ available: 50 });
    expect(done.warnings).toEqual([{ code: 'COST_DIFFERS', lineNo: 1, batchId: batch.id }]);
    const kept = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: two.id } });
    expect(kept.unitCostMinor).toBe(3000n);
  });

  it('puts an accepted expired line in quarantine and refuses a past expiry without the flag', async () => {
    const { a, owner, p } = await world();
    const refused = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { expiry: '2026-10-26' })])));
    const no = await act(owner, receiptActions.confirm, place(a, refused.id));
    expect(codeOf(no)).toBe('INVALID');
    expect(no.ok ? null : no.error.fields).toMatchObject({ phCode: 'EXPIRED' });
    expect(await prisma().phBatch.count()).toBe(0);
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: refused.id } })).status).toBe('DRAFT');

    const today = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { expiry: '2026-10-27', lot: 'T' })])));
    expect(codeOf(await act(owner, receiptActions.confirm, place(a, today.id)))).toBe('OK');

    const accepted = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { expiry: '2026-09-01', lot: 'E', acceptExpired: true })])));
    dataOf(await act(owner, receiptActions.confirm, place(a, accepted.id)));
    const batch = await prisma().phBatch.findFirstOrThrow({ where: { lot: 'E' } });
    expect(await prisma().phStockBalance.findFirstOrThrow({ where: { batchId: batch.id } })).toMatchObject({ available: 0, quarantine: 50 });
    const moves = await prisma().phStockMovement.findMany({ where: { batchId: batch.id }, orderBy: { availableDelta: 'desc' } });
    expect(moves.map((m) => [m.type, m.availableDelta, m.quarantineDelta, m.receiptId])).toEqual([
      ['RECEIPT', 50, 0, accepted.id],
      ['ADJUST', -50, 50, accepted.id],
    ]);
  });

  it('refuses to add stock to an existing RECALLED or BLOCKED batch (BATCH_NOT_ACTIVE) and rolls the whole confirm back', async () => {
    const { a, owner, p } = await world();
    const first = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 2 })])));
    dataOf(await act(owner, receiptActions.confirm, place(a, first.id)));
    const batch = await prisma().phBatch.findFirstOrThrow();
    for (const status of ['RECALLED', 'BLOCKED'] as const) {
      await prisma().phBatch.update({ where: { id: batch.id }, data: { status } });
      const again = dataOf(
        await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { lot: 'OTHER' }), line(p, { qty: 3 })])),
      );
      const r = await act(owner, receiptActions.confirm, place(a, again.id));
      expect(codeOf(r), status).toBe('CONFLICT');
      expect(r.ok ? null : r.error.fields, status).toMatchObject({ phCode: 'BATCH_NOT_ACTIVE' });
      expect(r.ok ? '' : r.error.message).toContain('Panadol');
      expect(r.ok ? '' : r.error.message).toContain('L-100');
      expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: again.id } })).status).toBe('DRAFT');
      expect(await prisma().phBatch.count()).toBe(1);
      expect(await prisma().phStockMovement.count()).toBe(1);
      expect((await balances())[0]).toMatchObject({ available: 20 });
    }
  });

  it('an expired line accepted into quarantine may join a BLOCKED batch but never a RECALLED one', async () => {
    const { a, owner, p } = await world();
    const first = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 1, expiry: '2026-09-01', lot: 'E', acceptExpired: true })])));
    dataOf(await act(owner, receiptActions.confirm, place(a, first.id)));
    const batch = await prisma().phBatch.findFirstOrThrow();
    const more = () =>
      act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 1, expiry: '2026-09-01', lot: 'E', acceptExpired: true })]));

    await prisma().phBatch.update({ where: { id: batch.id }, data: { status: 'BLOCKED' } });
    const blocked = dataOf(await more());
    expect(codeOf(await act(owner, receiptActions.confirm, place(a, blocked.id)))).toBe('OK');
    expect((await balances())[0]).toMatchObject({ available: 0, quarantine: 20 });

    await prisma().phBatch.update({ where: { id: batch.id }, data: { status: 'RECALLED' } });
    const recalled = dataOf(await more());
    const r = await act(owner, receiptActions.confirm, place(a, recalled.id));
    expect(codeOf(r)).toBe('CONFLICT');
    expect(r.ok ? null : r.error.fields).toMatchObject({ phCode: 'BATCH_NOT_ACTIVE' });
    expect((await balances())[0]).toMatchObject({ available: 0, quarantine: 20 });
  });

  it('refuses a line whose product was archived since the draft', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    await prisma().phProduct.update({ where: { id: p.id }, data: { active: false } });
    const r = await act(owner, receiptActions.confirm, place(a, made.id));
    expect(codeOf(r)).toBe('INVALID');
    expect(r.ok ? null : r.error.fields).toHaveProperty('lines.0.productId');
    expect(await prisma().phBatch.count()).toBe(0);
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('DRAFT');
  });

  it('refuses a line whose unit changed size since the draft (LINE_STALE) instead of adding the old quantity', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { qty: 5 })])));
    await prisma().phProductUnit.update({ where: { id: p.strip }, data: { baseQty: 12 } });
    const r = await act(owner, receiptActions.confirm, place(a, made.id));
    expect(codeOf(r)).toBe('CONFLICT');
    expect(r.ok ? null : r.error.fields).toMatchObject({ phCode: 'LINE_STALE' });
    expect(await prisma().phStockMovement.count()).toBe(0);
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('DRAFT');
  });

  it('under a concurrent double confirm exactly one wins and the stock is added once', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    const results = await Promise.all([1, 2, 3].map(() => act(owner, receiptActions.confirm, place(a, made.id))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(codeOf)).toEqual(['CONFLICT', 'CONFLICT']);
    expect((await balances())[0]).toMatchObject({ available: 50 });
    expect(await prisma().phStockMovement.count()).toBe(1);
    expect(await prisma().phReceipt.count({ where: { number: 'R-000001' } })).toBe(1);
  });

  it('numbers concurrent confirms of different receipts without gaps or duplicates', async () => {
    const { a, owner, p } = await world();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { lot: `N${i}` })]))).id);
    const results = await Promise.all(ids.map((id) => act(owner, receiptActions.confirm, place(a, id))));
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = (await prisma().phReceipt.findMany({ select: { number: true } })).map((r) => r.number).sort();
    expect(numbers).toEqual(['R-000001', 'R-000002', 'R-000003', 'R-000004']);
  });

  it('refuses to confirm a VOID receipt, to edit or void a confirmed one', async () => {
    const { a, owner, p } = await world();
    const voided = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    expect(codeOf(await act(owner, receiptActions.voidReceipt, place(a, voided.id)))).toBe('OK');
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: voided.id } })).status).toBe('VOID');
    expect(codeOf(await act(owner, receiptActions.confirm, place(a, voided.id)))).toBe('CONFLICT');
    expect(await prisma().phStockMovement.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.void', entityId: voided.id } })).toBe(1);

    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    const done = dataOf(await act(owner, receiptActions.confirm, place(a, made.id)));
    const edit = { ...draft(a.id, a.branchId, [line(p)]), receiptId: made.id, expectedVersion: done.version };
    expect(codeOf(await act(owner, receiptActions.update, edit))).toBe('CONFLICT');
    expect(codeOf(await act(owner, receiptActions.voidReceipt, place(a, made.id)))).toBe('CONFLICT');
    expect(codeOf(await act(owner, receiptActions.update, { ...edit, receiptId: voided.id }))).toBe('CONFLICT');
    expect((await balances())[0]).toMatchObject({ available: 50 });
  });
});

describe('permissions and branches', () => {
  it('a branch-limited actor cannot receive into, or touch a receipt of, another branch', async () => {
    const { a, owner, p } = await world();
    const stock = await person('stock', { staff: [a.id, 'STOCK', [a.branchIds[0]!]] });
    expect(codeOf(await act(stock, receiptActions.create, draft(a.id, a.branchIds[1]!, [line(p)])))).toBe('FORBIDDEN');
    expect(codeOf(await act(stock, receiptActions.create, { ...draft(a.id, a.branchIds[0]!, [line(p)]), branchId: undefined }))).toBe('INVALID');
    expect(codeOf(await act(stock, receiptActions.create, draft(a.id, a.branchIds[0]!, [line(p)])))).toBe('OK');

    const other = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchIds[1]!, [line(p)])));
    const noPlace = { restaurantId: a.id, receiptId: other.id };
    expect(codeOf(await act(stock, receiptActions.confirm, noPlace))).toBe('NOT_FOUND');
    expect(codeOf(await act(stock, receiptActions.voidReceipt, noPlace))).toBe('NOT_FOUND');
    expect(codeOf(await act(stock, receiptActions.confirm, { ...noPlace, branchId: a.branchIds[1] }))).toBe('FORBIDDEN');
    expect(dataOf(await ask(stock, receiptQueries.list, { restaurantId: a.id })).items).toHaveLength(1);
    expect(codeOf((await ask(stock, receiptQueries.get, { restaurantId: a.id, receiptId: other.id })) as ActionResult<unknown>)).toBe('NOT_FOUND');
    expect(dataOf(await ask(owner, receiptQueries.list, { restaurantId: a.id })).items).toHaveLength(2);
    expect(codeOf(await act(owner, receiptActions.confirm, { restaurantId: a.id, receiptId: other.id }))).toBe('OK');
  });

  it('refuses every write to a role without purchase.manage', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [a.branchId]] });
      expect(codeOf(await act(who, receiptActions.create, draft(a.id, a.branchId, [line(p)])))).toBe('FORBIDDEN');
      const edit = { ...draft(a.id, a.branchId, [line(p)]), receiptId: made.id, expectedVersion: 1 };
      expect(codeOf(await act(who, receiptActions.update, edit))).toBe('FORBIDDEN');
      expect(codeOf(await act(who, receiptActions.confirm, place(a, made.id)))).toBe('FORBIDDEN');
      expect(codeOf(await act(who, receiptActions.voidReceipt, place(a, made.id)))).toBe('FORBIDDEN');
    }
    expect(await prisma().phReceipt.count()).toBe(1);
  });

  it('a pharmacist in charge can receive', async () => {
    const { a, p } = await world();
    const pic = await person('pic', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [a.branchId]] });
    const made = dataOf(await act(pic, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    expect(codeOf(await act(pic, receiptActions.confirm, place(a, made.id)))).toBe('OK');
  });

  it('another business cannot read, confirm, update or void a receipt by its id', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    const b = await pharmacy('B');
    const bOwner = await person('bowner2', { membership: [b.id, 'OWNER'] });
    const bp = await product(b.id, bOwner);
    const there = { restaurantId: b.id, branchId: b.branchId, receiptId: made.id };
    expect(codeOf(await act(bOwner, receiptActions.confirm, there))).toBe('NOT_FOUND');
    expect(codeOf(await act(bOwner, receiptActions.voidReceipt, there))).toBe('NOT_FOUND');
    expect(codeOf(await act(bOwner, receiptActions.update, { ...draft(b.id, b.branchId, [line(bp)]), receiptId: made.id, expectedVersion: 1 }))).toBe('NOT_FOUND');
    expect(codeOf((await ask(bOwner, receiptQueries.get, there)) as ActionResult<unknown>)).toBe('NOT_FOUND');
    expect((await prisma().phReceipt.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('DRAFT');
  });

  it('hides cost values from list and get for a role without cost.view', async () => {
    const { a, owner, p } = await world();
    const made = dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p)])));
    const cashier = await person('csh', { staff: [a.id, 'CASHIER', [a.branchId]] });
    expect(JSON.stringify(dataOf(await ask(cashier, receiptQueries.get, { restaurantId: a.id, receiptId: made.id })))).not.toMatch(/2500|unitCost|currency/);
    const pharmacist = await person('rph', { staff: [a.id, 'PHARMACIST', [a.branchId]] });
    const seen = dataOf(await ask(pharmacist, receiptQueries.get, { restaurantId: a.id, receiptId: made.id }));
    expect(JSON.stringify(seen)).not.toMatch(/2500|unitCostMinor|currency/);
    expect(seen.lines[0]).toMatchObject({ lot: 'L-100', qty: 5 });
    const list = dataOf(await ask(pharmacist, receiptQueries.list, { restaurantId: a.id }));
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/2500|unitCost|currency/);
    const full = dataOf(await ask(owner, receiptQueries.get, { restaurantId: a.id, receiptId: made.id }));
    expect(full.lines[0]).toMatchObject({ unitCostMinor: '2500', currency: 'IQD' });
  });

  it('lists by status with a cursor', async () => {
    const { a, owner, p } = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(dataOf(await act(owner, receiptActions.create, draft(a.id, a.branchId, [line(p, { lot: `P${i}` })]))).id);
    dataOf(await act(owner, receiptActions.confirm, place(a, ids[0]!)));
    const drafts = dataOf(await ask(owner, receiptQueries.list, { restaurantId: a.id, status: 'DRAFT' }));
    expect(drafts.items).toHaveLength(2);
    const p1 = dataOf(await ask(owner, receiptQueries.list, { restaurantId: a.id, pageSize: 2 }));
    const p2 = dataOf(await ask(owner, receiptQueries.list, { restaurantId: a.id, pageSize: 2, cursor: p1.nextCursor }));
    expect([...p1.items, ...p2.items].map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(p2.nextCursor).toBeNull();
    const done = [...p1.items, ...p2.items].find((r) => r.id === ids[0])!;
    expect(done).toMatchObject({ status: 'CONFIRMED', number: 'R-000001', lineCount: 1 });
  });
});
