import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { isLocale, LOCALES, type Locale } from '@/lib/locale';
import { isTemplateId, TEMPLATE_IDS, TEMPLATES, type DesignOverrides, type TemplateId } from '@/lib/templates';
import type { SceneMedia } from '@/lib/templates/types';
import { designPaletteProblems } from '@/lib/templates/palette';
import { overriddenPalette, parseOverrides } from '@/lib/templates/resolve';
import { allows, type Entitlements, type FeatureKey } from '@/server/domain/entitlements';
import { MOTION_PRESET_IDS, type MotionPresetId } from '@/lib/templates/motion-presets';
import { allowedSceneKinds, motionPresetLock, premiumTemplateLock, sceneChoiceLock, sceneFeature, type SceneFileKind } from '@/server/domain/plan-choices';
import { isSceneKind, SCENE_KINDS, SCENE_MEDIA_KIND } from '@/server/media/kinds';
import { loadAssets } from '@/server/media/resolve';
import { sceneMediaOf } from '@/server/media/scene';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { requireFeature } from '@/server/studio/framework/plan';
import { StudioError } from '@/server/studio/framework/result';
import { editDraft } from './draft-edit';
import type { UpgradeInfo } from './plans';
import { refreshDraftHashes } from './restaurants';

/**
 * A menu's design (spec 2026-10-18-template-studio-design.md, section 7): which template preset it is drawn with, and
 * what the business changed from it. Both live on the brand kit and are part of the draft; guests see them after a
 * publish. Saved designs (`DesignTemplate`) are a restaurant's own, or shared across the platform by a Super Admin.
 */

// Fields --------------------------------------------------------------------------------------------------------------

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const designFields = {
  version: z.number().int().min(1),
  /** The overrides as the Design tab sends them; anything invalid is dropped by `parseOverrides`. */
  overrides: z.record(z.string(), z.unknown()),
};
export const applyField = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), templateId: z.enum(TEMPLATE_IDS) }),
  z.object({ kind: z.literal('custom'), customTemplateId: id }),
  z.object({ kind: z.literal('classic') }),
]);
export const templateName = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');

// Overrides that belong to the business, not to the look: they stay when the template changes or the look is reset.
const CONTENT_KEYS = ['featured', 'promo', 'info', 'ordering'] as const satisfies ReadonlyArray<keyof DesignOverrides>;

function contentOnly(overrides: DesignOverrides): DesignOverrides {
  const kept: DesignOverrides = {};
  for (const key of CONTENT_KEYS) if (overrides[key] !== undefined) Object.assign(kept, { [key]: overrides[key] });
  return kept;
}

