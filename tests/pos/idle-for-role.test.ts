import { describe, expect, it } from 'vitest';
import { idleMinutesFor } from '@/lib/pos-idle';

describe('idleMinutesFor', () => {
  it('never signs the kitchen screen out, which nobody touches in a quiet spell', () => {
    expect(idleMinutesFor('KITCHEN', 15)).toBe(0);
  });

  it('keeps the restaurant’s minutes for every other role', () => {
    for (const role of ['OWNER', 'MANAGER', 'CASHIER'] as const) expect(idleMinutesFor(role, 15)).toBe(15);
  });
});
