import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { DesignOverrides } from '@/lib/templates/types';
import { createPrisma } from '@/server/data/prisma';
import { storageEnv } from '@/server/env';
import { prepareAsset, storeAsset, type AssetVariants } from '@/server/media/process';
import { getStorage } from '@/server/storage/storage';
import { seedMenu } from '../../../prisma/seed/apply';
import { ONDA } from '../../../prisma/seed/onda';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';
import { deleteBillingRows, publishFixture } from '../../helpers/db';

export type SceneKind = 'model' | 'video' | 'lottie';

export interface SceneMenus {
  /**
   * The address of the menu that plays each kind of file, and of one with the video under a restaurant on Pro, whose
   * plan lacks background video (spec 2026-10-18-scene-files-plans-design.md).
   */
  slugs: Record<SceneKind | 'lockedVideo', string>;
  /**
   * Deletes the restaurant, its menus, slugs, audit rows and library, and the files stored for it. Safe to call again
   * (a describe's `afterAll` can come round twice, see `createTemporaryMenu`).
   */
  remove(): Promise<void>;
}

/**
 * The sample GLB (a torus knot) and Lottie animation (drifting dots) that `scripts/scene-fixtures.ts` writes, made by
 * running the script into a folder of its own.
 */
async function sampleFiles(): Promise<{ model: Uint8Array; lottie: Uint8Array }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'buzzify-scene-fixtures-'));
  try {
    execFileSync(process.execPath, ['--import', 'tsx', path.join('scripts', 'scene-fixtures.ts'), folder], { stdio: 'pipe' });
    const [model, lottie] = await Promise.all([readFile(path.join(folder, 'torus-knot.glb')), readFile(path.join(folder, 'drifting-dots.json'))]);
    return { model: new Uint8Array(model), lottie: new Uint8Array(lottie) };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * A short H.264 MP4 recorded in the browser (a colour wash with a square crossing it, 1.5 s at 320 × 240), and its first
 * frame as a PNG poster, the way the Studio takes one. The library accepts a recorder's fragmented MP4.
 */
async function recordVideo(browser: Browser): Promise<{ video: Uint8Array; poster: Uint8Array }> {
  const page = await browser.newPage();
  try {
    const recorded = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => {
        context.fillStyle = `hsl(${(frame * 6) % 360} 60% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#FFF3DF';
        context.fillRect((frame * 8) % canvas.width, 100, 40, 40);
        frame += 1;
      };
      draw();
      const poster = canvas.toDataURL('image/png');
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 400_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((done) => (recorder.onstop = done));
      recorder.start();
      const timer = setInterval(draw, 33);
      await new Promise((done) => setTimeout(done, 1500));
      clearInterval(timer);
      recorder.stop();
      await stopped;
      const video = await new Promise<string>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(reader.result as string);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/mp4' }));
      });
      return { video: video.split(',')[1]!, poster: poster.split(',')[1]! };
    });
    return { video: new Uint8Array(Buffer.from(recorded.video, 'base64')), poster: new Uint8Array(Buffer.from(recorded.poster, 'base64')) };
  } finally {
    await page.close();
  }
}

interface StoredFile {
  id: string;
  /** Every file written for it. */
  keys: string[];
  /** The folder they are in (`MediaAsset.storageKey`). */
  folder: string;
}

/** A scene file in the restaurant's library, checked and stored the way an upload is. */
async function storeSceneFile(prisma: PrismaClient, restaurantId: string, bytes: Uint8Array, poster?: Uint8Array): Promise<StoredFile> {
  const prepared = await prepareAsset(bytes, poster);
  if (!prepared.ok) throw new Error(`The test scene file was refused: ${prepared.reason}`);
  const { asset } = prepared;
  const stored = await storeAsset(getStorage(), { restaurantId }, asset);
  const row = await prisma.mediaAsset.create({
    data: {
      restaurantId,
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
    },
    select: { id: true },
  });
  return { id: row.id, keys: storedKeys(stored.variants), folder: stored.storageKey };
}

function storedKeys(variants: AssetVariants): string[] {
  const widths = [variants.avif, variants.webp, variants.poster?.avif, variants.poster?.webp];
  return [variants.original, ...widths.flatMap((byWidth) => Object.values(byWidth ?? {}))];
}

/**
 * Three published copies of the Gelateria Onda demo menu (its Gelato Riviera template asks for 3D), each with a scene
 * file from the restaurant's library as its background: the sample GLB, a recorded MP4 and the sample Lottie
 * animation; and a fourth with the video under a second restaurant on Pro. They live under throwaway restaurants at new
 * addresses, so the seeded demo menus, which other suites read while this one runs, never change, and no address has
 * been served (and cached by the app) before.
 */
export async function createSceneMenus(browser: Browser): Promise<SceneMenus> {
  const [{ model, lottie }, { video, poster }] = await Promise.all([sampleFiles(), recordVideo(browser)]);
  const prisma = createPrisma(databaseUrl(DEV_DB));
  const run = randomUUID().slice(0, 8);
  const restaurant = await prisma.restaurant.create({ data: { name: `${ONDA.profile.name} scene files e2e-${run}`, type: ONDA.profile.type } });
  const onPro = await prisma.restaurant.create({ data: { name: `${ONDA.profile.name} scene files on Pro e2e-${run}`, type: ONDA.profile.type, plan: 'PRO' } });
  const restaurantIds = [restaurant.id, onPro.id];
  const menuIds: string[] = [];
  const slugs: string[] = [];
  const files: StoredFile[] = [];

  const remove = async () => {
    await prisma.$disconnect();
    // A client of its own, so a second call does not depend on the first one's having been left open.
    const db = createPrisma(databaseUrl(DEV_DB));
    try {
      // Slugs first, so no tombstone is left; deleting the restaurant takes its library with it.
      await db.menuSlug.deleteMany({ where: { OR: [{ menuId: { in: menuIds } }, { slug: { in: slugs } }] } });
      await db.menu.deleteMany({ where: { id: { in: menuIds } } });
      await db.auditLog.deleteMany({ where: { OR: [{ menuId: { in: menuIds } }, { restaurantId: { in: restaurantIds } }] } });
      await deleteBillingRows(db, restaurantIds);
      await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
    } finally {
      await db.$disconnect();
    }
    await getStorage().delete(files.flatMap((file) => file.keys));
    // The development folder keeps the folders the files were in: each restaurant's library folder is only its own.
    const storage = storageEnv();
    const libraries = new Set(files.map((file) => path.posix.dirname(file.folder)));
    if (storage.kind === 'folder') for (const library of libraries) await rm(path.join(storage.dir, library), { recursive: true, force: true });
  };

  const sceneMenu = async (
    kind: SceneKind | 'lockedVideo',
    file: StoredFile,
    scene?: DesignOverrides['scene'],
    restaurantId = restaurant.id,
  ): Promise<string> => {
    files.push(file);
    const slug = `e2e-${run}-${kind.toLowerCase()}`;
    slugs.push(slug);
    const { menuId } = await seedMenu(prisma, { ...ONDA, restaurant: { ...ONDA.restaurant, slug, domains: [] } }, restaurantId);
    menuIds.push(menuId);
    await prisma.menuSlug.create({ data: { slug, menuId } });
    // As the Design tab saves a chosen file: in the overrides, beside what the demo already changed.
    const design: DesignOverrides = { ...ONDA.brand.design, ...(scene ? { scene } : {}), sceneAsset: { assetId: file.id } };
    await prisma.brandConfig.update({ where: { menuId }, data: { design: design as Prisma.InputJsonValue } });
    await publishFixture(prisma, menuId, `Scene file: ${kind}`);
    return slug;
  };

  try {
    return {
      slugs: {
        // Picking a model in the Studio asks for 3D (the template already does; said here so the test does not depend on it).
        model: await sceneMenu('model', await storeSceneFile(prisma, restaurant.id, model), { mode: '3d' }),
        video: await sceneMenu('video', await storeSceneFile(prisma, restaurant.id, video, poster)),
        lottie: await sceneMenu('lottie', await storeSceneFile(prisma, restaurant.id, lottie)),
        lockedVideo: await sceneMenu('lockedVideo', await storeSceneFile(prisma, onPro.id, video, poster), undefined, onPro.id),
      },
      remove,
    };
  } catch (error) {
    // The suite never gets a `remove` from a setup that failed: what was made so far goes now.
    await remove();
    throw error;
  }
}
