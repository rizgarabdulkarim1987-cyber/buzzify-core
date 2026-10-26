import { describe, expect, it } from 'vitest';
import { isExpired, promoDiscountPerUnit, QR_LIMITS } from '@/server/domain/pos/customer-order-rules';

const at = (iso: string) => new Date(iso);

describe('customer order rules', () => {
  it('states the limits of the plan', () => {
    expect(QR_LIMITS).toMatchObject({ pendingPerTable: 3, perTablePer10Min: 5, perRestaurantPerHour: 300, maxLines: 30, maxQuantity: 20, maxNote: 300, expiryMinutes: 60 });
  });

  it('isExpired is true at exactly 60 minutes and false at 59:59', () => {
    const now = at('2026-10-25T12:00:00Z');
    expect(isExpired(at('2026-10-25T11:00:00Z'), now)).toBe(true);
    expect(isExpired(at('2026-10-25T11:00:01Z'), now)).toBe(false);
  });

  it('promoDiscountPerUnit is what the quote took off and never negative', () => {
    expect(promoDiscountPerUnit(5000, 500, 4950)).toBe(550);
    expect(promoDiscountPerUnit(5000, 0, 5000)).toBe(0);
    expect(promoDiscountPerUnit(5000, 0, 6000)).toBe(0);
  });
});
