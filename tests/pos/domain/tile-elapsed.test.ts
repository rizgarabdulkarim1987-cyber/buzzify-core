import { describe, expect, it } from 'vitest';
import { compactElapsed } from '@/lib/pos-format';

describe('the short time on a table tile', () => {
  it('keeps minutes under two hours', () => {
    expect(compactElapsed(0)).toEqual({ unit: 'minutes', n: 0 });
    expect(compactElapsed(59)).toEqual({ unit: 'minutes', n: 59 });
    expect(compactElapsed(119)).toEqual({ unit: 'minutes', n: 119 });
  });

  it('switches to whole hours from two hours', () => {
    expect(compactElapsed(120)).toEqual({ unit: 'hours', n: 2 });
    expect(compactElapsed(215)).toEqual({ unit: 'hours', n: 3 });
    expect(compactElapsed(47 * 60 + 59)).toEqual({ unit: 'hours', n: 47 });
  });

  it('switches to whole days from two days, so 4,880 minutes is 3 d', () => {
    expect(compactElapsed(48 * 60)).toEqual({ unit: 'days', n: 2 });
    expect(compactElapsed(4880)).toEqual({ unit: 'days', n: 3 });
  });

  it('never goes below zero or keeps a fraction', () => {
    expect(compactElapsed(-5)).toEqual({ unit: 'minutes', n: 0 });
    expect(compactElapsed(90.9)).toEqual({ unit: 'minutes', n: 90 });
  });
});
