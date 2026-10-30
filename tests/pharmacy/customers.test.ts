import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as creditSettingsActions from '@/server/pharmacy/actions/credit-settings';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as creditSettingsQueries from '@/server/pharmacy/queries/credit-settings';
import * as customerQueries from '@/server/pharmacy/queries/customers';
import { NOW, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';
import { balanceBySql, creditWorld, makeCustomer, sellOnCredit, type CreditWorld } from './credit-world';

/**
 * Customers (phase 7, task 3; R7-5): business-wide records with a currency, a credit limit and a balance that is the SUM of their
 * ledger rows. The phone and the note are shown to `customer.manage` only; a seller (`credit.sell`) sees name, limit and balance.
 */

type Row = { id: string; name: string; phone?: string | null; note?: string; creditLimitMinor: string; balanceMinor: string; availableMinor: string; active: boolean; version: number; currency: string };
type Page = { items: Row[]; nextCursor: string | null };

let w: CreditWorld;
const at = () => ({ restaurantId: w.a.id, branchId: w.b1 });

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  w = await creditWorld();
});
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('who may manage customers', () => {
  it('lets the owner, a branch manager, the pharmacist in charge and an accountant create one; refuses everyone else', async () => {
    const results: Record<string, string> = {};
    const roles: [string, Person][] = [
      ['owner', w.owner],
      ['manager', w.manager],
      ['pic', w.pic],
      ['accountant', w.accountant],
      ['pharmacist', w.pharmacist],
      ['cashier', w.cashier],
      ['stock', w.stockClerk],
      ['support', w.support],
    ];
    for (const [label, who] of roles) {
      results[label] = codeOf(await act(who, customerActions.create, { ...at(), name: `C ${label}`, creditLimitMinor: 1000n, currency: 'IQD' }));
    }
    expect(results).toEqual({ owner: 'OK', manager: 'OK', pic: 'OK', accountant: 'OK', pharmacist: 'FORBIDDEN', cashier: 'FORBIDDEN', stock: 'FORBIDDEN', support: 'FORBIDDEN' });
    expect(await prisma().phCustomer.count()).toBe(4);
  });

  it('lets a seller (credit.sell) and a manager list customers, but not a cashier, stock or support', async () => {
    await makeCustomer(w);
    const out: Record<string, string> = {};
    for (const [label, who] of [['owner', w.owner], ['pharmacist', w.pharmacist], ['accountant', w.accountant], ['cashier', w.cashier], ['stock', w.stockClerk], ['support', w.support]] as const) {
      out[label] = codeOf(await ask(who, customerQueries.list, at()));
    }
    expect(out).toEqual({ owner: 'OK', pharmacist: 'OK', accountant: 'OK', cashier: 'FORBIDDEN', stock: 'FORBIDDEN', support: 'FORBIDDEN' });
  });

  it('shows the phone and the note to customer.manage only', async () => {
    const c = await makeCustomer(w, { phone: '0770 999 8888', note: 'secret note' });
    const asManager = dataOf(await ask(w.accountant, customerQueries.list, at())) as Page;
    expect(asManager.items[0]).toMatchObject({ name: 'Layla Hassan', phone: '0770 999 8888', note: 'secret note' });
    const asSeller = dataOf(await ask(w.pharmacist, customerQueries.list, at())) as Page;
    expect(Object.keys(asSeller.items[0]!)).not.toContain('phone');
    expect(Object.keys(asSeller.items[0]!)).not.toContain('note');
    expect(JSON.stringify(asSeller)).not.toContain('0770 999 8888');
    const one = dataOf(await ask(w.pharmacist, customerQueries.get, { ...at(), customerId: c.id })) as Row;
    expect(JSON.stringify(one)).not.toContain('0770 999 8888');
    expect(JSON.stringify(one)).not.toContain('secret note');
    const search = dataOf(await ask(w.pharmacist, customerQueries.list, { ...at(), search: '999 8888' })) as Page;
    expect(search.items).toEqual([]);
    const searchManager = dataOf(await ask(w.accountant, customerQueries.list, { ...at(), search: '999 8888' })) as Page;
    expect(searchManager.items).toHaveLength(1);
  });

  it('keeps customers of another business out of sight: not found, never listed', async () => {
    const c = await makeCustomer(w);
    const other = await makeCustomer(w, { name: 'Other pharmacy customer', restaurantId: w.b.id, who: w.ownerB });
    const listed = dataOf(await ask(w.ownerB, customerQueries.list, { restaurantId: w.b.id })) as Page;
    expect(listed.items.map((i) => i.id)).toEqual([other.id]);
    expect(codeOf(await ask(w.ownerB, customerQueries.get, { restaurantId: w.b.id, customerId: c.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.ownerB, customerActions.update, { restaurantId: w.b.id, customerId: c.id, expectedVersion: 1, name: 'Hacked', creditLimitMinor: 1n }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.ownerB, customerActions.archive, { restaurantId: w.b.id, customerId: c.id, archived: true }))).toBe('NOT_FOUND');
    expect((await prisma().phCustomer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Layla Hassan');
  });
});

describe('creating, editing and archiving', () => {
  it('stores the customer business-wide with a clean name, a currency and a limit, and starts at version 1 and balance 0', async () => {
    const made = dataOf(await act(w.owner, customerActions.create, { ...at(), name: '  Layla   Hassan ', phone: '', creditLimitMinor: 250_000n, currency: 'IQD' }));
    expect(made).toMatchObject({ version: 1, active: true, currency: 'IQD', creditLimitMinor: '250000' });
    const row = await prisma().phCustomer.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ restaurantId: w.a.id, name: 'Layla Hassan', phone: null, creditLimitMinor: 250_000n });
    const got = dataOf(await ask(w.owner, customerQueries.get, { ...at(), customerId: made.id })) as Row;
    expect(got).toMatchObject({ balanceMinor: '0', availableMinor: '250000' });
  });

  it('refuses an empty name, a negative limit and a missing currency', async () => {
    for (const bad of [{ name: '   ' }, { creditLimitMinor: -1n }, { currency: 'EUR' }]) {
      const r = await act(w.owner, customerActions.create, { ...at(), name: 'X', creditLimitMinor: 1n, currency: 'IQD', ...bad });
      expect(codeOf(r), String(Object.keys(bad))).toBe('INVALID');
    }
    expect(await prisma().phCustomer.count()).toBe(0);
  });

  it('updates with the version it started from; a stale version is a conflict that changes nothing; the currency never changes', async () => {
    const c = await makeCustomer(w, { limit: 1000n });
    const saved = dataOf(await act(w.manager, customerActions.update, { ...at(), customerId: c.id, expectedVersion: 1, name: 'Layla H.', creditLimitMinor: 2000n, currency: 'USD' }));
    expect(saved.version).toBe(2);
    const row = await prisma().phCustomer.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ name: 'Layla H.', creditLimitMinor: 2000n, currency: 'IQD', version: 2 });
    const stale = await act(w.manager, customerActions.update, { ...at(), customerId: c.id, expectedVersion: 1, name: 'Late', creditLimitMinor: 5n });
    expect(codeOf(stale)).toBe('CONFLICT');
    expect((await prisma().phCustomer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Layla H.');
  });

  it('archives and restores, hides the archived from the default list, and an unchanged archive writes no audit row', async () => {
    const c = await makeCustomer(w);
    expect(dataOf(await act(w.owner, customerActions.archive, { ...at(), customerId: c.id, archived: true }))).toMatchObject({ active: false, version: 2 });
    const before = await prisma().auditLog.count({ where: { action: 'ph.customer.archive' } });
    expect(dataOf(await act(w.owner, customerActions.archive, { ...at(), customerId: c.id, archived: true }))).toMatchObject({ active: false, version: 2 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.customer.archive' } })).toBe(before);
    expect(((dataOf(await ask(w.owner, customerQueries.list, at())) as Page).items)).toEqual([]);
    expect(((dataOf(await ask(w.owner, customerQueries.list, { ...at(), active: false })) as Page).items.map((i) => i.id))).toEqual([c.id]);
    expect(((dataOf(await ask(w.owner, customerQueries.list, { ...at(), active: 'all' })) as Page).items)).toHaveLength(1);
    expect(dataOf(await act(w.owner, customerActions.archive, { ...at(), customerId: c.id, archived: false }))).toMatchObject({ active: true });
  });

  it('writes audit rows with ids, currency, limit and version only: never the name, phone or note', async () => {
    const c = await makeCustomer(w, { name: 'Zainab Karim', phone: '0771 555 0000', note: 'diabetic, owes for insulin' });
    await act(w.owner, customerActions.update, { ...at(), customerId: c.id, expectedVersion: 1, name: 'Zainab K', phone: '0771 555 0001', creditLimitMinor: 9n, note: 'new private note' });
    await act(w.owner, customerActions.archive, { ...at(), customerId: c.id, archived: true });
    const rows = await prisma().auditLog.findMany({ where: { entityType: 'PhCustomer' } });
    expect(rows.length).toBe(3);
    const text = JSON.stringify(rows.map((r) => r.changes));
    for (const secret of ['Zainab', '0771', 'diabetic', 'insulin', 'private note']) expect(text).not.toContain(secret);
    expect(text).toContain('creditLimitMinor');
  });
});

describe('the balance is the sum of the ledger', () => {
  it('reads limit, balance and room from the ledger: a 100 000 limit with 30 000 + 20 000 sold has 50 000 owed and 50 000 left', async () => {
    const c = await makeCustomer(w, { limit: 100_000n });
    dataOf(await sellOnCredit(w, w.pharmacist, c.id, 30_000n));
    dataOf(await sellOnCredit(w, w.manager, c.id, 20_000n));
    const got = dataOf(await ask(w.pharmacist, customerQueries.get, { ...at(), customerId: c.id })) as Row;
    expect(got).toMatchObject({ balanceMinor: '50000', availableMinor: '50000', creditLimitMinor: '100000' });
    expect(await balanceBySql(c.id)).toBe(50_000n);
    const owing = dataOf(await ask(w.owner, customerQueries.list, { ...at(), owingOnly: true })) as Page;
    expect(owing.items.map((i) => i.id)).toEqual([c.id]);
  });

  it('lists only customers who owe something with owingOnly, and pages by name', async () => {
    const a = await makeCustomer(w, { name: 'Amal' });
    await makeCustomer(w, { name: 'Basma' });
    dataOf(await sellOnCredit(w, w.pharmacist, a.id, 1000n));
    expect(((dataOf(await ask(w.owner, customerQueries.list, { ...at(), owingOnly: true })) as Page).items.map((i) => i.name))).toEqual(['Amal']);
    expect(((dataOf(await ask(w.owner, customerQueries.list, at())) as Page).items.map((i) => i.name))).toEqual(['Amal', 'Basma']);
  });
});

describe('the credit switch', () => {
  it('is the owner’s alone, off in a new business, and saved with the version it started from', async () => {
    const got = dataOf(await ask(w.cashier, creditSettingsQueries.get, at())) as { creditEnabled: boolean; version: number };
    expect(got.creditEnabled).toBe(true);
    expect(codeOf(await act(w.manager, creditSettingsActions.set, { ...at(), creditEnabled: false, version: got.version }))).toBe('FORBIDDEN');
    expect(dataOf(await act(w.owner, creditSettingsActions.set, { ...at(), creditEnabled: false, version: got.version }))).toMatchObject({ creditEnabled: false, version: got.version + 1 });
    expect(codeOf(await act(w.owner, creditSettingsActions.set, { ...at(), creditEnabled: true, version: got.version }))).toBe('CONFLICT');
    expect((await prisma().phSettings.findFirstOrThrow({ where: { restaurantId: w.a.id } })).creditEnabled).toBe(false);
    const c = await makeCustomer(w);
    expect(phCodeOf(await sellOnCredit(w, w.pharmacist, c.id, 1000n))).toBe('CREDIT_NOT_ENABLED');
  });
});
