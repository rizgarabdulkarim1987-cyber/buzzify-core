import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { canonicalSet } from '@/lib/canonical';
import { LOCALES, type Locale } from '@/lib/locale';
import { MAX_MINOR, minorUnitDigits, rescaleMinor } from '@/lib/money-input';
import type { ScopedTx } from '@/server/data/tenant-db';
import { currencyField, localesField, timeZoneField } from '@/server/domain/platform-settings';
import { menuPriceStep } from '@/server/domain/bulk-prices';
import { loadAssets } from '@/server/media/resolve';
import type { AssetVariants } from '@/server/media/process';
import { seoMap } from '@/server/publish/draft';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { editDraft } from './draft-edit';
import { thumbKey } from './media';
import { menuName } from './menus';

/**
 * A menu's settings (spec 10.3, Settings): its name, languages, currency, numerals, time zone, rounding step, the search
 * text of each language and the notes. They are part of the draft (guests see a change after a publish), saved at the
 * menu's version.
 */

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;

const seoEntry = z.object({
  title: z.string().trim().max(SEO_TITLE_MAX, 'Use at most 70 characters'),
  description: z.string().trim().max(SEO_DESCRIPTION_MAX, 'Use at most 200 characters'),
  imageAssetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

export const settingsFields = {
  version: z.number().int().min(1),
  name: menuName,
  locales: localesField,
  defaultLocale: z.enum(LOCALES, 'Choose one of the languages offered'),
  currency: currencyField,
  confirmCurrencyChange: z.boolean().optional(),
  timezone: timeZoneField,
  numeralSystem: z.enum(['LATN', 'ARAB'], 'Choose one of the numeral systems offered'),
  seo: z.partialRecord(z.enum(LOCALES), seoEntry),
  notes: z.string().max(2_000, 'Use at most 2,000 characters'),
  priceStep: z.number().int().min(1, 'Use at least one unit').max(MAX_MINOR, 'This price is too high').nullable(),
};

type SettingsInput = z.infer<z.ZodObject<typeof settingsFields>>;

/** The rows whose amounts a currency of other decimals changes, and their amount fields. */
async function rescaleCatalog(tx: ScopedTx, from: number, to: number): Promise<number> {
  const scale = (value: number) => rescaleMinor(value, from, to);
  const scaleOptional = (value: number | null) => (value === null ? null : scale(value));
  let rows = 0;

  for (const product of await tx.product.findMany({ select: { id: true, basePrice: true, cost: true } })) {
    await tx.product.updateMany({
      where: { id: product.id },
      data: { basePrice: scale(product.basePrice), cost: scaleOptional(product.cost), version: { increment: 1 } },
    });
    rows += 1;
  }
  for (const variant of await tx.productVariant.findMany({ select: { id: true, priceDelta: true, costDelta: true } })) {
    if (variant.priceDelta === 0 && !variant.costDelta) continue;
    await tx.productVariant.updateMany({
      where: { id: variant.id },
      data: { priceDelta: scale(variant.priceDelta), costDelta: scaleOptional(variant.costDelta), version: { increment: 1 } },
    });
    rows += 1;
  }
  for (const option of await tx.modifierOption.findMany({ select: { id: true, priceDelta: true, costDelta: true } })) {
    if (option.priceDelta === 0 && !option.costDelta) continue;
    await tx.modifierOption.updateMany({
      where: { id: option.id },
      data: { priceDelta: scale(option.priceDelta), costDelta: scaleOptional(option.costDelta), version: { increment: 1 } },
    });
    rows += 1;
  }
  for (const bundle of await tx.bundle.findMany({ select: { id: true, price: true } })) {
    await tx.bundle.updateMany({ where: { id: bundle.id }, data: { price: scale(bundle.price) } });
    rows += 1;
  }
  return rows;
}

/**
 * Saves the settings at the version the person read. A currency of other decimals than the menu's (USD and IQD) needs
 * `confirmCurrencyChange`, and then converts every amount of the draft and the rounding step, keeping each number in
 * the major unit (4.50 USD becomes 5 IQD; 6,000 IQD becomes 6,000.00 USD) and moving the converted rows' versions.
 * Removing a language keeps its texts in the rows, so adding it back restores them.
 */
export function updateSettings(ctx: ActionContext, input: SettingsInput): Promise<{ version: number; rescaled: number }> {
  return editDraft(ctx, async (tx, menuId) => {
    const menu = await tx.menu.findFirst({ where: { id: menuId } });
    if (!menu) throw new StudioError('NOT_FOUND');

    const locales = canonicalSet<Locale>(input.locales, LOCALES);
    if (!locales.includes(input.defaultLocale)) {
      throw new StudioError('INVALID', undefined, { defaultLocale: 'Choose the default language among the menu languages' });
    }

    const from = minorUnitDigits(menu.currency);
    const to = minorUnitDigits(input.currency);
    if (from !== to && !input.confirmCurrencyChange) {
      throw new StudioError('INVALID', undefined, { currency: 'Confirm the new currency: every price is converted' });
    }

    const imageIds = Object.values(input.seo).flatMap((entry) => (entry?.imageAssetId ? [entry.imageAssetId] : []));
    if (imageIds.length > 0) {
      if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
      const found = await loadAssets(tx, ctx.restaurantId, imageIds);
      if (imageIds.some((id) => !found.has(id))) throw new StudioError('NOT_FOUND');
    }

    const seo: Record<string, { title: string; description: string; imageAssetId?: string }> = {};
    for (const locale of LOCALES) {
      const entry = input.seo[locale];
      if (!entry || (entry.title === '' && entry.description === '' && !entry.imageAssetId)) continue;
      seo[locale] = { title: entry.title, description: entry.description, ...(entry.imageAssetId ? { imageAssetId: entry.imageAssetId } : {}) };
    }

    // The step was typed in the menu's currency as it stood; it converts with the prices, and a step that rounds away
    // to nothing falls back to the new currency's default.
    let priceStep = input.priceStep;
    if (priceStep !== null && from !== to) priceStep = rescaleMinor(priceStep, from, to) || null;

    // The menu first: a stale save stops here, before a single price is converted.
    const data = {
      name: input.name,
      locales,
      defaultLocale: input.defaultLocale,
      currency: input.currency,
      timezone: input.timezone,
      numeralSystem: input.numeralSystem,
      seo: seo as Prisma.InputJsonObject,
      notes: input.notes,
      priceStep,
    };
    await updateWithVersion(tx.menu, { id: menuId, version: input.version, data, entityType: 'Menu' }, tx);
    const rescaled = from === to ? 0 : await rescaleCatalog(tx, from, to);

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const before: Record<string, unknown> = {
      name: menu.name,
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      currency: menu.currency,
      timezone: menu.timezone,
      numeralSystem: menu.numeralSystem,
      seo: menu.seo,
      notes: menu.notes,
      priceStep: menu.priceStep,
    };
    for (const [field, after] of Object.entries(data)) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after)) changes[field] = { before: before[field], after };
    }
    if (rescaled > 0) changes.rescaled = { before: null, after: rescaled };
    ctx.audit({ action: 'menu.settings_changed', entityType: 'Menu', entityId: menuId, changes });
    return { version: input.version + 1, rescaled };
  });
}

