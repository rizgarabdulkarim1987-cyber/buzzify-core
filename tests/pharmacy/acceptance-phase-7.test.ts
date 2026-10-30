import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/pharmacy/rx-attachments/[id]/route';
import * as assistantActions from '@/server/pharmacy/actions/assistant';
import * as controlledSettings from '@/server/pharmacy/actions/controlled-settings';
import * as creditSettings from '@/server/pharmacy/actions/credit-settings';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as rxActions from '@/server/pharmacy/actions/prescriptions';
import * as saleActions from '@/server/pharmacy/actions/sales';
import { ask as askAssistant, type AskEnv, type AssistantAnswer } from '@/server/pharmacy/assistant/assistant';
import { withIntakeStorage } from '@/server/pharmacy/intake/storage';
import * as assistantQueries from '@/server/pharmacy/queries/assistant';
import * as customerQueries from '@/server/pharmacy/queries/customers';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';
import { phScopedClient } from '@/server/studio/framework/access';
import { assistantWorld, HOSTILE, scripted, text, tools, type AssistantWorld } from './assistant-mock';
import { asPh, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { memoryIntakeStorage } from './intake-helpers';
import { shift } from './reports-world';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- answers are read off the wire and checked by value */
/* eslint-disable no-restricted-properties -- the independent checks of this file are SQL written here, over the tables, on purpose */

/**
 * Acceptance of phase 7 (spec section 12, row 7): "no fabrication; no permission bypass; a prescription attachment cannot be
 * read without `rx.attachment.view`". Everything goes through the same actions and queries the screens call, with a SCRIPTED model
 * (no real model exists anywhere in the phase). The independent side is plain SQL written in this file.
 *
 * THE WORLD. The report world with one sale (assistant-mock.ts: batches expiring X 2026-11-20, Z expired 2026-10-01, the hostile
 * product's 2026-11-10, a customer with a phone number, a prescription with a patient name) and, added here, in business A:
 *   R (Morphex, RESTRICTED, 100 IQD a tablet): lot L1 15 tablets (expires 2027-01-31) and lot L2 40 (2028-03-31) at branch 1. 55 received.
 *   Controlled sales on (limit 30 tablets a sale), credit on. P (Panadol) sells at 100 IQD and 1.00 USD (100 minor) a tablet.
 *
 * CONTROLLED REGISTER (hand figures). S1: 20 tablets on prescription 1 = 15 from L1 + 5 from L2, 2,000 IQD. S2: 10 tablets on
 * prescription 2 = 10 from L2. 12 of S1 come back; S2 is cancelled. Dispensed net: 30 -> 18 -> 8 (S1 8, S2 0). Held = 55 - 8 = 47.
 *
 * CREDIT (hand figures). Customer CI (IQD): CS1 5,000 wholly on credit; CS2 3,000 = 1,000 cash + 2,000 credit (7,000 owed); pays 1,500
 * cash and 800 by card (4,700); the card payment is corrected (+800 = 5,500); 10 of CS1's tablets come back, 1,000 off the debt:
 * 4,500. Customer CU (USD): 20 tablets = 20.00 USD on credit, 5.00 USD paid by transfer: 15.00 USD (1,500 minor). 4,500 IQD and
 * 1,500 USD-minor are never added together.
 */

vi.mock('@/server/studio/auth/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/studio/auth/actor')>();
  const { getPrisma } = await import('@/server/data/prisma');
  return {
    ...original,
    actorFromHeaders: async (_prisma: unknown, headers: Headers) => {
      const id = headers.get('x-test-user');
      return id ? original.loadActor(getPrisma(), id) : null;
    },
  };
});

let seq = 0;
const key = (label: string) => `acc7-${label}-${(seq += 1)}-${'x'.repeat(8)}`;

/** Words that belong to a patient, a prescriber, a customer, a phone or free text: none may reach an audit row or a model. */
const SECRETS = {
  prescriber: 'Dr Strange',
  patient: 'Layla Hassan Patient',
  idNote: 'National ID: 4821',
  rx1: 'AB 1234',
  rx2: 'AB 5678',
  customer: 'Zahra Customer Alpha',
  phone: '0770 555 0199',
  customerNote: 'pays on Fridays only',
  question: 'QZX-question-token',
};

let w: AssistantWorld;
let restore: () => void;
let storage: ReturnType<typeof memoryIntakeStorage>;
let support: Person;
let ownerB: Person;
let otherId: string;
let R: { id: string; tablet: string; strip: string };
let L1: string;
let L2: string;
const place = (branchId?: string) => ({ restaurantId: w.a.id, ...(branchId ? { branchId } : {}) });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('acceptance bytes of the paper prescription', 'utf8')]);

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await assistantWorld();
  storage = memoryIntakeStorage();
  restore = withIntakeStorage(storage);
  await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { controlledEnabled: true, controlledMaxQty: 30, creditEnabled: true } });
  R = await makeProduct(w.a.id, 'Morphex');
  await prisma().phProduct.update({ where: { id: R.id }, data: { rxLevel: 'RESTRICTED' } });
  await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: R.id, unitId: R.tablet, branchId: null, currency: 'IQD', amountMinor: 100n, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  L1 = await makeBatch(w.a.id, w.b1, R.id, { lot: 'RL1', expiry: '2027-01-31', buckets: { available: 15 } });
  L2 = await makeBatch(w.a.id, w.b1, R.id, { lot: 'RL2', expiry: '2028-03-31', buckets: { available: 40 } });
  await shift(w.a.id, w.b1, w.pharmacist);
  await shift(w.a.id, w.b1, w.pic, 'USD');
  support = await person('supportAcc7', { superAdmin: true });
  await grant(support, w.a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  const other = await pharmacy('Other7', { branches: 1 });
  otherId = other.id;
  ownerB = await person('ownerB7', { membership: [other.id, 'OWNER'] });
}, 240_000);

