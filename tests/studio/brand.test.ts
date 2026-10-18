import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PALETTES, type Palette } from '@/lib/brand';
import { paletteProblems } from '@/lib/palette';
import { getPrisma } from '@/server/data/prisma';
import { getTenant } from '@/server/data/public-menu';
import { emptyWorkingHours } from '@/server/domain/restaurant-profile';
import { prepareAsset, storeAsset, type AssetVariants } from '@/server/media/process';
import { assetUsage } from '@/server/media/usage';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { getStorage } from '@/server/storage/storage';
import * as brand from '@/server/studio/actions/brand';
import * as menus from '@/server/studio/actions/menus';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as brandQueries from '@/server/studio/queries/brand';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let dir: string;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), designer, def, input, META);

/** A logo stored in a library the way an upload is: a coloured mark on white, wide like a wordmark. */
async function logo(restaurantId: string | null, color = { r: 180, g: 40, b: 30 }): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: await sharp({ create: { width: 720, height: 360, channels: 3, background: color } }).png().toBuffer(), left: 240, top: 120 }])
    .png()
    .toBuffer();
  const prepared = await prepareAsset(new Uint8Array(png));
  if (!prepared.ok) throw new Error(prepared.reason);
  const stored = await storeAsset(getStorage(), { restaurantId }, prepared.asset);
  const row = await prisma().mediaAsset.create({
    data: {
      restaurantId,
      kind: prepared.asset.kind,
      storageKey: stored.storageKey,
      contentHash: prepared.asset.contentHash,
      mime: prepared.asset.mime,
      bytes: prepared.asset.bytes,
      storedBytes: stored.storedBytes,
      width: prepared.asset.width,
      height: prepared.asset.height,
      variants: stored.variants as object,
      placeholder: prepared.asset.placeholder,
    },
  });
  return row.id;
}

