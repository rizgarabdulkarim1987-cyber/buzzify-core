import { describe, expect, it } from 'vitest';
import { RETAIL_LIMIT_KEYS, retailLimitsSchema } from '@/server/domain/retail/limits';

const ok = { branches: 1, users: 5, terminals: 2, storageMb: 100, aiMonthly: 0 };

describe('retailLimitsSchema', () => {
  it('accepts 0', () => {
    const zero = Object.fromEntries(RETAIL_LIMIT_KEYS.map((k) => [k, 0]));
    expect(retailLimitsSchema.safeParse(zero).success).toBe(true);
    expect(retailLimitsSchema.safeParse({ ...ok, branches: 1_000_000_000 }).success).toBe(true);
  });

  it('refuses negative, fractions, > 1e9 and missing keys', () => {
    expect(retailLimitsSchema.safeParse({ ...ok, users: -1 }).success).toBe(false);
    expect(retailLimitsSchema.safeParse({ ...ok, users: 1.5 }).success).toBe(false);
    expect(retailLimitsSchema.safeParse({ ...ok, storageMb: 1_000_000_001 }).success).toBe(false);
    for (const key of RETAIL_LIMIT_KEYS) {
      const rest: Record<string, number> = { ...ok };
      delete rest[key];
      expect(retailLimitsSchema.safeParse(rest).success).toBe(false);
    }
  });

  it('ignores no extra key silently', () => {
    expect(retailLimitsSchema.safeParse({ ...ok, seats: 3 }).success).toBe(false);
  });
});
