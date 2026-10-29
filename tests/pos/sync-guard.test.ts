import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OP_KINDS, operationSchema } from '@/lib/pos-sync/op-schema';

/**
 * The offline queue replays a device's actions later, without the captain's gate in front of them. So no queueable kind may
 * touch a guest's request, a captain's order or a bill call: those stay online-only, where the server gate runs.
 */
const ALLOWED = ['openOrder', 'addLine', 'sendToKitchen', 'requestBill', 'cancelOrder', 'payCash'];

/** The kinds the schema really accepts: read off the union's own variants, not the hand-written OP_KINDS list. */
const schemaKinds = (): string[] => operationSchema.options.map((variant) => String(variant.shape.kind.value));

describe('the offline sync cannot reach guest requests', () => {
  it('has a schema variant for exactly the allowed kinds, and OP_KINDS lists the same', () => {
    expect(schemaKinds().sort()).toEqual([...ALLOWED].sort());
    expect([...OP_KINDS].sort()).toEqual(schemaKinds().sort());
  });

  it('queues only the known till kinds; a new kind must be added here on purpose, after it is gated', () => {
    expect([...OP_KINDS].sort()).toEqual([...ALLOWED].sort());
  });

  it('names no kind about requests, approvals, captains or bill calls', () => {
    for (const kind of OP_KINDS) expect(kind).not.toMatch(/request(?!Bill$)|approve|accept|reject|captain|billCall/i);
  });

  it('refuses an operation of a request kind at the schema', () => {
    const base = { operationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', deviceId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', clientAt: new Date().toISOString() };
    for (const kind of ['acceptRequest', 'approveRequest', 'rejectRequest', 'placeCaptainOrder', 'markBillCallSeen']) {
      expect(operationSchema.safeParse({ ...base, kind, payload: {} }).success, kind).toBe(false);
    }
  });

  it('runs only till order actions: the sync server imports neither the request nor the captain actions', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/server/pos/sync.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/pos-requests|pos-captain|customer-orders|bill-calls/);
  });
});
