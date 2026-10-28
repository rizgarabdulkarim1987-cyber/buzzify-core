import { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/server/data/prisma';
import type { TenantInfo } from '@/server/data/tenant';
import { advertShowsIn, introLiveFor, safeHref } from '@/server/domain/intro';

/**
 * Counts one view or click of a platform advert on a menu's intro page, by day. Only counts are kept: no address, cookie or person. An
 * advert that does not exist, is off, is outside its dates or is not for this menu is ignored (null), so nobody can fill the report with
 * made-up numbers for adverts that were never shown there. Returns the advert's safe address ('' when it has none) for a click to follow.
 */
export async function countAdvert(tenant: TenantInfo, advertId: string, kind: 'view' | 'click', now: Date): Promise<{ href: string } | null> {
  if (!tenant.extras?.intro) return null;
  const prisma = getPrisma();
  const advert = await prisma.platformAdvert.findUnique({ where: { id: advertId } });
  if (!advert || introLiveFor([advert], now).length === 0) return null;
  if (!advertShowsIn(advert, { menuId: tenant.id, restaurantId: tenant.restaurantId })) return null;
  const href = safeHref(advert.href);
  if (kind === 'click' && href === '') return null;

  const key = { advertId, shownMenuId: tenant.id, day: now.toISOString().slice(0, 10) };
  const bump = kind === 'view' ? { views: { increment: 1 } } : { clicks: { increment: 1 } };
  try {
    await prisma.platformAdvertDaily.upsert({
      where: { advertId_shownMenuId_day: key },
      create: { ...key, shownRestaurantId: tenant.restaurantId, views: kind === 'view' ? 1 : 0, clicks: kind === 'click' ? 1 : 0 },
      update: bump,
    });
  } catch (error) {
    // Two first counts of the day at once: the other one made the row, so this one adds to it.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    await prisma.platformAdvertDaily.update({ where: { advertId_shownMenuId_day: key }, data: bump });
  }
  return { href };
}
