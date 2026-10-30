import type { Locale } from '@/lib/locale';
import type { DraftMediaItem } from '@/lib/media';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import type { Allergen, Badge, DietaryTag } from '@/lib/product-tags';
import type { ProductEditing } from '@/server/studio/services/content';
import { formatDeltaInput, newKey, parseDeltaInput, PRICE_PROBLEM_KEYS, type Names } from './shared';

/** A product as the drawer edits it: numbers as the person types them, rows keyed so React keeps their inputs. */

export interface VariantDraft {
  key: string;
  id?: string;
  version?: number;
  names: Names;
  priceDelta: string;
  isDefault: boolean;
}

export interface OptionDraft {
  key: string;
  id?: string;
  version?: number;
  names: Names;
  priceDelta: string;
  isSuggested: boolean;
}

export interface GroupDraft {
  key: string;
  id?: string;
  version?: number;
  names: Names;
  minSelect: string;
  maxSelect: string;
  options: OptionDraft[];
}

export interface MediaDraft {
  key: string;
  value: DraftMediaItem;
  thumbUrl: string | null;
}

export interface ProductDraft {
  slug: string;
  categoryId: string;
  names: Names;
  descriptions: Names;
  price: string;
  isSignature: boolean;
  isFeatured: boolean;
  allergens: Allergen[];
  dietary: DietaryTag[];
  badges: Badge[];
  calories: string;
  media: MediaDraft[];
  variants: VariantDraft[];
  groups: GroupDraft[];
  /** The sales fields: what one costs to make (a price, typed), how much to promote it, how many it serves, when it runs low. */
  cost: string;
  priority: number;
  serves: string;
  lowStockThreshold: string;
}

const ref = (row: { id: string; version: number }) => ({ key: row.id, id: row.id, version: row.version });

export function draftOf(product: ProductEditing, currency: string): ProductDraft {
  return {
    slug: product.slug,
    categoryId: product.categoryId,
    names: product.names,
    descriptions: product.descriptions,
    price: formatPriceInput(product.price, currency),
    isSignature: product.isSignature,
    isFeatured: product.isFeatured,
    allergens: product.allergens,
    dietary: product.dietary,
    badges: product.badges,
    calories: product.calories === null ? '' : String(product.calories),
    media: product.media.map((entry) => ({ key: newKey(), ...entry })),
    variants: product.variants.map((variant) => ({
      ...ref(variant),
      names: variant.names,
      priceDelta: formatDeltaInput(variant.priceDelta, currency),
      isDefault: variant.isDefault,
    })),
    groups: product.groups.map((group) => ({
      ...ref(group),
      names: group.names,
      minSelect: String(group.minSelect),
      maxSelect: String(group.maxSelect),
      options: group.options.map((option) => ({
        ...ref(option),
        names: option.names,
        priceDelta: formatDeltaInput(option.priceDelta, currency),
        isSuggested: option.isSuggested,
      })),
    })),
    cost: product.cost === null ? '' : formatPriceInput(product.cost, currency),
    priority: product.priority,
    serves: product.serves === null ? '' : String(product.serves),
    lowStockThreshold: product.lowStockThreshold === null ? '' : String(product.lowStockThreshold),
  };
}

/** What the drawer compares to tell whether there is anything to save: the draft without its row keys. */
export function comparable(draft: ProductDraft): string {
  return JSON.stringify(draft, (key, value: unknown) => (key === 'key' || key === 'thumbUrl' ? undefined : value));
}

/** Keeps the texts that have something in them. */
function texts(names: Names): Names {
  const result: Names = {};
  for (const [locale, value] of Object.entries(names) as Array<[Locale, string | undefined]>) {
    if (value && value.trim() !== '') result[locale] = value.trim();
  }
  return result;
}

/** A whole number typed in a field, or null when it is not one. */
export function wholeNumber(text: string): number | null {
  const value = text.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

/**
 * The save the server takes, or the messages of what the person must fix first (by the server's field paths, so the
 * server's own refusals land in the same places).
 */
export function toSave(
  draft: ProductDraft,
  base: { menuId: string; productId: string; version: number; currency: string },
): { ok: true; save: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const price = parsePriceInput(draft.price, base.currency);
  if (!price.ok) errors.price = PRICE_PROBLEM_KEYS[price.reason];

  let calories: number | null = null;
  if (draft.calories.trim() !== '') {
    calories = wholeNumber(draft.calories);
    if (calories === null || calories > 20_000) errors.calories = 'content.calories.range';
  }

  let cost: number | null = null;
  if (draft.cost.trim() !== '') {
    const parsed = parsePriceInput(draft.cost, base.currency);
    if (parsed.ok) cost = parsed.minor;
    else errors.cost = PRICE_PROBLEM_KEYS[parsed.reason];
  }
  let serves: number | null = null;
  if (draft.serves.trim() !== '') {
    serves = wholeNumber(draft.serves);
    if (serves === null || serves < 2 || serves > 20) errors.serves = 'content.serves.range';
  }
  let lowStockThreshold: number | null = null;
  if (draft.lowStockThreshold.trim() !== '') {
    lowStockThreshold = wholeNumber(draft.lowStockThreshold);
    if (lowStockThreshold === null || lowStockThreshold < 1 || lowStockThreshold > 999) errors.lowStockThreshold = 'content.lowStock.range';
  }

  const variants = draft.variants.map((variant, index) => {
    const delta = parseDeltaInput(variant.priceDelta, base.currency);
    if (!delta.ok) errors[`variants.${index}.priceDelta`] = PRICE_PROBLEM_KEYS[delta.reason];
    return {
      ...(variant.id ? { id: variant.id, version: variant.version } : {}),
      names: texts(variant.names),
      priceDelta: delta.ok ? delta.minor : 0,
      isDefault: variant.isDefault,
    };
  });

  const groups = draft.groups.map((group, index) => {
    const minSelect = wholeNumber(group.minSelect);
    const maxSelect = wholeNumber(group.maxSelect);
    if (minSelect === null) errors[`groups.${index}.minSelect`] = 'content.groups.wholeNumber';
    if (maxSelect === null) errors[`groups.${index}.maxSelect`] = 'content.groups.wholeNumber';
    return {
      ...(group.id ? { id: group.id, version: group.version } : {}),
      names: texts(group.names),
      minSelect: minSelect ?? 0,
      maxSelect: maxSelect ?? 1,
      options: group.options.map((option, position) => {
        const delta = parseDeltaInput(option.priceDelta, base.currency);
        if (!delta.ok) errors[`groups.${index}.options.${position}.priceDelta`] = PRICE_PROBLEM_KEYS[delta.reason];
        return {
          ...(option.id ? { id: option.id, version: option.version } : {}),
          names: texts(option.names),
          priceDelta: delta.ok ? delta.minor : 0,
          isSuggested: option.isSuggested,
        };
      }),
    };
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    save: {
      menuId: base.menuId,
      productId: base.productId,
      version: base.version,
      slug: draft.slug.trim(),
      categoryId: draft.categoryId,
      names: texts(draft.names),
      descriptions: texts(draft.descriptions),
      price: price.ok ? price.minor : 0,
      isSignature: draft.isSignature,
      isFeatured: draft.isFeatured,
      allergens: draft.allergens,
      dietary: draft.dietary,
      badges: draft.badges,
      calories,
      media: draft.media.map((entry) => entry.value),
      variants,
      groups,
      cost,
      priority: draft.priority,
      serves,
      lowStockThreshold,
    },
  };
}
