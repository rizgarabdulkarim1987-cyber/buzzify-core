import { describe, expect, it } from 'vitest';
import { canQueue, OFFLINE_MAX_AGE_MS } from '@/lib/pos-sync/guards';
import { deriveLocalState, localTotals } from '@/lib/pos-sync/local-state';
import type { Op } from '@/lib/pos-sync/op-schema';
import type { OpDraft, QueuedOp } from '@/lib/pos-sync/queue';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';
import { computeTotals } from '@/server/domain/pos/totals';

const device = '11111111-1111-4111-8111-111111111111';
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    serverTime: '2026-10-25T08:00:00.000Z',
    restaurantId: 'r1',
    user: { id: 'u1', name: 'Cashier', locale: 'ar', can: { discount: true, cancel: true, pay: true } },
    rates: { serviceRatePercent: 5, taxRatePercent: 10 },
    kitchen: { print: true, screen: false },
    catalog: {
      menuId: 'm1',
      currency: 'IQD',
      locales: ['ar', 'en'],
      defaultLocale: 'ar',
      categories: [{ id: 'c1', sortOrder: 1, names: { ar: 'أكل' }, sectionId: null }],
      products: [
        {
          id: 'burger',
          categoryId: 'c1',
          sortOrder: 1,
          names: { ar: 'برغر', en: 'Burger' },
          price: 5000,
          available: true,
          hiddenFromGuests: false,
          sectionId: null,
          variants: [
            { id: 'small', names: { ar: 'صغير' }, priceDelta: 0, isDefault: true },
            { id: 'large', names: { ar: 'كبير' }, priceDelta: 1000, isDefault: false },
          ],
          groups: [{ id: 'g1', names: { ar: 'إضافات' }, minSelect: 0, maxSelect: 2, options: [{ id: 'cheese', names: { ar: 'جبن' }, priceDelta: 500, available: true }] }],
        },
      ],
    },
    areas: [{ id: 'a1', name: 'Hall', tables: [{ id: 't1', number: 1 }, { id: 't2', number: 2 }] }],
    orders: [],
    openShift: { id: 's1' },
    ...over,
  };
}

let seq = 0;
function queued(op: OpDraft & { operationId?: string }, extra: Partial<QueuedOp> = {}): QueuedOp {
  const operationId = op.operationId ?? id();
  return {
    operationId,
    scope: 'r1:u1',
    seq: ++seq,
    kind: op.kind,
    op: { ...op, operationId, deviceId: device, clientAt: '2026-10-25T08:00:00.000Z' } as Op,
    state: 'pending',
    attempts: 0,
    lastError: null,
    result: null,
    doneAt: null,
    provisional: op.kind === 'openOrder' ? 'P-1111-1' : null,
    ...extra,
  };
}

const add = (ref: { op: string } | { id: string }, expectedVersion: number, payload: Partial<{ quantity: number; variantId: string; optionIds: string[]; note: string }> = {}) =>
  queued({ kind: 'addLine', orderRef: ref, expectedVersion, payload: { productId: 'burger', quantity: 1, note: '', optionIds: [], ...payload } });

