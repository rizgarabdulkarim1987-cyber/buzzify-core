import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaKind } from '@/generated/prisma/client';
import { PREMIUM_TEMPLATE_IDS } from '@/lib/templates/premium';
import { entitlementsFor } from '@/server/data/plans';
import { getPrisma } from '@/server/data/prisma';
import { tenantInfo } from '@/server/data/public-menu';
import type { PlanTier } from '@/server/domain/entitlements';
import { parseSnapshot } from '@/server/domain/snapshot';
import { brandRowFromSnapshot, loadDraftSnapshot } from '@/server/publish/draft';
import * as design from '@/server/studio/actions/design';
import * as media from '@/server/studio/actions/media';
import * as menuActions from '@/server/studio/actions/menus';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as designQueries from '@/server/studio/queries/design';
import * as mediaQueries from '@/server/studio/queries/media';
import * as previewQueries from '@/server/studio/queries/preview';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

/**
 * A library file as a template menu's background (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 4):
 * chosen in the design, frozen at publish, carried by saved designs, kept from deletion while anything uses it.
 */

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

let dir: string;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;
let admin: Actor;

async function person(id: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']>, superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name: id, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), actor, def, input);
const state = async (actor: Actor = designer) => dataOf(await ask(actor, designQueries.get, { menuId: a.menu.id }));
const overrides = async () => (await prisma().brandConfig.findUniqueOrThrow({ where: { menuId: a.menu.id } })).design as Record<string, unknown>;

async function apply(choice: Record<string, unknown>, actor: Actor = designer) {
  return run(actor, design.apply, { menuId: a.menu.id, version: (await state(actor)).version, choice });
}
async function update(next: Record<string, unknown>, actor: Actor = designer) {
  return run(actor, design.update, { menuId: a.menu.id, version: (await state(actor)).version, overrides: next });
}

/** A library row of a kind, its files named as the library names them (nothing needs to be in storage). */
async function asset(restaurantId: string | null, kind: MediaKind, seed: string = kind): Promise<string> {
  const hash = createHash('sha256').update(`${restaurantId}-${seed}`).digest('hex');
  const folder = `${restaurantId === null ? 'shared' : `r/${restaurantId}`}/${hash}`;
  const variants =
    kind === 'MODEL'
      ? { original: `${folder}/original.glb` }
      : kind === 'VIDEO'
        ? {
            original: `${folder}/original.mp4`,
            poster: {
              avif: { '320': `${folder}/poster-avif-320.avif`, '640': `${folder}/poster-avif-640.avif` },
              webp: { '320': `${folder}/poster-webp-320.webp`, '640': `${folder}/poster-webp-640.webp` },
            },
          }
        : kind === 'LOTTIE'
          ? { original: `${folder}/original.json` }
          : { original: `${folder}/original.png`, webp: { '320': `${folder}/webp-320.webp` }, avif: { '320': `${folder}/avif-320.avif` } };
  const sized = kind === 'VIDEO' ? { width: 1080, height: 1920 } : kind === 'LOTTIE' ? { width: 512, height: 512 } : kind === 'IMAGE' ? { width: 320, height: 200 } : {};
  const row = await prisma().mediaAsset.create({
    data: {
      restaurantId,
      kind,
      storageKey: folder,
      contentHash: hash,
      mime: { MODEL: 'model/gltf-binary', VIDEO: 'video/mp4', LOTTIE: 'application/json', IMAGE: 'image/png', SVG: 'image/svg+xml', ICON: 'image/x-icon' }[kind],
      bytes: 100,
      storedBytes: 100,
      ...sized,
      variants,
      placeholder: kind === 'VIDEO' ? 'data:image/webp;base64,UklGRg==' : '',
    },
  });
  return row.id;
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  dir = mkdtempSync(join(tmpdir(), 'buzzify-scene-files-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'scene-a');
  b = await createMenuFixture(prisma(), 'scene-b');
  designer = await person('designer-a', [[a.restaurant.id, 'DESIGNER']]);
  admin = await person('admin', [], true);
  dataOf(await apply({ kind: 'preset', templateId: 'obsidian-gold' }));
});

afterAll(async () => {
  await resetTestData(prisma());
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('choosing a scene file', () => {
  it("takes the restaurant's own file or a shared one, and the Design tab reads it back resolved", async () => {
    const own = await asset(a.restaurant.id, 'MODEL');
    dataOf(await update({ sceneAsset: { assetId: own, framing: { scale: 1.4 } } }));
    expect((await state()).sceneMedia).toEqual({
      kind: 'model',
      assetId: own,
      url: expect.stringMatching(new RegExp(`^/api/dev-media/r/${a.restaurant.id}/[0-9a-f]+/original\\.glb$`)),
      framing: { scale: 1.4, x: 0, y: 0, turn: 0 },
    });

    const shared = await asset(null, 'VIDEO');
    dataOf(await update({ sceneAsset: { assetId: shared } }));
    expect((await state()).sceneMedia).toMatchObject({
      kind: 'video',
      assetId: shared,
      url: expect.stringMatching(/^\/api\/dev-media\/shared\/.+\/original\.mp4$/),
      width: 1080,
      height: 1920,
      poster: { url: expect.stringMatching(/poster-webp-640\.webp$/), srcset: expect.stringMatching(/poster-webp-320\.webp 320w, .+poster-webp-640\.webp 640w$/), placeholder: 'data:image/webp;base64,UklGRg==' },
    });

    const lottie = await asset(a.restaurant.id, 'LOTTIE');
    dataOf(await update({ sceneAsset: { assetId: lottie } }));
    expect((await state()).sceneMedia).toMatchObject({ kind: 'lottie', width: 512, height: 512, url: expect.stringMatching(/original\.json$/) });
  });

  it("refuses another restaurant's file, a vector graphic, or one that does not exist", async () => {
    for (const assetId of [await asset(b.restaurant.id, 'MODEL'), await asset(a.restaurant.id, 'SVG'), 'missing']) {
      expect(failureOf(await update({ sceneAsset: { assetId } })).code).toBe('NOT_FOUND');
    }
    expect((await overrides()).sceneAsset).toBeUndefined();
  });

  it('takes a photo from the library as the background (design.backgroundImage)', async () => {
    const photo = await asset(a.restaurant.id, 'IMAGE');
    dataOf(await update({ sceneAsset: { assetId: photo } }));
    expect((await overrides()).sceneAsset).toEqual({ assetId: photo });
  });

  it('leaves with the look: changing template or resetting removes it, and a saved design keeps it', async () => {
    const own = await asset(a.restaurant.id, 'VIDEO');
    dataOf(await update({ sceneAsset: { assetId: own } }));
    dataOf(await apply({ kind: 'preset', templateId: 'kyoto-ink' }));
    expect((await overrides()).sceneAsset).toBeUndefined();

    dataOf(await update({ sceneAsset: { assetId: own } }));
    dataOf(await run(designer, design.reset, { menuId: a.menu.id, version: (await state()).version }));
    expect((await overrides()).sceneAsset).toBeUndefined();

    dataOf(await update({ sceneAsset: { assetId: own } }));
    const saved = dataOf(await run(designer, design.save, { menuId: a.menu.id, name: 'House look', shared: false, from: 'menu' }));
    dataOf(await apply({ kind: 'preset', templateId: 'ivory-marble' }));
    dataOf(await apply({ kind: 'custom', customTemplateId: saved.id }));
    expect((await overrides()).sceneAsset).toEqual({ assetId: own });
  });

  it('leaves out a saved design’s file the restaurant cannot use, so the design can still be saved after applying it', async () => {
    const theirs = await asset(b.restaurant.id, 'MODEL');
    const saved = await prisma().designTemplate.create({ data: { restaurantId: null, name: 'Old platform look', basePresetId: 'kyoto-ink', overrides: { sceneAsset: { assetId: theirs } } } });
    dataOf(await apply({ kind: 'custom', customTemplateId: saved.id }));
    expect((await overrides()).sceneAsset).toBeUndefined();
    dataOf(await update({ paletteId: 'smoke' }));
  });

  it('lets a shared saved design name only shared files', async () => {
    dataOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'MODEL') } }, admin));
    expect(failureOf(await run(admin, design.save, { menuId: a.menu.id, name: 'Platform look', shared: true, from: 'menu' }))).toMatchObject({
      code: 'INVALID',
      fields: { sceneAsset: expect.any(String) },
    });
    dataOf(await update({ sceneAsset: { assetId: await asset(null, 'MODEL') } }, admin));
    expect(dataOf(await run(admin, design.save, { menuId: a.menu.id, name: 'Platform look', shared: true, from: 'menu' }))).toMatchObject({ shared: true });
  });
});

