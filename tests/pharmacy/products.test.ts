import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { resolveBarcode } from '@/server/pharmacy/barcodes';
import { PH_STOCK_RECORD_MODELS } from '@/server/pharmacy/products';
import * as productActions from '@/server/pharmacy/actions/products';
import * as productQueries from '@/server/pharmacy/queries/products';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.19', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

/** Tablet, strip of 10, box of 3 strips. */
const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 30, sellable: true },
];

const panadol = (restaurantId: string, over: Record<string, unknown> = {}) => ({
  restaurantId,
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  manufacturer: 'GSK',
  rxLevel: 'OTC',
  levels: LADDER,
  barcodes: [],
  branchSettings: [],
  ...over,
});

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

describe('pharmacy products', () => {
  it('creates a product with units, barcodes and branch settings in one transaction and audits it', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });

    const created = dataOf(
      await act(
        owner,
        productActions.create,
        panadol(a.id, {
          barcodes: [
            { code: '6291234567894', level: 2 },
            { code: ' ٠٠١٢٣٤ ', level: 1 },
          ],
          branchSettings: [
            { branchId: a.branchIds[0], minQty: 30, reorderQty: 90 },
            { branchId: a.branchIds[1], minQty: 10, reorderQty: 60 },
          ],
        }),
      ),
    );

    const product = await prisma().phProduct.findUniqueOrThrow({ where: { id: created.id } });
    expect(product).toMatchObject({ restaurantId: a.id, tradeName: 'Panadol', active: true, version: 1 });
    // The identity is the server's, from the five fields (the pack is the top unit).
    expect(product.identityKey).toBe('panadol|500mg|tablet|gsk|30 box');
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    expect(units.map((u) => [u.level, u.label, u.baseQty, u.restaurantId])).toEqual([
      [0, 'tablet', 1, a.id],
      [1, 'strip', 10, a.id],
      [2, 'box', 30, a.id],
    ]);
    const barcodes = await prisma().phBarcode.findMany({ where: { productId: created.id }, orderBy: { code: 'asc' } });
    // Stored as text: digits made Latin, the spaces gone, the leading zeros kept.
    expect(barcodes.map((b) => [b.code, b.unitId, b.restaurantId, b.shared])).toEqual([
      ['001234', units[1]!.id, a.id, false],
      ['6291234567894', units[2]!.id, a.id, false],
    ]);
    const settings = await prisma().phProductBranch.findMany({ where: { productId: created.id }, orderBy: { minQty: 'desc' } });
    expect(settings.map((s) => [s.branchId, s.minQty, s.reorderQty, s.restaurantId])).toEqual([
      [a.branchIds[0], 30, 90, a.id],
      [a.branchIds[1], 10, 60, a.id],
    ]);

    const audits = await prisma().auditLog.findMany({ where: { action: 'ph.product.create' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ restaurantId: a.id, actorId: owner.userId, entityType: 'PhProduct', entityId: created.id });
    expect(audits[0]!.changes).toMatchObject({ tradeName: { before: null, after: 'Panadol' }, barcodes: { before: null, after: ['001234', '6291234567894'] } });

    // One transaction: a create refused after the product row was written (its barcode is taken) leaves nothing behind.
    const refused = await act(owner, productActions.create, panadol(a.id, { tradeName: 'Fevadol', barcodes: [{ code: '6291234567894', level: 2 }] }));
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(await prisma().phProduct.count()).toBe(1);
    expect(await prisma().phProductUnit.count()).toBe(3);
    expect(await prisma().auditLog.count({ where: { action: 'ph.product.create' } })).toBe(1);
  });

  it('a duplicate identity is refused and names the existing product', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const first = dataOf(await act(owner, productActions.create, panadol(a.id)));

    // Case, digit script, spacing and unit spelling do not make another product.
    const again = await act(owner, productActions.create, panadol(a.id, { tradeName: ' PANADOL ', strength: '٥٠٠ ملغ', manufacturer: 'gsk' }));
    expect(again).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_PRODUCT', productId: first.id, productName: 'Panadol' } },
    });
    expect(await prisma().phProduct.count()).toBe(1);

    // An update that would turn another product into this one is refused the same way.
    const other = dataOf(await act(owner, productActions.create, panadol(a.id, { strength: '250 mg' })));
    const update = await act(owner, productActions.update, { ...panadol(a.id), productId: other.id, expectedVersion: other.version });
    expect(update).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_PRODUCT', productId: first.id } } });

    // Another business may hold the same product.
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await act(ownerB, productActions.create, panadol(b.id)))).toBe('OK');
  });

  it('500 mg and 1000 mg of the same trade name are both created', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { strength: '500 mg' })))).toBe('OK');
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { strength: '1000 mg' })))).toBe('OK');
    // So is another pack of the same medicine.
    const bigBox = [...LADDER.slice(0, 2), { level: 2, label: 'box', baseQty: 100, sellable: true }];
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { levels: bigBox })))).toBe('OK');
    expect(await prisma().phProduct.count()).toBe(3);
  });

  it('an invalid ladder is refused with its code', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const notMultiple = [LADDER[0], LADDER[1], { level: 2, label: 'box', baseQty: 25, sellable: true }];
    const refused = await act(owner, productActions.create, panadol(a.id, { levels: notMultiple }));
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'INVALID', fields: { phCode: 'NOT_A_MULTIPLE', levels: 'Each unit must hold a whole number of the one below it' } },
    });
    const noBase = await act(owner, productActions.create, panadol(a.id, { levels: [{ level: 1, label: 'strip', baseQty: 10, sellable: true }] }));
    expect(noBase).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'NO_BASE' } } });
    // A barcode on a level the ladder does not have is refused too.
    const strayBarcode = await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '123', level: 7 }] }));
    expect(strayBarcode).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { 'barcodes.0.level': expect.any(String) } } });
    expect(await prisma().phProduct.count()).toBe(0);
  });

  it('a barcode on another product is refused BARCODE_IN_USE', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const first = dataOf(await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '6291234567894', level: 2 }] })));

    const refused = await act(owner, productActions.create, panadol(a.id, { tradeName: 'Fevadol', barcodes: [{ code: '6291234567894', level: 0 }] }));
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICT',
        fields: { phCode: 'BARCODE_IN_USE', productId: first.id, productName: 'Panadol', 'barcodes.0.code': expect.any(String) },
      },
    });
    expect(await prisma().phProduct.count()).toBe(1);
    expect(await prisma().phBarcode.count()).toBe(1);

    // The same refusal on an update that adds the code to another product.
    const second = dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: 'Fevadol' })));
    const update = await act(owner, productActions.update, {
      ...panadol(a.id, { tradeName: 'Fevadol', barcodes: [{ code: '6291234567894', level: 1 }] }),
      productId: second.id,
      expectedVersion: second.version,
    });
    expect(update).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'BARCODE_IN_USE' } } });
    expect(await prisma().phBarcode.count()).toBe(1);
  });

  it('a shared barcode makes resolveBarcode return many', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const first = dataOf(await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '6291234567894', level: 2 }] })));
    const second = dataOf(
      await act(owner, productActions.create, panadol(a.id, { tradeName: 'Fevadol', barcodes: [{ code: '6291234567894', level: 2, shared: true }] })),
    );

    const db = scopedClient(prisma(), { restaurantId: a.id, allBranches: true });
    const resolved = await resolveBarcode(db, '6291234567894');
    expect(resolved.kind).toBe('many');
    const units = await prisma().phProductUnit.findMany({ where: { level: 2 }, select: { id: true, productId: true } });
    const unitOf = (productId: string) => units.find((u) => u.productId === productId)!.id;
    expect(resolved.kind === 'many' && [...resolved.candidates].sort((x, y) => x.productId.localeCompare(y.productId))).toEqual(
      [
        { productId: first.id, unitId: unitOf(first.id) },
        { productId: second.id, unitId: unitOf(second.id) },
      ].sort((x, y) => x.productId.localeCompare(y.productId)),
    );
    // Both rows now say the code is shared.
    expect((await prisma().phBarcode.findMany()).map((b) => b.shared)).toEqual([true, true]);

    // The sharing is audited with codes only.
    const [audit, ...more] = await prisma().auditLog.findMany({ where: { action: 'ph.barcode.share' } });
    expect(more).toEqual([]);
    expect(audit).toMatchObject({ restaurantId: a.id, actorId: owner.userId, entityType: 'PhProduct', entityId: second.id });
    expect(audit!.changes).toEqual({
      code: { before: null, after: '6291234567894' },
      sharedWith: { before: null, after: [first.id] },
    });

    // Another business's codes are never candidates.
    const b = await pharmacy('B');
    expect(await resolveBarcode(scopedClient(prisma(), { restaurantId: b.id, allBranches: true }), '6291234567894')).toEqual({ kind: 'none' });
  });

  it('resolveBarcode of 0012345678905 does not match 12345678905', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const created = dataOf(await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '0012345678905', level: 1 }] })));
    const unit = await prisma().phProductUnit.findFirstOrThrow({ where: { productId: created.id, level: 1 } });

    const db = scopedClient(prisma(), { restaurantId: a.id, allBranches: true });
    expect(await resolveBarcode(db, '12345678905')).toEqual({ kind: 'none' });
    expect(await resolveBarcode(db, '0012345678905')).toEqual({ kind: 'one', productId: created.id, unitId: unit.id });
    // A scanner in Arabic-Indic digits, with its Enter, finds it too.
    expect(await resolveBarcode(db, '٠٠١٢٣٤٥٦٧٨٩٠٥\r\n')).toEqual({ kind: 'one', productId: created.id, unitId: unit.id });
    expect(await resolveBarcode(db, '   ')).toEqual({ kind: 'none' });

    // The same digits without the zeros are another code: no BARCODE_IN_USE for them.
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { tradeName: 'Other', barcodes: [{ code: '12345678905', level: 1 }] })))).toBe('OK');
  });

  it('a stale expectedVersion is refused naming who changed it', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchId]] });
    const created = dataOf(await act(owner, productActions.create, panadol(a.id)));

    const saved = dataOf(
      await act(owner, productActions.update, { ...panadol(a.id, { manufacturer: 'Haleon' }), productId: created.id, expectedVersion: created.version }),
    );
    expect(saved.version).toBe(created.version + 1);

    const stale = await act(manager, productActions.update, { ...panadol(a.id, { form: 'caplet' }), productId: created.id, expectedVersion: created.version });
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { changedBy: 'owner person', changedAt: expect.any(String) } } });
    const row = await prisma().phProduct.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ manufacturer: 'Haleon', form: 'tablet', version: 2 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.product.update' } })).toBe(1);
  });

  it('a cashier cannot create a product and can list it', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });

    expect(codeOf(await act(cashier, productActions.create, panadol(a.id)))).toBe('FORBIDDEN');
    expect(await prisma().phProduct.count()).toBe(0);

    const created = dataOf(await act(owner, productActions.create, panadol(a.id)));
    expect(codeOf(await act(cashier, productActions.update, { ...panadol(a.id), productId: created.id, expectedVersion: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(await act(cashier, productActions.archive, { restaurantId: a.id, productId: created.id, expectedVersion: 1 }))).toBe('FORBIDDEN');

    const listed = dataOf(await ask(cashier, productQueries.list, { restaurantId: a.id }));
    expect(listed.items.map((p) => [p.id, p.tradeName, p.strength, p.packLabel])).toEqual([[created.id, 'Panadol', '500 mg', '30 box']]);
    const got = dataOf(await ask(cashier, productQueries.get, { restaurantId: a.id, productId: created.id }));
    expect(got.units).toHaveLength(3);

    // Another business's cashier sees nothing of it.
    const b = await pharmacy('B');
    const cashierB = await person('cashierB', { staff: [b.id, 'CASHIER', [b.branchId]] });
    expect(dataOf(await ask(cashierB, productQueries.list, { restaurantId: b.id })).items).toEqual([]);
    expect(codeOf(await ask(cashierB, productQueries.get, { restaurantId: b.id, productId: created.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(cashierB, productQueries.list, { restaurantId: a.id }))).toBe('FORBIDDEN');
  });

  it('an accountant sees cost fields and a cashier does not', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [a.branchId]] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    const created = dataOf(await act(owner, productActions.create, panadol(a.id)));

    const forAccountant = dataOf(await ask(accountant, productQueries.list, { restaurantId: a.id })).items[0]!;
    expect(forAccountant).toHaveProperty('cost');
    expect(forAccountant.cost).toEqual({ lastPurchaseMinor: null, currency: null });
    expect(dataOf(await ask(accountant, productQueries.get, { restaurantId: a.id, productId: created.id }))).toHaveProperty('cost');

    const forCashier = dataOf(await ask(cashier, productQueries.list, { restaurantId: a.id })).items[0]!;
    expect(forCashier.id).toBe(created.id);
    expect(forCashier).not.toHaveProperty('cost');
    expect(dataOf(await ask(cashier, productQueries.get, { restaurantId: a.id, productId: created.id }))).not.toHaveProperty('cost');
  });

  it('a support actor reads the catalog without cost fields and cannot write', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['catalog.read'] });
    const created = dataOf(await act(owner, productActions.create, panadol(a.id)));

    const listed = dataOf(await ask(admin, productQueries.list, { restaurantId: a.id })).items;
    expect(listed.map((p) => p.id)).toEqual([created.id]);
    expect(listed[0]).not.toHaveProperty('cost');
    expect(dataOf(await ask(admin, productQueries.get, { restaurantId: a.id, productId: created.id }))).not.toHaveProperty('cost');
    // Each read is audited by the framework; support never runs an action.
    expect(await prisma().auditLog.count({ where: { action: 'support.read', actorId: admin.userId } })).toBe(2);
    expect(codeOf(await act(admin, productActions.archive, { restaurantId: a.id, productId: created.id, expectedVersion: 1 }))).toBe('FORBIDDEN');
  });

  it('a branch manager of branch 1 cannot set branch settings for branch 2', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const [one, two] = a.branchIds as [string, string];
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [one]] });

    const refused = await act(manager, productActions.create, panadol(a.id, { branchSettings: [{ branchId: two, minQty: 5, reorderQty: 10 }] }));
    expect(codeOf(refused)).toBe('FORBIDDEN');
    expect(await prisma().phProduct.count()).toBe(0);

    const created = dataOf(await act(manager, productActions.create, panadol(a.id, { branchSettings: [{ branchId: one, minQty: 5, reorderQty: 10 }] })));
    const update = await act(manager, productActions.update, {
      ...panadol(a.id, { branchSettings: [{ branchId: two, minQty: 1, reorderQty: 2 }] }),
      productId: created.id,
      expectedVersion: created.version,
    });
    expect(codeOf(update)).toBe('FORBIDDEN');
    expect(await prisma().phProductBranch.count({ where: { branchId: two } })).toBe(0);

    // The owner sets branch 2; the manager still sees only branch 1's settings.
    dataOf(
      await act(owner, productActions.update, {
        ...panadol(a.id, { branchSettings: [{ branchId: two, minQty: 7, reorderQty: 14 }] }),
        productId: created.id,
        expectedVersion: created.version,
      }),
    );
    const seen = dataOf(await ask(manager, productQueries.get, { restaurantId: a.id, productId: created.id }));
    expect(seen.branchSettings).toEqual([{ branchId: one, minQty: 5, reorderQty: 10 }]);
    const ownerSees = dataOf(await ask(owner, productQueries.get, { restaurantId: a.id, productId: created.id }));
    expect(ownerSees.branchSettings).toHaveLength(2);
  });

  it('two simultaneous creates of the same product end with exactly one product', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const actor = await actorOf(owner);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => runAction(prisma(), actor, productActions.create, panadol(a.id), META)),
    );

    const products = await prisma().phProduct.findMany();
    expect(products).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const result of results.filter((r) => !r.ok)) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_PRODUCT', productId: products[0]!.id, productName: 'Panadol' } },
      });
    }
    expect(await prisma().phProductUnit.count()).toBe(3);
  });

  it('two simultaneous saves of different products with the same barcode end with one holder', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const actor = await actorOf(owner);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runAction(prisma(), actor, productActions.create, panadol(a.id, { tradeName: `Brand ${i}`, barcodes: [{ code: '6291234567894', level: 2 }] }), META),
      ),
    );

    const rows = await prisma().phBarcode.findMany({ where: { code: '6291234567894' }, include: { product: true } });
    expect(rows).toHaveLength(1);
    const winner = rows[0]!.product;
    expect(results.filter((r) => r.ok)).toEqual([{ ok: true, data: { id: winner.id, version: 1 } }]);
    for (const result of results.filter((r) => !r.ok)) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', fields: { phCode: 'BARCODE_IN_USE', productId: winner.id, productName: winner.tradeName } },
      });
    }
    expect(await prisma().phProduct.count()).toBe(1);

    // The same race, made certain: another save holds the code uncommitted while this one checks (finding nothing) and
    // then waits on the index; when the other commits, this one is refused naming it, never failing as an internal error.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const holding = new Promise<void>((resolve) => (inserted = resolve));
    const other = prisma().$transaction(
      async (tx) => {
        const product = await tx.phProduct.create({ data: { restaurantId: a.id, tradeName: 'Holder', identityKey: 'holder', searchText: searchTextOf({ tradeName: 'Holder', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }) }, select: { id: true } });
        const unit = await tx.phProductUnit.create({
          data: { restaurantId: a.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 },
          select: { id: true },
        });
        await tx.phBarcode.create({ data: { restaurantId: a.id, productId: product.id, unitId: unit.id, code: '5000000000001' } });
        inserted();
        await held;
        return product;
      },
      { timeout: 20_000 },
    );
    await holding;
    const losing = runAction(prisma(), actor, productActions.create, panadol(a.id, { tradeName: 'Late', barcodes: [{ code: '5000000000001', level: 0 }] }), META);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    const holder = await other;
    expect(await losing).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', fields: { phCode: 'BARCODE_IN_USE', productId: holder.id, productName: 'Holder', 'barcodes.0.code': expect.any(String) } },
    });
    expect(await prisma().phProduct.count({ where: { tradeName: 'Late' } })).toBe(0);
  });

  it('archive keeps the row and hides it from the default list', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const kept = dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: 'Brufen' })));
    const created = dataOf(await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '777', level: 0 }] })));

    const archived = dataOf(await act(owner, productActions.archive, { restaurantId: a.id, productId: created.id, expectedVersion: created.version }));
    expect(archived).toEqual({ id: created.id, version: created.version + 1, active: false });

    const row = await prisma().phProduct.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.active).toBe(false);
    expect(await prisma().phProductUnit.count({ where: { productId: created.id } })).toBe(3);
    expect(await prisma().auditLog.count({ where: { action: 'ph.product.archive', entityId: created.id } })).toBe(1);

    const ids = async (input: Record<string, unknown>) =>
      dataOf(await ask(owner, productQueries.list, { restaurantId: a.id, ...input })).items.map((p) => p.id);
    expect(await ids({})).toEqual([kept.id]);
    expect(await ids({ active: 'archived' })).toEqual([created.id]);
    expect((await ids({ active: 'all' })).sort()).toEqual([kept.id, created.id].sort());
    // An archived product's barcode no longer resolves at the till.
    expect(await resolveBarcode(scopedClient(prisma(), { restaurantId: a.id, allBranches: true }), '777')).toEqual({ kind: 'none' });
    // A stale archive is a conflict, not a second archive.
    const stale = await act(owner, productActions.archive, { restaurantId: a.id, productId: kept.id, expectedVersion: kept.version + 5 });
    expect(codeOf(stale)).toBe('CONFLICT');
  });

  it('pages the list with a bounded page size', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    for (const name of ['Alpha', 'Bravo', 'Charlie']) dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: name })));

    const first = dataOf(await ask(owner, productQueries.list, { restaurantId: a.id, pageSize: 2 }));
    expect(first.items.map((p) => p.tradeName)).toEqual(['Alpha', 'Bravo']);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(owner, productQueries.list, { restaurantId: a.id, pageSize: 2, cursor: first.nextCursor }));
    expect(second.items.map((p) => p.tradeName)).toEqual(['Charlie']);
    expect(second.nextCursor).toBeNull();
    expect(codeOf(await ask(owner, productQueries.list, { restaurantId: a.id, pageSize: 101 }))).toBe('INVALID');
  });

  it('every Ph model is a catalog model or wired into the stock guard', () => {
    // A unit's size and a product's archive are guarded against Phase 2 records (batches, sales). The guard reads the
    // models in PH_STOCK_RECORD_MODELS (none yet). A new Ph model must be added either to the catalog list below (it
    // holds no stock or sale of a unit) or to PH_STOCK_RECORD_MODELS, which fails closed until the guard reads it.
    const CATALOG = [
      'PhSettings',
      'PhStaff',
      'PhStaffBranch',
      'PhCategory',
      'PhProduct',
      'PhProductUnit',
      'PhBarcode',
      'PhProductBranch',
      'PhPrice',
      'PhPriceChangeBatch',
      'PhImportBatch',
      'PhImportRow',
    ];
    // Phase 3 sale records are self-contained: a sale line keeps its own qty AND baseQty, unit price and cost snapshot, so a later
    // resize of the unit or archive of the product changes nothing in them; a held cart is priced again when it is completed
    // (an archived product is refused then). They need no guard, which is a decision made here and not by omission.
    const SELF_CONTAINED_SALES = [
      'PhShift',
      'PhCashMovement',
      'PhSale',
      'PhSaleLine',
      'PhSaleLineAllocation',
      'PhPayment',
      'PhReturn',
      'PhReturnLine',
      'PhReceiptReprint',
    ];
    // Phase 4 purchasing records are self-contained too: a supplier, invoice, payment, allocation or credit note holds money
    // and no unit; an invoice line points at a received line, which keeps its own qty AND baseQty; a supplier return line is
    // in base units with its own cost copy. An order line names a product and a unit with the ordered count, and the
    // receipt that answers it keeps its own baseQty, so a later resize of the unit changes no stock or money already
    // booked. Decided here, not by omission.
    const SELF_CONTAINED_PURCHASING = [
      'PhSupplier',
      'PhPurchaseOrder',
      'PhPurchaseOrderLine',
      'PhSupplierInvoice',
      'PhSupplierInvoiceLine',
      'PhSupplierPayment',
      'PhSupplierPaymentAllocation',
      'PhSupplierReturn',
      'PhSupplierReturnLine',
      'PhCreditNote',
      'PhCreditAllocation',
    ];
    // Phase 5 intake records are self-contained: a row keeps what the AI read and what the reviewer made of it as JSON,
    // and a matched unit only names the product it was matched to; approval copies the values into a receipt line, which
    // keeps its own qty AND baseQty. The usage and call tables hold money and counts only. Decided here, not by omission.
    const SELF_CONTAINED_INTAKE = ['PhIntakeBatch', 'PhIntakeFile', 'PhIntakeRow', 'PhAiUsageMonth', 'PhAiCall', 'PhAiReservation'];
    // Phase 6 transfer records are self-contained: a line is in base units of the product it names and keeps its own sent,
    // received, lost and damaged counts, so a later resize of a unit or archive of the product changes nothing in a transfer
    // already made (an archived product is refused when a new transfer is requested). Decided here, not by omission.
    const SELF_CONTAINED_TRANSFERS = ['PhTransfer', 'PhTransferLine'];
    // The generated client's model names: the schema as the application sees it.
    const phModels = Object.values(Prisma.ModelName).filter((name) => /^Ph[A-Z]/.test(name));
    expect(phModels).toContain('PhProduct');
    const unclassified = phModels.filter((name) => !CATALOG.includes(name) && !SELF_CONTAINED_SALES.includes(name) && !SELF_CONTAINED_PURCHASING.includes(name) && !SELF_CONTAINED_INTAKE.includes(name) && !SELF_CONTAINED_TRANSFERS.includes(name) && !PH_STOCK_RECORD_MODELS.includes(name));
    expect(unclassified).toEqual([]);
  });
});

