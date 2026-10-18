import sharp from 'sharp';
import { z } from 'zod';
import type { BrandConfig, MediaAsset, Prisma, PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, HEX, sanitizePalette, type Palette } from '@/lib/brand';
import { DEFAULT_FONT_PAIR, FONT_PAIR_IDS, isFontPairId, type FontPairId } from '@/lib/font-pairs';
import { dominantColors, paletteProblems, suggestPalettes, type PaletteProblem } from '@/lib/palette';
import { isRailStyle, RAIL_STYLES, type RailStyle } from '@/lib/rail';
import { isTemplateId, TEMPLATES } from '@/lib/templates';
import { MEDIA_MAX_BYTES } from '@/server/domain/media-type';
import type { FeatureKey } from '@/server/domain/entitlements';
import { brandChoiceLock, type BrandChoices, type Motion } from '@/server/domain/plan-choices';
import { FAVICON_SIZES, faviconFiles, type AssetVariants } from '@/server/media/process';
import { loadAssets } from '@/server/media/resolve';
import { assetKey, IMMUTABLE_CACHE } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { requireFeature } from '@/server/studio/framework/plan';
import { StudioError } from '@/server/studio/framework/result';
import { PICTURE_KINDS } from '@/server/media/kinds';
import { editDraft } from './draft-edit';
import { thumbKey } from './media';
import type { UpgradeInfo } from './plans';

/**
 * The brand kit (spec 12): the palette of each theme, the logos, the favicon, the font pair, the rail and the motion. It
 * is part of the draft, saved at the kit's own version; guests see it after a publish.
 */

// Fields --------------------------------------------------------------------------------------------------------------

const colour = z.string().regex(HEX, 'Use a colour such as #1A1A1A');
export const paletteField = z.object({
  bg: colour,
  surface: colour,
  raised: colour,
  accent: colour,
  text: colour,
  muted: colour,
  line: colour,
  onAccent: colour,
});

const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const faviconField = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('fromLogo') }),
  z.object({ kind: z.literal('asset'), assetId }),
]);
export type FaviconChoice = z.infer<typeof faviconField>;

export const brandFields = {
  version: z.number().int().min(1),
  theme: z.enum(['light', 'dark'], 'Choose one of the themes offered'),
  palette: paletteField,
  logoAssetId: assetId.nullable(),
  logoDarkAssetId: assetId.nullable(),
  favicon: faviconField,
  fontPairId: z.enum(FONT_PAIR_IDS, 'Choose one of the font pairs offered'),
  railStyle: z.enum(RAIL_STYLES, 'Choose one of the rail styles offered'),
  motionIntensity: z.enum(['none', 'subtle', 'expressive'], 'Choose one of the motion levels offered'),
  logoText: z.string().trim().min(1, 'Enter the name shown in place of a logo').max(60, 'Use at most 60 characters'),
};
type BrandInput = z.infer<z.ZodObject<typeof brandFields>>;

// Favicons ------------------------------------------------------------------------------------------------------------

type FaviconSource = Pick<MediaAsset, 'id' | 'kind' | 'restaurantId' | 'contentHash' | 'variants'>;

/**
 * Makes sure an asset has the favicon PNGs (32, 180 and 512 px): draws them from its original when it has none and
 * records them on the asset. An icon file is used as it is. Runs before the kit's transaction: the files are derived
 * from the asset alone, and one left over by a refused save is simply there for the next.
 */
async function ensureFavicon(db: PrismaClient, asset: FaviconSource): Promise<void> {
  const variants = asset.variants as unknown as AssetVariants;
  if (asset.kind === 'ICON' || variants.favicon) return;
  const storage = getStorage();
  const original = await storage.get(variants.original, MEDIA_MAX_BYTES);
  if (!original) throw new StudioError('INVALID', 'This picture could not be read. Upload it again.');
  const files = await faviconFiles({ kind: asset.kind, original: original.bytes });
  const favicon = {} as Record<(typeof FAVICON_SIZES)[number], string>;
  for (const size of FAVICON_SIZES) {
    const key = assetKey({ restaurantId: asset.restaurantId }, asset.contentHash, `favicon-${size}`, 'png');
    await storage.put(key, files[size], { contentType: 'image/png', cacheControl: IMMUTABLE_CACHE });
    favicon[size] = key;
  }
  await db.mediaAsset.update({ where: { id: asset.id }, data: { variants: { ...variants, favicon } as unknown as Prisma.InputJsonObject } });
}

// Saving --------------------------------------------------------------------------------------------------------------

function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

/**
 * Saves the kit at the version the person read. The palette replaces the one of its theme; a palette with text that
 * would be hard to read is refused, naming each pair and its ratio (`fields['palette.muted/surface'] = '3.10'`), while a
 * weak accent is saved and returned as a warning. Logos and the favicon must be the restaurant's or shared.
 */
