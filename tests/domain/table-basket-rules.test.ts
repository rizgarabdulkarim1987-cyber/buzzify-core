import { describe, expect, it } from 'vitest';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { BASKET_LIMITS, fitsOneOrder, isLive, lastSentOrder, mergedLines, type BasketLine, type BasketPart } from '@/server/domain/pos/table-basket-rules';

const NOW = new Date('2026-10-31T20:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const line = (productId: string): BasketLine => ({ productId, variantId: null, optionIds: [], quantity: 1, note: '' });
const part = (ownerKey: string, lines: BasketLine[], changed = 5, sent: { id: string; ago: number } | null = null): BasketPart => ({
  ownerKey,
  name: '',
  lines,
  updatedAt: minutesAgo(changed),
  sentPublicId: sent?.id ?? null,
  sentAt: sent ? minutesAgo(sent.ago) : null,
});

describe('a part of the table basket', () => {
  it('is live for three hours after its last change, and not once sent', () => {
    expect(isLive(part('a', [line('x')], BASKET_LIMITS.liveMinutes - 1), NOW)).toBe(true);
    expect(isLive(part('a', [line('x')], BASKET_LIMITS.liveMinutes), NOW)).toBe(false);
    expect(isLive(part('a', [line('x')], 1, { id: 'o1', ago: 1 }), NOW)).toBe(false);
  });

  it('merges the live parts into one cart, the oldest part first, leaving out sent and stale ones', () => {
    const parts = [part('b', [line('juice')], 2), part('a', [line('burger')], 9), part('old', [line('stale')], 400), part('sent', [line('done')], 3, { id: 'o1', ago: 2 })];
    expect(mergedLines(parts, NOW).map((l) => l.productId)).toEqual(['burger', 'juice']);
  });

  it('names the newest order sent within half an hour, and none after that', () => {
    const parts = [part('a', [], 40, { id: 'old', ago: 40 }), part('b', [], 10, { id: 'mid', ago: 10 }), part('c', [], 4, { id: 'new', ago: 4 })];
    expect(lastSentOrder(parts, NOW)?.publicId).toBe('new');
    expect(lastSentOrder([part('a', [], 40, { id: 'old', ago: 40 })], NOW)).toBeNull();
    expect(lastSentOrder([part('a', [line('x')])], NOW)).toBeNull();
  });

  it('fits one order while all the live lines stay within the order’s cap, counting the guest’s new lines instead of their old ones', () => {
    const others = [part('b', Array.from({ length: QR_LIMITS.maxLines - 2 }, (_, i) => line(`p${i}`)))];
    expect(fitsOneOrder(others, 'a', [line('x'), line('y')], NOW)).toBe(true);
    expect(fitsOneOrder(others, 'a', [line('x'), line('y'), line('z')], NOW)).toBe(false);
    // Replacing one's own part counts the new lines only.
    const withOwn = [...others, part('a', [line('old1'), line('old2')])];
    expect(fitsOneOrder(withOwn, 'a', [line('x'), line('y')], NOW)).toBe(true);
  });
});