afterAll(() => {
  restore?.();
  vi.useRealTimers();
});

// --- Independent SQL ------------------------------------------------------------------------------------------------------------------------

type PerBatch = Record<string, number>;
const perBatch = (rows: Array<{ batchId: string; n: bigint }>): PerBatch => Object.fromEntries(rows.map((r) => [r.batchId, Number(r.n)]));

/** The register, summed per batch and per sale, straight from the table. */
const registerSql = async () => ({
  byBatch: perBatch(await prisma().$queryRaw`SELECT "batchId", SUM("baseQty")::bigint AS n FROM "PhControlledEntry" WHERE "restaurantId" = ${w.a.id} GROUP BY "batchId"`),
  bySale: Object.fromEntries((await prisma().$queryRaw<Array<{ saleId: string; n: bigint }>>`SELECT "saleId", SUM("baseQty")::bigint AS n FROM "PhControlledEntry" WHERE "restaurantId" = ${w.a.id} GROUP BY "saleId"`).map((r) => [r.saleId, Number(r.n)])),
  rows: Number((await prisma().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "PhControlledEntry" WHERE "restaurantId" = ${w.a.id}`)[0]!.n),
});
/** What the sales themselves say was dispensed of R and not brought back: allocations less returned units, per batch. */
const dispensedBySales = async () =>
  perBatch(await prisma().$queryRaw`SELECT a."batchId", SUM(a."baseQty" - a."returnedBaseQty")::bigint AS n FROM "PhSaleLineAllocation" a JOIN "PhSaleLine" l ON l."id" = a."saleLineId" WHERE a."restaurantId" = ${w.a.id} AND l."productId" = ${R.id} GROUP BY a."batchId"`);
const heldSql = async () =>
  Number((await prisma().$queryRaw<{ n: bigint | null }[]>`SELECT SUM("available" + "reserved" + "quarantine" + "damaged")::bigint AS n FROM "PhStockBalance" WHERE "restaurantId" = ${w.a.id} AND "batchId" IN (${L1}, ${L2})`)[0]!.n ?? 0n);
const receivedSql = async () =>
  Number((await prisma().$queryRaw<{ n: bigint | null }[]>`SELECT SUM("availableDelta")::bigint AS n FROM "PhStockMovement" WHERE "restaurantId" = ${w.a.id} AND "type" = 'RECEIPT' AND "batchId" IN (${L1}, ${L2})`)[0]!.n ?? 0n);
const total = (m: PerBatch) => Object.values(m).reduce((n, v) => n + v, 0);

/** What every customer owes, per currency, from the sales, the payments, the corrections and the returns (never the ledger). */
async function owedSql(customerId: string): Promise<bigint> {
  const sum = async (rows: Promise<Array<{ n: bigint | null }>>) => (await rows)[0]!.n ?? 0n;
  const charged = await sum(prisma().$queryRaw`SELECT SUM(p."amountMinor")::bigint AS n FROM "PhPayment" p JOIN "PhSale" s ON s."id" = p."saleId" WHERE s."customerId" = ${customerId} AND p."method" = 'CREDIT'`);
  const paid = await sum(prisma().$queryRaw`SELECT SUM("amountMinor")::bigint AS n FROM "PhCustomerPayment" WHERE "customerId" = ${customerId} AND "reversesId" IS NULL`);
  const corrected = await sum(prisma().$queryRaw`SELECT SUM("amountMinor")::bigint AS n FROM "PhCustomerPayment" WHERE "customerId" = ${customerId} AND "reversesId" IS NOT NULL`);
  const refunded = await sum(prisma().$queryRaw`SELECT SUM(r."creditMinor")::bigint AS n FROM "PhReturn" r JOIN "PhSale" s ON s."id" = r."saleId" WHERE s."customerId" = ${customerId}`);
  return charged - paid + corrected - refunded;
}
const owedByCurrencySql = async () =>
  Object.fromEntries(
    (await prisma().$queryRaw<Array<{ currency: string; n: bigint }>>`SELECT "currency"::text AS currency, SUM("amountMinor")::bigint AS n FROM "PhCustomerLedger" WHERE "restaurantId" = ${w.a.id} AND "customerId" IN (SELECT "id" FROM "PhCustomer" WHERE "restaurantId" = ${w.a.id} AND "name" IN (${SECRETS.customer}, 'Customer Dollar')) GROUP BY "currency"`).map((r) => [r.currency, r.n]),
  );
const writes = async () => ({
  sales: await prisma().phSale.count(),
  movements: await prisma().phStockMovement.count(),
  register: await prisma().phControlledEntry.count(),
  ledger: await prisma().phCustomerLedger.count(),
  customerPayments: await prisma().phCustomerPayment.count(),
  transfers: await prisma().phTransfer.count(),
  orders: await prisma().phPurchaseOrder.count(),
  supplierReturns: await prisma().phSupplierReturn.count(),
  receipts: await prisma().phReceipt.count(),
  proposals: await prisma().phAiProposal.count(),
  prescriptions: await prisma().phPrescription.count(),
});

// --- Steps ----------------------------------------------------------------------------------------------------------------------------------

const newRx = async (number: string, who: Person = w.pharmacist) =>
  dataOf(await act(who, rxActions.create, { ...place(w.b1), clientKey: key('rx'), number, prescriberName: SECRETS.prescriber, patientName: SECRETS.patient, patientIdNote: SECRETS.idNote, issuedOn: '2026-10-20' })).id as string;
const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const sellR = (who: Person, qty: number, prescriptionId: string | undefined, over: Record<string, unknown> = {}) =>
  act(who, saleActions.create, { ...place(w.b1), clientKey: key('sale'), currency: 'IQD', lines: [{ productId: R.id, unitId: R.tablet, qty }], payments: [cash(BigInt(qty) * 100n)], ...(prescriptionId ? { prescriptionId } : {}), ...over });
const sellP = (who: Person, currency: 'IQD' | 'USD', qty: number, payments: unknown[], customerId?: string) =>
  act(who, saleActions.create, { ...place(w.b1), clientKey: key('sale'), currency, lines: [{ productId: w.P.id, unitId: w.P.tablet, qty }], payments, ...(customerId ? { customerId } : {}) });
const credit = (amountMinor: bigint) => ({ method: 'CREDIT', amountMinor, clientKey: key('pay') });
const lineOf = async (saleId: string) => (await prisma().phSaleLine.findFirstOrThrow({ where: { saleId }, select: { id: true } })).id;
const customer = async (name: string, currency: 'IQD' | 'USD', limit: bigint, who: Person = w.owner) =>
  dataOf(await act(who, customerActions.create, { ...place(w.b1), name, phone: SECRETS.phone, note: SECRETS.customerNote, creditLimitMinor: limit, currency })).id as string;
const pay = (who: Person, customerId: string, method: 'CASH' | 'CARD' | 'TRANSFER', amountMinor: bigint) =>
  act(who, customerActions.pay, { ...place(w.b1), customerId, method, amountMinor, clientKey: key('cpay') });

const S: Record<string, string> = {};

// ==========================================================================================================================================
describe('controlled drugs: the register nets with sales and returns', () => {
  it('refuses, and writes nothing, a cashier, a sale without a prescription, a sale over the limit and support', async () => {
    const rx = await newRx(SECRETS.rx1);
    S.rx1 = rx;
    const before = await writes();
    const cashier = await sellR(w.cashier1, 5, rx);
    expect([codeOf(cashier), phCodeOf(cashier)]).toEqual(['INVALID', 'RX_NEEDS_PHARMACIST']);
    const none = await sellR(w.pharmacist, 5, undefined);
    expect([codeOf(none), phCodeOf(none)]).toEqual(['INVALID', 'PRESCRIPTION_REQUIRED']);
    const over = await sellR(w.pharmacist, 31, rx);
    expect([codeOf(over), phCodeOf(over)]).toEqual(['CONFLICT', 'CONTROLLED_QTY_LIMIT']);
    expect(codeOf(await sellR(support, 5, rx))).toBe('FORBIDDEN');
    expect(await writes()).toEqual(before);
  });

  it('is off until the owner switches it on: with the switch off even a pharmacist with a prescription is refused', async () => {
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { controlledEnabled: false } });
    const off = await sellR(w.pharmacist, 5, S.rx1);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { controlledEnabled: true } });
    expect([codeOf(off), phCodeOf(off)]).toEqual(['CONFLICT', 'RESTRICTED_NOT_AVAILABLE']);
    expect((await registerSql()).rows).toBe(0);
  });

  it('S1: 20 tablets on prescription 1 are 15 from L1 and 5 from L2 in the register, and the sales table says the same', async () => {
    const sold = dataOf(await sellR(w.pharmacist, 20, S.rx1));
    S.s1 = sold.id;
    expect(sold).toMatchObject({ status: 'COMPLETED', totalMinor: '2000' });
    const reg = await registerSql();
    expect(reg.byBatch).toEqual({ [L1]: 15, [L2]: 5 });
    expect(reg.bySale).toEqual({ [S.s1!]: 20 });
    expect(await dispensedBySales()).toEqual(reg.byBatch);
  });

  it('S2: 10 more tablets on prescription 2 (the same prescription cannot serve a second sale)', async () => {
    S.rx2 = await newRx(SECRETS.rx2);
    const again = await sellR(w.pharmacist, 5, S.rx1);
    expect(codeOf(again)).not.toBe('OK');
    S.s2 = dataOf(await sellR(w.pharmacist, 10, S.rx2)).id;
    const reg = await registerSql();
    expect(reg.byBatch).toEqual({ [L1]: 15, [L2]: 15 });
    expect(total(reg.byBatch)).toBe(30);
    expect(await dispensedBySales()).toEqual(reg.byBatch);
  });

  it('a return of 12 of S1 and the cancellation of S2 bring the register to 8 dispensed, batch by batch, and every unit is accounted for', async () => {
    const lineId = await lineOf(S.s1!);
    dataOf(await act(w.manager1, returnActions.create, { ...place(w.b1), saleId: S.s1, lines: [{ saleLineId: lineId, baseQty: 12 }], reason: 'Customer changed their mind', clientKey: key('ret') }));
    let reg = await registerSql();
    expect(total(reg.byBatch)).toBe(18);
    dataOf(await act(w.manager1, returnActions.cancel, { ...place(w.b1), saleId: S.s2, reason: 'entered by mistake', refundMethod: 'CASH', clientKey: key('can') }));
    reg = await registerSql();
    expect(total(reg.byBatch)).toBe(8);
    expect(reg.bySale).toEqual({ [S.s1!]: 8, [S.s2!]: 0 });
    // The register is the sales' own account of what left, batch by batch.
    expect(reg.byBatch).toEqual(await dispensedBySales());
    // Nothing vanished: received 55 = held 47 (the returned units wait in quarantine) + 8 dispensed.
    expect(await receivedSql()).toBe(55);
    expect(await heldSql()).toBe(47);
    expect((await receivedSql()) - (await heldSql())).toBe(total(reg.byBatch));
    // 3 sale rows (S1 two batches, S2 one) and the rows that reversed them.
    expect(await prisma().phControlledEntry.count({ where: { kind: 'SALE' } })).toBe(3);
  });

  it('is append-only: the database itself refuses to change or delete a register row', async () => {
    const before = await registerSql();
    await expect(prisma().$executeRaw`UPDATE "PhControlledEntry" SET "baseQty" = 0 WHERE "restaurantId" = ${w.a.id}`).rejects.toThrow();
    await expect(prisma().$executeRaw`DELETE FROM "PhControlledEntry" WHERE "restaurantId" = ${w.a.id}`).rejects.toThrow();
    expect(await registerSql()).toEqual(before);
  });
});

// ==========================================================================================================================================
describe('credit: the balance is credit sales minus payments plus corrections minus returns, per currency', () => {
  it('only a person with credit.sell may sell on credit, only customer.manage may make a customer or take a payment', async () => {
    const ci = await customer(SECRETS.customer, 'IQD', 1_000_000n);
    S.ci = ci;
    const before = await writes();
    const refusals = [
      // credit.sell: cashier, stock clerk, accountant; support has no role at all
      await sellP(w.cashier1, 'IQD', 5, [credit(500n)], ci),
      await sellP(w.stockP, 'IQD', 5, [credit(500n)], ci),
      await sellP(w.accountant, 'IQD', 5, [credit(500n)], ci),
      await sellP(support, 'IQD', 5, [credit(500n)], ci),
      // customer.manage: pharmacist, cashier, stock clerk, support
      await act(w.pharmacist, customerActions.create, { ...place(w.b1), name: 'X Y', creditLimitMinor: 1000n, currency: 'IQD' }),
      await act(w.cashier1, customerActions.create, { ...place(w.b1), name: 'X Y', creditLimitMinor: 1000n, currency: 'IQD' }),
      await pay(w.pharmacist, ci, 'CARD', 100n),
      await pay(w.cashier1, ci, 'CARD', 100n),
      await pay(w.stockP, ci, 'CARD', 100n),
      await pay(support, ci, 'CARD', 100n),
    ];
    expect(refusals.map(codeOf)).toEqual(Array(refusals.length).fill('FORBIDDEN'));
    expect(await writes()).toEqual(before);
  });

  it('IQD customer: 7,000 sold on credit, 1,500 cash and 800 card paid, the card payment corrected, 1,000 off by a return: 4,500', async () => {
    const ci = S.ci!;
    S.cs1 = dataOf(await sellP(w.pharmacist, 'IQD', 50, [credit(5000n)], ci)).id;
    S.cs2 = dataOf(await sellP(w.pharmacist, 'IQD', 30, [cash(1000n), credit(2000n)], ci)).id;
    expect(await owedSql(ci)).toBe(7000n);
    dataOf(await pay(w.manager1, ci, 'CASH', 1500n));
    const card = dataOf(await pay(w.accountant, ci, 'CARD', 800n));
    expect(await owedSql(ci)).toBe(4700n);
    dataOf(await act(w.accountant, customerActions.reverse, { ...place(w.b1), paymentId: card.id, clientKey: key('rev') }));
    expect(await owedSql(ci)).toBe(5500n);
    const back = dataOf(await act(w.manager1, returnActions.create, { ...place(w.b1), saleId: S.cs1, lines: [{ saleLineId: await lineOf(S.cs1!), baseQty: 10 }], reason: 'Customer changed their mind', clientKey: key('ret') }));
    expect(back).toMatchObject({ refundMinor: '1000', creditMinor: '1000' });
    // Hand figure, independent SQL over the sales/payments/returns, and the ledger the service keeps: all 4,500.
    expect(await owedSql(ci)).toBe(4500n);
    const ledger = (await prisma().$queryRaw<{ n: bigint }[]>`SELECT SUM("amountMinor")::bigint AS n FROM "PhCustomerLedger" WHERE "customerId" = ${ci}`)[0]!.n;
    expect(ledger).toBe(4500n);
  });

  it('what the service reports (statement, list) is the same 4,500', async () => {
    const statement = dataOf(await ask(w.owner, customerQueries.statement, { ...place(w.b1), customerId: S.ci, from: '2026-10-01', to: '2026-10-31' })) as any;
    expect(statement.closingMinor).toBe('4500');
    expect(statement.customer.currency).toBe('IQD');
    const listed = (dataOf(await ask(w.owner, customerQueries.list, place(w.b1))) as any).items.find((c: any) => c.id === S.ci);
    expect(String(listed.balanceMinor)).toBe('4500');
  });

  it('USD customer: 20.00 USD on credit and 5.00 USD paid is 15.00 USD, apart from the 4,500 IQD', async () => {
    S.cu = await customer('Customer Dollar', 'USD', 100_000n);
    dataOf(await sellP(w.pic, 'USD', 20, [credit(2000n)], S.cu));
    dataOf(await pay(w.accountant, S.cu, 'TRANSFER', 500n));
    expect(await owedSql(S.cu)).toBe(1500n);
    expect(await owedByCurrencySql()).toEqual({ IQD: 4500n, USD: 1500n });
    const ageing = dataOf(await ask(w.owner, customerQueries.ageing, { ...place(w.b1), asOf: '2026-10-31' })) as any;
    expect(ageing.totals.map((t: any) => [t.currency, t.owedMinor]).sort()).toEqual([['IQD', '4500'], ['USD', '1500']]);
    // No figure adds the two currencies up (6,000 appears nowhere).
    expect(JSON.stringify(ageing)).not.toContain('6000');
  });

  it('never converts: a USD sale on an IQD customer and an IQD sale on a USD customer are refused, and so is a sale over the limit', async () => {
    const small = await customer('Customer Small', 'IQD', 1000n);
    const before = await writes();
    const usdOnIqd = await sellP(w.pic, 'USD', 5, [credit(500n)], S.ci);
    const iqdOnUsd = await sellP(w.pharmacist, 'IQD', 5, [credit(500n)], S.cu);
    const over = await sellP(w.pharmacist, 'IQD', 11, [credit(1100n)], small);
    expect([usdOnIqd, iqdOnUsd, over].map((r) => [codeOf(r), phCodeOf(r)])).toEqual([
      ['CONFLICT', 'CUSTOMER_CURRENCY'],
      ['CONFLICT', 'CUSTOMER_CURRENCY'],
      ['CONFLICT', 'CREDIT_LIMIT_EXCEEDED'],
    ]);
    expect(await writes()).toEqual(before);
    expect(await owedByCurrencySql()).toEqual({ IQD: 4500n, USD: 1500n });
  });

  it('is off until the owner switches it on: credit is refused with the switch off', async () => {
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { creditEnabled: false } });
    const before = await writes();
    const off = await sellP(w.pharmacist, 'IQD', 5, [credit(500n)], S.ci);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { creditEnabled: true } });
    expect(codeOf(off)).not.toBe('OK');
    expect(await writes()).toEqual(before);
  });
});

// ==========================================================================================================================================
describe('a prescription attachment cannot be read without rx.attachment.view', () => {
  const url = (id: string, restaurantId: string) => `http://localhost/api/pharmacy/rx-attachments/${id}?restaurantId=${restaurantId}&branchId=${w.b1}`;
  const get = (id: string, who?: Person, restaurantId = w.a.id) =>
    GET(new Request(url(id, restaurantId), { headers: who ? { 'x-test-user': who.userId } : {} }), { params: Promise.resolve({ id }) });
  const readQuery = (who: Person, restaurantId = w.a.id) => ask(who, rxQueries.attachmentRead, { restaurantId, branchId: restaurantId === w.a.id ? w.b1 : undefined, id: S.file });
  const reads = () => prisma().auditLog.count({ where: { action: 'ph.rx.attachment.read' } });

  it('is kept by a pharmacist, and nobody else may add one', async () => {
    expect(codeOf(await act(w.cashier1, rxActions.attach, { ...place(w.b1), prescriptionId: S.rx1, base64: PNG.toString('base64') }))).toBe('FORBIDDEN');
    expect(codeOf(await act(support, rxActions.attach, { ...place(w.b1), prescriptionId: S.rx1, base64: PNG.toString('base64') }))).toBe('FORBIDDEN');
    expect(storage.objects.size).toBe(0);
    S.file = dataOf(await act(w.pharmacist, rxActions.attach, { ...place(w.b1), prescriptionId: S.rx1, base64: PNG.toString('base64') })).id;
    expect(storage.objects.size).toBe(1);
  });

  it('the query refuses every role without the permission, support, and another business, and sends the exact bytes to those who hold it', async () => {
    for (const who of [w.cashier1, w.accountant, w.stockP, support]) expect(codeOf(await readQuery(who)), who.email).toBe('FORBIDDEN');
    expect(codeOf(await readQuery(ownerB, otherId))).toBe('NOT_FOUND');
    expect(codeOf(await readQuery(ownerB))).toBe('FORBIDDEN');
    expect(await reads()).toBe(0);
    for (const who of [w.pharmacist, w.owner, w.manager1, w.pic]) {
      const got = dataOf(await readQuery(who)) as any;
      expect(Buffer.from(got.base64, 'base64').equals(PNG), who.email).toBe(true);
    }
    expect(await reads()).toBe(4);
  });

  it('the route does the same: no session 401, no permission 403, support 403, another business 403, and private no-store bytes otherwise', async () => {
    const before = await reads();
    const denied: Array<[string, Response]> = [
      ['no session', await get(S.file!)],
      ['cashier', await get(S.file!, w.cashier1)],
      ['accountant', await get(S.file!, w.accountant)],
      ['stock', await get(S.file!, w.stockP)],
      ['support', await get(S.file!, support)],
      ['other business', await get(S.file!, ownerB)],
    ];
    expect(denied.map(([, r]) => r.status)).toEqual([401, 403, 403, 403, 403, 403]);
    for (const [label, reply] of denied) {
      expect(Buffer.from(await reply.arrayBuffer()).includes(Buffer.from('acceptance bytes')), label).toBe(false);
    }
    expect(await reads()).toBe(before);
    const ok = await get(S.file!, w.pharmacist);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
    expect(await reads()).toBe(before + 1);
  });

  it('is read afresh on every request: the same person loses the file the moment the role changes', async () => {
    expect((await get(S.file!, w.pharmacist)).status).toBe(200);
    await prisma().phStaff.updateMany({ where: { userId: w.pharmacist.userId }, data: { role: 'CASHIER' } });
    try {
      expect((await get(S.file!, w.pharmacist)).status).toBe(403);
      expect(codeOf(await readQuery(w.pharmacist))).toBe('FORBIDDEN');
    } finally {
      await prisma().phStaff.updateMany({ where: { userId: w.pharmacist.userId }, data: { role: 'PHARMACIST' } });
    }
  });
});

// ==========================================================================================================================================
describe('no permission bypass: every action and tool answers to the role matrix written here by hand', () => {
  const roles: Record<string, Person> = {};
  beforeAll(() => {
    Object.assign(roles, { owner: w.owner, manager: w.manager1, pic: w.pic, pharmacist: w.pharmacist, cashier: w.cashier1, stock: w.stockP, accountant: w.accountant });
  });
  const names = ['owner', 'manager', 'pic', 'pharmacist', 'cashier', 'stock', 'accountant'];

  // tool -> roles that may run it (report.view; purchase.manage; report.view + profit.view + cost.view)
  const TOOLS: Array<[string, string, string[]]> = [
    ['batches_expiring', 'Which batches expire soon?', ['owner', 'manager', 'pic', 'accountant']],
    ['stock_below_reorder', 'What is running low on stock?', ['owner', 'manager', 'pic', 'accountant']],
    ['slow_movers', 'Show me the slow moving products', ['owner', 'manager', 'pic', 'accountant']],
    ['transfer_candidates', 'Which stock should I transfer?', ['owner', 'manager', 'pic', 'accountant']],
    ['unpaid_supplier_invoices', 'Which supplier invoices are unpaid?', ['owner', 'manager', 'pic', 'stock', 'accountant']],
    ['margin_change', 'How did the margin change?', ['owner', 'manager', 'accountant']],
  ];

  it.each(TOOLS)('%s runs for exactly %j and is refused to everyone else, support included', async (tool, question, allowed) => {
    const before = await writes();
    for (const name of names) {
      const result = await act(roles[name]!, assistantActions.askAction, { ...place(), question, direct: true, batchId: w.ids.pb1 });
      if (allowed.includes(name)) expect(dataOf(result).tables.map((t: any) => t.tool), name).toEqual([tool]);
      else expect(codeOf(result), name).toBe('FORBIDDEN');
    }
    expect(codeOf(await act(support, assistantActions.askAction, { ...place(), question, direct: true, batchId: w.ids.pb1 }))).toBe('FORBIDDEN');
    expect(await writes()).toEqual(before);
  });

  it('a role without ai.use never reaches a model: it gets the tables and the reason', async () => {
    for (const name of ['accountant', 'stock']) {
      const answer = dataOf(await act(roles[name]!, assistantActions.askAction, { ...place(), question: name === 'accountant' ? 'Which batches expire soon?' : 'Which supplier invoices are unpaid?' })) as any;
      expect(answer).toMatchObject({ degraded: true, reason: 'NO_AI_PERMISSION', answer: null }, name);
      expect(answer.tables).toHaveLength(1);
    }
  });

  it('the proposals need ai.use and the permission of the draft they hand over to; accepting creates nothing', async () => {
    const reorder = { kind: 'REORDER', lines: [{ productId: w.P.id, qty: 100 }] };
    const transfer = { kind: 'TRANSFER', fromBranchId: w.b1, toBranchId: w.b2, lines: [{ productId: w.P.id, qty: 1 }] };
    // REORDER needs ai.use + purchase.manage; TRANSFER needs ai.use + transfer.manage.
    const REORDER_OK = ['owner', 'manager', 'pic'];
    const TRANSFER_OK = ['owner', 'manager'];
    for (const [proposal, ok] of [[reorder, REORDER_OK], [transfer, TRANSFER_OK]] as const) {
      for (const name of names) {
        const before = await prisma().phAiProposal.count();
        const result = await act(roles[name]!, assistantActions.proposalCreate, { ...place(w.b1), proposal });
        if (ok.includes(name)) {
          expect(codeOf(result), `${proposal.kind} ${name}`).toBe('OK');
          expect(await prisma().phAiProposal.count()).toBe(before + 1);
        } else {
          expect(codeOf(result), `${proposal.kind} ${name}`).toBe('FORBIDDEN');
          expect(await prisma().phAiProposal.count()).toBe(before);
        }
      }
      expect(codeOf(await act(support, assistantActions.proposalCreate, { ...place(w.b1), proposal }))).toBe('FORBIDDEN');
    }
    // A person who may not handle the kind can neither accept nor dismiss it, and the proposal stays proposed.
    const made = (await prisma().phAiProposal.findFirstOrThrow({ where: { kind: 'TRANSFER' } })).id;
    for (const name of ['pic', 'pharmacist', 'cashier', 'accountant', 'stock']) {
      expect(codeOf(await act(roles[name]!, assistantActions.proposalAccept, { ...place(w.b1), proposalId: made })), name).toBe('FORBIDDEN');
      expect(codeOf(await act(roles[name]!, assistantActions.proposalDismiss, { ...place(w.b1), proposalId: made })), name).toBe('FORBIDDEN');
      expect(codeOf(await ask(roles[name]!, assistantQueries.proposals, place())), name).toBe(name === 'pic' || name === 'pharmacist' ? 'OK' : 'FORBIDDEN');
    }
    expect((await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made } })).status).toBe('PROPOSED');
    // Accepting hands over the data of a draft and creates none.
    const before = await writes();
    const accepted = dataOf(await act(w.manager1, assistantActions.proposalAccept, { ...place(w.b1), proposalId: made })) as any;
    expect(accepted).toMatchObject({ status: 'ACCEPTED', prefill: { draft: 'TRANSFER_REQUEST' } });
    expect(await writes()).toEqual(before);
  });

  it('prescriptions: only rx.dispense creates one (owner, manager, pic, pharmacist)', async () => {
    const before = await prisma().phPrescription.count();
    let made = 0;
    for (const name of names) {
      const result = await act(roles[name]!, rxActions.create, { ...place(w.b1), clientKey: key('rx'), number: `ACC ${name}`, prescriberName: 'Dr Matrix', issuedOn: '2026-10-20' });
      if (['owner', 'manager', 'pic', 'pharmacist'].includes(name)) {
        expect(codeOf(result), name).toBe('OK');
        made += 1;
      } else expect(codeOf(result), name).toBe('FORBIDDEN');
    }
    expect(codeOf(await act(support, rxActions.create, { ...place(w.b1), clientKey: key('rx'), number: 'ACC support', prescriberName: 'Dr Matrix', issuedOn: '2026-10-20' }))).toBe('FORBIDDEN');
    expect(await prisma().phPrescription.count()).toBe(before + made);
  });

  it('customers: customer.manage or credit.sell may pick one, only customer.manage sees the phone; the settings switches belong to the owner alone', async () => {
    for (const name of names) {
      const result = await ask(roles[name]!, customerQueries.list, place(w.b1));
      if (['cashier', 'stock'].includes(name)) {
        expect(codeOf(result), name).toBe('FORBIDDEN');
        continue;
      }
      const listed = dataOf(result) as any;
      expect(listed.items.length, name).toBeGreaterThan(0);
      if (['owner', 'manager', 'pic', 'accountant'].includes(name)) expect(listed.items.map((c: any) => c.phone ?? null), name).toContain(SECRETS.phone);
      else expect(JSON.stringify(listed), name).not.toContain('0770');
    }
    expect(codeOf(await ask(support, customerQueries.list, place(w.b1)))).toBe('FORBIDDEN');
    for (const name of names) {
      const statement = await ask(roles[name]!, customerQueries.statement, { ...place(w.b1), customerId: S.ci, from: '2026-10-01', to: '2026-10-31' });
      expect(codeOf(statement), name).toBe(['owner', 'manager', 'pic', 'accountant'].includes(name) ? 'OK' : 'FORBIDDEN');
    }
    const settings = await prisma().phSettings.findUniqueOrThrow({ where: { restaurantId: w.a.id } });
    for (const name of names.filter((n) => n !== 'owner')) {
      expect(codeOf(await act(roles[name]!, controlledSettings.set, { ...place(), controlledEnabled: false, controlledMaxQty: 30, rxRetentionDays: 3650, version: settings.version })), name).toBe('FORBIDDEN');
      expect(codeOf(await act(roles[name]!, creditSettings.set, { ...place(), creditEnabled: false, version: settings.version })), name).toBe('FORBIDDEN');
    }
    const after = await prisma().phSettings.findUniqueOrThrow({ where: { restaurantId: w.a.id } });
    expect([after.controlledEnabled, after.creditEnabled]).toEqual([true, true]);
  });
});