export async function updateBrand(ctx: ActionContext, input: BrandInput): Promise<{ version: number; warnings: PaletteProblem[] }> {
  const problems = paletteProblems(input.palette);
  const blocking = problems.filter((problem) => problem.severity === 'block');
  if (blocking.length > 0) {
    const fields: Record<string, string> = { palette: 'Some text would be hard to read on these colours' };
    for (const problem of blocking) fields[`palette.${problem.foreground}/${problem.background}`] = problem.ratio.toFixed(2);
    throw new StudioError('INVALID', undefined, fields);
  }
  if (input.favicon.kind === 'fromLogo' && input.logoAssetId === null) {
    throw new StudioError('INVALID', undefined, { favicon: 'Choose a logo first' });
  }

  // The assets first, read on the application's client with the library named: the restaurant's and the shared ones.
  const restaurantId = restaurantOf(ctx);
  const faviconId = input.favicon.kind === 'asset' ? input.favicon.assetId : input.favicon.kind === 'fromLogo' ? input.logoAssetId : null;
  const ids = [input.logoAssetId, input.logoDarkAssetId, faviconId].filter((id): id is string => id !== null);
  if (ids.length > 0) {
    const found = await ctx.db.mediaAsset.findMany({
      where: { id: { in: ids }, kind: { in: [...PICTURE_KINDS] }, OR: [{ restaurantId }, { restaurantId: null }] },
      select: { id: true, kind: true, restaurantId: true, contentHash: true, variants: true },
    });
    if (ids.some((id) => !found.some((asset) => asset.id === id))) throw new StudioError('NOT_FOUND');
    const source = faviconId ? found.find((asset) => asset.id === faviconId) : undefined;
    if (source) await ensureFavicon(ctx.db, source);
  }

  return editDraft(ctx, async (tx, menuId) => {
    let row = await tx.brandConfig.findFirst({ where: { menuId } });
    if (!row) {
      const menu = await tx.menu.findFirst({ where: { id: menuId }, select: { restaurant: { select: { name: true } } } });
      row = await tx.brandConfig.create({ data: { menuId, tokens: DEFAULT_PALETTES as unknown as Prisma.InputJsonObject, typography: {}, logoText: menu?.restaurant.name ?? input.logoText } });
    }
    // A choice the plan locks may be kept, never newly made: what the row holds already is compared with what is sent.
    requireChoices(ctx, storedChoices(row), { fontPairId: input.fontPairId, railStyle: input.railStyle, motionIntensity: input.motionIntensity });
    const tokens = (row.tokens ?? {}) as { dark?: unknown; light?: unknown };
    const nextTokens = {
      dark: sanitizePalette(tokens.dark, DEFAULT_PALETTES.dark),
      light: sanitizePalette(tokens.light, DEFAULT_PALETTES.light),
      [input.theme]: input.palette,
    };
    const data = {
      tokens: nextTokens as unknown as Prisma.InputJsonObject,
      theme: input.theme === 'light' ? ('LIGHT' as const) : ('DARK' as const),
      logoAssetId: input.logoAssetId,
      logoDarkAssetId: input.logoDarkAssetId,
      faviconAssetId: input.favicon.kind === 'asset' ? input.favicon.assetId : null,
      faviconFromLogo: input.favicon.kind === 'fromLogo',
      fontPairId: input.fontPairId,
      railStyle: input.railStyle,
      motionIntensity: input.motionIntensity,
      logoText: input.logoText,
    };
    await updateWithVersion(tx.brandConfig, { id: row.id, version: input.version, data, entityType: 'BrandConfig' }, tx);

    const before: Record<string, unknown> = {
      tokens: row.tokens,
      theme: row.theme,
      logoAssetId: row.logoAssetId,
      logoDarkAssetId: row.logoDarkAssetId,
      faviconAssetId: row.faviconAssetId,
      faviconFromLogo: row.faviconFromLogo,
      fontPairId: row.fontPairId,
      railStyle: row.railStyle,
      motionIntensity: row.motionIntensity,
      logoText: row.logoText,
    };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [field, after] of Object.entries(data)) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after)) changes[field] = { before: before[field], after };
    }
    ctx.audit({ action: 'brand.updated', entityType: 'BrandConfig', entityId: row.id, changes });
    return { version: input.version + 1, warnings: problems.filter((problem) => problem.severity === 'warn') };
  });
}

// The plan -------------------------------------------------------------------------------------------------------------

/** The choices a brand row holds, as the Brand tab shows them (the defaults where the row has none it knows). */
export function storedChoices(row: Pick<BrandConfig, 'fontPairId' | 'railStyle' | 'motionIntensity'> | null): BrandChoices {
  const motion = row?.motionIntensity === 'none' || row?.motionIntensity === 'expressive' ? row.motionIntensity : 'subtle';
  return {
    fontPairId: row && isFontPairId(row.fontPairId) ? row.fontPairId : DEFAULT_FONT_PAIR,
    railStyle: row && isRailStyle(row.railStyle) ? row.railStyle : 'grains',
    motionIntensity: motion,
  };
}

