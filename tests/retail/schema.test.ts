import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

beforeAll(async () => {
  await resetTestData(prisma);
  await seedApplications(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('the retail link tables', () => {
  it('BusinessSector has RETAIL', async () => {
    const client = new pg.Client({ connectionString: databaseUrl(TEST_DB) });
    await client.connect();
    const { rows } = await client.query<{ v: string }>('SELECT unnest(enum_range(NULL::"BusinessSector"))::text AS v').finally(() => client.end());
    expect(rows.map((r) => r.v)).toEqual(['FOOD', 'PHARMACY', 'RETAIL']);
  });

  it('the retail Application row is DISABLED with sortOrder 4', async () => {
    const app = await prisma.application.findUniqueOrThrow({ where: { id: 'retail' } });
    expect(app).toMatchObject({ status: 'DISABLED', sortOrder: 4 });
  });

  it('one RetailLink per restaurant', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Link twice', sector: 'RETAIL' } });
    await prisma.retailLink.create({ data: { restaurantId: restaurant.id } });
    const error = await prisma.retailLink.create({ data: { restaurantId: restaurant.id } }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'P2002' });
  });

  it('deleting the restaurant removes its link and outbox row', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Cascade', sector: 'RETAIL' } });
    await prisma.retailLink.create({ data: { restaurantId: restaurant.id } });
    await prisma.retailOutbox.create({ data: { restaurantId: restaurant.id, dueVersion: 1 } });
    await prisma.restaurant.delete({ where: { id: restaurant.id } });
    expect(await prisma.retailLink.count({ where: { restaurantId: restaurant.id } })).toBe(0);
    expect(await prisma.retailOutbox.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });

  it('defaults to IQD, version 0 and AI off', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Defaults', sector: 'RETAIL' } });
    const link = await prisma.retailLink.create({ data: { restaurantId: restaurant.id } });
    expect(link).toMatchObject({ currencies: ['IQD'], aiIntake: false, stateVersion: 0, acceptedVersion: 0, retailBusinessId: null });
  });

  it('CHECK refuses dueVersion 0', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Due zero', sector: 'RETAIL' } });
    const error = await prisma.retailOutbox.create({ data: { restaurantId: restaurant.id, dueVersion: 0 } }).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain('RetailOutbox_dueVersion_check');
  });

  it('CHECK refuses empty currencies', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'No currency', sector: 'RETAIL' } });
    const error = await prisma.retailLink.create({ data: { restaurantId: restaurant.id, currencies: [] } }).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain('RetailLink_currencies_check');
  });
});
