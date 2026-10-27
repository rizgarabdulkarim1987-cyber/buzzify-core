import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { getCatalog, resolvePublicMenu } from '@/server/data/public-menu';
import { scopedClient } from '@/server/data/tenant-db';
import { effectivePermissions } from '@/server/domain/permissions';
import { resolveBarcode } from '@/server/pharmacy/barcodes';
import * as importActions from '@/server/pharmacy/actions/imports';
import * as productActions from '@/server/pharmacy/actions/products';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import * as productQueries from '@/server/pharmacy/queries/products';
import { readSheet } from '@/server/sheets/read';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as invitations from '@/server/studio/services/invitations';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture } from '../helpers/db';
import { asPh, DAY, GOOD, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

/**
 * Acceptance of phases 0 and 1 (spec section 12): one scenario per criterion, through the same actions, queries and
 * services the screens call. The detailed rules live in the per-task files; these scenarios are the owner's checklist.
 */

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('@/server/studio/services/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/studio/services/invitations')>();
  return { ...actual, createInvitation: vi.fn(actual.createInvitation) };
});

const META = { ip: '203.0.113.25', userAgent: 'vitest' };
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

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

/** A GS1 code with a correct check digit from its body (any length the check digit applies to). */
function withCheckDigit(body: string): string {
  const sum = [...body].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}
const ean13 = (n: number) => withCheckDigit(`629${String(n).padStart(9, '0')}`);

const HEAD = ['Trade name', 'Strength', 'Form', 'Manufacturer', 'Rx', 'Pack', 'Units per pack', 'Barcode', 'Price'];
const drug = (n: number, barcode = ean13(n)) => [`Drug ${n}`, '500 mg', 'tablet', 'ACME', 'OTC', 'box', '20', barcode, '1,250'];
const csvFile = (rows: string[][]) => ({
  fileName: 'list.csv',
  fileBase64: Buffer.from([HEAD, ...rows].map((r) => r.join(',')).join('\n'), 'utf8').toString('base64'),
});

type Preview = { batchId: string; batchHash: string; summary: { ok: number; warnings: number; errors: number; duplicates: number; rows: number } };

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  vi.mocked(invitations.createInvitation).mockClear();
});

