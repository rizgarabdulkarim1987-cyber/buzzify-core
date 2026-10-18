import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, sanitizePalette } from '@/lib/brand';
import { isLocale, LOCALES, type Locale } from '@/lib/locale';
import type { MotionParams } from '@/motion/types';
import { allows } from '@/server/domain/entitlements';
import { cleanMotion, MOTION_PLACES, slotOf, type MotionPlace, type MotionTexts } from '@/server/domain/menu-motions';
import type { Motion } from '@/server/domain/plan-choices';
import { resolveText } from '@/server/domain/translate';
import type { TranslationMap } from '@/server/domain/types';
import type { ActionContext } from '@/server/studio/framework/action';
import { deleteWithVersion, updateWithVersion } from '@/server/studio/framework/concurrency';
import { requireFeature } from '@/server/studio/framework/plan';
import type { QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from './content';
import { editDraft } from './draft-edit';
import { isUniqueViolation } from './menus';
import { upgradeInfo, type UpgradeInfo } from './plans';

/**
 * The Motion tab (spec: docs/superpowers/specs/2026-10-18-menu-motions-design.md, section 10): a menu's motions are
 * draft rows, one per place, saved at their own version through the draft and published with the revision. A motion
 * the plan does not include may be kept, never newly placed.
 */

// Fields --------------------------------------------------------------------------------------------------------------

const paramValue = z.union([z.string().max(200), z.number(), z.boolean()]);

export const placeFields = {
  menuId: idField,
  place: z.enum(MOTION_PLACES, 'Choose one of the places offered'),
  categoryId: idField.optional(),
};

export const saveFields = {
  ...placeFields,
  motionId: z.string().min(1).max(64),
  params: z.record(z.string().max(40), paramValue),
  texts: z.record(z.string().max(40), z.record(z.string().max(8), z.string().max(400))),
  /** The version the person started from; null for a place that had no motion. */
  version: z.number().int().min(1).nullable(),
};

type PlaceInput = { place: MotionPlace; categoryId?: string | undefined };
type SaveInput = z.infer<z.ZodObject<typeof saveFields>>;
type RemoveInput = PlaceInput & { version: number };

function slotFor(input: PlaceInput): string {
  if (input.place === 'category' && !input.categoryId) throw new StudioError('INVALID', undefined, { categoryId: 'Choose a category' });
  if (input.place !== 'category' && input.categoryId) throw new StudioError('INVALID', undefined, { categoryId: 'This place has no category' });
  return slotOf(input.place, input.categoryId);
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

// Saving --------------------------------------------------------------------------------------------------------------

/**
 * Places a motion, or tunes or changes the one at its place. The motion must be one the place offers; params are
 * resolved and texts kept for the menu's languages (`cleanMotion`). A new place (`version: null`) that someone has filled
 * meanwhile, or a stale version, is `CONFLICT`.
 */
export async function saveMotion(ctx: ActionContext, input: SaveInput): Promise<{ version: number }> {
  const slot = slotFor(input);
  return editDraft(ctx, async (tx, menuId) => {
    if (input.categoryId && !(await tx.category.findFirst({ where: { id: input.categoryId }, select: { id: true } }))) {
      throw new StudioError('NOT_FOUND');
    }
    const menu = await tx.menu.findFirstOrThrow({ where: { id: menuId }, select: { locales: true } });
    const locales = menu.locales.filter(isLocale);
    const motion = cleanMotion(input, { locales, categoryIds: new Set(input.categoryId ? [input.categoryId] : []) });
    if (!motion) throw new StudioError('INVALID', undefined, { motionId: 'Choose one of the motions offered here' });

    const stored = await tx.menuMotion.findFirst({ where: { slot } });
    // A motion the plan does not include may stay where it is (tuned, even), never be newly placed.
    if (stored?.motionId !== motion.motionId) requireFeature(ctx.plan, 'design.menuMotions');

    const data = { motionId: motion.motionId, params: json(motion.params), texts: json(motion.texts) };
    let id: string;
    let version: number;
    if (input.version === null) {
      if (stored) throw new StudioError('CONFLICT');
      try {
        const created = await tx.menuMotion.create({ data: { menuId, slot, categoryId: input.categoryId ?? null, ...data } });
        id = created.id;
      } catch (error) {
        if (isUniqueViolation(error)) throw new StudioError('CONFLICT');
        throw error;
      }
      version = 1;
    } else {
      if (!stored) throw new StudioError('NOT_FOUND');
      await updateWithVersion(tx.menuMotion, { id: stored.id, version: input.version, data, entityType: 'MenuMotion' }, tx);
      id = stored.id;
      version = input.version + 1;
    }

    const before = { motionId: stored?.motionId ?? null, params: stored?.params ?? null, texts: stored?.texts ?? null };
    const after = { motionId: motion.motionId, params: motion.params, texts: motion.texts };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of ['motionId', 'params', 'texts'] as const) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes[field] = { before: before[field], after: after[field] };
    }
    ctx.audit({ action: 'motion.placed', entityType: 'MenuMotion', entityId: id, changes: { slot: { before: slot, after: slot }, ...changes } });
    return { version };
  });
}

