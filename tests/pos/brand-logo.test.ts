import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareAsset, storeAsset } from '@/server/media/process';
import { restaurantLogoOf } from '@/server/pos/brand';
import { getStorage } from '@/server/storage/storage';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();
let dir: string;

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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'buzzify-brand-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('restaurantLogoOf', () => {
  it('is null for a restaurant with no logo', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'No Logo' } });
    expect(await restaurantLogoOf(prisma, restaurant.id)).toBeNull();
  });

  it('is null when the logo asset is gone, so the header falls back to the Buzzify logo', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Gone', logoAssetId: 'no-such-asset' } });
    expect(await restaurantLogoOf(prisma, restaurant.id)).toBeNull();
  });

  it('gives the logo’s address and size when it exists', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'With Logo' } });
    const assetId = await storeLogo(restaurant.id);
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { logoAssetId: assetId } });
    const logo = await restaurantLogoOf(prisma, restaurant.id);
    expect(logo?.url).toMatch(/^\/api\/dev-media\//);
    expect(logo).toMatchObject({ width: 400, height: 200 });
  });

  it('is null for an unknown restaurant', async () => {
    expect(await restaurantLogoOf(prisma, 'nope')).toBeNull();
  });
});
