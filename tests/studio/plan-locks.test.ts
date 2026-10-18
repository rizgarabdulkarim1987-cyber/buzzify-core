import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { activateDueRevisions } from '@/server/publish/revisions';
import * as brand from '@/server/studio/actions/brand';
import * as menus from '@/server/studio/actions/menus';
import * as qr from '@/server/studio/actions/qr';
import * as revisions from '@/server/studio/actions/revisions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as brandQueries from '@/server/studio/queries/brand';
import * as menuQueries from '@/server/studio/queries/menus';
import * as previewQueries from '@/server/studio/queries/preview';
import * as qrQueries from '@/server/studio/queries/qr';
import * as revisionQueries from '@/server/studio/queries/revisions';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const GOOD = 'correct horse battery staple';
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

const BRANDED = { foreground: '#123456', background: '#FFFFFF', logo: false, frameText: 'Scan' };
const PLAIN = { foreground: '#000000', background: '#FFFFFF', logo: false, frameText: 'Scan' };

describe('plans lock what a restaurant may choose', () => {
  const prisma = () => getPrisma();
  let dir: string;
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let designer: Actor;
  let owner: Actor;

  const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = designer) => runAction(prisma(), actor, def, input, META);
  const setPlan = (restaurantId: string, plan: 'BASIC' | 'PRO' | 'PREMIUM') => prisma().restaurant.update({ where: { id: restaurantId }, data: { plan } });
  const brandRow = (menuId: string) => prisma().brandConfig.findUniqueOrThrow({ where: { menuId } });

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
    dir = mkdtempSync(join(tmpdir(), 'buzzify-plan-locks-'));
    vi.stubEnv('MEDIA_LOCAL_DIR', dir);
    vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
  });

  beforeEach(async () => {
    await resetTestData(prisma());
    a = await createMenuFixture(prisma(), 'locks-a');
    const { userId } = await createPasswordUser(prisma(), { email: 'designer@locks.test', name: 'Dana', password: GOOD });
    await prisma().membership.create({ data: { userId, restaurantId: a.restaurant.id, role: 'DESIGNER' } });
    designer = (await loadActor(prisma(), userId))!;
    const created = await createPasswordUser(prisma(), { email: 'owner@buzzify.test', name: 'Owner', password: GOOD, isSuperAdmin: true, isPlatformOwner: true });
    await prisma().user.update({ where: { id: created.userId }, data: { twoFactorEnabled: true } });
    owner = (await loadActor(prisma(), created.userId))!;
  });

  afterAll(async () => {
    await resetTestData(prisma());
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('the Brand tab', () => {
    it('keeps a locked choice a downgraded menu already has, and refuses choosing one anew', async () => {
      dataOf(await run(brand.update, await kit({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' })));
      await setPlan(a.restaurant.id, 'BASIC');
      const kept = await kit({ logoText: 'Renamed' });
      expect(dataOf(await run(brand.update, kept))).toMatchObject({ version: kept.version + 1 });
      expect(await brandRow(a.menu.id)).toMatchObject({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive', logoText: 'Renamed' });
      expect(failureOf(await run(brand.update, await kit({ railStyle: 'flap' })))).toMatchObject({
        code: 'UPGRADE_REQUIRED',
        upgrade: { feature: 'design.railStyles', plan: 'PRO' },
      });
      expect(failureOf(await run(brand.update, await kit({ fontPairId: 'cafe' }))).upgrade).toEqual({ feature: 'design.fontPairs', plan: 'PRO' });
    });

    it('tells the Brand tab what the plan offers and which stored choices guests do not see', async () => {
      dataOf(await run(brand.update, await kit({ railStyle: 'drum', fontPairId: 'fine' })));
      await setPlan(a.restaurant.id, 'BASIC');
      const view = dataOf(await runQuery(prisma(), designer, brandQueries.get, { menuId: a.menu.id }));
      expect(view.plan).toMatchObject({ fontPairs: ['classic', 'modern'], rails: ['plain'], motions: ['none', 'subtle'], hidden: ['design.fontPairs', 'design.railStyles'] });
      // What guests get in place of each stored choice, for the tab's "Guests see … until the plan includes …".
      expect(view.plan.guestSees).toEqual({ fontPairId: 'classic', railStyle: 'plain', motionIntensity: view.motionIntensity });
      expect(view.plan.upgrade).toMatchObject({ restaurantName: a.restaurant.name, isOwner: false, lowest: { 'design.railStyles': 'PRO' } });
    });
  });

  describe('new and duplicated menus', () => {
    it('starts a Basic restaurant’s new menu on the plain rail and a Premium one on the melting dish', async () => {
      await setPlan(a.restaurant.id, 'BASIC');
      const basic = dataOf(await run(menus.createMenu, { restaurantId: a.restaurant.id, name: 'Lunch', slug: 'locks-lunch' }));
      expect((await brandRow(basic.menuId)).railStyle).toBe('plain');
      await setPlan(a.restaurant.id, 'PREMIUM');
      const premium = dataOf(await run(menus.createMenu, { restaurantId: a.restaurant.id, name: 'Dinner', slug: 'locks-dinner' }));
      expect((await brandRow(premium.menuId)).railStyle).toBe('grains');
    });

    it('brings a duplicated menu within the plan of the restaurant it lands in, leaving the source as it was', async () => {
      dataOf(await run(brand.update, await kit({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' })));
      const b = await createMenuFixture(prisma(), 'locks-b');
      await setPlan(b.restaurant.id, 'BASIC');
      const copy = dataOf(await run(menus.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'locks-copy', targetRestaurantId: b.restaurant.id }, owner));
      expect(await brandRow(copy.menuId)).toMatchObject({ railStyle: 'plain', fontPairId: 'classic', motionIntensity: 'subtle' });
      expect(await brandRow(a.menu.id)).toMatchObject({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' });
    });
  });

  describe('QR codes', () => {
    it('refuses giving a code brand colours on Basic, keeps a code that had them, and draws it plain', async () => {
      const { id } = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
      dataOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: id, version: 1, label: 'Door', style: BRANDED }));
      await setPlan(a.restaurant.id, 'BASIC');
      // Renaming keeps the colours it had.
      dataOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: id, version: 2, label: 'Front door', style: BRANDED }));
      const list = dataOf(await runQuery(prisma(), designer, qrQueries.list, { menuId: a.menu.id }));
      const code = list.codes.find((entry) => entry.id === id)!;
      expect(code.style).toEqual(BRANDED);
      expect(code.svg).not.toContain('#123456');
      expect(list.branded).toBe(false);
      expect(list.upgrade.lowest['qr.branded']).toBe('PRO');

      const other = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Bar' }));
      expect(failureOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: other.id, version: 1, label: 'Bar', style: BRANDED })).code).toBe('UPGRADE_REQUIRED');
      expect((await run(qr.update, { menuId: a.menu.id, qrCodeId: other.id, version: 1, label: 'Bar', style: PLAIN })).ok).toBe(true);
    });

    it('refuses applying a branded style to the other codes on Basic', async () => {
      const { id } = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
      dataOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: id, version: 1, label: 'Door', style: BRANDED }));
      dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Bar' }));
      await setPlan(a.restaurant.id, 'BASIC');
      expect(failureOf(await run(qr.applyStyle, { menuId: a.menu.id, qrCodeId: id })).upgrade).toEqual({ feature: 'qr.branded', plan: 'PRO' });
    });
  });

  describe('the preview', () => {
    it('shows the draft as guests on the restaurant’s plan would see it', async () => {
      dataOf(await run(brand.update, await kit({ railStyle: 'drum', motionIntensity: 'expressive' })));
      await setPlan(a.restaurant.id, 'BASIC');
      const { tenant } = dataOf(await runQuery(prisma(), designer, previewQueries.draft, { menuId: a.menu.id, locale: 'en' }));
      expect(tenant.brand).toMatchObject({ railStyle: 'plain', motionIntensity: 'subtle' });
      expect(tenant.features).toEqual({ explore: false, stage: false, smartSelling: false, offers: false, socialProof: false, rails: ['plain'] });
    });

    it('leaves the offers out of the preview and names them in the note on a plan without them', async () => {
      await prisma().promotion.create({
        data: { menuId: a.menu.id, kind: 'DISCOUNT', percentOff: 50, productIds: [a.product.id], translations: { en: { title: 'Half price' } } },
      });
      const premium = dataOf(await runQuery(prisma(), designer, previewQueries.draft, { menuId: a.menu.id, locale: 'en' }));
      expect(premium.view.offers.map((offer) => offer.title)).toEqual(['Half price']);
      await setPlan(a.restaurant.id, 'BASIC');
      const basic = dataOf(await runQuery(prisma(), designer, previewQueries.draft, { menuId: a.menu.id, locale: 'en' }));
      expect(basic.view.offers).toEqual([]);
      expect(basic.view.products.find((product) => product.id === a.product.id)).not.toHaveProperty('regularPrice');
      expect(dataOf(await runQuery(prisma(), designer, previewQueries.planNote, { menuId: a.menu.id })).hidden).toContain('selling.offers');
    });

    it('names what guests on the plan do not see, with the hint’s data, and nothing on a plan that has it all', async () => {
      dataOf(await run(brand.update, await kit({ railStyle: 'drum', motionIntensity: 'expressive' })));
      expect(dataOf(await runQuery(prisma(), designer, previewQueries.planNote, { menuId: a.menu.id }))).toEqual({ hidden: [], upgrade: null });
      await setPlan(a.restaurant.id, 'BASIC');
      const note = dataOf(await runQuery(prisma(), designer, previewQueries.planNote, { menuId: a.menu.id }));
      expect(note.hidden).toEqual(['design.railStyles', 'design.expressiveMotion', 'immersive.explore']);
      expect(note.upgrade?.lowest['immersive.explore']).toBe('PREMIUM');
    });
  });

  describe('scheduled publishing', () => {
    it('refuses scheduling on Basic but still publishes what was scheduled before the downgrade', async () => {
      await setPlan(a.restaurant.id, 'PRO');
      const goLiveAt = new Date(Date.now() + 5 * 60_000);
      const scheduled = dataOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt: goLiveAt.toISOString() }));
      await setPlan(a.restaurant.id, 'BASIC');
      expect(failureOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt: goLiveAt.toISOString(), replacePending: true })).code).toBe('UPGRADE_REQUIRED');
      const list = dataOf(await runQuery(prisma(), designer, revisionQueries.list, { menuId: a.menu.id }));
      expect(list).toMatchObject({ canSchedule: false });
      expect(list.upgrade.lowest['publish.scheduling']).toBe('PRO');
      await activateDueRevisions(prisma(), new Date(goLiveAt.getTime() + 60_000));
      expect((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).liveRevisionId).toBe(scheduled.revisionId);
    });

    it('gives the menu’s Schedule entry the hint’s data only when the plan has no scheduling', async () => {
      expect(dataOf(await runQuery(prisma(), designer, menuQueries.getMenu, { menuId: a.menu.id })).scheduleUpgrade).toBeNull();
      await setPlan(a.restaurant.id, 'BASIC');
      const menu = dataOf(await runQuery(prisma(), designer, menuQueries.getMenu, { menuId: a.menu.id }));
      expect(menu.scheduleUpgrade?.lowest['publish.scheduling']).toBe('PRO');
    });
  });
});