export interface MenuSettingsView {
  version: number;
  name: string;
  slug: string;
  formerSlugs: string[];
  locales: Locale[];
  defaultLocale: Locale;
  currency: string;
  timezone: string;
  numeralSystem: 'LATN' | 'ARAB';
  seo: Partial<Record<Locale, { title: string; description: string; imageAssetId?: string; imageUrl: string | null }>>;
  notes: string;
  priceStep: number | null;
  /** The step bulk changes use when `priceStep` is empty: the currency's own. */
  defaultStep: number;
}

/** The settings as the tab shows them, with each search image's thumbnail. */
export async function settingsView(db: PrismaClient, menuId: string, restaurantId: string): Promise<MenuSettingsView> {
  const menu = await db.menu.findUnique({ where: { id: menuId }, include: { slugs: { select: { slug: true } } } });
  if (!menu) throw new StudioError('NOT_FOUND');
  const seo = seoMap(menu.seo);
  const imageIds = Object.values(seo).flatMap((entry) => (entry?.imageAssetId ? [entry.imageAssetId] : []));
  const assets =
    imageIds.length === 0
      ? []
      : await db.mediaAsset.findMany({
          where: { id: { in: imageIds }, OR: [{ restaurantId }, { restaurantId: null }] },
          select: { id: true, kind: true, variants: true },
        });
  const thumbs = new Map(assets.map((asset) => [asset.id, getStorage().publicUrl(thumbKey(asset.kind, asset.variants as unknown as AssetVariants))]));
  const locales = menu.locales.filter((code): code is Locale => (LOCALES as readonly string[]).includes(code));
  return {
    version: menu.version,
    name: menu.name,
    slug: menu.slug,
    formerSlugs: menu.slugs.map((row) => row.slug).filter((slug) => slug !== menu.slug),
    locales,
    defaultLocale: (LOCALES as readonly string[]).includes(menu.defaultLocale) ? (menu.defaultLocale as Locale) : 'en',
    currency: menu.currency,
    timezone: menu.timezone,
    numeralSystem: menu.numeralSystem,
    seo: Object.fromEntries(
      Object.entries(seo).map(([locale, entry]) => [locale, { ...entry, imageUrl: entry?.imageAssetId ? (thumbs.get(entry.imageAssetId) ?? null) : null }]),
    ),
    notes: menu.notes,
    priceStep: menu.priceStep,
    defaultStep: menuPriceStep({ priceStep: null, currency: menu.currency }),
  };
}
