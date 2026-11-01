import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jump } from '@/server/studio/queries/search';
import { listRestaurants } from '@/server/studio/queries/restaurants';
import { ask, dataOf, person, prisma, resetWorld, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const APP = path.join(process.cwd(), 'src/app/studio/(studio)/(app)');
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

let admin: Person;

beforeAll(() => {
  useTestDatabase();
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

beforeEach(async () => {
  await resetWorld();
  admin = await person('admin', { superAdmin: true });
  await prisma().restaurant.create({ data: { name: 'Cafe Alpha' } });
  await prisma().restaurant.create({ data: { name: 'Alpha Pharmacy', sector: 'PHARMACY' } });
});

describe('the Menu and Cashier space', () => {
  it('lists no pharmacy', async () => {
    const list = dataOf(await ask(admin, listRestaurants, { space: 'food' }));
    expect(list.rows.map((row) => row.name)).toEqual(['Cafe Alpha']);
  });

  it('never offers a pharmacy to Jump to', async () => {
    const found = dataOf(await ask(admin, jump, { q: 'alpha', space: 'food' }));
    expect(found.restaurants.map((row) => row.name)).toEqual(['Cafe Alpha']);
    const pharmacy = dataOf(await ask(admin, jump, { q: 'alpha', space: 'pharmacy' }));
    expect(pharmacy.restaurants.map((row) => row.name)).toEqual(['Alpha Pharmacy']);
  });

  it('shows a Super Admin no sector filter or sector column, since the space is the sector', () => {
    expect(read('restaurants/page.tsx')).toContain('showSector={!actor.isSuperAdmin}');
  });

  it('opens a result of Jump to in the space it was searched from', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/studio/shell/JumpTo.tsx'), 'utf8');
    expect(source).toContain('businessPath(');
    expect(source).toContain('space');
  });
});