function lookOnly(overrides: DesignOverrides): DesignOverrides {
  const look = { ...overrides };
  for (const key of CONTENT_KEYS) delete look[key];
  return look;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

// Reading -------------------------------------------------------------------------------------------------------------

export interface SavedDesign {
  id: string;
  name: string;
  basePresetId: TemplateId;
  shared: boolean;
}

/** What the restaurant's plan offers the Design tab's background file (spec: scene files and plans, 5.4). */
export interface DesignPlanView {
  /** The kinds of file the plan lets the business choose. */
  sceneKinds: SceneFileKind[];
  /** The stored file's feature when the plan lacks it (kept, but guests get the template's scene); else null. */
  lockedScene: FeatureKey | null;
  /** The motion presets the plan lets the business choose (`still` is in every plan). */
  motionPresets: MotionPresetId[];
  /** Whether the plan has the premium templates; without it the Gallery marks them and a save refuses them. */
  premiumTemplates: boolean;
  upgrade: UpgradeInfo;
}

export interface DesignView {
  /** The brand kit's version, which every save of the design sends back. */
  version: number;
  templateId: TemplateId | null;
  overrides: DesignOverrides;
  /** The scene file the overrides name, resolved for the live preview (even when the plan locks it); null when none. */
  sceneMedia: SceneMedia | null;
  plan: DesignPlanView;
  customTemplateId: string | null;
  saved: SavedDesign[];
  /** The menu's products, for choosing what to feature: slug and name in the menu's default language. */
  products: Array<{ slug: string; name: string }>;
  locales: Locale[];
  defaultLocale: Locale;
  restaurantId: string;
  restaurantType: string;
  /** Which of the restaurant's details are filled in (the menu can show only those). */
  details: Record<'hours' | 'address' | 'map' | 'phone' | 'whatsapp' | 'social', boolean>;
  showPoweredBy: boolean;
  /** Only a Super Admin changes Powered by Buzzify and saves designs for every restaurant. */
  superAdmin: boolean;
}

function nameOf(translations: unknown, locale: Locale): string {
  const all = (translations ?? {}) as Partial<Record<Locale, { name?: string }>>;
  return all[locale]?.name || all.en?.name || Object.values(all).find((entry) => entry?.name)?.name || '';
}

export async function designState(
  db: PrismaClient,
  menuId: string,
  restaurantId: string,
  superAdmin: boolean,
  plan: { entitlements: Entitlements; upgrade: UpgradeInfo },
): Promise<DesignView> {
  const menu = await db.menu.findUnique({
    where: { id: menuId },
    select: {
      locales: true,
      defaultLocale: true,
      brand: { select: { version: true, templateId: true, design: true, customTemplateId: true } },
      restaurant: { select: { type: true, address: true, city: true, phone: true, whatsapp: true, mapUrl: true, socialLinks: true, workingHours: true, showPoweredBy: true } },
    },
  });
  if (!menu) throw new StudioError('NOT_FOUND');
  const defaultLocale = isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en';
  const [saved, products] = await Promise.all([
    db.designTemplate.findMany({ where: { OR: [{ restaurantId }, { restaurantId: null }] }, orderBy: [{ restaurantId: 'asc' }, { name: 'asc' }], select: { id: true, name: true, basePresetId: true, restaurantId: true } }),
    db.product.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }], select: { slug: true, translations: true } }),
  ]);
  const r = menu.restaurant;
  const social = (r.socialLinks ?? {}) as Record<string, unknown>;
  const hours = (r.workingHours ?? {}) as Record<string, unknown>;
  const overrides = parseOverrides(menu.brand?.design);
  const scene = await usableSceneAsset(db, restaurantId, overrides.sceneAsset);
  const sceneKind = scene && isSceneKind(scene.kind) ? SCENE_MEDIA_KIND[scene.kind] : null;
  return {
    version: menu.brand?.version ?? 1,
    templateId: isTemplateId(menu.brand?.templateId) ? menu.brand.templateId : null,
    overrides,
    sceneMedia: scene ? sceneMediaOf(scene, (key) => getStorage().publicUrl(key), overrides.sceneAsset?.framing) : null,
    plan: {
      sceneKinds: allowedSceneKinds(plan.entitlements),
      lockedScene: sceneKind && !allows(plan.entitlements, sceneFeature(sceneKind)) ? sceneFeature(sceneKind) : null,
      motionPresets: MOTION_PRESET_IDS.filter((id) => motionPresetLock(id, undefined, plan.entitlements) === null),
      premiumTemplates: allows(plan.entitlements, 'design.premiumTemplates'),
      upgrade: plan.upgrade,
    },
    customTemplateId: menu.brand?.customTemplateId ?? null,
    saved: saved
      .filter((entry) => isTemplateId(entry.basePresetId))
      .map((entry) => ({ id: entry.id, name: entry.name, basePresetId: entry.basePresetId as TemplateId, shared: entry.restaurantId === null })),
    products: products.map((product) => ({ slug: product.slug, name: nameOf(product.translations, defaultLocale) || product.slug })),
    locales: menu.locales.filter(isLocale),
    defaultLocale,
    restaurantId,
    restaurantType: r.type,
    details: {
      hours: Object.values(hours).some((ranges) => Array.isArray(ranges) && ranges.length > 0),
      address: Boolean(r.address.trim() || r.city.trim()),
      map: r.mapUrl.trim() !== '',
      phone: r.phone.trim() !== '',
      whatsapp: r.whatsapp.trim() !== '',
      social: Object.values(social).some((value) => typeof value === 'string' && value.trim() !== ''),
    },
    showPoweredBy: r.showPoweredBy,
    superAdmin,
  };
}

// Saving --------------------------------------------------------------------------------------------------------------

