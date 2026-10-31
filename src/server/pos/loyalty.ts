import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantInfo } from '@/server/data/tenant';
import { scopedClient, type AnyDb } from '@/server/data/tenant-db';
import { canRedeem, cardKeyOf } from '@/server/domain/pos/loyalty-rules';
import { QrGateClosed, qrOrderGate } from './customer-orders-guest';

/** What a guest sees of their card: how many stamps it holds, how many fill it, and what the reward is. */
export interface CardView {
  stamps: number;
  required: number;
  reward: string;
  full: boolean;
}

/**
 * The guest's card at a table where ordering is open and the restaurant runs the program (and its plan has it). The token
 * is hashed here; a card nobody has stamped yet reads as empty. Anything else answers like a closed gate.
 */
export async function readCard(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId' | 'features'>, input: { table: number; token: string }, now: Date = new Date()): Promise<CardView> {
  if (!tenant.features.stampCard) throw new QrGateClosed();
  const gate = await qrOrderGate(prisma, tenant, input.table, now);
  if (!gate.open) throw new QrGateClosed();
  const till = scopedClient(prisma, { restaurantId: gate.restaurantId });
  const settings = await till.posSettings.findFirst({ where: { restaurantId: gate.restaurantId }, select: { loyaltyEnabled: true, loyaltyStampsRequired: true, loyaltyReward: true } });
  if (!settings?.loyaltyEnabled) throw new QrGateClosed();
  const card = await till.posLoyaltyCard.findFirst({ where: { restaurantId: gate.restaurantId, cardKey: cardKeyOf(input.token) }, select: { stamps: true } });
  const stamps = card?.stamps ?? 0;
  return { stamps, required: settings.loyaltyStampsRequired, reward: settings.loyaltyReward, full: canRedeem(stamps, settings.loyaltyStampsRequired) };
}

/**
 * Called in the transaction that fully pays an order. Each distinct card on the order's guest requests earns one stamp,
 * once (the unique row is the guard, so a repeat does nothing); a card that asked for its reward on a request, and held the
 * stamps for it, spends them first. Runs only while the restaurant's switch is on. Writes nothing that can refuse the payment.
 */
export async function settleCards(db: AnyDb, restaurantId: string, orderId: string): Promise<void> {
  const settings = await db.posSettings.findFirst({ where: { restaurantId }, select: { loyaltyEnabled: true, loyaltyStampsRequired: true } });
  if (!settings?.loyaltyEnabled) return;
  const requests = await db.posCustomerOrder.findMany({ where: { restaurantId, orderId, cardKey: { not: null } }, select: { cardKey: true, redeemReward: true } });
  const cards = new Map<string, boolean>();
  for (const request of requests) {
    if (request.cardKey === null) continue;
    cards.set(request.cardKey, (cards.get(request.cardKey) ?? false) || request.redeemReward);
  }
  for (const [cardKey, redeem] of cards) {
    await db.posLoyaltyCard.upsert({ where: { restaurantId_cardKey: { restaurantId, cardKey } }, create: { restaurantId, cardKey, stamps: 0 }, update: {} });
    if (redeem) {
      const card = await db.posLoyaltyCard.findFirst({ where: { restaurantId, cardKey }, select: { stamps: true } });
      if (card && canRedeem(card.stamps, settings.loyaltyStampsRequired)) {
        const spent = await db.posLoyaltyStamp.createMany({ data: [{ restaurantId, cardKey, orderId, kind: 'SPEND', amount: settings.loyaltyStampsRequired }], skipDuplicates: true });
        if (spent.count > 0) await db.posLoyaltyCard.updateMany({ where: { restaurantId, cardKey, stamps: { gte: settings.loyaltyStampsRequired } }, data: { stamps: { decrement: settings.loyaltyStampsRequired } } });
      }
    }
    const earned = await db.posLoyaltyStamp.createMany({ data: [{ restaurantId, cardKey, orderId, kind: 'EARN', amount: 1 }], skipDuplicates: true });
    if (earned.count > 0) await db.posLoyaltyCard.updateMany({ where: { restaurantId, cardKey }, data: { stamps: { increment: 1 } } });
  }
}
