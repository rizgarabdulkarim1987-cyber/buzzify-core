import { describe, expect, it } from 'vitest';
import {
  TransferError,
  canTransition,
  checkReceive,
  closeStatus,
  conservation,
  inTransitQty,
  needsLossApproval,
  planSend,
  transferPayloadHash,
  type SendBatch,
} from '@/server/domain/pharmacy/transfers';

/** Pure rules of a transfer between branches: no database, no clock (today comes in). */

const TODAY = '2026-10-27';
const batch = (id: string, over: Partial<SendBatch> = {}): SendBatch => ({
  id,
  productId: 'P1',
  lot: id.toUpperCase(),
  expiryDate: '2028-03-31',
  expiryPrecision: 'MONTH',
  status: 'ACTIVE',
  available: 0,
  ...over,
});

function failure(fn: () => unknown): TransferError {
  try {
    fn();
  } catch (e) {
    if (e instanceof TransferError) return e;
    throw e;
  }
  throw new Error('expected a TransferError');
}

describe('the transfer state machine (R6-1)', () => {
  it('allows REQUESTED to SENT or CANCELLED, SENT to RECEIVED or PARTIAL, and nothing else', () => {
    expect(canTransition('REQUESTED', 'SENT')).toBe(true);
    expect(canTransition('REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('SENT', 'RECEIVED')).toBe(true);
    expect(canTransition('SENT', 'PARTIAL')).toBe(true);
  });
  it('never cancels a sent transfer, never receives a request, never leaves a closed state', () => {
    expect(canTransition('SENT', 'CANCELLED')).toBe(false);
    expect(canTransition('REQUESTED', 'RECEIVED')).toBe(false);
    expect(canTransition('REQUESTED', 'PARTIAL')).toBe(false);
    for (const closed of ['RECEIVED', 'PARTIAL', 'CANCELLED'] as const) {
      for (const to of ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'] as const) {
        expect(canTransition(closed, to), `${closed} to ${to}`).toBe(false);
      }
    }
    expect(canTransition('SENT', 'SENT')).toBe(false);
  });
});

describe('planSend', () => {
  it('allocates 30 units FEFO over two batches: 18 from the earlier expiry, 12 from the next', () => {
    const plan = planSend({
      lines: [{ lineId: 'L1', productId: 'P1', requestedQty: 30 }],
      batches: [batch('late', { expiryDate: '2029-01-31', available: 50 }), batch('early', { expiryDate: '2027-06-30', available: 18 })],
      today: TODAY,
    });
    expect(plan.allocations).toEqual([
      { lineId: 'L1', productId: 'P1', batchId: 'early', qty: 18, override: false },
      { lineId: 'L1', productId: 'P1', batchId: 'late', qty: 12, override: false },
    ]);
    expect(plan.override).toBe(false);
    expect(plan.totalQty).toBe(30);
  });

  it('skips expired, recalled, blocked and empty batches', () => {
    const plan = planSend({
      lines: [{ lineId: 'L1', productId: 'P1', requestedQty: 5 }],
      batches: [
        batch('expired', { expiryDate: '2026-10-26', available: 100 }),
        batch('recalled', { status: 'RECALLED', available: 100 }),
        batch('blocked', { status: 'BLOCKED', available: 100 }),
        batch('empty', { available: 0 }),
        batch('good', { expiryDate: '2030-01-31', available: 5 }),
      ],
      today: TODAY,
    });
    expect(plan.allocations.map((a) => [a.batchId, a.qty])).toEqual([['good', 5]]);
  });

  it('may send a batch on its expiry day (expired only the day after)', () => {
    const plan = planSend({ lines: [{ lineId: 'L1', productId: 'P1', requestedQty: 2 }], batches: [batch('today', { expiryDate: TODAY, available: 2 })], today: TODAY });
    expect(plan.allocations).toHaveLength(1);
  });

  it('names every product that is short, with what was asked and what is sendable, and plans nothing', () => {
    const error = failure(() =>
      planSend({
        lines: [
          { lineId: 'L1', productId: 'P1', requestedQty: 30 },
          { lineId: 'L2', productId: 'P2', requestedQty: 4 },
          { lineId: 'L3', productId: 'P3', requestedQty: 1 },
        ],
        batches: [batch('a', { available: 10 }), batch('b', { productId: 'P2', available: 4 }), batch('x', { productId: 'P1', status: 'RECALLED', available: 99 })],
        today: TODAY,
      }),
    );
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.shortfalls).toEqual([
      { productId: 'P1', requested: 30, available: 10 },
      { productId: 'P3', requested: 1, available: 0 },
    ]);
  });

  it('sends a partial line from picks in FEFO order without an override', () => {
    const plan = planSend({
      lines: [{ lineId: 'L1', productId: 'P1', requestedQty: 30 }],
      batches: [batch('early', { expiryDate: '2027-06-30', available: 18 }), batch('late', { expiryDate: '2029-01-31', available: 50 })],
      picks: [
        { lineId: 'L1', batchId: 'early', qty: 18 },
        { lineId: 'L1', batchId: 'late', qty: 2 },
      ],
      today: TODAY,
    });
    expect(plan.totalQty).toBe(20);
    expect(plan.override).toBe(false);
    expect(plan.allocations.every((a) => !a.override)).toBe(true);
  });

  it('flags a pick out of FEFO order as an override, and only that line', () => {
    const plan = planSend({
      lines: [
        { lineId: 'L1', productId: 'P1', requestedQty: 10 },
        { lineId: 'L2', productId: 'P2', requestedQty: 3 },
      ],
      batches: [batch('early', { expiryDate: '2027-06-30', available: 18 }), batch('late', { expiryDate: '2029-01-31', available: 50 }), batch('q', { productId: 'P2', available: 3 })],
      picks: [{ lineId: 'L1', batchId: 'late', qty: 10 }],
      today: TODAY,
    });
    expect(plan.override).toBe(true);
    expect(plan.allocations).toEqual([
      { lineId: 'L1', productId: 'P1', batchId: 'late', qty: 10, override: true },
      { lineId: 'L2', productId: 'P2', batchId: 'q', qty: 3, override: false },
    ]);
  });

  it('refuses a pick of an expired, recalled or blocked batch even as an override', () => {
    const lines = [{ lineId: 'L1', productId: 'P1', requestedQty: 5 }];
    for (const bad of [batch('x', { expiryDate: '2026-01-31', available: 9 }), batch('x', { status: 'RECALLED', available: 9 }), batch('x', { status: 'BLOCKED', available: 9 })]) {
      expect(failure(() => planSend({ lines, batches: [bad, batch('ok', { available: 9 })], picks: [{ lineId: 'L1', batchId: 'x', qty: 5 }], today: TODAY })).code).toBe('BATCH_NOT_SENDABLE');
    }
  });

  it('refuses picks of a batch of another product, of an unknown line, twice, over the request, over the stock', () => {
    const lines = [{ lineId: 'L1', productId: 'P1', requestedQty: 5 }];
    const batches = [batch('a', { available: 3 }), batch('b', { available: 9 }), batch('other', { productId: 'P2', available: 9 })];
    const run = (picks: { lineId: string; batchId: string; qty: number }[]) => failure(() => planSend({ lines, batches, picks, today: TODAY })).code;
    expect(run([{ lineId: 'L1', batchId: 'other', qty: 1 }])).toBe('PICK_BATCH_INVALID');
    expect(run([{ lineId: 'L1', batchId: 'nope', qty: 1 }])).toBe('PICK_BATCH_INVALID');
    expect(run([{ lineId: 'L9', batchId: 'a', qty: 1 }])).toBe('PICK_LINE_UNKNOWN');
    expect(run([{ lineId: 'L1', batchId: 'a', qty: 1 }, { lineId: 'L1', batchId: 'a', qty: 1 }])).toBe('DUPLICATE_PICK');
    expect(run([{ lineId: 'L1', batchId: 'b', qty: 6 }])).toBe('OVER_REQUESTED');
    expect(run([{ lineId: 'L1', batchId: 'a', qty: 4 }])).toBe('INSUFFICIENT_STOCK');
  });

  it('allows a zero pick to leave a line unsent, but sends at least one unit overall', () => {
    const lines = [
      { lineId: 'L1', productId: 'P1', requestedQty: 5 },
      { lineId: 'L2', productId: 'P2', requestedQty: 5 },
    ];
    const batches = [batch('a', { available: 9 }), batch('b', { productId: 'P2', available: 9 })];
    const plan = planSend({ lines, batches, picks: [{ lineId: 'L1', batchId: 'a', qty: 0 }], today: TODAY });
    expect(plan.allocations.map((a) => [a.lineId, a.batchId, a.qty])).toEqual([['L2', 'b', 5]]);
    const none = failure(() =>
      planSend({ lines, batches, picks: [{ lineId: 'L1', batchId: 'a', qty: 0 }, { lineId: 'L2', batchId: 'b', qty: 0 }], today: TODAY }),
    );
    expect(none.code).toBe('NOTHING_TO_SEND');
  });
});

describe('checkReceive', () => {
  const sent = (over: Partial<{ lineId: string; sentQty: number; receivedQty: number; damagedQty: number; lostQty: number; lostReason: 'LOST' | 'OTHER'; quarantine: boolean }> = {}) => ({
    lineId: 'L1',
    sentQty: 30,
    receivedQty: 30,
    damagedQty: 0,
    lostQty: 0,
    quarantine: false,
    ...over,
  });

  it('accepts a full receipt and drops a reason that has nothing lost', () => {
    const [line] = checkReceive([sent({ lostReason: 'LOST' })]);
    expect(line).toMatchObject({ lineId: 'L1', receivedQty: 30, damagedQty: 0, lostQty: 0, lostReason: null });
  });

  it('accepts 25 received and 5 lost with a reason', () => {
    const [line] = checkReceive([sent({ receivedQty: 25, lostQty: 5, lostReason: 'LOST' })]);
    expect(line).toMatchObject({ receivedQty: 25, lostQty: 5, lostReason: 'LOST' });
  });

  it('accepts a damaged shortfall with no reason (damaged is the reason), and a mix with LOST or OTHER', () => {
    expect(checkReceive([sent({ receivedQty: 26, damagedQty: 4 })])[0]).toMatchObject({ damagedQty: 4, lostQty: 0, lostReason: null });
    expect(checkReceive([sent({ receivedQty: 20, damagedQty: 4, lostQty: 6, lostReason: 'OTHER' })])[0]).toMatchObject({ lostReason: 'OTHER', damagedQty: 4, lostQty: 6 });
  });

  it('refuses more than sent, a lost quantity with no reason, and units not accounted for', () => {
    expect(failure(() => checkReceive([sent({ receivedQty: 31 })])).code).toBe('OVER_SENT');
    expect(failure(() => checkReceive([sent({ receivedQty: 25, lostQty: 6, lostReason: 'LOST' })])).code).toBe('OVER_SENT');
    expect(failure(() => checkReceive([sent({ receivedQty: 25, lostQty: 5 })])).code).toBe('REASON_REQUIRED');
    expect(failure(() => checkReceive([sent({ receivedQty: 20 })])).code).toBe('UNACCOUNTED');
    expect(failure(() => checkReceive([sent({ receivedQty: 20, damagedQty: 4 })])).code).toBe('UNACCOUNTED');
  });

  it('refuses negative or fractional quantities', () => {
    expect(failure(() => checkReceive([sent({ receivedQty: -1 })])).code).toBe('INVALID_QUANTITY');
    expect(failure(() => checkReceive([sent({ receivedQty: 29.5, lostQty: 0.5, lostReason: 'LOST' })])).code).toBe('INVALID_QUANTITY');
  });
});

describe('closing a transfer', () => {
  const line = (sentQty: number, receivedQty: number, lostQty = 0, damagedQty = 0) => ({ sentQty, receivedQty, lostQty, damagedQty });

  it('is RECEIVED when every line was received in full, else PARTIAL', () => {
    expect(closeStatus([line(30, 30), line(5, 5)])).toBe('RECEIVED');
    expect(closeStatus([line(30, 25, 5), line(5, 5)])).toBe('PARTIAL');
    expect(closeStatus([line(30, 26, 0, 4)])).toBe('PARTIAL');
  });

  it('needs loss approval only for LOST or OTHER quantities, not for damaged ones', () => {
    expect(needsLossApproval([line(30, 30)])).toBe(false);
    expect(needsLossApproval([line(30, 26, 0, 4)])).toBe(false);
    expect(needsLossApproval([line(30, 25, 5), line(5, 5)])).toBe(true);
  });
});

describe('in transit and conservation', () => {
  it('in transit is sent minus received, damaged and lost, over the lines of open transfers', () => {
    expect(inTransitQty([{ sentQty: 30, receivedQty: 0, damagedQty: 0, lostQty: 0 }, { sentQty: 10, receivedQty: 0, damagedQty: 0, lostQty: 0 }])).toBe(40);
    expect(inTransitQty([{ sentQty: 30, receivedQty: 25, damagedQty: 0, lostQty: 5 }])).toBe(0);
    expect(inTransitQty([])).toBe(0);
  });

  it('adds every bucket of every branch, what is in transit and what was lost', () => {
    const a = { available: 70, reserved: 0, quarantine: 0, damaged: 0 };
    const b = { available: 25, reserved: 0, quarantine: 3, damaged: 2 };
    // 100 in the system: a sent 30 (70 left); b received 25, 3 of them into quarantine, 2 damaged on arrival... 70 + 30 = 100.
    expect(conservation({ branchBuckets: [a, b], inTransit: 0, lost: 0 })).toBe(100);
    // The same stock mid-flight: 30 in transit, none yet at b.
    expect(conservation({ branchBuckets: [a, { available: 0, reserved: 0, quarantine: 0, damaged: 0 }], inTransit: 30, lost: 0 })).toBe(100);
    // 5 lost on the way.
    expect(conservation({ branchBuckets: [a, { available: 25, reserved: 0, quarantine: 0, damaged: 0 }], inTransit: 0, lost: 5 })).toBe(100);
  });
});

describe('transferPayloadHash', () => {
  it('is the same for the same request and differs for any change', () => {
    const base = transferPayloadHash('request', ['F', 'T', [['P1', 30]], 'note']);
    expect(transferPayloadHash('request', ['F', 'T', [['P1', 30]], 'note'])).toBe(base);
    expect(transferPayloadHash('request', ['F', 'T', [['P1', 31]], 'note'])).not.toBe(base);
    expect(transferPayloadHash('send', ['F', 'T', [['P1', 30]], 'note'])).not.toBe(base);
  });
});