/** The brand kit row of a menu, created with the defaults when the menu has none yet. */
async function brandRow(tx: Parameters<Parameters<typeof editDraft>[1]>[0], menuId: string) {
  const row = await tx.brandConfig.findFirst({ where: { menuId } });
  if (row) return row;
  const menu = await tx.menu.findFirst({ where: { id: menuId }, select: { restaurant: { select: { name: true } } } });
  return tx.brandConfig.create({ data: { menuId, tokens: json(DEFAULT_PALETTES), typography: {}, logoText: menu?.restaurant.name ?? '' } });
}

/** A palette text cannot be read on stops the save, naming each pair and its ratio, as the Brand tab does. */
function refuseUnreadable(templateId: TemplateId, overrides: DesignOverrides): void {
  const blocking = designPaletteProblems(overriddenPalette(TEMPLATES[templateId], overrides)).filter((problem) => problem.severity === 'block');
  if (blocking.length === 0) return;
  const fields: Record<string, string> = { palette: 'Some text would be hard to read on these colours' };
  for (const problem of blocking) fields[`palette.${problem.foreground}/${problem.background}`] = problem.ratio.toFixed(2);
  throw new StudioError('INVALID', undefined, fields);
}

/**
 * Draws the menu with a preset, with a saved design, or as the classic menu. The business's own settings (featured
 * products, its offer, which details to show, ordering) carry over; the look's overrides belong to the template they were
 * made for, so a different template starts from its own defaults. A saved design brings its look along.
 */
export async function applyDesign(ctx: ActionContext, input: { version: number; choice: z.infer<typeof applyField> }): Promise<{ version: number }> {
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) throw new Error('A menu action ran without a restaurant');
  let saved: { id: string; basePresetId: string; overrides: unknown } | null = null;
  if (input.choice.kind === 'custom') {
    saved = await ctx.db.designTemplate.findFirst({
      where: { id: input.choice.customTemplateId, OR: [{ restaurantId }, { restaurantId: null }] },
      select: { id: true, basePresetId: true, overrides: true },
    });
    if (!saved || !isTemplateId(saved.basePresetId)) throw new StudioError('NOT_FOUND');
  }
  // A saved design's background file comes along only if this restaurant may use it; otherwise every later save of the
  // design would be refused for a file the business never chose here.
  const savedLook = saved ? lookOnly(parseOverrides(saved.overrides)) : {};
  const savedScene = await usableSceneAsset(ctx.db, restaurantId, savedLook.sceneAsset);
  if (!savedScene) delete savedLook.sceneAsset;
  return editDraft(ctx, async (tx, menuId) => {
    const row = await brandRow(tx, menuId);
    const current = parseOverrides(row.design);
    // A premium template is newly chosen only on a plan that has it; the one the menu already has is kept.
    const chosen = input.choice.kind === 'preset' ? input.choice.templateId : input.choice.kind === 'custom' ? (saved!.basePresetId as TemplateId) : null;
    const premiumLocked = ctx.plan === null ? null : premiumTemplateLock(chosen, isTemplateId(row.templateId) ? row.templateId : null, ctx.plan.entitlements);
    if (premiumLocked) requireFeature(ctx.plan, premiumLocked);
    // Likewise a file the plan locks, unless it is the one the menu already has.
    if (sceneLock(ctx, savedScene, current.sceneAsset?.assetId ?? null)) delete savedLook.sceneAsset;
    const next =
      input.choice.kind === 'preset'
        ? { templateId: input.choice.templateId, design: row.templateId === input.choice.templateId ? current : contentOnly(current), customTemplateId: null }
        : input.choice.kind === 'custom'
          ? { templateId: saved!.basePresetId, design: { ...savedLook, ...contentOnly(current) }, customTemplateId: saved!.id }
          : { templateId: null, design: contentOnly(current), customTemplateId: null };
    await updateWithVersion(tx.brandConfig, { id: row.id, version: input.version, data: { ...next, design: json(next.design) }, entityType: 'BrandConfig' }, tx);
    ctx.audit({
      action: 'design.applied',
      entityType: 'BrandConfig',
      entityId: row.id,
      changes: { templateId: { before: row.templateId, after: next.templateId }, ...(saved ? { customTemplateId: { before: row.customTemplateId, after: saved.id } } : {}) },
    });
    return { version: input.version + 1 };
  });
}