describe('phase 0 acceptance', () => {
  it('a Super Admin creates a pharmacy with two branches and invites an owner, who then works in it', async () => {
    const root = await person('root', { superAdmin: true });
    const created = await act(root, restaurants.createRestaurant, {
      name: 'Rizgar Pharmacy',
      type: 'RESTAURANT',
      city: 'Erbil',
      sector: 'PHARMACY',
      branches: [{ name: 'Main', city: 'Erbil' }, { name: 'Ankawa' }],
      currencies: ['IQD', 'USD'],
      ownerEmail: 'boss@ph-test.example',
    });
    const { restaurantId } = dataOf(created as ActionResult<{ restaurantId: string }>);

    expect(await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).toMatchObject({ sector: 'PHARMACY', status: 'ACTIVE' });
    const branches = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    expect(branches.map((b) => b.name)).toEqual(['Main', 'Ankawa']);
    expect(await prisma().phSettings.findUniqueOrThrow({ where: { restaurantId } })).toMatchObject({ enabledCurrencies: ['IQD', 'USD'] });
    const invitation = await prisma().invitation.findFirstOrThrow({ where: { restaurantId } });
    expect(invitation).toMatchObject({ email: 'boss@ph-test.example', role: 'OWNER', invitedById: root.userId });

    // The invited person accepts the link and becomes the owner.
    const { url } = await vi.mocked(invitations.createInvitation).mock.results[0]!.value;
    const token = url.slice(url.lastIndexOf('/') + 1);
    const accepted = await invitations.acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Boss', password: GOOD, now: NOW });
    const owner: Person = { userId: accepted.userId, email: accepted.email };
    expect(await prisma().membership.findFirstOrThrow({ where: { userId: owner.userId, restaurantId } })).toMatchObject({ role: 'OWNER' });

    // The billing screens start the pharmacy subscription (Task 10); here it is written as they write it.
    await prisma().subscription.create({
      data: {
        restaurantId,
        applicationId: 'pharmacy',
        planCode: 'standard',
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(NOW.getTime() - 5 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() + 25 * DAY),
        graceDays: 7,
        version: 1,
      },
    });

    // The owner enters the pharmacy, sees both branches, and can write its catalog.
    const actor = await asPh(owner.userId, restaurantId, branches[1]!.id);
    expect(actor).toMatchObject({ restaurantId, role: 'OWNER', allBranches: true, viaMembership: true });
    expect([...actor!.branchIds].sort()).toEqual(branches.map((b) => b.id).sort());
    expect(codeOf(await act(owner, productActions.create, panadol(restaurantId)))).toBe('OK');
  });

  it('isolation by business, by branch and by permission holds, and a support grant reads without writing', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const [one, two] = a.branchIds as [string, string];
    const b = await pharmacy('B');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [one]] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [one]] });
    const product = dataOf(
      await act(
        owner,
        productActions.create,
        panadol(a.id, {
          branchSettings: [
            { branchId: one, minQty: 5, reorderQty: 10 },
            { branchId: two, minQty: 7, reorderQty: 14 },
          ],
        }),
      ),
    );

    // Business: B's owner cannot read A's catalog, by naming A or by naming A's product from B.
    expect(codeOf(await ask(ownerB, productQueries.list, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(ownerB, productQueries.get, { restaurantId: b.id, productId: product.id }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(ownerB, productQueries.list, { restaurantId: b.id })).items).toEqual([]);

    // Branch: the manager of branch one sees and changes only branch one.
    const seen = dataOf(await ask(manager, productQueries.get, { restaurantId: a.id, productId: product.id }));
    expect(seen.branchSettings).toEqual([{ branchId: one, minQty: 5, reorderQty: 10 }]);
    const update = await act(manager, productActions.update, {
      ...panadol(a.id, { branchSettings: [{ branchId: two, minQty: 1, reorderQty: 2 }] }),
      productId: product.id,
      expectedVersion: product.version,
    });
    expect(codeOf(update)).toBe('FORBIDDEN');
    const branchOne = scopedClient(prisma(), { restaurantId: a.id, branchIds: [one] });
    expect((await branchOne.phProductBranch.findMany({ select: { branchId: true } })).map((r) => r.branchId)).toEqual([one]);

    // Permission: a cashier reads and cannot write; a Super Admin without a grant gets nothing.
    expect(codeOf(await act(cashier, productActions.create, panadol(a.id, { strength: '1000 mg' })))).toBe('FORBIDDEN');
    expect(dataOf(await ask(cashier, productQueries.list, { restaurantId: a.id })).items.map((p) => p.id)).toEqual([product.id]);
    const support = await person('support', { superAdmin: true });
    expect(codeOf(await ask(support, productQueries.list, { restaurantId: a.id }))).toBe('FORBIDDEN');

    // The grant: support reads without cost, every read audited, and cannot write.
    await grant(support, a.id, { scopes: ['catalog.read'] });
    const listed = dataOf(await ask(support, productQueries.list, { restaurantId: a.id })).items;
    expect(listed.map((p) => p.id)).toEqual([product.id]);
    expect(listed[0]).not.toHaveProperty('cost');
    expect(await prisma().auditLog.count({ where: { action: 'support.read', actorId: support.userId, restaurantId: a.id } })).toBe(1);
    expect(codeOf(await act(support, productActions.archive, { restaurantId: a.id, productId: product.id, expectedVersion: 1 }))).toBe('FORBIDDEN');
    expect(await prisma().phProduct.count()).toBe(1);
  });
});

