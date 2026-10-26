import { describe, expect, it } from 'vitest';
import { canAdvance, isFinished, nextSteps } from '@/server/domain/pos/fulfillment';

describe('fulfillment moves', () => {
  it('walks a takeaway to pickup and a delivery to the door, one step at a time', () => {
    expect(nextSteps('TAKEAWAY', 'READY')).toEqual({ forward: 'PICKED_UP', back: 'PREPARING' });
    expect(nextSteps('DELIVERY', 'READY')).toEqual({ forward: 'OUT', back: 'PREPARING' });
    expect(nextSteps('DELIVERY', 'OUT')).toEqual({ forward: 'DELIVERED', back: 'READY' });
    expect(nextSteps('DELIVERY', 'NEW')).toEqual({ forward: 'PREPARING', back: null });
  });

  it('allows no skip, no other step back and nothing after the end', () => {
    expect(canAdvance('DELIVERY', 'NEW', 'READY')).toBe(false);
    expect(canAdvance('TAKEAWAY', 'READY', 'OUT')).toBe(false);
    expect(canAdvance('DELIVERY', 'PREPARING', 'NEW')).toBe(false);
    for (const end of ['DELIVERED', 'PICKED_UP'] as const) expect(nextSteps('DELIVERY', end)).toEqual({ forward: null, back: null });
    expect(isFinished('DELIVERED') && isFinished('PICKED_UP') && !isFinished('OUT')).toBe(true);
  });
});
