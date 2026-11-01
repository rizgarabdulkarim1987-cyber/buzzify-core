import { createHash } from 'node:crypto';

/**
 * The stamp card's rules (plan feature `loyalty.stampCard`, spec 2026-10-31-project-6-loyalty-design.md). A guest's card is
 * a random token their phone keeps; only its SHA-256 is stored.
 */

export const LOYALTY = { minStamps: 3, maxStamps: 20, defaultStamps: 8, maxReward: 80 } as const;

export const cardKeyOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A card can ask for its reward once it holds the stamps the program needs. */
export const canRedeem = (stamps: number, required: number): boolean => required >= LOYALTY.minStamps && stamps >= required;