describe('phase 1 acceptance', () => {
  it('a product with another strength or pack is accepted; the same identity is refused', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const first = dataOf(await act(owner, productActions.create, panadol(a.id)));

    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { strength: '1000 mg' })))).toBe('OK');
    const bigBox = [...LADDER.slice(0, 2), { level: 2, label: 'box', baseQty: 100, sellable: true }];
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { levels: bigBox })))).toBe('OK');
    expect(codeOf(await act(owner, productActions.create, panadol(a.id, { form: 'syrup' })))).toBe('OK');

    // Case, Arabic digits, spacing and the unit's spelling do not make another product.
    const again = await act(owner, productActions.create, panadol(a.id, { tradeName: ' PANADOL ', strength: '٥٠٠ ملغ', manufacturer: 'gsk' }));
    expect(again).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'DUPLICATE_PRODUCT', productId: first.id } } });
    expect(await prisma().phProduct.count()).toBe(4);
  });

  it('a barcode keeps its leading zeros from import to scan to export', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const code = withCheckDigit('001234567890');
    expect(code).toBe('0012345678905');

    const pre = dataOf((await act(owner, importActions.preview, { restaurantId: a.id, ...csvFile([drug(1, code)]) })) as ActionResult<Preview>);
    expect(pre.summary).toMatchObject({ rows: 1, ok: 1, errors: 0, warnings: 0 });
    dataOf(await act(owner, importActions.apply, { restaurantId: a.id, batchId: pre.batchId, batchHash: pre.batchHash, acceptWarnings: false }));

    const stored = await prisma().phBarcode.findMany({ where: { restaurantId: a.id }, select: { code: true, productId: true, unitId: true } });
    expect(stored.map((b) => b.code)).toEqual(['0012345678905']);

    // A scan finds it in any digit script; the same digits without the zeros are another code.
    const db = scopedClient(prisma(), { restaurantId: a.id, allBranches: true });
    const hit = { kind: 'one', productId: stored[0]!.productId, unitId: stored[0]!.unitId };
    expect(await resolveBarcode(db, '0012345678905')).toEqual(hit);
    expect(await resolveBarcode(db, '٠٠١٢٣٤٥٦٧٨٩٠٥\r\n')).toEqual(hit);
    expect(await resolveBarcode(db, '12345678905')).toEqual({ kind: 'none' });

    // Both export formats write it as text, zeros included.
    for (const format of ['csv', 'xlsx'] as const) {
      const out = dataOf((await ask(owner, exportQueries.products, { restaurantId: a.id, format })) as ActionResult<{ base64: string }>);
      const sheet = await readSheet(new Uint8Array(Buffer.from(out.base64, 'base64')), { maxRows: 100 });
      expect(sheet.rows[0]![sheet.headers.indexOf('barcode')]).toBe('0012345678905');
    }
  });

  it('5,000 rows preview inside the 10-second budget', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const file = csvFile(Array.from({ length: 5_000 }, (_, i) => drug(i + 1)));

    const started = performance.now();
    const pre = dataOf((await act(owner, importActions.preview, { restaurantId: a.id, ...file })) as ActionResult<Preview>);
    const elapsed = performance.now() - started;
    expect(pre.summary).toMatchObject({ rows: 5_000, ok: 5_000, errors: 0 });
    expect(await prisma().phImportRow.count({ where: { batchId: pre.batchId } })).toBe(5_000);
    // Preview changes nothing in the catalog.
    expect(await prisma().phProduct.count()).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});

// Last: it swaps the global client for one that logs its queries.
describe('phase 0 acceptance: FOOD is unchanged', () => {
  const makeLogged = () =>
    new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event' as const, level: 'query' as const }] });
  let logged: ReturnType<typeof makeLogged>;
  const queries: string[] = [];

  beforeAll(async () => {
    await prisma().$disconnect();
    logged = makeLogged();
    logged.$on('query', (event) => queries.push(event.query));
    globalForPrisma.__prisma = logged;
  });
  afterAll(async () => {
    await logged.$disconnect();
    delete globalForPrisma.__prisma;
  });

  it('the FOOD golden suite is in place, an owner keeps the same rights, and the public menu touches no Ph table', async () => {
    const golden = resolve(process.cwd(), 'tests/pharmacy/golden-food.test.ts');
    expect(existsSync(golden)).toBe(true);
    const source = readFileSync(golden, 'utf8');
    for (const name of ['golden: permissions', 'golden: the Studio navigation', 'golden: the public menu']) expect(source).toContain(name);

    // The rights of a FOOD owner with no policy, as they were before the pharmacy plan.
    expect([...effectivePermissions({ isSuperAdmin: false, isPlatformOwner: false, role: 'OWNER', policy: {} })].sort()).toEqual([
      'content.availability',
      'content.edit',
      'content.media',
      'content.prices',
      'prices.bulk',
      'publish.now',
    ]);

    await createMenuFixture(logged, 'acceptance-food');
    queries.length = 0;
    const resolved = await resolvePublicMenu('acceptance-food');
    expect(resolved.kind).toBe('live');
    if (resolved.kind !== 'live') return;
    await getCatalog(resolved.tenant);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.filter((sql) => /"Ph[A-Z][A-Za-z]*"/.test(sql))).toEqual([]);
  });
});
