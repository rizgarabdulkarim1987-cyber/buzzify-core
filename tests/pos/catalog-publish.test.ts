import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishMenu } from '@/server/publish/publish';
import { ensureCatalogMenu, posCreateCategory, posCreateProduct, posDeleteProduct, posSaveProductBasics, posSetAvailability } from '@/server/studio/actions/pos';
import { dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let owner: Person;
let manager: Person;
let menuId: string;

const arabic = (text: string) => ({ ar: text });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Publish A');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  menuId = dataOf(await run(owner, ensureCatalogMenu, {})).menuId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const liveJson = async () => {
  const menu = await prisma().menu.findUniqueOrThrow({ where: { id: menuId }, select: { liveRevisionId: true } });
  if (!menu.liveRevisionId) return null;
  return JSON.stringify((await prisma().menuRevision.findUniqueOrThrow({ where: { id: menu.liveRevisionId } })).snapshot);
};

async function setUp() {
  const categoryId = dataOf(await run(manager, posCreateCategory, { names: arabic('مشروبات') })).categoryId;
  const productId = dataOf(await run(manager, posCreateProduct, { categoryId, names: arabic('شاي'), price: 1500 })).productId;
  return { categoryId, productId };
}

const goLive = () => prisma().$transaction((tx) => publishMenu(tx, { menuId, actorId: null, now: new Date() }));

describe('a cashier’s edit of the product list reaches the guests’ menu', () => {
  it('republishes a live menu when a product’s name and price change', async () => {
    const { categoryId, productId } = await setUp();
    expect((await goLive()).ok).toBe(true);
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posSaveProductBasics, { productId, version, names: arabic('شاي كرك'), price: 2000, categoryId }));
    const json = await liveJson();
    expect(json).toContain('شاي كرك');
    expect(json).toContain('2000');
  });

  it('shows a new product and drops a deleted one', async () => {
    const { categoryId, productId } = await setUp();
    expect((await goLive()).ok).toBe(true);
    dataOf(await run(manager, posCreateProduct, { categoryId, names: arabic('قهوة'), price: 3000 }));
    expect(await liveJson()).toContain('قهوة');
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posDeleteProduct, { productId, version }));
    expect(await liveJson()).not.toContain('شاي');
  });

  it('leaves hide and sold-out switches to their own live path, with no new revision', async () => {
    const { productId } = await setUp();
    expect((await goLive()).ok).toBe(true);
    const before = await prisma().menuRevision.count({ where: { menuId } });
    dataOf(await run(manager, posSetAvailability, { productId, isHidden: true }));
    expect(await prisma().menuRevision.count({ where: { menuId } })).toBe(before);
  });

  it('never publishes a till-only menu that was not live', async () => {
    const { categoryId, productId } = await setUp();
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posSaveProductBasics, { productId, version, names: arabic('شاي'), price: 1800, categoryId }));
    expect(await liveJson()).toBeNull();
    expect(await prisma().menuRevision.count({ where: { menuId } })).toBe(0);
  });

  it('keeps the edit when the publish is blocked, and records that it was skipped', async () => {
    const { categoryId, productId } = await setUp();
    expect((await goLive()).ok).toBe(true);
    const spy = vi.spyOn(await import('@/server/publish/publish'), 'publishMenu').mockResolvedValue({ ok: false, issues: [] });
    const version = (await prisma().product.findUniqueOrThrow({ where: { id: productId } })).version;
    dataOf(await run(manager, posSaveProductBasics, { productId, version, names: arabic('شاي'), price: 2500, categoryId }));
    spy.mockRestore();
    expect((await prisma().product.findUniqueOrThrow({ where: { id: productId } })).basePrice).toBe(2500);
    expect(await prisma().auditLog.count({ where: { action: 'pos.catalog.publish_skipped' } })).toBe(1);
  });
});
