import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareAsset, storeAsset } from '@/server/media/process';
import { getStorage } from '@/server/storage/storage';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();
let dir: string;

type Handler = (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response>;
let GET: Handler;

const image = (slug: string, search: string) =>
  GET(new Request(`http://localhost/api/${slug}/social-image${search}`), { params: Promise.resolve({ tenant: slug }) });

/** A logo in the restaurant's library: a red mark on a transparent ground. */
async function storeLogo(restaurantId: string): Promise<string> {
  const png = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const prepared = await prepareAsset(new Uint8Array(png));
  if (!prepared.ok) throw new Error(prepared.reason);
  const stored = await storeAsset(getStorage(), { restaurantId }, prepared.asset);
  const row = await prisma.mediaAsset.create({
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
    },
  });
  return row.id;
}

let withLogo: { menuId: string; first: string; live: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'buzzify-social-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
  await resetTestData(prisma);

  const fixture = await createMenuFixture(prisma, 'social-logo', { publish: false });
  const logoId = await storeLogo(fixture.restaurant.id);
  await prisma.brandConfig.upsert({
    where: { menuId: fixture.menu.id },
    create: { menuId: fixture.menu.id, tokens: {}, typography: {}, logoText: 'Social', theme: 'LIGHT', logoAssetId: logoId },
    update: { theme: 'LIGHT', logoAssetId: logoId },
  });
  await publishFixture(prisma, fixture.menu.id);
  const first = (await prisma.menu.findUniqueOrThrow({ where: { id: fixture.menu.id } })).liveRevisionId!;
  await publishFixture(prisma, fixture.menu.id);
  const live = (await prisma.menu.findUniqueOrThrow({ where: { id: fixture.menu.id } })).liveRevisionId!;
  withLogo = { menuId: fixture.menu.id, first, live };

  await createMenuFixture(prisma, 'social-plain');
  GET = (await import('@/app/api/[tenant]/social-image/route')).GET;
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('the social image', () => {
  it('draws a 1200 × 630 PNG of the logo on the theme background', async () => {
    const response = await image('social-logo', `?rev=${withLogo.live}&locale=en`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('immutable');
    const png = sharp(Buffer.from(await response.arrayBuffer()));
    expect(await png.metadata()).toMatchObject({ width: 1200, height: 630 });
    const { data, info } = await png.raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    // The corner is the light theme's background; the centre is the logo's red.
    const bg = (await import('@/lib/brand')).DEFAULT_PALETTES.light.bg;
    expect(pixel(2, 2)).toEqual([1, 3, 5].map((at) => Number.parseInt(bg.slice(at, at + 2), 16)));
    expect(pixel(600, 315)[0]).toBeGreaterThan(150);
  });

  it('sends an old revision to the live one', async () => {
    const response = await image('social-logo', `?rev=${withLogo.first}&locale=en`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/api/social-logo/social-image?rev=${withLogo.live}&locale=en`);
  });

  it('is 404 for a menu without a logo or an SEO image', async () => {
    const live = (await prisma.menu.findFirstOrThrow({ where: { slug: 'social-plain' } })).liveRevisionId!;
    expect((await image('social-plain', `?rev=${live}&locale=en`)).status).toBe(404);
  });
});
