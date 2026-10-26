import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as design from '@/server/studio/actions/design';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as designQueries from '@/server/studio/queries/design';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.9', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;
let admin: Actor;

async function person(id: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']>, superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name: id, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const state = async (actor: Actor = designer, menuId = a.menu.id) => dataOf(await runQuery(prisma(), actor, designQueries.get, { menuId }));
const brandRow = () => prisma().brandConfig.findUniqueOrThrow({ where: { menuId: a.menu.id } });

async function apply(choice: Record<string, unknown>, actor: Actor = designer) {
  return run(actor, design.apply, { menuId: a.menu.id, version: (await state(actor)).version, choice });
}
async function update(overrides: Record<string, unknown>, actor: Actor = designer) {
  return run(actor, design.update, { menuId: a.menu.id, version: (await state(actor)).version, overrides });
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'design-a');
  designer = await person('designer-a', [[a.restaurant.id, 'DESIGNER']]);
  admin = await person('admin', [], true);
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('applying a template', () => {
  it('changes the draft only: the slug, the products and the live revision stay as they were', async () => {
    const before = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));

    const after = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(after.slug).toBe('design-a');
    expect(after.liveRevisionId).toBe(before.liveRevisionId);
    expect(after.liveHash).toBe(before.liveHash);
    expect(after.draftHash).not.toBe(before.draftHash);
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.brand.design?.templateId).toBe('copper-roast');
    expect(draft.catalog.products.map((product) => product.slug)).toEqual(['design-a-espresso']);
    const live = await prisma().menuRevision.findUniqueOrThrow({ where: { id: after.liveRevisionId! } });
    expect((live.snapshot as { brand: { design?: unknown } }).brand.design).toBeUndefined();
  });

  it('keeps featured products and the offer on a switch, and leaves the old template’s look behind', async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    dataOf(await update({ paletteId: 'crema', featured: { slugs: ['design-a-espresso'] }, ordering: 'none' }));
    dataOf(await apply({ kind: 'preset', templateId: 'nordic-brew' }));
    expect((await brandRow()).design).toEqual({ featured: { slugs: ['design-a-espresso'] }, ordering: 'none' });
  });

  it('keeps every override when the same template is applied again', async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    dataOf(await update({ paletteId: 'crema' }));
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    expect((await brandRow()).design).toEqual({ paletteId: 'crema' });
  });

  it('goes back to the classic menu, whose draft has no design', async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    dataOf(await apply({ kind: 'classic' }));
    expect((await brandRow()).templateId).toBeNull();
    expect((await loadDraftSnapshot(prisma(), a.menu.id)).brand.design).toBeUndefined();
  });

  it('refuses an owner whose restaurant took away brand editing', async () => {
    const owner = await person('owner-a', [[a.restaurant.id, 'OWNER']]);
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['brand.edit'] } } } });
    const refused = await run(owner, design.apply, { menuId: a.menu.id, version: 1, choice: { kind: 'preset', templateId: 'copper-roast' } });
    expect(failureOf(refused).code).toBe('FORBIDDEN');
  });
});

describe('customizing a template', () => {
  beforeEach(async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
  });

  it('refuses colours text cannot be read on, naming the pair', async () => {
    const error = failureOf(await update({ colors: { bg: '#ffffff', text: '#f4f4f4' } }));
    expect(error.code).toBe('INVALID');
    expect(error.fields).toMatchObject({ palette: expect.any(String), 'palette.text/bg': expect.stringMatching(/^\d\.\d\d$/) });
  });

  it('refuses a stale save', async () => {
    const stale = (await state()).version;
    dataOf(await update({ paletteId: 'crema' }));
    expect(failureOf(await run(designer, design.update, { menuId: a.menu.id, version: stale, overrides: { paletteId: 'ristretto' } })).code).toBe('CONFLICT');
  });

  it('drops what it does not recognise rather than storing it', async () => {
    dataOf(await update({ paletteId: 'crema', script: '<script>alert(1)</script>', layout: { hero: 'nope', card: 'list' } }));
    expect((await brandRow()).design).toEqual({ paletteId: 'crema', layout: { card: 'list' } });
  });

  it('resets the look and keeps the business’s own settings', async () => {
    dataOf(await update({ paletteId: 'crema', layout: { card: 'list' }, featured: { slugs: ['design-a-espresso'] } }));
    dataOf(await run(designer, design.reset, { menuId: a.menu.id, version: (await state()).version }));
    expect((await brandRow()).design).toEqual({ featured: { slugs: ['design-a-espresso'] } });
  });

  it('refuses to customize before a template is chosen', async () => {
    dataOf(await apply({ kind: 'classic' }));
    expect(failureOf(await update({ paletteId: 'crema' })).code).toBe('INVALID');
  });
});

