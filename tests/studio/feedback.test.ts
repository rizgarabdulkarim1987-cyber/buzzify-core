import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMenuFeedback } from '@/server/studio/actions/feedback';
import { restaurantFeedback } from '@/server/studio/queries/feedback';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuId = '';
let owner: Person;
let stranger: Person;

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Feedback A', 'none');
  b = await restaurant('Feedback B', 'none');
  menuId = await menuOf(a.id, 'fb-a');
  await menuOf(b.id, 'fb-b');
  owner = await person('fb-owner', { membership: [a.id, 'OWNER'] });
  stranger = await person('fb-stranger', { membership: [b.id, 'OWNER'] });
  const rows = [
    { restaurantId: a.id, clientKey: 'k1-xxxxxxxxxxxxxxxx', body: 'Cold soup', category: 'FOOD' as const, createdAt: new Date('2026-10-01') },
    { restaurantId: a.id, clientKey: 'k2-xxxxxxxxxxxxxxxx', body: 'Add a kids menu', category: 'SUGGESTION' as const, contactName: 'Sara', contactPhone: '0770 123 4567', createdAt: new Date('2026-10-02') },
    { restaurantId: b.id, clientKey: 'k3-xxxxxxxxxxxxxxxx', body: 'Other place', createdAt: new Date('2026-10-03') },
  ];
  for (const row of rows) await prisma().posComplaint.create({ data: { locale: 'en', ...row } });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the feedback tab of a restaurant', () => {
  it('lists its own messages newest first, with the menus and their switches', async () => {
    const data = dataOf(await ask(owner, restaurantFeedback, { restaurantId: a.id }));
    expect(data.rows.map((row) => row.body)).toEqual(['Add a kids menu', 'Cold soup']);
    expect(data.rows[0]).toMatchObject({ category: 'SUGGESTION', contactName: 'Sara' });
    expect(data.menus).toEqual([{ id: menuId, name: 'fb-a', feedbackEnabled: true }]);
  });

  it('shuts out a person of another restaurant', async () => {
    expect(codeOf(await ask(stranger, restaurantFeedback, { restaurantId: a.id }))).not.toBe('OK');
  });
});

describe('the menu switch', () => {
  it('turns the box off and on, and writes an audit row', async () => {
    dataOf(await run(owner, setMenuFeedback, { menuId, enabled: false }));
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).feedbackEnabled).toBe(false);
    expect(await prisma().auditLog.count({ where: { action: 'menu.feedback_changed', menuId } })).toBe(1);
    dataOf(await run(owner, setMenuFeedback, { menuId, enabled: true }));
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).feedbackEnabled).toBe(true);
  });

  it('refuses a person of another restaurant', async () => {
    expect(codeOf(await run(stranger, setMenuFeedback, { menuId, enabled: false }))).not.toBe('OK');
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).feedbackEnabled).toBe(true);
  });
});