/** Takes the motion off its place, at the version the person read. Always allowed, whatever the plan. */
export async function removeMotion(ctx: ActionContext, input: RemoveInput): Promise<{ removed: true }> {
  const slot = slotFor(input);
  return editDraft(ctx, async (tx) => {
    const stored = await tx.menuMotion.findFirst({ where: { slot } });
    if (!stored) throw new StudioError('NOT_FOUND');
    await deleteWithVersion(tx.menuMotion, { id: stored.id, version: input.version, entityType: 'MenuMotion' }, tx);
    ctx.audit({
      action: 'motion.removed',
      entityType: 'MenuMotion',
      entityId: stored.id,
      changes: { slot: { before: slot, after: null }, motionId: { before: stored.motionId, after: null } },
    });
    return { removed: true };
  });
}

// Reading -------------------------------------------------------------------------------------------------------------

export interface MotionPlaceView {
  place: MotionPlace;
  categoryId?: string;
  /** The category's name in the menu's default language; empty for the menu's own places. */
  name: string;
  motion: { motionId: string; params: MotionParams; texts: MotionTexts; version: number } | null;
}

export interface MotionPlacesView {
  locales: Locale[];
  defaultLocale: Locale;
  logoText: string;
  /** The page colour of the brand's theme: what a motion's background starts as, and what previews are drawn on. */
  pageBackground: string;
  motionIntensity: Motion;
  hasSignature: boolean;
  places: MotionPlaceView[];
  /** Whether the restaurant's plan includes motions on the menu. */
  allowed: boolean;
  upgrade: UpgradeInfo | null;
}

/** The Motion tab's places: the top of the menu, behind the signature dish, then each category in the menu's order. */
export async function motionPlaces(db: PrismaClient, ctx: QueryContext): Promise<MotionPlacesView> {
  if (ctx.menuId === null || ctx.plan === null) throw new Error('motionPlaces ran without a menu');
  const menuId = ctx.menuId;
  const menu = await db.menu.findUnique({
    where: { id: menuId },
    select: { locales: true, defaultLocale: true, brand: true, restaurant: { select: { name: true } } },
  });
  if (!menu) throw new StudioError('NOT_FOUND');
  const [categories, rows, signatures] = await Promise.all([
    db.category.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, slug: true, translations: true } }),
    db.menuMotion.findMany({ where: { menuId } }),
    db.product.count({ where: { menuId, isSignature: true } }),
  ]);
  const locales = menu.locales.filter(isLocale);
  const defaultLocale = isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en';
  const brand = menu.brand;
  const theme = brand?.theme === 'LIGHT' ? 'light' : 'dark';
  const tokens = (brand?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const motionIntensity = brand?.motionIntensity === 'none' || brand?.motionIntensity === 'expressive' ? brand.motionIntensity : 'subtle';
  const bySlot = new Map(rows.map((row) => [row.slot, row]));
  const stored = (slot: string): MotionPlaceView['motion'] => {
    const row = bySlot.get(slot);
    return row
      ? { motionId: row.motionId, params: row.params as MotionParams, texts: row.texts as MotionTexts, version: row.version }
      : null;
  };
  const allowed = allows(ctx.plan.entitlements, 'design.menuMotions');
  return {
    locales: locales.length > 0 ? locales : [...LOCALES.slice(0, 1)],
    defaultLocale,
    logoText: brand?.logoText ?? menu.restaurant.name,
    pageBackground: sanitizePalette(tokens[theme], DEFAULT_PALETTES[theme]).bg,
    motionIntensity,
    hasSignature: signatures > 0,
    places: [
      { place: 'hero', name: '', motion: stored('hero') },
      { place: 'signature', name: '', motion: stored('signature') },
      ...categories.map((category) => ({
        place: 'category' as const,
        categoryId: category.id,
        name: resolveText(category.translations as TranslationMap, 'name', defaultLocale, defaultLocale) || category.slug,
        motion: stored(slotOf('category', category.id)),
      })),
    ],
    allowed,
    upgrade: allowed ? null : await upgradeInfo(db, ctx),
  };
}
