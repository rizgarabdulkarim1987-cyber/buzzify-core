import type { MediaAsset, Prisma } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';

/** What a copy of an asset needs from the original, read on the side of the restaurant that owns it. */
export type CopyableAsset = Pick<
  MediaAsset,
  'id' | 'restaurantId' | 'kind' | 'storageKey' | 'contentHash' | 'mime' | 'bytes' | 'storedBytes' | 'width' | 'height' | 'variants' | 'placeholder' | 'alt' | 'folder' | 'tags'
>;

export const COPYABLE = {
  id: true,
  restaurantId: true,
  kind: true,
  storageKey: true,
  contentHash: true,
  mime: true,
  bytes: true,
  storedBytes: true,
  width: true,
  height: true,
  variants: true,
  placeholder: true,
  alt: true,
  folder: true,
  tags: true,
} as const;

/**
 * Gives a restaurant its own copies of another restaurant's assets, for a menu duplicated into it (spec 6.5, 2a
 * follow-up 7): the target's asset with the same content when it has one, else a new row that points at the same stored
 * files. Shared assets need no copy. Runs on a transaction scoped to the target restaurant; the originals were read on
 * the source's side, since this client cannot read them. Answers each original id with the id to use.
 */
export async function copyAssetsForMenu(
  tx: ScopedTx,
  args: { assets: readonly CopyableAsset[]; toRestaurantId: string },
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const asset of args.assets) {
    if (asset.restaurantId === null || asset.restaurantId === args.toRestaurantId) {
      map.set(asset.id, asset.id);
      continue;
    }
    const existing = await tx.mediaAsset.findFirst({
      where: { restaurantId: args.toRestaurantId, contentHash: asset.contentHash },
      select: { id: true },
    });
    if (existing) {
      map.set(asset.id, existing.id);
      continue;
    }
    const copy = await tx.mediaAsset.create({
      data: {
        restaurantId: args.toRestaurantId,
        kind: asset.kind,
        storageKey: asset.storageKey,
        contentHash: asset.contentHash,
        mime: asset.mime,
        bytes: asset.bytes,
        storedBytes: asset.storedBytes,
        width: asset.width,
        height: asset.height,
        variants: asset.variants as Prisma.InputJsonValue,
        placeholder: asset.placeholder,
        alt: asset.alt as Prisma.InputJsonValue,
        folder: asset.folder,
        tags: asset.tags,
      },
      select: { id: true },
    });
    map.set(asset.id, copy.id);
  }
  return map;
}