/** Refuses, with the upgrade hint's details, a save that newly chooses something the restaurant's plan locks. */
function requireChoices(ctx: ActionContext, stored: BrandChoices, next: BrandChoices): void {
  if (ctx.plan === null) throw new Error('The brand kit is saved on a menu, whose restaurant has a plan');
  const locked = brandChoiceLock(next, stored, ctx.plan.entitlements);
  if (locked) requireFeature(ctx.plan, locked);
}

// Reading -------------------------------------------------------------------------------------------------------------

export interface BrandKitView {
  version: number;
  theme: 'light' | 'dark';
  tokens: { light: Palette; dark: Palette };
  logo: { assetId: string; thumbUrl: string } | null;
  logoDark: { assetId: string; thumbUrl: string } | null;
  favicon: FaviconChoice;
  faviconThumbUrl: string | null;
  fontPairId: FontPairId;
  /** The style the brand chose (with motion off, guests get the plain rail). */
  railStyle: RailStyle;
  motionIntensity: 'none' | 'subtle' | 'expressive';
  logoText: string;
  restaurantId: string;
  /** The template the menu is drawn with, by name; its colours, type and motion are then the Design tab's. */
  templateName: string | null;
}

/** What the restaurant's plan offers the Brand tab, and what guests get in place of a stored choice it does not include. */
export interface BrandPlanView {
  fontPairs: FontPairId[];
  rails: RailStyle[];
  motions: Motion[];
  /** The features whose stored choice guests do not see on this plan. */
  hidden: FeatureKey[];
  guestSees: BrandChoices;
  upgrade: UpgradeInfo;
}

/** The kit as the Brand tab edits it, with thumbnails of its logos and favicon. */
export async function brandKit(db: PrismaClient, menuId: string, restaurantId: string): Promise<BrandKitView> {
  const menu = await db.menu.findUnique({ where: { id: menuId }, select: { brand: true, restaurant: { select: { name: true } } } });
  if (!menu) throw new StudioError('NOT_FOUND');
  const row = menu.brand;
  const tokens = (row?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const faviconId = row?.faviconFromLogo ? row.logoAssetId : (row?.faviconAssetId ?? null);
  const ids = [row?.logoAssetId, row?.logoDarkAssetId, faviconId].filter((id): id is string => Boolean(id));
  const assets = ids.length === 0 ? [] : await db.mediaAsset.findMany({ where: { id: { in: ids }, OR: [{ restaurantId }, { restaurantId: null }] } });
  const storage = getStorage();
  const thumb = (id: string | null | undefined) => {
    const asset = id ? assets.find((entry) => entry.id === id) : undefined;
    return asset ? { assetId: asset.id, thumbUrl: storage.publicUrl(thumbKey(asset.kind, asset.variants as unknown as AssetVariants)) } : null;
  };
  const motion = row?.motionIntensity === 'none' || row?.motionIntensity === 'expressive' ? row.motionIntensity : 'subtle';
  return {
    version: row?.version ?? 1,
    theme: row?.theme === 'LIGHT' ? 'light' : 'dark',
    tokens: { light: sanitizePalette(tokens.light, DEFAULT_PALETTES.light), dark: sanitizePalette(tokens.dark, DEFAULT_PALETTES.dark) },
    logo: thumb(row?.logoAssetId),
    logoDark: thumb(row?.logoDarkAssetId),
    favicon: row?.faviconFromLogo ? { kind: 'fromLogo' } : row?.faviconAssetId ? { kind: 'asset', assetId: row.faviconAssetId } : { kind: 'none' },
    faviconThumbUrl: thumb(faviconId)?.thumbUrl ?? null,
    fontPairId: row && isFontPairId(row.fontPairId) ? row.fontPairId : DEFAULT_FONT_PAIR,
    railStyle: row && isRailStyle(row.railStyle) ? row.railStyle : 'grains',
    motionIntensity: motion,
    logoText: row?.logoText ?? menu.restaurant.name,
    restaurantId,
    templateName: row && isTemplateId(row.templateId) ? TEMPLATES[row.templateId].name : null,
  };
}

/**
 * Three palettes for a theme built around the colours of a logo (spec 12): its main colours, read from the narrowest
 * rendition, each the accent of one palette. Every palette passes the contrast rules.
 */
export async function paletteSuggestions(db: PrismaClient, restaurantId: string, input: { assetId: string; theme: 'light' | 'dark' }): Promise<{ palettes: Palette[] }> {
  const asset = (await loadAssets(db, restaurantId, [input.assetId])).get(input.assetId);
  if (!asset) throw new StudioError('NOT_FOUND');
  const variants = asset.variants as unknown as AssetVariants;
  const file = await getStorage().get(variants.webp?.['320'] ?? variants.original, MEDIA_MAX_BYTES);
  if (!file) throw new StudioError('INVALID', 'This picture could not be read. Upload it again.');
  const source = asset.kind === 'SVG' ? sharp(Buffer.from(file.bytes), { density: 72 }) : sharp(Buffer.from(file.bytes));
  const { data, info } = await source.resize(96, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = dominantColors(new Uint8Array(data), info.channels === 4 ? 4 : 3, 6);
  return { palettes: suggestPalettes(colors, input.theme).slice(0, 3) };
}
