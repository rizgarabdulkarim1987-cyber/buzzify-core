import type { CartLineInput } from '@/server/domain/types';
import { QR_LIMITS } from './customer-order-rules';

/**
 * The table basket (plan feature `ordering.tableBasket`): the guests of one table each keep their own part, and one of them
 * sends every part as a single order. Pure rules; the rows are read and written by `server/pos/table-basket`.
 */

export const BASKET_LIMITS = {
  /** A part stops counting this long after its owner last changed it. */
  liveMinutes: 180,
  /** After its lines went into an order a part is kept this long, so every phone at the table can follow the order. */
  sentKeepMinutes: 30,
  /** Guests sharing one table. */
  maxParts: 12,
  /** A guest's name for the others to read. */
  maxName: 24,
} as const;

const MINUTE = 60_000;

export type BasketLine = CartLineInput & { note: string };

export interface BasketPart {
  ownerKey: string;
  name: string;
  lines: BasketLine[];
  updatedAt: Date;
  sentPublicId: string | null;
  sentAt: Date | null;
}

/** Still being put together: changed within the last three hours and not yet sent. */
export function isLive(part: Pick<BasketPart, 'updatedAt' | 'sentPublicId'>, now: Date): boolean {
  return part.sentPublicId === null && now.getTime() - part.updatedAt.getTime() < BASKET_LIMITS.liveMinutes * MINUTE;
}

/** Sent less than half an hour ago, so the table can still follow its order. */
export function isRecentlySent(part: Pick<BasketPart, 'sentPublicId' | 'sentAt'>, now: Date): boolean {
  return part.sentPublicId !== null && part.sentAt !== null && now.getTime() - part.sentAt.getTime() < BASKET_LIMITS.sentKeepMinutes * MINUTE;
}

/** The newest order the table's phones should follow, or null. */
export function lastSentOrder(parts: readonly BasketPart[], now: Date): { publicId: string; at: Date } | null {
  let latest: { publicId: string; at: Date } | null = null;
  for (const part of parts) {
    if (!isRecentlySent(part, now) || part.sentAt === null || part.sentPublicId === null) continue;
    if (latest === null || part.sentAt > latest.at) latest = { publicId: part.sentPublicId, at: part.sentAt };
  }
  return latest;
}

/** Every live part's lines as one cart, the oldest part first so the order reads in the order guests joined. */
export function mergedLines(parts: readonly BasketPart[], now: Date): BasketLine[] {
  return parts
    .filter((part) => isLive(part, now))
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .flatMap((part) => part.lines);
}

/** Whether the live parts, with this guest's part replaced by `lines`, still fit one order. */
export function fitsOneOrder(parts: readonly BasketPart[], ownerKey: string, lines: readonly BasketLine[], now: Date): boolean {
  const others = parts.filter((part) => isLive(part, now) && part.ownerKey !== ownerKey).reduce((sum, part) => sum + part.lines.length, 0);
  return others + lines.length <= QR_LIMITS.maxLines;
}
