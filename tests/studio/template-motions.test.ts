import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as design from '@/server/studio/actions/design';
import * as motions from '@/server/studio/actions/motions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as designQueries from '@/server/studio/queries/design';
import * as motionQueries from '@/server/studio/queries/motions';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

/** Applying a template places its suggested motions (spec: 2026-10-18-template-motions-design.md, section 4). */

const prisma = () => getPrisma();
const META = { ip: '203.0.113.10', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), designer, def, input, META);
const version = async () => dataOf(await runQuery(prisma(), designer, designQueries.get, { menuId: a.menu.id })).version;
const apply = async (choice: Record<string, unknown>) => dataOf(await run(design.apply, { menuId: a.menu.id, version: await version(), choice }));
const rows = () => prisma().menuMotion.findMany({ where: { menuId: a.menu.id }, orderBy: { slot: 'asc' } });
const placed = async () => (await rows()).map((row) => [row.slot.startsWith('category:') ? 'category' : row.slot, row.motionId, row.fromTemplate]);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // One category, "Coffee": every template suggests coffee steam over it.
  a = await createMenuFixture(prisma(), 'tpl-motions-a');
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('a template’s suggested motions', () => {
  it('are placed when the template is applied, marked as the template’s', async () => {
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    expect(await placed()).toEqual([
      ['category', 'coffee-steam', 'obsidian-gold'],
      ['hero', 'golden-particles', 'obsidian-gold'],
    ]);
    const hero = (await rows()).find((row) => row.slot === 'hero')!;
    expect(hero.params).toMatchObject({ background: expect.stringMatching(/^#[0-9a-f]{6}$/) });
  });

  it('give way to the next template’s, and leave with Classic', async () => {
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    await apply({ kind: 'preset', templateId: 'copper-roast' });
    expect(await placed()).toEqual([
      ['category', 'coffee-steam', 'copper-roast'],
      ['hero', 'coffee-beans-falling', 'copper-roast'],
    ]);
    await apply({ kind: 'classic' });
    expect(await placed()).toEqual([]);
  });

  it('never replace a motion the designer placed', async () => {
    dataOf(await run(motions.save, { menuId: a.menu.id, place: 'hero', motionId: 'aurora-background', params: {}, texts: {}, version: null }));
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    await apply({ kind: 'classic' });
    expect(await placed()).toEqual([['hero', 'aurora-background', null]]);
  });

  it('become the designer’s once saved in the Motion tab, and stay through a change of template', async () => {
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    const hero = (await rows()).find((row) => row.slot === 'hero')!;
    dataOf(await run(motions.save, { menuId: a.menu.id, place: 'hero', motionId: 'golden-particles', params: { count: 300 }, texts: {}, version: hero.version }));
    await apply({ kind: 'preset', templateId: 'copper-roast' });
    expect(await placed()).toEqual([
      ['category', 'coffee-steam', 'copper-roast'],
      ['hero', 'golden-particles', null],
    ]);
  });

  it('are not placed on a plan without motions on the menu', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    expect(await placed()).toEqual([]);
  });

  it('are Studio bookkeeping only: the draft snapshot carries the motions without who placed them', async () => {
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    const snapshot = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(snapshot.motions).toHaveLength(2);
    expect(JSON.stringify(snapshot.motions)).not.toContain('fromTemplate');
  });

  it('are marked in the Motion tab with the template that suggested them', async () => {
    await apply({ kind: 'preset', templateId: 'obsidian-gold' });
    const view = dataOf(await runQuery(prisma(), designer, motionQueries.list, { menuId: a.menu.id }));
    expect(view.templateId).toBe('obsidian-gold');
    expect(view.places.find((place) => place.place === 'hero')?.motion).toMatchObject({ suggestedBy: 'obsidian-gold' });
  });
});
