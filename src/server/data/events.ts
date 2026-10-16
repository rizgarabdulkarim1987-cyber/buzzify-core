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
  payload: Record<string, unknown>;
}

export async function recordEvents(
  prisma: PrismaClient,
  menuId: string,
  input: { anonymousSessionId: string; tableNumber: number | null; events: EventInput[] },
): Promise<number> {
  const db = menuDb(prisma, menuId);
  const result = await db.analyticsEvent.createMany({
    data: input.events.map((event) => ({
      anonymousSessionId: input.anonymousSessionId,
      tableNumber: input.tableNumber,
      type: event.type,
      productId: event.productId ?? null,
      suggestionId: event.suggestionId ?? null,
      payload: event.payload as never,
    })) as never,
  });
  return result.count;
}
