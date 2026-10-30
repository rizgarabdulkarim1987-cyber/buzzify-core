import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PHARMACY_BRANCH_SCOPED_MODELS,
  RESTAURANT_SCOPED_MODELS,
  scopedClient,
} from '@/server/data/tenant-db';
import { pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { makeProduct } from './stock-helpers';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
  delete globalForPrisma.__prisma;
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(resetWorld);

type Data = Record<string, unknown>;

let seq = 0;
const next = () => (seq += 1);

const ISSUED = new Date('2026-10-30T00:00:00.000Z');
const EXPIRY = new Date('2028-03-31T00:00:00.000Z');

/** A business with two branches, a product and batch, an IQD customer; a second business with the same; and a sale in each branch. */
async function world() {
  const biz = await pharmacy('A', { branches: 2 });
  const other = await pharmacy('B', { branches: 1 });
  const [b1, b2] = biz.branchIds as [string, string];
  const mk = async (restaurantId: string, branchId: string, tag: string) => {
    const product = await makeProduct(restaurantId, `Drug ${tag}`);
    const product2 = await makeProduct(restaurantId, `Drug two ${tag}`);
    const batch = await prisma().phBatch.create({ data: { restaurantId, productId: product.id, lot: 'L1', expiryDate: EXPIRY }, select: { id: true } });
    const batch2 = await prisma().phBatch.create({ data: { restaurantId, productId: product2.id, lot: 'L2', expiryDate: EXPIRY }, select: { id: true } });
    const shift = await prisma().phShift.create({ data: { restaurantId, branchId, userId: 'u1', currency: 'IQD' }, select: { id: true } });
    const sale = await prisma().phSale.create({
      data: { restaurantId, branchId, shiftId: shift.id, currency: 'IQD', clientKey: `sale-${next()}`, soldById: 'u1' },
      select: { id: true },
    });
    const line = await prisma().phSaleLine.create({
      data: { restaurantId, saleId: sale.id, lineNo: 1, productId: product.id, unitId: product.tablet, qty: 1, baseQty: 1, unitPriceMinor: 100n, totalMinor: 100n },
      select: { id: true },
    });
    const customer = await prisma().phCustomer.create({ data: { restaurantId, name: 'Customer', currency: 'IQD', creditLimitMinor: 1_000_000n }, select: { id: true } });
    return { productId: product.id, product2Id: product2.id, unitId: product.tablet, batchId: batch.id, batch2Id: batch2.id, shiftId: shift.id, saleId: sale.id, lineId: line.id, customerId: customer.id };
  };
  const a = await mk(biz.id, b1, 'a1');
  const a2 = await mk(biz.id, b2, 'a2');
  const b = await mk(other.id, other.branchId, 'b1');
  return { biz, other, b1, b2, ...a, a2, b };
}
type World = Awaited<ReturnType<typeof world>>;

const prescriptionOf = (w: World, over: Data = {}) =>
  prisma().phPrescription.create({
    data: {
      restaurantId: w.biz.id,
      branchId: w.b1,
      number: `RX-${next()}`,
      prescriberName: 'Dr A',
      issuedOn: ISSUED,
      clientKey: `rx-${next()}`,
      payloadHash: 'h',
      createdById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const entryOf = (w: World, prescriptionId: string, over: Data = {}) =>
  prisma().phControlledEntry.create({
    data: {
      restaurantId: w.biz.id,
      branchId: w.b1,
      saleId: w.saleId,
      saleLineId: w.lineId,
      productId: w.productId,
      batchId: w.batchId,
      prescriptionId,
      baseQty: 5,
      kind: 'SALE',
      dispensedById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const ledgerOf = (w: World, over: Data = {}) =>
  prisma().phCustomerLedger.create({
    data: { restaurantId: w.biz.id, customerId: w.customerId, kind: 'CHARGE', amountMinor: 500n, currency: 'IQD', saleId: w.saleId, ...over } as never,
    select: { id: true },
  });

const paymentOf = (w: World, over: Data = {}) =>
  prisma().phCustomerPayment.create({
    data: {
      restaurantId: w.biz.id,
      branchId: w.b1,
      customerId: w.customerId,
      method: 'CASH',
      amountMinor: 200n,
      currency: 'IQD',
      clientKey: `cp-${next()}`,
      payloadHash: 'h',
      shiftId: w.shiftId,
      createdById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

describe('PhSettings additions', () => {
  it('start off, 30 and 3650, and refuse a negative limit or a zero retention', async () => {
    const w = await world();
    const row = await prisma().phSettings.create({ data: { restaurantId: w.biz.id } });
    expect(row).toMatchObject({ controlledEnabled: false, controlledMaxQty: 30, creditEnabled: false, rxRetentionDays: 3650, print: null });
    await expect(prisma().phSettings.update({ where: { id: row.id }, data: { controlledMaxQty: -1 } })).rejects.toThrow(/PhSettings_controlledMaxQty_nonnegative/);
    await expect(prisma().phSettings.update({ where: { id: row.id }, data: { controlledMaxQty: 0 } })).resolves.toHaveProperty('id');
    await expect(prisma().phSettings.update({ where: { id: row.id }, data: { rxRetentionDays: 0 } })).rejects.toThrow(/PhSettings_rxRetentionDays_positive/);
    await expect(prisma().phSettings.update({ where: { id: row.id }, data: { rxRetentionDays: 1, print: { margin: 4 } } })).resolves.toHaveProperty('id');
  });
});

describe('the new enum values', () => {
  it('exist', async () => {
    const values = async (type: string) =>
      // eslint-disable-next-line no-restricted-properties -- the catalog is read by SQL on purpose
      (await prisma().$queryRawUnsafe<{ v: string }[]>(`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = '${type}'`)).map((r) => r.v);
    expect(await values('PhPaymentMethod')).toEqual(expect.arrayContaining(['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL', 'CREDIT']));
    expect(await values('PhCashMovementType')).toEqual(expect.arrayContaining(['FLOAT_OPEN', 'PAID_OUT', 'CUSTOMER_PAYMENT']));
  });

  it('are usable once committed: a CREDIT payment of a sale, a CUSTOMER_PAYMENT cash movement of the right sign', async () => {
    const w = await world();
    await expect(
      prisma().phPayment.create({ data: { restaurantId: w.biz.id, saleId: w.saleId, method: 'CREDIT', amountMinor: 100n, currency: 'IQD', clientKey: `p-${next()}` } }),
    ).resolves.toHaveProperty('id');
    const move = (amountMinor: bigint, type: string) =>
      prisma().phCashMovement.create({ data: { restaurantId: w.biz.id, shiftId: w.shiftId, type, amountMinor, currency: 'IQD', userId: 'u1' } as never });
    await expect(move(300n, 'CUSTOMER_PAYMENT')).resolves.toHaveProperty('id');
    await expect(move(-300n, 'CUSTOMER_PAYMENT')).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(move(0n, 'CUSTOMER_PAYMENT')).rejects.toThrow(/PhCashMovement_amount_sign/);
    // the earlier types keep their signs
    await expect(move(-50n, 'PAID_OUT')).resolves.toHaveProperty('id');
    await expect(move(50n, 'PAID_OUT')).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(move(50n, 'SALE_CASH')).resolves.toHaveProperty('id');
    await expect(move(-50n, 'SALE_CASH')).rejects.toThrow(/PhCashMovement_amount_sign/);
  });
});

describe('the sale customer', () => {
  it('is optional, of the same business, and a customer in use cannot be deleted', async () => {
    const w = await world();
    expect(await prisma().phSale.findUniqueOrThrow({ where: { id: w.saleId }, select: { customerId: true } })).toEqual({ customerId: null });
    await expect(prisma().phSale.update({ where: { id: w.saleId }, data: { customerId: w.customerId } })).resolves.toHaveProperty('id');
    // another business's customer is refused by the composite key
    // eslint-disable-next-line no-restricted-properties -- a raw write is the way to try a composite key the client would not build
    await expect(prisma().$executeRawUnsafe(`UPDATE "PhSale" SET "customerId" = '${w.b.customerId}' WHERE id = '${w.a2.saleId}'`)).rejects.toThrow(/foreign key/i);
    await expect(prisma().phCustomer.delete({ where: { id: w.customerId } })).rejects.toThrow(/foreign key|violates/i);
  });
});

describe('the prescription', () => {
  it('has a number that may repeat, a clientKey that may not, and one sale at most', async () => {
    const w = await world();
    const first = await prescriptionOf(w, { number: 'SAME', clientKey: 'k1' });
    await expect(prescriptionOf(w, { number: 'SAME', clientKey: 'k2' })).resolves.toHaveProperty('id');
    await expect(prescriptionOf(w, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
    // the same key in another business is another prescription
    await expect(prescriptionOf(w, { restaurantId: w.other.id, branchId: w.other.branchId, clientKey: 'k1' })).resolves.toHaveProperty('id');
    await prisma().phPrescription.update({ where: { id: first.id }, data: { saleId: w.saleId } });
    await expect(prescriptionOf(w, { saleId: w.saleId })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma().phPrescription.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ prescriberLicense: null, patientName: null, patientIdNote: null });
  });

  it('is tied to a sale of its own branch and business', async () => {
    const w = await world();
    // the sale of the other branch of the same business, and the sale of another business
    await expect(prescriptionOf(w, { saleId: w.a2.saleId })).rejects.toThrow(/foreign key/i);
    await expect(prescriptionOf(w, { saleId: w.b.saleId })).rejects.toThrow(/foreign key/i);
    await expect(prescriptionOf(w, { saleId: w.saleId })).resolves.toHaveProperty('id');
  });

  it('refuses an empty number or prescriber, and a branch of another business', async () => {
    const w = await world();
    await expect(prescriptionOf(w, { number: '  ' })).rejects.toThrow(/PhPrescription_number_present/);
    await expect(prescriptionOf(w, { prescriberName: '' })).rejects.toThrow(/PhPrescription_prescriberName_present/);
    await expect(prescriptionOf(w, { branchId: w.other.branchId })).rejects.toThrow(/foreign key/i);
  });
});

describe('the prescription attachment', () => {
  const attachmentOf = (w: World, prescriptionId: string, over: Data = {}) =>
    prisma().phRxAttachment.create({
      data: { restaurantId: w.biz.id, branchId: w.b1, prescriptionId, storageKey: `rx/${next()}`, mime: 'image/png', sizeBytes: 1000, sha256: 'a'.repeat(64), uploadedById: 'u1', ...over } as never,
      select: { id: true },
    });

  it('holds 1 byte to 5 MB, an image or a PDF, and a 64-character hash', async () => {
    const w = await world();
    const rx = await prescriptionOf(w);
    await expect(attachmentOf(w, rx.id, { sizeBytes: 0 })).rejects.toThrow(/PhRxAttachment_size_range/);
    await expect(attachmentOf(w, rx.id, { sizeBytes: 5_242_881 })).rejects.toThrow(/PhRxAttachment_size_range/);
    await expect(attachmentOf(w, rx.id, { sizeBytes: 1 })).resolves.toHaveProperty('id');
    await expect(attachmentOf(w, rx.id, { sizeBytes: 5_242_880, mime: 'application/pdf' })).resolves.toHaveProperty('id');
    await expect(attachmentOf(w, rx.id, { mime: 'text/html' })).rejects.toThrow(/PhRxAttachment_mime_allowed/);
    await expect(attachmentOf(w, rx.id, { sha256: 'zz' })).rejects.toThrow(/PhRxAttachment_sha256_hex/);
    await expect(attachmentOf(w, rx.id, { storageKey: 'rx/dup' })).resolves.toHaveProperty('id');
    await expect(attachmentOf(w, rx.id, { storageKey: 'rx/dup' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('belongs to the branch of its prescription', async () => {
    const w = await world();
    const rx = await prescriptionOf(w);
    await expect(attachmentOf(w, rx.id, { branchId: w.b2 })).rejects.toThrow(/foreign key/i);
    const foreign = await prescriptionOf(w, { restaurantId: w.other.id, branchId: w.other.branchId });
    await expect(attachmentOf(w, foreign.id)).rejects.toThrow(/foreign key/i);
  });
});

describe('the controlled register', () => {
  it('records a sale as a positive and a return as a negative quantity, never zero', async () => {
    const w = await world();
    const rx = await prescriptionOf(w);
    await expect(entryOf(w, rx.id, { baseQty: 0 })).rejects.toThrow(/PhControlledEntry_baseQty_nonzero/);
    await expect(entryOf(w, rx.id, { kind: 'SALE', baseQty: -2 })).rejects.toThrow(/PhControlledEntry_baseQty_sign/);
    await expect(entryOf(w, rx.id, { kind: 'RETURN', baseQty: 2 })).rejects.toThrow(/PhControlledEntry_baseQty_sign/);
    await entryOf(w, rx.id, { kind: 'SALE', baseQty: 5 });
    await entryOf(w, rx.id, { kind: 'RETURN', baseQty: -2 });
    const sum = await prisma().phControlledEntry.aggregate({ where: { productId: w.productId }, _sum: { baseQty: true } });
    expect(sum._sum.baseQty).toBe(3);
  });

  it('is append-only: no UPDATE, no DELETE', async () => {
    const w = await world();
    const rx = await prescriptionOf(w);
    const made = await entryOf(w, rx.id);
    await expect(prisma().phControlledEntry.update({ where: { id: made.id }, data: { baseQty: 6 } })).rejects.toThrow(/PhControlledEntry is append-only: UPDATE refused/);
    await expect(prisma().phControlledEntry.delete({ where: { id: made.id } })).rejects.toThrow(/PhControlledEntry is append-only: DELETE refused/);
    await expect(prisma().phControlledEntry.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma().phControlledEntry.count()).toBe(1);
  });

  it('names a line of the sale, a batch of the product, and a prescription of the branch', async () => {
    const w = await world();
    const rx = await prescriptionOf(w);
    await expect(entryOf(w, rx.id, { saleLineId: w.a2.lineId })).rejects.toThrow(/foreign key/i);
    await expect(entryOf(w, rx.id, { batchId: w.batch2Id })).rejects.toThrow(/foreign key/i);
    await expect(entryOf(w, rx.id, { productId: w.b.productId, batchId: w.b.batchId })).rejects.toThrow(/foreign key/i);
    const otherBranchRx = await prescriptionOf(w, { branchId: w.b2 });
    await expect(entryOf(w, otherBranchRx.id)).rejects.toThrow(/foreign key/i);
    await expect(entryOf(w, rx.id, { saleId: w.a2.saleId })).rejects.toThrow(/foreign key/i);
  });
});

describe('the customer', () => {
  it('has a name and a limit of 0 or more, active and version 1 to start', async () => {
    const w = await world();
    const make = (over: Data) => prisma().phCustomer.create({ data: { restaurantId: w.biz.id, name: 'N', currency: 'USD', ...over } as never });
    await expect(make({ creditLimitMinor: -1n })).rejects.toThrow(/PhCustomer_creditLimit_nonnegative/);
    await expect(make({ name: ' ' })).rejects.toThrow(/PhCustomer_name_present/);
    expect(await make({})).toMatchObject({ creditLimitMinor: 0n, active: true, version: 1, phone: null, note: '' });
  });
});

describe('the customer ledger', () => {
  it('refuses a zero amount and a sign that does not fit the kind', async () => {
    const w = await world();
    await expect(ledgerOf(w, { amountMinor: 0n })).rejects.toThrow(/PhCustomerLedger_amount_nonzero/);
    await expect(ledgerOf(w, { kind: 'CHARGE', amountMinor: -5n })).rejects.toThrow(/PhCustomerLedger_kind_sign/);
    await expect(ledgerOf(w, { kind: 'REFUND', amountMinor: 5n })).rejects.toThrow(/PhCustomerLedger_kind_sign/);
    const pay = await paymentOf(w);
    await expect(ledgerOf(w, { kind: 'PAYMENT', amountMinor: 5n, saleId: null, paymentId: pay.id })).rejects.toThrow(/PhCustomerLedger_kind_sign/);
  });

  it('names a sale for a charge or refund and a payment for a payment or reversal', async () => {
    const w = await world();
    const pay = await paymentOf(w);
    await expect(ledgerOf(w, { saleId: null })).rejects.toThrow(/PhCustomerLedger_kind_reference/);
    await expect(ledgerOf(w, { paymentId: pay.id })).rejects.toThrow(/PhCustomerLedger_kind_reference/);
    await expect(ledgerOf(w, { kind: 'PAYMENT', amountMinor: -5n, saleId: null, paymentId: null })).rejects.toThrow(/PhCustomerLedger_kind_reference/);
    await expect(ledgerOf(w, { kind: 'PAYMENT', amountMinor: -5n, saleId: null, paymentId: pay.id })).resolves.toHaveProperty('id');
  });

  it('has one charge per sale and one row per payment', async () => {
    const w = await world();
    await ledgerOf(w);
    await expect(ledgerOf(w, { amountMinor: 7n })).rejects.toThrow(/PhCustomerLedger_one_charge_per_sale/);
    // refunds of the same sale are many
    await ledgerOf(w, { kind: 'REFUND', amountMinor: -10n });
    await ledgerOf(w, { kind: 'REFUND', amountMinor: -20n });
    const pay = await paymentOf(w);
    await ledgerOf(w, { kind: 'PAYMENT', amountMinor: -5n, saleId: null, paymentId: pay.id });
    await expect(ledgerOf(w, { kind: 'PAYMENT', amountMinor: -5n, saleId: null, paymentId: pay.id })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stays in the currency of the customer and of the sale, and the business of both', async () => {
    const w = await world();
    await expect(ledgerOf(w, { currency: 'USD' })).rejects.toThrow(/foreign key/i);
    // another business's customer, or sale
    await expect(ledgerOf(w, { customerId: w.b.customerId })).rejects.toThrow(/foreign key/i);
    await expect(ledgerOf(w, { saleId: w.b.saleId })).rejects.toThrow(/foreign key/i);
  });

  it('gives the balance by SUM over charges, payments, a reversal and a refund', async () => {
    const w = await world();
    const sale2 = await prisma().phSale.create({
      data: { restaurantId: w.biz.id, branchId: w.b1, shiftId: w.shiftId, currency: 'IQD', clientKey: `sale-${next()}`, soldById: 'u1' },
      select: { id: true },
    });
    await ledgerOf(w, { kind: 'CHARGE', amountMinor: 1000n });
    await ledgerOf(w, { kind: 'CHARGE', amountMinor: 400n, saleId: sale2.id });
    const pay = await paymentOf(w, { amountMinor: 600n });
    await ledgerOf(w, { kind: 'PAYMENT', amountMinor: -600n, saleId: null, paymentId: pay.id });
    const undo = await paymentOf(w, { amountMinor: 600n, reversesId: pay.id });
    await ledgerOf(w, { kind: 'REVERSAL', amountMinor: 600n, saleId: null, paymentId: undo.id });
    await ledgerOf(w, { kind: 'REFUND', amountMinor: -150n, saleId: sale2.id });
    // eslint-disable-next-line no-restricted-properties -- the balance is recomputed by SQL on purpose, not through the code under test
    const rows = await prisma().$queryRaw<{ balance: bigint; n: bigint }[]>`SELECT SUM("amountMinor")::bigint AS balance, COUNT(*) AS n FROM "PhCustomerLedger" WHERE "restaurantId" = ${w.biz.id} AND "customerId" = ${w.customerId}`;
    expect(rows[0]).toEqual({ balance: 1250n, n: 5n });
    const agg = await prisma().phCustomerLedger.aggregate({ where: { customerId: w.customerId }, _sum: { amountMinor: true } });
    expect(agg._sum.amountMinor).toBe(1250n);
  });

  it('is append-only', async () => {
    const w = await world();
    const made = await ledgerOf(w);
    await expect(prisma().phCustomerLedger.update({ where: { id: made.id }, data: { amountMinor: 1n } })).rejects.toThrow(/PhCustomerLedger is append-only: UPDATE refused/);
    await expect(prisma().phCustomerLedger.delete({ where: { id: made.id } })).rejects.toThrow(/PhCustomerLedger is append-only: DELETE refused/);
  });
});

describe('the customer payment', () => {
  it('is above zero, idempotent by clientKey, and append-only', async () => {
    const w = await world();
    await expect(paymentOf(w, { amountMinor: 0n })).rejects.toThrow(/PhCustomerPayment_amount_positive/);
    await expect(paymentOf(w, { amountMinor: -1n })).rejects.toThrow(/PhCustomerPayment_amount_positive/);
    const made = await paymentOf(w, { clientKey: 'same' });
    await expect(paymentOf(w, { clientKey: 'same' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma().phCustomerPayment.update({ where: { id: made.id }, data: { amountMinor: 1n } })).rejects.toThrow(/PhCustomerPayment is append-only: UPDATE refused/);
    await expect(prisma().phCustomerPayment.delete({ where: { id: made.id } })).rejects.toThrow(/PhCustomerPayment is append-only: DELETE refused/);
  });

  it('is reversed at most once, by a row of the same customer and currency', async () => {
    const w = await world();
    const pay = await paymentOf(w);
    await expect(paymentOf(w, { reversesId: pay.id })).resolves.toHaveProperty('id');
    await expect(paymentOf(w, { reversesId: pay.id })).rejects.toMatchObject({ code: 'P2002' });
    const other = await prisma().phCustomer.create({ data: { restaurantId: w.biz.id, name: 'Other', currency: 'IQD' }, select: { id: true } });
    const pay2 = await paymentOf(w);
    await expect(paymentOf(w, { reversesId: pay2.id, customerId: other.id })).rejects.toThrow(/foreign key/i);
    const usd = await prisma().phCustomer.create({ data: { restaurantId: w.biz.id, name: 'Usd', currency: 'USD' }, select: { id: true } });
    await expect(paymentOf(w, { customerId: usd.id })).rejects.toThrow(/foreign key/i);
  });

  it('is paid in cash only into a shift, which is a shift of the same branch', async () => {
    const w = await world();
    await expect(paymentOf(w, { shiftId: null })).rejects.toThrow(/PhCustomerPayment_cash_needs_shift/);
    await expect(paymentOf(w, { method: 'CARD', shiftId: null })).resolves.toHaveProperty('id');
    await expect(paymentOf(w, { method: 'TRANSFER' })).resolves.toHaveProperty('id');
    await expect(paymentOf(w, { shiftId: w.a2.shiftId })).rejects.toThrow(/foreign key/i);
    await expect(paymentOf(w, { branchId: w.other.branchId })).rejects.toThrow(/foreign key/i);
  });
});

describe('the assistant proposal', () => {
  const proposalOf = (w: World, over: Data = {}) =>
    prisma().phAiProposal.create({
      data: { restaurantId: w.biz.id, branchId: w.b1, kind: 'REORDER', payload: { lines: [{ productId: w.productId, qty: 10 }] }, createdById: 'u1', ...over } as never,
    });

  it('starts PROPOSED, and is decided exactly when it has a decision time', async () => {
    const w = await world();
    const made = await proposalOf(w);
    expect(made).toMatchObject({ status: 'PROPOSED', decidedAt: null });
    await expect(prisma().phAiProposal.update({ where: { id: made.id }, data: { status: 'ACCEPTED' } })).rejects.toThrow(/PhAiProposal_decided_together/);
    await expect(prisma().phAiProposal.update({ where: { id: made.id }, data: { decidedAt: new Date() } })).rejects.toThrow(/PhAiProposal_decided_together/);
    await expect(prisma().phAiProposal.update({ where: { id: made.id }, data: { status: 'DISMISSED', decidedAt: new Date() } })).resolves.toHaveProperty('id');
    for (const kind of ['TRANSFER', 'REORDER', 'SUPPLIER_RETURN']) await expect(proposalOf(w, { kind })).resolves.toHaveProperty('id');
    await expect(proposalOf(w, { branchId: w.other.branchId })).rejects.toThrow(/foreign key/i);
  });
});

describe('the registry', () => {
  const NEW = ['PhPrescription', 'PhRxAttachment', 'PhControlledEntry', 'PhCustomer', 'PhCustomerLedger', 'PhCustomerPayment', 'PhAiProposal'];
  const BRANCH = ['PhPrescription', 'PhRxAttachment', 'PhControlledEntry', 'PhCustomerPayment', 'PhAiProposal'];

  it('lists every new model as restaurant-scoped and the ones with a branch as branch-scoped', () => {
    for (const model of NEW) expect(RESTAURANT_SCOPED_MODELS as readonly string[], model).toContain(model);
    for (const model of BRANCH) expect(PHARMACY_BRANCH_SCOPED_MODELS, model).toContain(model);
    for (const model of ['PhCustomer', 'PhCustomerLedger']) expect(PHARMACY_BRANCH_SCOPED_MODELS, model).not.toContain(model);
  });

  it('confines a client to its branches: a branch-1 client sees branch-1 prescriptions, attachments, register rows, payments and proposals only', async () => {
    const w = await world();
    const rx1 = await prescriptionOf(w);
    const rx2 = await prescriptionOf(w, { branchId: w.b2 });
    await prisma().phRxAttachment.create({ data: { restaurantId: w.biz.id, branchId: w.b1, prescriptionId: rx1.id, storageKey: 'k1', mime: 'image/png', sizeBytes: 5, sha256: 'a'.repeat(64), uploadedById: 'u1' } });
    await prisma().phRxAttachment.create({ data: { restaurantId: w.biz.id, branchId: w.b2, prescriptionId: rx2.id, storageKey: 'k2', mime: 'image/png', sizeBytes: 5, sha256: 'a'.repeat(64), uploadedById: 'u1' } });
    await entryOf(w, rx1.id);
    await paymentOf(w);
    await prisma().phAiProposal.create({ data: { restaurantId: w.biz.id, branchId: w.b2, kind: 'TRANSFER', payload: {}, createdById: 'u1' } });
    const client = scopedClient(prisma(), { restaurantId: w.biz.id, branchIds: [w.b1] });
    expect(await client.phPrescription.count()).toBe(1);
    expect(await client.phRxAttachment.count()).toBe(1);
    expect(await client.phControlledEntry.count()).toBe(1);
    expect(await client.phCustomerPayment.count()).toBe(1);
    expect(await client.phAiProposal.count()).toBe(0);
    // customers and their ledger are business-wide: one per branch of the world, both seen
    expect(await client.phCustomer.count()).toBe(2);
  });
});