describe('saved designs', () => {
  beforeEach(async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    dataOf(await update({ paletteId: 'crema', featured: { slugs: ['design-a-espresso'] } }));
  });

  it('saves the look for the restaurant, and applying it brings the look back', async () => {
    const saved = dataOf(await run(designer, design.save, { menuId: a.menu.id, name: 'House crema', shared: false, from: 'menu' }));
    expect(saved).toMatchObject({ basePresetId: 'copper-roast', shared: false });
    expect((await prisma().designTemplate.findUniqueOrThrow({ where: { id: saved.id } })).overrides).toEqual({ paletteId: 'crema' });

    dataOf(await apply({ kind: 'preset', templateId: 'nordic-brew' }));
    dataOf(await apply({ kind: 'custom', customTemplateId: saved.id }));
    const row = await brandRow();
    expect(row).toMatchObject({ templateId: 'copper-roast', customTemplateId: saved.id });
    expect(row.design).toEqual({ paletteId: 'crema', featured: { slugs: ['design-a-espresso'] } });
  });

  it("does not find another restaurant's saved design", async () => {
    const b = await createMenuFixture(prisma(), 'design-b');
    const theirs = await prisma().designTemplate.create({ data: { restaurantId: b.restaurant.id, name: 'Theirs', basePresetId: 'kyoto-ink', overrides: {} } });
    expect(failureOf(await apply({ kind: 'custom', customTemplateId: theirs.id })).code).toBe('NOT_FOUND');
    expect(failureOf(await run(designer, design.remove, { menuId: a.menu.id, id: theirs.id })).code).toBe('NOT_FOUND');
    expect((await state()).saved.map((entry) => entry.id)).not.toContain(theirs.id);
  });

  it('lets only a Super Admin share a design with every restaurant, which others can apply but not delete', async () => {
    expect(failureOf(await run(designer, design.save, { menuId: a.menu.id, name: 'For all', shared: true, from: 'menu' })).code).toBe('FORBIDDEN');
    const shared = dataOf(await run(admin, design.save, { menuId: a.menu.id, name: 'For all', shared: true, from: 'ivory-marble' }));
    expect((await prisma().designTemplate.findUniqueOrThrow({ where: { id: shared.id } })).restaurantId).toBeNull();

    expect((await state()).saved).toEqual(expect.arrayContaining([expect.objectContaining({ id: shared.id, shared: true })]));
    dataOf(await apply({ kind: 'custom', customTemplateId: shared.id }));
    expect((await brandRow()).templateId).toBe('ivory-marble');
    expect(failureOf(await run(designer, design.remove, { menuId: a.menu.id, id: shared.id })).code).toBe('FORBIDDEN');
  });
});

describe('Powered by Buzzify', () => {
  it('is changed only by a Super Admin, and reaches the draft of every template menu', async () => {
    dataOf(await apply({ kind: 'preset', templateId: 'copper-roast' }));
    expect((await loadDraftSnapshot(prisma(), a.menu.id)).brand.design?.poweredBy).toBe(true);

    expect(failureOf(await run(designer, design.poweredBy, { restaurantId: a.restaurant.id, show: false })).code).toBe('FORBIDDEN');
    dataOf(await run(admin, design.poweredBy, { restaurantId: a.restaurant.id, show: false }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).showPoweredBy).toBe(false);
    expect((await loadDraftSnapshot(prisma(), a.menu.id)).brand.design?.poweredBy).toBe(false);
  });
});
