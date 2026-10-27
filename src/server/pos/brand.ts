import type { PrismaClient } from '@/generated/prisma/client';
import { assetImage } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';

export interface RestaurantLogo {
  url: string;
  width: number;
  height: number;
}

/**
 * The restaurant's own logo for the till's header, from its media library. Null when it has none, when the asset was
 * deleted, or when anything about it cannot be read: the header then shows the Buzzify logo instead of failing.
 */
export async function restaurantLogoOf(prisma: PrismaClient, restaurantId: string): Promise<RestaurantLogo | null> {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { logoAssetId: true } });
    if (!restaurant?.logoAssetId) return null;
    const asset = await prisma.mediaAsset.findUnique({ where: { id: restaurant.logoAssetId } });
    if (!asset) return null;
    const image = assetImage(asset, (key) => getStorage().publicUrl(key));
    return { url: image.url, width: image.width, height: image.height };
  } catch {
    return null;
  }
}