describe('the stock guards on a product', () => {
  const EXPIRY = new Date('2027-03-31T00:00:00.000Z');

  async function withBatch(stock: { available?: number; quarantine?: number }) {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const created = dataOf(await act(owner, productActions.create, panadol(a.id)));
    const units = await prisma().phProductUnit.findMany({ where: { productId: created.id }, orderBy: { level: 'asc' } });
    const batch = await prisma().phBatch.create({
      data: { restaurantId: a.id, productId: created.id, lot: 'L1', expiryDate: EXPIRY, unitCostMinor: 1000n, costCurrency: 'IQD', costUnitId: units[1]!.id },
    });
    await prisma().phStockBalance.create({
      data: { restaurantId: a.id, branchId: a.branchIds[1]!, productId: created.id, batchId: batch.id, available: stock.available ?? 0, quarantine: stock.quarantine ?? 0 },
    });
    return { a, owner, created, units };
  }

  it('refuses to archive a product that has stock in any bucket of any branch', async () => {
    for (const stock of [{ available: 4 }, { quarantine: 2 }]) {
      await resetWorld();
      const { a, owner, created } = await withBatch(stock);
      const result = await act(owner, productActions.archive, { restaurantId: a.id, productId: created.id, expectedVersion: created.version });
      expect(codeOf(result)).toBe('CONFLICT');
    }
  });

  it('archives a product whose batches are empty', async () => {
    const { a, owner, created } = await withBatch({});
    const result = await act(owner, productActions.archive, { restaurantId: a.id, productId: created.id, expectedVersion: created.version });
    expect(codeOf(result)).toBe('OK');
  });

  it('refuses to resize a unit that a batch was costed in', async () => {
    const { a, owner, created } = await withBatch({});
    const resized = LADDER.map((l) => (l.level === 1 ? { ...l, baseQty: 15 } : l));
    const result = await act(owner, productActions.update, { ...panadol(a.id, { levels: resized }), productId: created.id, expectedVersion: created.version });
    expect(codeOf(result)).toBe('CONFLICT');
  });
});