/** The kit as the Brand tab sends it: the stored one, with `overrides`. */
async function kit(overrides: Record<string, unknown> = {}) {
  const current = dataOf(await runQuery(prisma(), designer, brandQueries.get, { menuId: a.menu.id }));
  return {
    menuId: a.menu.id,
    version: current.version,
    theme: current.theme,
    palette: current.tokens[current.theme],
    logoAssetId: current.logo?.assetId ?? null,
    logoDarkAssetId: current.logoDark?.assetId ?? null,
    favicon: current.favicon,
    fontPairId: current.fontPairId,
    railStyle: current.railStyle,
    motionIntensity: current.motionIntensity,
    logoText: current.logoText,
    ...overrides,
  };
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  dir = mkdtempSync(join(tmpdir(), 'buzzify-brand-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'brand-a');
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
  rmSync(dir, { recursive: true, force: true });
});

const light: Palette = { ...DEFAULT_PALETTES.light };

describe('the brand kit', () => {
  it('refuses muted text below 4.5:1 on the surface and names the pair', async () => {
    const palette = { ...light, muted: '#9a9a9a' };
    const error = failureOf(await run(brand.update, await kit({ theme: 'light', palette })));
    expect(error.code).toBe('INVALID');
    expect(error.fields).toMatchObject({ palette: expect.any(String), 'palette.muted/surface': expect.stringMatching(/^\d\.\d\d$/) });
  });

  it('saves a weak accent with a warning', async () => {
    const result = dataOf(await run(brand.update, await kit({ theme: 'light', palette: { ...light, accent: '#f2ead8' } })));
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ foreground: 'accent', background: 'bg', severity: 'warn' })]));
    expect((await prisma().brandConfig.findUniqueOrThrow({ where: { menuId: a.menu.id } })).version).toBe(2);
  });

  it('refuses a stale save and names who changed the kit', async () => {
    const stale = await kit();
    dataOf(await run(brand.update, await kit({ logoText: 'Atelier' })));
    expect(failureOf(await run(brand.update, { ...stale, logoText: 'Other' }))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
  });

  it('generates the favicon from the logo at 32, 180 and 512 px', async () => {
    const logoId = await logo(a.restaurant.id);
    dataOf(await run(brand.update, await kit({ logoAssetId: logoId, favicon: { kind: 'fromLogo' } })));
    const variants = (await prisma().mediaAsset.findUniqueOrThrow({ where: { id: logoId } })).variants as unknown as AssetVariants;
    expect(Object.keys(variants.favicon ?? {}).sort()).toEqual(['180', '32', '512']);
    for (const [size, key] of Object.entries(variants.favicon!)) {
      const file = await getStorage().get(key, 1_000_000);
      expect((await sharp(Buffer.from(file!.bytes)).metadata()).width).toBe(Number(size));
    }
    const snapshot = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(snapshot.brand.favicon).toMatchObject({ assetId: logoId, png32: expect.stringContaining('/api/dev-media/') });
  });

  it("refuses another restaurant's logo", async () => {
    const b = await createMenuFixture(prisma(), 'brand-b');
    const theirs = await logo(b.restaurant.id);
    expect(failureOf(await run(brand.update, await kit({ logoAssetId: theirs }))).code).toBe('NOT_FOUND');
  });

  it('refuses a scene file as a logo: logos take pictures only', async () => {
    const model = await prisma().mediaAsset.create({
      data: { restaurantId: a.restaurant.id, kind: 'MODEL', storageKey: `r/${a.restaurant.id}/abc`, contentHash: 'abc', mime: 'model/gltf-binary', bytes: 10, storedBytes: 10, variants: { original: `r/${a.restaurant.id}/abc/original.glb` } },
    });
    expect(failureOf(await run(brand.update, await kit({ logoAssetId: model.id }))).code).toBe('NOT_FOUND');
  });

  it('suggests three palettes from a logo, each passing every pair', async () => {
    const logoId = await logo(a.restaurant.id);
    const { palettes } = dataOf(await runQuery(prisma(), designer, brandQueries.suggestFromLogo, { menuId: a.menu.id, assetId: logoId, theme: 'light' }));
    expect(palettes).toHaveLength(3);
    for (const palette of palettes) expect(paletteProblems(palette)).toEqual([]);
  });

  it('changes nothing guests see until publish, then shows the logo and the pair', async () => {
    const logoId = await logo(a.restaurant.id);
    dataOf(await run(brand.update, await kit({ logoAssetId: logoId, fontPairId: 'cafe' })));
    expect((await getTenant('brand-a'))!.brand).not.toHaveProperty('logo');
    await publishFixture(prisma(), a.menu.id);
    const live = (await getTenant('brand-a'))!.brand;
    expect(live).toMatchObject({ fontPairId: 'cafe', logo: { assetId: logoId, svg: false, rasterKey: expect.stringMatching(/640\.webp$/) } });
    expect((await assetUsage(prisma(), { id: logoId, restaurantId: a.restaurant.id })).drafts).toEqual([expect.objectContaining({ where: 'logo' })]);
  });

  it('keeps the rail choice when motion is off, in the draft and in a duplicate', async () => {
    dataOf(await run(brand.update, await kit({ railStyle: 'drum', motionIntensity: 'none' })));
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.brand).toMatchObject({ railStyle: 'plain', railChoice: 'drum' });

    await publishFixture(prisma(), a.menu.id);
    const { menuId } = dataOf(await run(menus.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'brand-a-copy' }));
    expect(await prisma().brandConfig.findUniqueOrThrow({ where: { menuId } })).toMatchObject({ railStyle: 'drum', motionIntensity: 'none' });
  });

  it('starts a new menu with the restaurant logo', async () => {
    const logoId = await logo(a.restaurant.id);
    const restaurant = await prisma().restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } });
    dataOf(
      await run(restaurants.updateRestaurant, {
        restaurantId: restaurant.id,
        version: restaurant.version,
        name: restaurant.name,
        type: restaurant.type,
        description: '',
        address: '',
        city: '',
        country: '',
        phone: '',
        whatsapp: '',
        workingHours: emptyWorkingHours(),
        notes: '',
        logoAssetId: logoId,
      }),
    );
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurant.id } })).logoAssetId).toBe(logoId);
    const { menuId } = dataOf(await run(menus.createMenu, { restaurantId: restaurant.id, name: 'Second', slug: 'brand-a-second' }));
    expect((await prisma().brandConfig.findUniqueOrThrow({ where: { menuId } })).logoAssetId).toBe(logoId);
  });

  it('refuses a scene file as the restaurant logo', async () => {
    const model = await prisma().mediaAsset.create({
      data: { restaurantId: a.restaurant.id, kind: 'VIDEO', storageKey: `r/${a.restaurant.id}/def`, contentHash: 'def', mime: 'video/mp4', bytes: 10, storedBytes: 10, variants: { original: `r/${a.restaurant.id}/def/original.mp4` } },
    });
    const restaurant = await prisma().restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } });
    const result = await run(restaurants.updateRestaurant, {
      restaurantId: restaurant.id,
      version: restaurant.version,
      name: restaurant.name,
      type: restaurant.type,
      description: '',
      address: '',
      city: '',
      country: '',
      phone: '',
      whatsapp: '',
      workingHours: emptyWorkingHours(),
      notes: '',
      logoAssetId: model.id,
    });
    expect(failureOf(result).code).toBe('NOT_FOUND');
  });
});
