import { describe, expect, it } from 'vitest';
import { partTotals } from '@/server/domain/pos/split';

const none = { invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 0 };

describe('partTotals', () => {
  const lines = [
    { id: 'a', total: 3333, paid: false },
    { id: 'b', total: 3333, paid: false },
    { id: 'c', total: 3334, paid: false },
  ];
  const full = { subtotal: 10_000, invoiceDiscount: 1_000, service: 900, tax: 451, deliveryFee: 1_000, total: 11_351 };

  it('gives every part the exact bill between them, whatever the rounding', () => {
    const first = partTotals(full, lines, ['a'], none);
    const second = partTotals(full, lines.map((l) => (l.id === 'a' ? { ...l, paid: true } : l)), ['b'], { ...none, invoiceDiscount: first.invoiceDiscount, service: first.service, tax: first.tax, deliveryFee: first.deliveryFee });
    const taken = {
      invoiceDiscount: first.invoiceDiscount + second.invoiceDiscount,
      service: first.service + second.service,
      tax: first.tax + second.tax,
      deliveryFee: first.deliveryFee + second.deliveryFee,
    };
    const last = partTotals(full, lines.map((l) => ({ ...l, paid: l.id !== 'c' })), ['c'], taken);
    expect(first.total + second.total + last.total).toBe(full.total);
    expect(last.invoiceDiscount).toBe(full.invoiceDiscount - taken.invoiceDiscount);
  });

  it('takes the whole bill when every line is chosen', () => {
    expect(partTotals(full, lines, ['a', 'b', 'c'], none)).toEqual({ ...full, rounding: 0 });
  });

  it('spreads a bill of free lines by count', () => {
    const free = [{ id: 'a', total: 0, paid: false }, { id: 'b', total: 0, paid: false }];
    const part = partTotals({ subtotal: 0, invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 1_000, total: 1_000 }, free, ['a'], none);
    expect(part.deliveryFee).toBe(500);
  });
});