describe('publishing a scene file', () => {
  it('freezes the file into the design and names it on the revision', async () => {
    const own = await asset(a.restaurant.id, 'VIDEO');
    dataOf(await update({ sceneAsset: { assetId: own } }));
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.brand.design?.media).toMatchObject({ kind: 'video', assetId: own, url: expect.stringMatching(/original\.mp4$/) });

    const outcome = await publishFixture(prisma(), a.menu.id);
    const revision = await prisma().menuRevision.findUniqueOrThrow({ where: { id: outcome.revisionId } });
    expect(revision.assetIds).toContain(own);
  });

  it('writes the choice back on restore, renamed when the file was copied', async () => {
    const own = await asset(a.restaurant.id, 'MODEL');
    dataOf(await update({ sceneAsset: { assetId: own, framing: { turn: 45 } } }));
    const { brand } = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(brandRowFromSnapshot(brand).design).toMatchObject({ sceneAsset: { assetId: own, framing: { turn: 45 } } });
    expect(brandRowFromSnapshot(brand, new Map([[own, 'copy-1']])).design).toMatchObject({ sceneAsset: { assetId: 'copy-1', framing: { turn: 45 } } });
  });

  it('copies the file into the restaurant a menu is duplicated into', async () => {
    const own = await asset(a.restaurant.id, 'LOTTIE');
    dataOf(await update({ sceneAsset: { assetId: own } }));
    const { menuId } = dataOf(await run(admin, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'scene-copy', targetRestaurantId: b.restaurant.id }));
    const copied = (await prisma().brandConfig.findUniqueOrThrow({ where: { menuId } })).design as { sceneAsset?: { assetId: string } };
    expect(copied.sceneAsset?.assetId).toBeDefined();
    expect(copied.sceneAsset?.assetId).not.toBe(own);
    const copy = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: copied.sceneAsset!.assetId } });
    const original = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: own } });
    expect(copy).toMatchObject({ restaurantId: b.restaurant.id, kind: 'LOTTIE', storageKey: original.storageKey });
  });
});

