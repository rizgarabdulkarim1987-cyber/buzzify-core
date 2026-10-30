import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { Prisma } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { prepareAsset, storeAsset } from '@/server/media/process';
import { refreshDraftHash } from '@/server/publish/draft';
import { getStorage } from '@/server/storage/storage';
import { describeDatabase } from './database-target';

/**
 * `npm run studio:photos -- <menu-address> <folder> [--apply] [--replace]`
 *
 * Puts the photos of a folder on the menu's dishes by file name: `adana-kebab.jpg` goes to the dish whose address is
 * `adana-kebab`. Each photo becomes an asset of the restaurant's media library (resized, AVIF and WebP, like a Studio
 * upload) and the dish's draft picture. A dish that already has a picture is left alone unless `--replace` is given.
 * Nothing is published: the menu shows "unpublished changes" and the owner publishes from the Studio. Without `--apply`
 * it only says what it would do.
 */
const PICTURES = new Set(['.jpg', '.jpeg', '.png', '.webp']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const replace = args.includes('--replace');
  const [slug, folder] = args.filter((arg) => !arg.startsWith('--'));
  if (!slug || !folder) throw new Error('Usage: npm run studio:photos -- <menu-address> <folder> [--apply] [--replace]');
  const dir = resolve(folder);
  const files = (await readdir(dir)).filter((name) => PICTURES.has(extname(name).toLowerCase()));

  const prisma = createPrisma();
  try {
    console.log(`Database: ${describeDatabase()}`);
    const menu = await prisma.menu.findUnique({ where: { slug }, select: { id: true, restaurantId: true } });
    if (!menu) throw new Error(`No menu has the address "${slug}"`);
    const products = await prisma.product.findMany({ where: { menuId: menu.id }, select: { id: true, slug: true, media: true, translations: true } });
    const bySlug = new Map(products.map((product) => [product.slug, product]));

    const plan = files.map((name) => ({ name, product: bySlug.get(basename(name, extname(name))) }));
    const unmatched = plan.filter((item) => !item.product).map((item) => item.name);
    const matched = plan.filter((item) => item.product);
    const skipped = matched.filter((item) => !replace && Array.isArray(item.product!.media) && item.product!.media.length > 0);
    const todo = matched.filter((item) => !skipped.includes(item));
    const without = products.filter((product) => !files.some((name) => basename(name, extname(name)) === product.slug)).map((product) => product.slug);
    console.log(`${files.length} photos, ${products.length} dishes: ${todo.length} to attach, ${skipped.length} already have a picture, ${unmatched.length} photos match no dish, ${without.length} dishes have no photo.`);
    if (unmatched.length) console.log('  no dish:', unmatched.join(', '));
    if (without.length) console.log('  no photo:', without.join(', '));
    if (!apply) {
      console.log('Nothing was changed. Run again with --apply to upload and attach the photos.');
      return;
    }

    const storage = getStorage();
    const owner = { restaurantId: menu.restaurantId };
    let done = 0;
    for (const { name, product } of todo) {
      const prepared = await prepareAsset(await readFile(resolve(dir, name)));
      if (!prepared.ok) {
        console.log(`  ${name}: refused (${prepared.reason})`);
        continue;
      }
      const asset = prepared.asset;
      const existing = await prisma.mediaAsset.findFirst({ where: { restaurantId: owner.restaurantId, contentHash: asset.contentHash }, select: { id: true } });
      let assetId = existing?.id;
      if (!assetId) {
        const stored = await storeAsset(storage, owner, asset);
        const names = (product!.translations ?? {}) as Record<string, { name?: string } | undefined>;
        const alt = Object.fromEntries(['en', 'ar', 'ckb'].flatMap((locale) => (names[locale]?.name ? [[locale, names[locale]!.name!]] : [])));
        const row = await prisma.mediaAsset.create({
          data: {
            restaurantId: owner.restaurantId,
            kind: asset.kind,
            storageKey: stored.storageKey,
            contentHash: asset.contentHash,
            mime: asset.mime,
            bytes: asset.bytes,
            storedBytes: stored.storedBytes,
            width: asset.width,
            height: asset.height,
            durationMs: asset.durationMs,
            meta: asset.meta as Prisma.InputJsonValue,
            variants: stored.variants as unknown as Prisma.InputJsonValue,
            placeholder: asset.placeholder,
            alt,
            folder: 'dishes',
            tags: [],
          },
          select: { id: true },
        });
        assetId = row.id;
      }
      await prisma.product.update({ where: { id: product!.id }, data: { media: [{ kind: 'asset', assetId }], version: { increment: 1 } } });
      done += 1;
      if (done % 10 === 0) console.log(`  ${done}/${todo.length}`);
    }
    await refreshDraftHash(prisma, menu.id);
    console.log(`Attached ${done} photos. Publish the menu from the Studio to show them to guests.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
