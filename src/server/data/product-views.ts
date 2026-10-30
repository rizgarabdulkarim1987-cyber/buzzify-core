import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { dayOf } from '@/server/domain/wheel';
import { isCountableAgent, viewCounts } from '@/server/domain/dish-counts';
import { menuDb } from './tenant-db';

/**
 * Counts guests opening dishes (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md). The total of a dish only ever goes up and is
 * kept from the first day. What keeps it honest is a mark per device and day (a signed random cookie key) and a count per address and day
 * (a salted hash): one device counts once, one address at most `VIEW_IP_LIMIT` times, so a cleared browser cannot inflate a number.
 * Marks are kept three days (`pruneProductViewMarks`); no personal data is stored.
 */
export async function countProductViews(
  prisma: PrismaClient,
  input: { menuId: string; timeZone: string; guestKey: string; ipHash: string; userAgent: string | null; productIds: string[]; now: Date },
): Promise<number> {
  if (!isCountableAgent(input.userAgent)) return 0;
  const ids = [...new Set(input.productIds)];
  if (ids.length === 0) return 0;
  const db = menuDb(prisma, input.menuId);
  // Only this menu's own dishes count: any other id is dropped, never stored.
  const known = new Set((await db.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((product) => product.id));
  const day = dayOf(input.now, input.timeZone);
  let added = 0;
  for (const productId of ids.filter((id) => known.has(id))) {
    let markId: string;
    try {
      markId = (await db.productViewMark.create({ data: { menuId: input.menuId, productId, day, guestKey: input.guestKey, ipHash: input.ipHash }, select: { id: true } })).id;
    } catch (error) {
      // This device already counted the dish today (the mark is unique per device, dish and day).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
    // Counted with this mark in, like the wheel: views that arrive together may all back out, never all stay past the limit.
    const marks = await db.productViewMark.count({ where: { productId, day, ipHash: input.ipHash } });
    if (!viewCounts({ deviceSeen: false, addressViews: marks - 1 })) {
      await db.productViewMark.deleteMany({ where: { id: markId } });
      continue;
    }
    await prisma.productViewTotal.upsert({
      where: { menuId_productId: { menuId: input.menuId, productId } },
      create: { menuId: input.menuId, productId, views: 1 },
      update: { views: { increment: 1 } },
    });
    added += 1;
  }
  return added;
}