describe('the order as the device sees it', () => {
  it('prices the lines as the server will: the size, the options and the quantity, then tax and service', () => {
    const open = queued({ kind: 'openOrder', payload: { tableId: 't1' } });
    const state = deriveLocalState(snapshot(), [open, add({ op: open.operationId }, 1, { quantity: 2, variantId: 'large', optionIds: ['cheese'] })]);
    const order = state.live[0]!;
    expect(order.lines[0]).toMatchObject({ name: 'برغر', quantity: 2, unitPrice: 5000, options: [{ id: 'large', priceDelta: 1000 }, { id: 'cheese', priceDelta: 500 }] });
    // (5000 + 1000 + 500) x 2 = 13000; 5% service = 650; 10% tax on 13650 = 1365.
    expect(localTotals(order, snapshot().rates)).toEqual(computeTotals([{ unitPrice: 5000, optionsTotal: 1500, quantity: 2 }], undefined, snapshot().rates));
    expect(localTotals(order, snapshot().rates).total).toBe(15_015);
  });

  it('handles a 100 percent invoice discount over a discounted line', () => {
    const order = { lines: [{ id: 'l', productId: 'p', name: 'x', quantity: 2, unitPrice: 3000, options: [], note: '', discount: { kind: 'PERCENT' as const, value: 50 }, cancelled: false, sent: false }], invoiceDiscount: { kind: 'PERCENT' as const, value: 100 } };
    expect(localTotals({ lines: [...order.lines], invoiceDiscount: order.invoiceDiscount }, { serviceRatePercent: 0, taxRatePercent: 10 }).total).toBe(0);
  });

  it('opens a table with a provisional number and the version the next operation must carry', () => {
    const open = queued({ kind: 'openOrder', payload: { tableId: 't2' } });
    const a = add({ op: open.operationId }, 1);
    const b = add({ op: open.operationId }, 2);
    const state = deriveLocalState(snapshot(), [open, a, b]);
    const order = state.byTable.get('t2')!;
    expect(order).toMatchObject({ provisional: 'P-1111-1', serverId: null, waiting: 3, version: 3 });
    expect(order.lines.map((l) => l.id)).toEqual([`op:${a.operationId}`, `op:${b.operationId}`]);
    expect(state.byTable.has('t1')).toBe(false);
  });

  it('carries on from the version of an order the server already holds', () => {
    const snap = snapshot({ orders: [{ id: 'o9', number: 9, status: 'OPEN', version: 4, tableId: 't1', seatedAt: '2026-10-25T07:00:00.000Z', invoiceDiscount: null, lines: [] }] });
    const state = deriveLocalState(snap, [add({ id: 'o9' }, 4)]);
    expect(state.byTable.get('t1')).toMatchObject({ serverId: 'o9', number: 9, version: 5, waiting: 1 });
  });

  it('marks lines sent, asks for the bill, and brings a billed order back to open when a line is added', () => {
    const open = queued({ kind: 'openOrder', payload: { tableId: 't1' } });
    const ref = { op: open.operationId };
    const sent = deriveLocalState(snapshot(), [open, add(ref, 1), queued({ kind: 'sendToKitchen', orderRef: ref, expectedVersion: 2, payload: {} })]).live[0]!;
    expect(sent.lines[0]?.sent).toBe(true);
    const billed = deriveLocalState(snapshot(), [open, add(ref, 1), queued({ kind: 'requestBill', orderRef: ref, expectedVersion: 2, payload: {} })]).live[0]!;
    expect(billed.status).toBe('BILL_REQUESTED');
    const again = deriveLocalState(snapshot(), [open, add(ref, 1), queued({ kind: 'requestBill', orderRef: ref, expectedVersion: 2, payload: {} }), add(ref, 3)]).live[0]!;
    expect(again.status).toBe('OPEN');
  });

  it('takes a paid order off the floor and records the change; a cancelled order leaves too', () => {
    const open = queued({ kind: 'openOrder', payload: { tableId: 't1' } });
    const ref = { op: open.operationId };
    const paid = deriveLocalState(snapshot(), [open, add(ref, 1, { quantity: 2 }), queued({ kind: 'payCash', orderRef: ref, expectedVersion: 2, payload: { expectedTotal: 11_550, amountReceived: 15_000 } })]);
    expect(paid.live).toEqual([]);
    expect(paid.all[0]?.paid).toEqual({ total: 11_550, amountReceived: 15_000, change: 3_450 });
    const cancelled = deriveLocalState(snapshot(), [open, queued({ kind: 'cancelOrder', orderRef: ref, expectedVersion: 1, payload: { reason: 'left' } })]);
    expect(cancelled.live).toEqual([]);
    expect(cancelled.all[0]?.cancelled).toBe(true);
  });

  it('follows an order the server opened for an applied operation, and flags an operation that needs attention', () => {
    const open = queued({ kind: 'openOrder', payload: { tableId: 't1' } }, { state: 'done', result: { orderId: 'o5', number: 5, version: 1 } });
    const snap = snapshot({ orders: [{ id: 'o5', number: 5, status: 'OPEN', version: 1, tableId: 't1', seatedAt: null as unknown as string, invoiceDiscount: null, lines: [] }] });
    const stuck = { ...add({ op: open.operationId }, 1), state: 'attention' as const };
    const order = deriveLocalState(snap, [open, stuck]).live[0]!;
    expect(order).toMatchObject({ serverId: 'o5', number: 5, waiting: 1, attention: true, version: 2 });
  });
});

describe('what may be queued', () => {
  const state = (over: Partial<SyncSnapshot> = {}, age = 0) => ({ snapshot: snapshot(over), snapshotAt: 1_000_000, now: 1_000_000 + age });

  it('wants an open shift and the permission to take cash', () => {
    expect(canQueue('payCash', state({ openShift: null }))).toEqual({ ok: false, reason: 'noShift' });
    expect(canQueue('payCash', state({ user: { ...snapshot().user, can: { discount: true, cancel: true, pay: false } } }))).toEqual({ ok: false, reason: 'forbidden' });
    expect(canQueue('payCash', state())).toEqual({ ok: true });
  });

  it('wants the cancel permission for cancelling an order', () => {
    expect(canQueue('cancelOrder', state({ user: { ...snapshot().user, can: { discount: false, cancel: false, pay: true } } }))).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('refuses everything once the snapshot is more than twelve hours old', () => {
    expect(canQueue('addLine', state({}, OFFLINE_MAX_AGE_MS))).toEqual({ ok: true });
    expect(canQueue('addLine', state({}, OFFLINE_MAX_AGE_MS + 1))).toEqual({ ok: false, reason: 'stale' });
  });

  it('keeps what needs the network out of the queue', () => {
    for (const kind of ['openShift', 'closeShift', 'moveToTable', 'advanceFulfillment', 'addExpense']) {
      expect(canQueue(kind, state())).toEqual({ ok: false, reason: 'onlineOnly' });
    }
  });
});
