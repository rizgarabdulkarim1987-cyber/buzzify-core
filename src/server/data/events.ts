import type { PrismaClient } from '@/generated/prisma/client';
import { menuDb } from './tenant-db';

export const EVENT_TYPES = [
  'MENU_VIEW',
  'PRODUCT_VIEW',
  'ADD_TO_CART',
  'UPSELL_IMPRESSION',
  'UPSELL_ACCEPT',
  'PAIRING_IMPRESSION',
  'PAIRING_ADD',
  'BUNDLE_IMPRESSION',
  'BUNDLE_ACCEPT',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  type: EventType;
  productId?: string;
  suggestionId?: string;
  qrCodeId?: string;
  payload: Record<string, unknown>;
}

export async function recordEvents(
  prisma: PrismaClient,
  menuId: string,
  input: { anonymousSessionId: string; tableNumber: number | null; events: EventInput[] },
): Promise<number> {
  const db = menuDb(prisma, menuId);
  // A scan counts only for a code of this menu: any other id is dropped, never stored.
  const named = [...new Set(input.events.flatMap((event) => (event.qrCodeId ? [event.qrCodeId] : [])))];
  const codes =
    named.length === 0 ? new Set<string>() : new Set((await db.qrCode.findMany({ where: { id: { in: named } }, select: { id: true } })).map((code) => code.id));
  const result = await db.analyticsEvent.createMany({
    data: input.events.map((event) => ({
      anonymousSessionId: input.anonymousSessionId,
      tableNumber: input.tableNumber,
      type: event.type,
      productId: event.productId ?? null,
      suggestionId: event.suggestionId ?? null,
      ...(event.type === 'MENU_VIEW' && event.qrCodeId && codes.has(event.qrCodeId) ?{ qrCodeId: event.qrCodeId, source: 'qr' } : {}),
      payload: event.payload as never,
    })) as never,
  });
  return result.count;
}