/** The scene file a design names, if the restaurant may use it: its own or a shared one, and a scene file at all. */
async function usableSceneAsset(db: ActionContext['db'], restaurantId: string, choice: DesignOverrides['sceneAsset']) {
  if (!choice) return null;
  return (await loadAssets(db, restaurantId, [choice.assetId], SCENE_KINDS)).get(choice.assetId) ?? null;
}

/**
 * The feature the restaurant's plan lacks for newly choosing this scene file instead of the stored one, or null (spec:
 * scene files and plans, 4.2). The stored file is kept whatever the plan.
 */
function sceneLock(ctx: ActionContext, asset: { id: string; kind: string } | null, storedAssetId: string | null): FeatureKey | null {
  if (ctx.plan === null) throw new Error('A design is saved on a menu, whose restaurant has a plan');
  const next = asset && isSceneKind(asset.kind) ? { assetId: asset.id, kind: SCENE_MEDIA_KIND[asset.kind] } : null;
  return sceneChoiceLock(next, storedAssetId, ctx.plan.entitlements);
}

/**
 * Saves the business's overrides of its template, refusing colours text cannot be read on, a scene file the restaurant
 * may not use (another restaurant's, a picture, or none at all: `NOT_FOUND` either way), and a newly chosen one its
 * plan lacks (`UPGRADE_REQUIRED`).
 */
export async function updateDesign(ctx: ActionContext, input: { version: number; overrides: Record<string, unknown> }): Promise<{ version: number }> {
  const overrides = parseOverrides(input.overrides);
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) throw new Error('A menu action ran without a restaurant');
  const scene = await usableSceneAsset(ctx.db, restaurantId, overrides.sceneAsset);
  if (overrides.sceneAsset && !scene) throw new StudioError('NOT_FOUND');
  return editDraft(ctx, async (tx, menuId) => {
    const row = await brandRow(tx, menuId);
    if (!isTemplateId(row.templateId)) throw new StudioError('INVALID', 'Choose a template first.');
    const before = parseOverrides(row.design);
    const locked = sceneLock(ctx, scene, before.sceneAsset?.assetId ?? null);
    if (locked) requireFeature(ctx.plan, locked);
    const presetLocked = ctx.plan === null ? null : motionPresetLock(overrides.motionPreset, before.motionPreset, ctx.plan.entitlements);
    if (presetLocked) requireFeature(ctx.plan, presetLocked);
    refuseUnreadable(row.templateId, overrides);
    await updateWithVersion(tx.brandConfig, { id: row.id, version: input.version, data: { design: json(overrides) }, entityType: 'BrandConfig' }, tx);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(overrides)])].filter(
      (key) => JSON.stringify(before[key as keyof DesignOverrides]) !== JSON.stringify(overrides[key as keyof DesignOverrides]),
    );
    ctx.audit({ action: 'design.updated', entityType: 'BrandConfig', entityId: row.id, changes: { fields: { before: null, after: changed } } });
    return { version: input.version + 1 };
  });
}

/** Puts the look back to the template's defaults. Featured products, the offer, details and ordering stay as they are. */
export async function resetDesign(ctx: ActionContext, input: { version: number }): Promise<{ version: number }> {
  return editDraft(ctx, async (tx, menuId) => {
    const row = await brandRow(tx, menuId);
    const kept = contentOnly(parseOverrides(row.design));
    await updateWithVersion(tx.brandConfig, { id: row.id, version: input.version, data: { design: json(kept), customTemplateId: null }, entityType: 'BrandConfig' }, tx);
    ctx.audit({ action: 'design.reset', entityType: 'BrandConfig', entityId: row.id, changes: {} });
    return { version: input.version + 1 };
  });
}

/**
 * Saves a design for reuse: the menu's template and look (`from: 'menu'`), or a preset as it is (`from: preset id`), the
 * duplicate to customize. A Super Admin may share it with every restaurant; anyone else saves it for their restaurant.
 */
