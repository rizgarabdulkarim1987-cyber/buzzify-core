import * as customerActions from '@/server/pharmacy/actions/customers';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';
import { grant, person, pharmacy, prisma, type Person } from './fixture';
import { act, ask, dataOf, makeBatch, makeProduct } from './stock-helpers';

/**
 * The world of the customer and credit tests (phase 7, task 3). Business A has two branches (b1, b2) and credit switched on; B is
 * another business. Product Panadol sells by the tablet at 100 IQD (1 USD cents: 100 = 1.00 USD) and by the strip of 10 at 900 IQD.
 * Everyone who can sell holds an open IQD shift at b1 (owner also at b2), except `usdSeller`, whose shift is in USD.
 */
export interface CreditWorld {
  a: { id: string; branchId: string; branchIds: string[] };
  b: { id: string; branchId: string };
  b1: string;
  b2: string;
  owner: Person;
  manager: Person;
  pic: Person;
  pharmacist: Person;
  /** A pharmacist who works at branch 2 only. */
  pharmacist2: Person;
  cashier: Person;
  stockClerk: Person;
  accountant: Person;
  usdSeller: Person;
  ownerB: Person;
  support: Person;
  p: { id: string; tablet: string; strip: string };
  batch1: string;
  batch2: string;
  shifts: Record<string, string>;
}

let seq = 0;
export const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

const setPrice = async (restaurantId: string, p: CreditWorld['p'], currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) => {
  for (const [unitId, amountMinor] of [[p.tablet, tablet], [p.strip, strip]] as const) {
    await prisma().phPrice.create({ data: { restaurantId, productId: p.id, unitId, branchId: null, currency, amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
};

export async function creditWorld(over: { creditEnabled?: boolean } = {}): Promise<CreditWorld> {
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const pic = await person('pic', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const pharmacist2 = await person('pharmacist2', { staff: [a.id, 'PHARMACIST', [b2]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const stockClerk = await person('stockclerk', { staff: [a.id, 'STOCK', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  const usdSeller = await person('usdseller', { staff: [a.id, 'PHARMACIST', [b1]] });
  const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
  const support = await person('support', { superAdmin: true });
  await grant(support, a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  await prisma().phSettings.create({ data: { restaurantId: a.id, creditEnabled: over.creditEnabled ?? true } });
  await prisma().phSettings.create({ data: { restaurantId: b.id } });
  const p = await makeProduct(a.id, 'Panadol');
  await setPrice(a.id, p, 'IQD', 100n, 900n);
  await setPrice(a.id, p, 'USD', 100n, 900n);
  const batch1 = await makeBatch(a.id, b1, p.id, { lot: 'L1', expiry: '2028-03-31', buckets: { available: 1000 } });
  const batch2 = await makeBatch(a.id, b2, p.id, { lot: 'L2', expiry: '2028-03-31', buckets: { available: 1000 } });
  const shifts: Record<string, string> = {};
  const open = async (label: string, who: Person, branchId: string, currency: 'IQD' | 'USD' = 'IQD') => {
    shifts[label] = (await prisma().phShift.create({ data: { restaurantId: a.id, branchId, userId: who.userId, currency, openingFloatMinor: 0n }, select: { id: true } })).id;
  };
  for (const [label, who] of [['owner', owner], ['manager', manager], ['pic', pic], ['pharmacist', pharmacist], ['cashier', cashier]] as const) await open(label, who, b1);
  await open('owner2', owner, b2);
  await open('pharmacist2', pharmacist2, b2);
  await open('usdSeller', usdSeller, b1, 'USD');
  return { a, b, b1, b2, owner, manager, pic, pharmacist, pharmacist2, cashier, stockClerk, accountant, usdSeller, ownerB, support, p, batch1, batch2, shifts };
}

/** A customer, made through the real action by the owner. */
export async function makeCustomer(w: CreditWorld, over: { name?: string; phone?: string; note?: string; limit?: bigint; currency?: 'IQD' | 'USD'; restaurantId?: string; who?: Person } = {}) {
  const made = dataOf(
    await act(over.who ?? w.owner, customerActions.create, {
      restaurantId: over.restaurantId ?? w.a.id,
      name: over.name ?? 'Layla Hassan',
      phone: over.phone ?? '0770 123 4567',
      note: over.note ?? 'pays on Fridays',
      creditLimitMinor: over.limit ?? 1_000_000n,
      currency: over.currency ?? 'IQD',
    }),
  );
  return made;
}

export const creditSale = (w: CreditWorld, customerId: string | undefined, creditMinor: bigint, over: Record<string, unknown> = {}, extraPayments: { method: string; amountMinor: bigint }[] = []) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('sale'),
  currency: 'IQD',
  // 100 IQD a tablet: qty = total / 100.
  lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: Number((creditMinor + extraPayments.reduce((s, p) => s + p.amountMinor, 0n)) / 100n) }],
  payments: [...extraPayments.map((p) => ({ ...p, clientKey: key('pay') })), { method: 'CREDIT', amountMinor: creditMinor, clientKey: key('pay') }],
  ...(customerId ? { customerId } : {}),
  ...over,
});

export const sellOnCredit = async (w: CreditWorld, who: Person, customerId: string, creditMinor: bigint, over: Record<string, unknown> = {}, extra: { method: string; amountMinor: bigint }[] = []) =>
  act(who, saleActions.create, creditSale(w, customerId, creditMinor, over, extra));

/** What a customer owes, from the ledger by independent SQL (never through the service). */
export async function balanceBySql(customerId: string): Promise<bigint> {
  // eslint-disable-next-line no-restricted-properties -- the test sums the ledger itself, to check the service against it
  const rows = await prisma().$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS s FROM "PhCustomerLedger" WHERE "customerId" = ${customerId}`;
  return rows[0]!.s ?? 0n;
}

/** The shift's cash figures as the shift page reads them. */
export async function shiftNow(w: CreditWorld, who: Person, branchId: string) {
  const r = dataOf(await ask(who, shiftQueries.current, { restaurantId: w.a.id, branchId })) as { totals: { expectedMinor: string; cash: Record<string, string>; payments: { method: string; amountMinor: string; count: number }[]; returns: { refundMinor: string; creditMinor: string; byMethod: { method: string; amountMinor: string }[] } } } | null;
  return r!.totals;
}
