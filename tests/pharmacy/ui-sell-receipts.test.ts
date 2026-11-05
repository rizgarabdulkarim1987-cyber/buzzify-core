import { describe, expect, it } from 'vitest';
import { emptyCart, type CartLine, type CartState } from '@/app/pharmacy/_ui/sell-logic';
import { canClose, initialReceipts, MAX_RECEIPTS, receiptsReducer, type ReceiptsState } from '@/app/pharmacy/_ui/sell-receipts';

const line = (key: string): CartLine => ({
  key,
  productId: `p-${key}`,
  name: 'Paracetamol',
  detail: '500 mg',
  rxLevel: 'OTC',
  units: [{ id: 'u1', label: 'Box', baseQty: 1, priceMinor: '1000' }],
  unitId: 'u1',
  qty: 1,
  sellableQty: 10,
  batches: [],
  discount: null,
  batchId: null,
  batchLot: '',
  batchReason: '',
});
const cartWith = (...keys: string[]): CartState => ({ ...emptyCart(), lines: keys.map(line) });
const open = (s: ReceiptsState) => receiptsReducer(s, { type: 'open' });

describe('open receipts', () => {
  it('starts with one empty receipt', () => {
    const s = initialReceipts();
    expect(s.receipts).toHaveLength(1);
    expect(s.active).toBe(0);
    expect(s.receipts[0]).toMatchObject({ customerId: null, fromHoldId: null, prescriptionId: null, done: false });
    expect(s.receipts[0].cart.lines).toHaveLength(0);
  });

  it('open adds a receipt and activates it', () => {
    const s = open(initialReceipts());
    expect(s.receipts).toHaveLength(2);
    expect(s.active).toBe(1);
    expect(s.receipts[0].key).not.toBe(s.receipts[1].key);
  });

  it('open at the maximum returns the same state', () => {
    let s = initialReceipts();
    for (let i = 1; i < MAX_RECEIPTS; i++) s = open(s);
    expect(s.receipts).toHaveLength(MAX_RECEIPTS);
    expect(open(s)).toBe(s);
  });

  it('switch out of range is ignored', () => {
    const s = open(initialReceipts());
    expect(receiptsReducer(s, { type: 'switch', index: 5 })).toBe(s);
    expect(receiptsReducer(s, { type: 'switch', index: -1 })).toBe(s);
    expect(receiptsReducer(s, { type: 'switch', index: 0 }).active).toBe(0);
  });

  it('each receipt keeps its own cart across switches', () => {
    let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
    s = open(s);
    s = receiptsReducer(s, { type: 'cart', cart: cartWith('b', 'c') });
    s = receiptsReducer(s, { type: 'switch', index: 0 });
    expect(s.receipts[0].cart.lines.map((l) => l.key)).toEqual(['a']);
    s = receiptsReducer(s, { type: 'switch', index: 1 });
    expect(s.receipts[1].cart.lines.map((l) => l.key)).toEqual(['b', 'c']);
  });

  it('customer sets the active receipt only', () => {
    let s = open(initialReceipts());
    s = receiptsReducer(s, { type: 'customer', customerId: 'c1' });
    expect(s.receipts[1].customerId).toBe('c1');
    expect(s.receipts[0].customerId).toBeNull();
  });

  describe('close', () => {
    it('ignores a receipt with lines that is not done', () => {
      let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
      s = open(s);
      expect(receiptsReducer(s, { type: 'close', index: 0 })).toBe(s);
    });

    it('ignores an index out of range', () => {
      const s = open(initialReceipts());
      expect(receiptsReducer(s, { type: 'close', index: 9 })).toBe(s);
    });

    it('closing the only receipt replaces it with a fresh empty one', () => {
      const s0 = initialReceipts();
      const s = receiptsReducer(s0, { type: 'close', index: 0 });
      expect(s.receipts).toHaveLength(1);
      expect(s.active).toBe(0);
      expect(s.receipts[0].key).not.toBe(s0.receipts[0].key);
    });

    it('closing a receipt before the active one decrements active', () => {
      let s = open(open(initialReceipts()));
      expect(s.active).toBe(2);
      s = receiptsReducer(s, { type: 'close', index: 0 });
      expect(s.receipts).toHaveLength(2);
      expect(s.active).toBe(1);
    });

    it('closing the active last receipt moves active to the new last', () => {
      let s = open(open(initialReceipts()));
      s = receiptsReducer(s, { type: 'close', index: 2 });
      expect(s.active).toBe(1);
    });

    it('closes a done receipt even with lines', () => {
      let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
      s = open(s);
      s = receiptsReducer(s, { type: 'switch', index: 0 });
      s = receiptsReducer(s, { type: 'done' });
      s = receiptsReducer(s, { type: 'close', index: 0 });
      expect(s.receipts).toHaveLength(1);
    });
  });

  describe('done', () => {
    it('marks the active receipt', () => {
      let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
      s = receiptsReducer(s, { type: 'done' });
      expect(s.receipts[0].done).toBe(true);
    });

    it('open replaces a done active receipt instead of adding', () => {
      let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
      s = receiptsReducer(s, { type: 'done' });
      const doneKey = s.receipts[0].key;
      s = open(s);
      expect(s.receipts).toHaveLength(1);
      expect(s.receipts[0].done).toBe(false);
      expect(s.receipts[0].key).not.toBe(doneKey);
      expect(s.receipts[0].cart.lines).toHaveLength(0);
    });

    it('open on a full set with a done active receipt replaces it', () => {
      let s = initialReceipts();
      for (let i = 1; i < MAX_RECEIPTS; i++) s = open(s);
      s = receiptsReducer(s, { type: 'cart', cart: cartWith('a') });
      s = receiptsReducer(s, { type: 'done' });
      const n = open(s);
      expect(n.receipts).toHaveLength(MAX_RECEIPTS);
      expect(n.receipts[n.active].done).toBe(false);
    });

    it('first use of a done active receipt starts a fresh one holding the new cart', () => {
      let s = receiptsReducer(initialReceipts(), { type: 'cart', cart: cartWith('a') });
      s = receiptsReducer(s, { type: 'customer', customerId: 'c1' });
      s = receiptsReducer(s, { type: 'done' });
      s = receiptsReducer(s, { type: 'cart', cart: cartWith('z') });
      expect(s.receipts).toHaveLength(1);
      expect(s.receipts[0].done).toBe(false);
      expect(s.receipts[0].customerId).toBeNull();
      expect(s.receipts[0].cart.lines.map((l) => l.key)).toEqual(['z']);
    });
  });

  it('replace swaps the active receipt', () => {
    const base = open(initialReceipts());
    const receipt = { ...base.receipts[0], key: 'rc-x', fromHoldId: 'h1', prescriptionId: 'rx1', cart: cartWith('q') };
    const s = receiptsReducer(base, { type: 'replace', receipt });
    expect(s.receipts[1]).toBe(receipt);
    expect(s.receipts[0]).toBe(base.receipts[0]);
  });

  it('canClose: empty or done', () => {
    const r = initialReceipts().receipts[0];
    expect(canClose(r)).toBe(true);
    expect(canClose({ ...r, cart: cartWith('a') })).toBe(false);
    expect(canClose({ ...r, cart: cartWith('a'), done: true })).toBe(true);
  });
});
