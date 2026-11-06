import { describe, expect, it } from 'vitest';
import { emptyCart, serializeDraft, type CartLine, type CartState } from '@/app/pharmacy/_ui/sell-logic';
import {
  initialReceipts,
  MAX_RECEIPTS,
  parseReceipts,
  RECEIPTS_VERSION,
  receiptsKey,
  serializeReceipts,
  type OpenReceipt,
  type ReceiptsState,
} from '@/app/pharmacy/_ui/sell-receipts';

const line = (key: string): CartLine => ({
  key,
  productId: `p-${key}`,
  code: `c-${key}`,
  name: 'Paracetamol',
  detail: '500 mg',
  rxLevel: 'OTC',
  units: [{ id: 'u1', label: 'Box', baseQty: 1, priceMinor: '1000' }],
  unitId: 'u1',
  qty: 2,
  sellableQty: 10,
  batches: [],
  discount: null,
  batchId: null,
  batchLot: '',
  batchReason: '',
});
const cartWith = (...keys: string[]): CartState => ({ ...emptyCart(), lines: keys.map(line), seq: keys.length });
const receipt = (key: string, over: Partial<OpenReceipt> = {}): OpenReceipt => ({ key, cart: cartWith(`${key}-l`), customerId: null, fromHoldId: null, prescriptionId: null, done: false, attempt: null, ...over });
const state = (receipts: OpenReceipt[], active = 0): ReceiptsState => ({ receipts, active });
const raw = (obj: unknown) => JSON.stringify(obj);

describe('receipts on the device', () => {
  it('key carries the version, pharmacy, branch, person and currency', () => {
    expect(RECEIPTS_VERSION).toBe(3);
    expect(receiptsKey('r1', 'b1', 'u1', 'IQD')).toBe('ph-sell-receipts:v3:r1:b1:u1:IQD');
  });

  it('round trips three receipts with the active index', () => {
    const s = state([receipt('a', { customerId: 'c1' }), receipt('b', { fromHoldId: 'h1', prescriptionId: 'rx1' }), receipt('c')], 2);
    const back = parseReceipts(serializeReceipts(s), null);
    expect(back).toEqual(s);
  });

  it('corrupt or missing input gives one empty receipt', () => {
    for (const bad of ['{not json', null, '', '[]', '{"v":3}', raw({ v: 2, receipts: [] }), raw({ v: 3, receipts: 'x', active: 0 })]) {
      const s = parseReceipts(bad, null);
      expect(s.receipts).toHaveLength(1);
      expect(s.receipts[0].cart.lines).toHaveLength(0);
      expect(s.active).toBe(0);
    }
  });

  it('drops a receipt with an invalid line and keeps the others', () => {
    const bad = receipt('bad');
    (bad.cart.lines[0] as { qty: number }).qty = 0;
    const s = parseReceipts(serializeReceipts(state([receipt('a'), bad, receipt('c')], 2)), null);
    expect(s.receipts.map((r) => r.cart.lines[0].key)).toEqual(['a-l', 'c-l']);
    expect(s.active).toBe(1);
  });

  it('keeps the active pointer on the same receipt when an earlier one is dropped, and clamps when the active one is dropped', () => {
    const bad = receipt('bad');
    (bad.cart.lines[0] as { productId: unknown }).productId = 5;
    const s = parseReceipts(serializeReceipts(state([receipt('a'), receipt('b'), bad], 2)), null);
    expect(s.receipts).toHaveLength(2);
    expect(s.active).toBe(1);
  });

  it('truncates to the maximum', () => {
    const many = Array.from({ length: 9 }, (_, i) => receipt(`r${i}`));
    const s = parseReceipts(serializeReceipts(state(many, 8)), null);
    expect(s.receipts).toHaveLength(MAX_RECEIPTS);
    expect(s.active).toBe(MAX_RECEIPTS - 1);
  });

  it('does not persist done receipts', () => {
    const s = parseReceipts(serializeReceipts(state([receipt('a', { done: true }), receipt('b')], 1)), null);
    expect(s.receipts.map((r) => r.cart.lines[0].key)).toEqual(['b-l']);
    expect(s.active).toBe(0);
    const only = parseReceipts(serializeReceipts(state([receipt('a', { done: true })], 0)), null);
    expect(only.receipts).toHaveLength(1);
    expect(only.receipts[0].cart.lines).toHaveLength(0);
  });

  it('keeps an empty receipt that has a customer', () => {
    const s = parseReceipts(serializeReceipts(state([receipt('a', { cart: emptyCart(), customerId: 'c9' })])), null);
    expect(s.receipts[0].customerId).toBe('c9');
  });

  it('migrates a valid v2 draft into one receipt', () => {
    const legacy = serializeDraft('IQD', cartWith('x'), null, 'h7', 'rx7');
    const s = parseReceipts(null, legacy);
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]).toMatchObject({ fromHoldId: 'h7', prescriptionId: 'rx7', customerId: null, done: false });
    expect(s.receipts[0].cart.lines.map((l) => l.key)).toEqual(['x']);
    expect(s.receipts[0].key).toMatch(/^rc-/);
  });

  it('prefers the receipts over the legacy draft, and ignores a bad legacy draft', () => {
    const legacy = serializeDraft('IQD', cartWith('x'));
    const s = parseReceipts(serializeReceipts(state([receipt('a')])), legacy);
    expect(s.receipts[0].cart.lines[0].key).toBe('a-l');
    expect(parseReceipts(null, '{oops').receipts).toHaveLength(1);
    expect(parseReceipts(null, null)).toEqual({ receipts: [expect.objectContaining({ done: false })], active: 0 });
  });

  it('never throws on odd shapes', () => {
    for (const odd of ['null', '3', '"s"', raw({ v: 3, receipts: [null, 4, {}], active: 'x' }), raw({ v: 3, receipts: [{ key: 'k', cart: null }], active: 0 })]) {
      expect(() => parseReceipts(odd, odd)).not.toThrow();
      expect(parseReceipts(odd, null).receipts.length).toBeGreaterThanOrEqual(1);
    }
    expect(initialReceipts().receipts).toHaveLength(1);
  });
});
