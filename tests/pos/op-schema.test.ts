import { describe, expect, it } from 'vitest';
import { OP_KINDS, operationSchema, syncRequestSchema } from '@/lib/pos-sync/op-schema';

const base = { operationId: '00000000-0000-4000-8000-000000000001', deviceId: '11111111-1111-4111-8111-111111111111', clientAt: '2026-10-25T08:00:00.000Z' };
const onOrder = { orderRef: { id: 'order1' }, expectedVersion: 2 };

const samples = {
  openOrder: { ...base, kind: 'openOrder', payload: { tableId: 't1' } },
  addLine: { ...base, ...onOrder, kind: 'addLine', payload: { productId: 'p1', quantity: 2, note: '', optionIds: [] } },
  sendToKitchen: { ...base, ...onOrder, kind: 'sendToKitchen', payload: {} },
  requestBill: { ...base, ...onOrder, kind: 'requestBill', payload: {} },
  cancelOrder: { ...base, ...onOrder, kind: 'cancelOrder', payload: { reason: 'left' } },
  payCash: { ...base, ...onOrder, kind: 'payCash', payload: { expectedTotal: 10_000, amountReceived: 12_000 } },
} as const;

describe('the queueable operations', () => {
  it('parses a valid sample of every kind', () => {
    for (const kind of OP_KINDS) expect(operationSchema.safeParse(samples[kind]).success, kind).toBe(true);
  });

  it('never queues a terminal method: a payCash payload carries no method or reference', () => {
    for (const extra of [{ method: 'FIB' }, { method: 'CASH' }, { reference: 'TX-1' }]) {
      const op = { ...samples.payCash, payload: { ...samples.payCash.payload, ...extra } };
      expect(operationSchema.safeParse(op).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('refuses everything that needs the network', () => {
    for (const kind of ['openShift', 'closeShift', 'moveToTable', 'advanceFulfillment', 'updateLine', 'setInvoiceDiscount', 'reversePayment', 'payTerminal']) {
      expect(operationSchema.safeParse({ ...samples.sendToKitchen, kind }).success, kind).toBe(false);
    }
  });

  it('refuses a payment that names a method, a float or a negative amount', () => {
    const pay = samples.payCash;
    expect(operationSchema.safeParse({ ...pay, payload: { ...pay.payload, method: 'FIB' } }).success).toBe(false);
    expect(operationSchema.safeParse({ ...pay, payload: { ...pay.payload, amountReceived: 10.5 } }).success).toBe(false);
    expect(operationSchema.safeParse({ ...pay, payload: { ...pay.payload, expectedTotal: -1 } }).success).toBe(false);
  });

  it('takes an order reference with exactly one of id and op', () => {
    expect(operationSchema.safeParse({ ...samples.requestBill, orderRef: { id: 'a', op: base.operationId } }).success).toBe(false);
    expect(operationSchema.safeParse({ ...samples.requestBill, orderRef: { op: base.operationId } }).success).toBe(true);
    expect(operationSchema.safeParse({ ...samples.requestBill, orderRef: {} }).success).toBe(false);
  });

  it('refuses a version below 1 and an operation id that is not a uuid', () => {
    expect(operationSchema.safeParse({ ...samples.requestBill, expectedVersion: 0 }).success).toBe(false);
    expect(operationSchema.safeParse({ ...samples.requestBill, operationId: 'not-a-uuid' }).success).toBe(false);
  });

  it('takes one to 25 operations in a request', () => {
    const op = samples.requestBill;
    expect(syncRequestSchema.safeParse({ scope: "r1:u1", deviceId: base.deviceId, operations: [] }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ scope: "r1:u1", deviceId: base.deviceId, operations: Array(25).fill(op) }).success).toBe(true);
    expect(syncRequestSchema.safeParse({ scope: "r1:u1", deviceId: base.deviceId, operations: Array(26).fill(op) }).success).toBe(false);
  });
});