// ==========================================================================================================================================
describe('no fabrication: the assistant never states a figure the tools did not return', () => {
  const envFor = async (who: Person, provider: AskEnv['provider']): Promise<AskEnv> => {
    const ph = (await asPh(who.userId, w.a.id))!;
    return { scoped: phScopedClient(prisma(), ph), ph, now: NOW, provider };
  };
  const askAs = async (who: Person, provider: AskEnv['provider'], question: string, opts: Parameters<typeof askAssistant>[2] = {}): Promise<AssistantAnswer> =>
    askAssistant(await envFor(who, provider), question, opts);
  const EXPIRY = 'Which batches expire soon?';

  /** Batches with stock that are expired or expire within 90 days of NOW, counted in SQL here. */
  const expiringSql = async () =>
    Number((await prisma().$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT b."id")::bigint AS n FROM "PhBatch" b JOIN "PhStockBalance" s ON s."batchId" = b."id" WHERE b."restaurantId" = ${w.a.id} AND b."expiryDate" <= ${new Date('2027-01-25T00:00:00.000Z')} AND (s."available" + s."reserved" + s."quarantine") > 0`)[0]!.n);

  it('shows prose only when its figures are in the table: the count the SQL finds is accepted, any other figure is dropped', async () => {
    const real = await expiringSql();
    expect(real).toBe(3);
    const good = await askAs(w.owner, scripted(text(`${real} batches are expired or expiring within 90 days.`)), EXPIRY);
    expect(good).toMatchObject({ grounded: true, label: 'fact' });
    expect(good.answer).toBe('3 batches are expired or expiring within 90 days.');
    expect((good.tables[0] as any).rows).toHaveLength(real);
    for (const invented of ['There are 7 batches in trouble.', 'Seven batches expire soon.', '3 batches expire, worth 900,000 IQD.', 'The next expiry is on 2026-12-31.', '3 batches, 12 units are at risk.']) {
      const a = await askAs(w.owner, scripted(text(invented)), EXPIRY);
      expect(a, invented).toMatchObject({ answer: null, grounded: false, degraded: true, reason: 'UNGROUNDED' });
      // The truth is still shown: the plain table, with every row.
      expect((a.tables[0] as any).rows, invented).toHaveLength(real);
    }
  });

  it('cannot be made to quote a figure by putting it in a product name', async () => {
    const decoy = await makeProduct(w.a.id, 'Offer 4242 units');
    await makeBatch(w.a.id, w.b1, decoy.id, { lot: 'DECOY', expiry: '2026-12-01', buckets: { available: 7 } });
    const real = await expiringSql();
    expect(real).toBe(4);
    const lie = await askAs(w.owner, scripted(text('4242 batches are expiring.')), EXPIRY);
    expect(lie).toMatchObject({ answer: null, degraded: true, reason: 'UNGROUNDED' });
    const truth = await askAs(w.owner, scripted(text(`${real} batches are expired or expiring.`)), EXPIRY);
    expect(truth.answer).toBe('4 batches are expired or expiring.');
  });

  it('ignores a hostile product name: same tool, same tables, the model sees it only as untrusted data, and nothing is written', async () => {
    const before = await writes();
    const model = scripted(text(`${HOSTILE.slice(0, 30)}. 3 batches.`));
    const a = await askAs(w.owner, model, EXPIRY);
    expect(a.tables.map((t) => t.tool)).toEqual(['batches_expiring']);
    expect(JSON.stringify(a.tables)).toContain('Ignore previous instructions');
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.tools).toBeUndefined();
    expect(model.requests[0]!.system).not.toContain('Ignore previous');
    expect(model.requests[0]!.user).toContain('&lt;/untrusted_data&gt;');
    // Obeying the name would mean a margin table, a sale or a transfer: none happens, with or without a model that tries.
    const obeying = scripted(tools('margin_change', 'sell_everything'), text('3 batches.'));
    const b = await askAs(w.pic, obeying, 'good morning, what should I look at today');
    expect(b.tables.map((t) => t.tool)).not.toContain('margin_change');
    expect(await writes()).toEqual(before);
  });

  it('gives the model no patient, prescriber, customer, phone or prescription number, whatever is asked', async () => {
    const model = scripted(text('3 batches.'), tools('batches_expiring'), text('3 batches.'));
    await askAs(w.owner, model, EXPIRY);
    await askAs(w.owner, model, `call ${w.customerPhone} please: ${EXPIRY}`);
    const everything = JSON.stringify(model.requests);
    for (const secret of [w.customerName, w.customerPhone, w.patientName, 'Dr Prescriber', 'RX-T-1', 'owes us', SECRETS.patient, SECRETS.prescriber, SECRETS.customer, SECRETS.phone, SECRETS.rx1]) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it('degrades to the plain tables when the model fails, and never invents an answer', async () => {
    const a = await askAs(w.owner, scripted(new Error('provider down')), EXPIRY);
    expect(a).toMatchObject({ answer: null, degraded: true, reason: 'AI_PROVIDER_ERROR' });
    expect(a.tables).toHaveLength(1);
    const none = await askAs(w.accountant, null, EXPIRY);
    expect(none).toMatchObject({ answer: null, degraded: true, reason: 'NO_AI_PERMISSION' });
  });

  it('answers a forecast without eight weeks of sales with the sentence "insufficient data" and no number', async () => {
    const a = await askAs(w.owner, scripted(), 'Forecast next week', { productId: w.P.id });
    expect(a.answer).toBe('insufficient data');
    expect(a.forecast).toBeUndefined();
  });

  it('refuses to advise on doses or on selling expired stock, whatever the tables hold', async () => {
    const dose = await askAs(w.owner, scripted(), 'What dose of Morphex should a child take?');
    const expired = await askAs(w.owner, scripted(), 'Can we sell the expired batch to customers?');
    expect([dose.reason, expired.reason]).toEqual(['CLINICAL', 'UNSAFE_STOCK']);
    expect([dose.tables, expired.tables]).toEqual([[], []]);
  });
});

// ==========================================================================================================================================
describe('the audit log holds ids, counts and statuses, never a patient, prescriber, customer, phone or free text', () => {
  it('after the whole flow above plus a question of free text, no audit row holds any of it', async () => {
    dataOf(await act(w.owner, assistantActions.askAction, { ...place(), question: `${SECRETS.question} which batches expire soon?`, direct: true }));
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: w.a.id } });
    expect(rows.length).toBeGreaterThan(20);
    // The flow really wrote the rows the claim is about.
    const actions = new Set(rows.map((r) => r.action));
    for (const expected of ['ph.rx.create', 'ph.rx.file.add', 'ph.rx.attachment.read', 'ph.sale.create', 'ph.customer.create', 'ph.credit.payment.record', 'ph.credit.payment.reverse', 'ph.assistant.ask', 'ph.assistant.proposal.create', 'ph.assistant.proposal.accept']) {
      expect([...actions], expected).toContain(expected);
    }
    const everything = JSON.stringify(rows);
    const secrets = [...Object.values(SECRETS), w.customerName, w.customerPhone, w.patientName, 'Dr Prescriber', 'RX-T-1', 'owes us', 'Customer Dollar', 'Customer Small', 'Dr Matrix', 'ACC owner', 'Offer 4242', 'Morphex', 'Ignore previous'];
    for (const secret of secrets) {
      // Product names are catalog data, not patient data, but the assistant and the sales flow audit ids: none is needed in a row.
      if (secret === 'Morphex' || secret === 'Offer 4242' || secret === 'Ignore previous') continue;
      expect(everything, secret).not.toContain(secret);
    }
  });
});