describe('a plan without the file’s feature (spec 2026-10-18-scene-files-plans-design.md)', () => {
  const onPlan = (plan: PlanTier, restaurantId = a.restaurant.id) => prisma().restaurant.update({ where: { id: restaurantId }, data: { plan } });
  const shared = (name: string, assetId: string) =>
    prisma().designTemplate.create({ data: { restaurantId: null, name, basePresetId: 'obsidian-gold', overrides: { sceneAsset: { assetId } } } });

  it('refuses a newly chosen video or model on Pro, naming the feature and the plan that has it, and takes a Lottie file', async () => {
    await onPlan('PRO');
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'VIDEO') } }))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      upgrade: { feature: 'design.backgroundVideo', plan: 'PREMIUM' },
    });
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(null, 'MODEL') } }))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      upgrade: { feature: 'immersive.models3d', plan: 'PREMIUM' },
    });
    expect((await overrides()).sceneAsset).toBeUndefined();
    const lottie = await asset(a.restaurant.id, 'LOTTIE');
    dataOf(await update({ sceneAsset: { assetId: lottie } }));
    expect((await overrides()).sceneAsset).toEqual({ assetId: lottie });
  });

  it('project 2: a picture needs design.backgroundImage, a preset design.motionPresets, a premium template design.premiumTemplates', async () => {
    await onPlan('BASIC');
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'IMAGE') } }))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      upgrade: { feature: 'design.backgroundImage', plan: 'PRO' },
    });
    expect(failureOf(await update({ motionPreset: 'lively' }))).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.motionPresets', plan: 'PRO' } });
    dataOf(await update({ motionPreset: 'still' }));
    expect((await overrides()).motionPreset).toBe('still');
    const premium = PREMIUM_TEMPLATE_IDS[0];
    expect(failureOf(await apply({ kind: 'preset', templateId: premium }))).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.premiumTemplates', plan: 'PRO' } });

    await onPlan('PRO');
    const photo = await asset(a.restaurant.id, 'IMAGE');
    dataOf(await apply({ kind: 'preset', templateId: premium }));
    dataOf(await update({ sceneAsset: { assetId: photo }, motionPreset: 'lively' }));
    expect(await overrides()).toMatchObject({ sceneAsset: { assetId: photo }, motionPreset: 'lively' });

    // A downgrade keeps what is stored and refuses nothing the menu already has.
    await onPlan('BASIC');
    dataOf(await update({ sceneAsset: { assetId: photo }, motionPreset: 'lively', paletteId: 'smoke' }));
    expect(await overrides()).toMatchObject({ motionPreset: 'lively', paletteId: 'smoke' });
    dataOf(await apply({ kind: 'preset', templateId: premium }));
  });

  it('refuses a Lottie file on Basic, and still answers another restaurant’s file with NOT_FOUND', async () => {
    await onPlan('BASIC');
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'LOTTIE') } }))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      upgrade: { feature: 'design.backgroundAnimation', plan: 'PRO' },
    });
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(b.restaurant.id, 'VIDEO') } })).code).toBe('NOT_FOUND');
  });

  it('keeps a file stored before a downgrade through other changes, and refuses another locked one', async () => {
    const video = await asset(a.restaurant.id, 'VIDEO');
    dataOf(await update({ sceneAsset: { assetId: video } }));
    await onPlan('PRO');
    dataOf(await update({ sceneAsset: { assetId: video }, paletteId: 'smoke' }));
    expect(await overrides()).toMatchObject({ sceneAsset: { assetId: video }, paletteId: 'smoke' });
    expect(failureOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'VIDEO', 'second') } })).code).toBe('UPGRADE_REQUIRED');

    await onPlan('PREMIUM');
    const model = await asset(a.restaurant.id, 'MODEL');
    dataOf(await update({ sceneAsset: { assetId: model } }));
    await onPlan('PRO');
    dataOf(await update({ sceneAsset: { assetId: model, framing: { scale: 1.5, turn: 30 } } }));
    expect((await overrides()).sceneAsset).toEqual({ assetId: model, framing: { scale: 1.5, turn: 30 } });
  });

  it('tells the Design tab which kinds the plan allows and that the stored file is locked', async () => {
    dataOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'VIDEO') } }));
    expect((await state()).plan).toEqual({
      sceneKinds: ['model', 'video', 'lottie', 'image'],
      lockedScene: null,
      motionPresets: ['still', 'calm', 'lively', 'showtime'],
      premiumTemplates: true,
      upgrade: expect.objectContaining({ restaurantId: a.restaurant.id }),
    });
    await onPlan('PRO');
    expect((await state()).plan).toEqual({
      sceneKinds: ['lottie', 'image'],
      lockedScene: 'design.backgroundVideo',
      motionPresets: ['still', 'calm', 'lively', 'showtime'],
      premiumTemplates: true,
      upgrade: expect.objectContaining({ restaurantId: a.restaurant.id }),
    });
    // The live preview still gets the file itself.
    expect((await state()).sceneMedia).toMatchObject({ kind: 'video' });
  });

  it('lists the locked file in the Preview tab’s plan note', async () => {
    dataOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'VIDEO') } }));
    await onPlan('PRO');
    const note = dataOf(await ask(designer, previewQueries.planNote, { menuId: a.menu.id }));
    expect(note.hidden).toContain('design.backgroundVideo');
  });

  it('applies a saved design without a file the plan locks, and the design saves afterwards', async () => {
    await onPlan('PRO');
    dataOf(await apply({ kind: 'custom', customTemplateId: (await shared('Platform video', await asset(null, 'VIDEO'))).id }));
    expect((await overrides()).sceneAsset).toBeUndefined();

    await onPlan('BASIC');
    dataOf(await apply({ kind: 'custom', customTemplateId: (await shared('Platform dots', await asset(null, 'LOTTIE'))).id }));
    expect((await overrides()).sceneAsset).toBeUndefined();
    dataOf(await update({ paletteId: 'smoke' }));
  });

  it('leaves a locked file out of a copy, in another restaurant or the same one, and still copies the file', async () => {
    const video = await asset(a.restaurant.id, 'VIDEO');
    dataOf(await update({ sceneAsset: { assetId: video } }));
    await onPlan('PRO', b.restaurant.id);
    const elsewhere = dataOf(await run(admin, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'scene-copy-b', targetRestaurantId: b.restaurant.id }));
    expect(((await prisma().brandConfig.findUniqueOrThrow({ where: { menuId: elsewhere.menuId } })).design as Record<string, unknown>).sceneAsset).toBeUndefined();
    expect(await prisma().mediaAsset.count({ where: { restaurantId: b.restaurant.id, kind: 'VIDEO' } })).toBe(1);

    await onPlan('PRO');
    const here = dataOf(await run(admin, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'scene-copy-a' }));
    expect(((await prisma().brandConfig.findUniqueOrThrow({ where: { menuId: here.menuId } })).design as Record<string, unknown>).sceneAsset).toBeUndefined();
    // The source keeps its own choice.
    expect((await overrides()).sceneAsset).toEqual({ assetId: video });
  });

  it('serves a published menu without the file after a downgrade, with the revision untouched', async () => {
    dataOf(await update({ sceneAsset: { assetId: await asset(a.restaurant.id, 'VIDEO') } }));
    const { revisionId } = await publishFixture(prisma(), a.menu.id);
    const before = await prisma().menuRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const guests = async () => tenantInfo(a.menu, revisionId, parseSnapshot(before.snapshot), await entitlementsFor(prisma(), a.restaurant.id)).brand.design;

    expect((await guests())?.media).toMatchObject({ kind: 'video' });
    await onPlan('PRO');
    expect(await guests()).toMatchObject({ templateId: 'obsidian-gold' });
    expect((await guests())?.media).toBeUndefined();
    const after = await prisma().menuRevision.findUniqueOrThrow({ where: { id: revisionId } });
    expect(after.snapshotHash).toBe(before.snapshotHash);
  });
});

