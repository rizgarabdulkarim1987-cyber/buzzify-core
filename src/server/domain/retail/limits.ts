import { z } from 'zod';

/** Retails' own maximum for a limit; 0 means none. */
const LIMIT_MAX = 1_000_000_000;
const limit = z.number().int().min(0).max(LIMIT_MAX);

/** The limits a Retails plan carries, as the snapshot sends them. Strict: an unknown key is an error, not ignored. */
export const retailLimitsSchema = z
  .object({ branches: limit, users: limit, terminals: limit, storageMb: limit, aiMonthly: limit })
  .strict();
export type RetailLimits = z.infer<typeof retailLimitsSchema>;
export const RETAIL_LIMIT_KEYS = ['branches', 'users', 'terminals', 'storageMb', 'aiMonthly'] as const;
