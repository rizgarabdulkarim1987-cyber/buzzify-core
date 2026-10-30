import { describe, expect, it } from 'vitest';
import { roundTo } from '@/server/domain/pos/rounding';
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

  describe('with a rounding step', () => {
    /** Pays a bill of one line per guest, part after part, the way the till does; returns what each part paid. */
    const payInParts = (lineTotals: number[], step: number) => {
      const bill = lineTotals.map((total, i) => ({ id: `l${i}`, total, paid: false }));
      const subtotal = lineTotals.reduce((a, b) => a + b, 0);
      const whole = { subtotal, invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 0, total: subtotal };
      const paid: number[] = [];
      let taken = { ...none, billed: 0, paid: 0 };
      bill.forEach((line, i) => {
        const part = partTotals(whole, bill.map((l, j) => ({ ...l, paid: j < i })), [line.id], taken, step);
        paid.push(part.total);
        taken = {
          invoiceDiscount: taken.invoiceDiscount + part.invoiceDiscount,
          service: taken.service + part.service,
          tax: taken.tax + part.tax,
          deliveryFee: taken.deliveryFee + part.deliveryFee,
          billed: taken.billed + part.total - part.rounding,
          paid: taken.paid + part.total,
        };
      });
      return { paid, rounded: roundTo(subtotal, step).total };
    };

    it.each([250, 500, 1000])('never makes the parts pay more than the rounded bill (step %i, 3 to 7 small parts)', (step) => {
      for (let guests = 3; guests <= 7; guests++) {
        for (const each of [100, 260, 600, 1_400, 1_600, 2_499]) {
          const { paid, rounded } = payInParts(Array.from({ length: guests }, () => each), step);
          expect(paid.reduce((a, b) => a + b, 0), `${guests} x ${each}`).toBe(rounded);
          for (const part of paid) {
            expect(part).toBeGreaterThanOrEqual(0);
            expect(part % step).toBe(0);
          }
        }
      }
    });

    it('used to overcharge seven guests of 600 at a step of 1000 (7000 for a bill of 4000)', () => {
      expect(payInParts(Array(7).fill(600), 1000).paid.reduce((a, b) => a + b, 0)).toBe(4_000);
    });

    it('rounds the first part, and a bill paid at once, on its own as before', () => {
      expect(partTotals(full, lines, ['a', 'b', 'c'], none, 250)).toEqual({ ...full, total: 11_250, rounding: -101 });
      expect(partTotals(full, lines, ['a'], none, 1000).total).toBe(roundTo(partTotals(full, lines, ['a'], none).total, 1000).total);
    });
  });

  it('spreads a bill of free lines by count', () => {
    const free = [{ id: 'a', total: 0, paid: false }, { id: 'b', total: 0, paid: false }];
    const part = partTotals({ subtotal: 0, invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 1_000, total: 1_000 }, free, ['a'], none);
    expect(part.deliveryFee).toBe(500);
  });
});