describe('a scene file in use', () => {
  it('lists the brand kit and the saved design that use it, and is not deleted while they or a revision do', async () => {
    const own = await asset(a.restaurant.id, 'MODEL');
    const usage = async () => dataOf(await ask(designer, mediaQueries.usage, { restaurantId: a.restaurant.id, assetId: own }));
    const remove = async () => run(designer, media.deleteAsset, { restaurantId: a.restaurant.id, assetId: own });

    dataOf(await update({ sceneAsset: { assetId: own } }));
    const saved = dataOf(await run(designer, design.save, { menuId: a.menu.id, name: 'House look', shared: false, from: 'menu' }));
    expect((await usage()).drafts).toEqual([
      { menuId: a.menu.id, menuName: a.menu.name, where: 'scene', label: a.menu.name },
      { menuId: '', menuName: 'House look', where: 'savedDesign', label: 'House look' },
    ]);
    expect(failureOf(await remove())).toMatchObject({ code: 'INVALID', fields: { usage: '2' } });

    // Published, then taken out of the draft and the saved design removed: the revision still shows it to guests.
    await publishFixture(prisma(), a.menu.id);
    dataOf(await run(designer, design.reset, { menuId: a.menu.id, version: (await state()).version }));
    dataOf(await run(designer, design.remove, { menuId: a.menu.id, id: saved.id }));
    expect(await usage()).toEqual({ drafts: [], revisions: [expect.objectContaining({ menuId: a.menu.id })] });
    expect(failureOf(await remove()).code).toBe('INVALID');
  });

  it("does not count another restaurant's saved design that names a file of the same id", async () => {
    const own = await asset(a.restaurant.id, 'MODEL');
    await prisma().designTemplate.create({ data: { restaurantId: b.restaurant.id, name: 'Theirs', basePresetId: 'obsidian-gold', overrides: { sceneAsset: { assetId: own } } } });
    expect(dataOf(await ask(designer, mediaQueries.usage, { restaurantId: a.restaurant.id, assetId: own }))).toEqual({ drafts: [], revisions: [] });
  });
});