export async function saveDesign(
  ctx: ActionContext,
  input: { name: string; shared: boolean; from: 'menu' | TemplateId },
): Promise<SavedDesign> {
  const restaurantId = ctx.restaurantId;
  const menuId = ctx.menuId;
  if (restaurantId === null || menuId === null) throw new Error('A menu action ran without a restaurant');
  if (input.shared && !ctx.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');
  let basePresetId: TemplateId;
  let overrides: DesignOverrides = {};
  if (input.from === 'menu') {
    const row = await ctx.db.brandConfig.findFirst({ where: { menuId }, select: { templateId: true, design: true } });
    if (!row || !isTemplateId(row.templateId)) throw new StudioError('INVALID', 'Choose a template first.');
    basePresetId = row.templateId;
    overrides = lookOnly(parseOverrides(row.design));
  } else basePresetId = input.from;
  // Every restaurant may apply a shared design, so the scene file it names must be one every restaurant may use.
  if (input.shared && overrides.sceneAsset) {
    const scene = await ctx.db.mediaAsset.findFirst({ where: { id: overrides.sceneAsset.assetId, restaurantId: null }, select: { id: true } });
    if (!scene) throw new StudioError('INVALID', undefined, { sceneAsset: 'A shared design can only use a file from the shared library' });
  }
  const data = { name: input.name, basePresetId, overrides: json(overrides), createdById: ctx.actor.userId };
  // A shared design belongs to no restaurant, which the menu's scoped client may not write; the check above stands for it.
  const created = input.shared
    ? await ctx.db.designTemplate.create({ data: { ...data, restaurantId: null } })
    : await ctx.transaction((tx) => tx.designTemplate.create({ data: { ...data, restaurantId } }));
  ctx.audit({ action: 'design.saved', entityType: 'DesignTemplate', entityId: created.id, changes: { name: { before: null, after: input.name }, shared: { before: null, after: input.shared } } });
  return { id: created.id, name: created.name, basePresetId, shared: input.shared };
}

/** Removes a saved design: a restaurant's own, or (Super Admins only) a shared one. Menus drawn with it keep their look. */
export async function deleteDesign(ctx: ActionContext, input: { id: string }): Promise<void> {
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) throw new Error('A menu action ran without a restaurant');
  const row = await ctx.db.designTemplate.findFirst({ where: { id: input.id, OR: [{ restaurantId }, { restaurantId: null }] }, select: { id: true, restaurantId: true, name: true } });
  if (!row) throw new StudioError('NOT_FOUND');
  if (row.restaurantId === null && !ctx.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');
  if (row.restaurantId === null) await ctx.db.designTemplate.delete({ where: { id: row.id } });
  else await ctx.transaction((tx) => tx.designTemplate.deleteMany({ where: { id: row.id } }));
  ctx.audit({ action: 'design.deleted', entityType: 'DesignTemplate', entityId: row.id, changes: { name: { before: row.name, after: null } } });
}

/**
 * Shows or hides "Powered by Buzzify" on every template menu of a restaurant (Super Admins only, by the action's
 * permission). Each menu's draft changes, so each shows unpublished changes until it is published.
 */
export async function setPoweredBy(ctx: ActionContext, input: { show: boolean }): Promise<void> {
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) throw new Error('A restaurant action ran without a restaurant');
  await ctx.transaction(async (tx) => {
    const before = await tx.restaurant.findFirstOrThrow({ where: { id: restaurantId }, select: { showPoweredBy: true } });
    await tx.restaurant.updateMany({ where: { id: restaurantId }, data: { showPoweredBy: input.show } });
    const menus = await tx.menu.findMany({ where: { restaurantId }, select: { id: true } });
    // A restaurant's client cannot read its menus' rows; their drafts are hashed again once this has committed.
    ctx.afterCommit(() => void refreshDraftHashes(ctx.db, menus.map((menu) => menu.id)));
    ctx.audit({ action: 'restaurant.powered_by_changed', entityType: 'Restaurant', entityId: restaurantId, changes: { showPoweredBy: { before: before.showPoweredBy, after: input.show } } });
  });
}

/** Locales the Design tab writes texts in, for the overrides' texts to be checked against. */
export const DESIGN_LOCALES = LOCALES;
