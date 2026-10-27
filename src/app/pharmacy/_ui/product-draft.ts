import type { ProductDetail } from '@/server/pharmacy/products';

/**
 * The product editor's value: what the person typed, kept as typed (numbers as text) so a draft restores exactly. It is
 * what `useDraft` stores; a barcode scanner's buffer is never part of it.
 */
export interface LevelDraft {
  label: string;
  baseQty: string;
  sellable: boolean;
}

export interface BarcodeDraft {
  code: string;
  level: number;
  shared: boolean;
}

export interface ProductDraft {
  tradeName: string;
  genericName: string;
  activeIngredient: string;
  strength: string;
  form: string;
  manufacturer: string;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
  categoryId: string;
  requiresCold: boolean;
  storageNote: string;
  shelfLocation: string;
  imageAssetId: string | null;
  /** From the base unit (level 0) up: the position is the level. */
  levels: LevelDraft[];
  barcodes: BarcodeDraft[];
  branchSettings: Record<string, { minQty: string; reorderQty: string }>;
}

/** The product the editor opens with: what is stored, or an empty product with one base unit. */
export type EditorProduct = Pick<
  ProductDetail,
  | 'id'
  | 'tradeName'
  | 'genericName'
  | 'activeIngredient'
  | 'strength'
  | 'form'
  | 'manufacturer'
  | 'rxLevel'
  | 'active'
  | 'version'
  | 'units'
  | 'barcodes'
  | 'branchSettings'
  | 'categoryId'
  | 'requiresCold'
  | 'storageNote'
  | 'shelfLocation'
  | 'imageAssetId'
>;

export function draftOf(product: EditorProduct | null, branchIds: readonly string[], baseLabel: string): ProductDraft {
  const settings: ProductDraft['branchSettings'] = {};
  for (const id of branchIds) {
    const found = product?.branchSettings.find((s) => s.branchId === id);
    settings[id] = { minQty: String(found?.minQty ?? 0), reorderQty: String(found?.reorderQty ?? 0) };
  }
  if (!product) {
    return {
      tradeName: '',
      genericName: '',
      activeIngredient: '',
      strength: '',
      form: '',
      manufacturer: '',
      rxLevel: 'OTC',
      categoryId: '',
      requiresCold: false,
      storageNote: '',
      shelfLocation: '',
      imageAssetId: null,
      levels: [{ label: baseLabel, baseQty: '1', sellable: true }],
      barcodes: [],
      branchSettings: settings,
    };
  }
  const units = [...product.units].sort((a, b) => a.level - b.level);
  return {
    tradeName: product.tradeName,
    genericName: product.genericName,
    activeIngredient: product.activeIngredient,
    strength: product.strength,
    form: product.form,
    manufacturer: product.manufacturer,
    rxLevel: product.rxLevel,
    categoryId: product.categoryId ?? '',
    requiresCold: product.requiresCold,
    storageNote: product.storageNote,
    shelfLocation: product.shelfLocation,
    imageAssetId: product.imageAssetId,
    levels: units.map((u) => ({ label: u.label, baseQty: String(u.baseQty), sellable: u.sellable })),
    barcodes: product.barcodes.map((b) => ({ code: b.code, level: units.findIndex((u) => u.level === b.level), shared: b.shared })),
    branchSettings: settings,
  };
}

const WHOLE = /^\d{1,7}$/;

/** Text the person typed as a whole number, or null. Arabic-Indic digits count. */
export function wholeOf(text: string): number | null {
  const latin = text.trim().replace(/[٠-٩۰-۹]/g, (ch) => String((ch.charCodeAt(0) & 0xf) % 10));
  return WHOLE.test(latin) ? Number(latin) : null;
}

/**
 * The action input for a draft: the five identity fields, the ladder (levels numbered by position), barcodes, the
 * branches' levels and the other fields. No restaurant: the Server Action puts in the place the person chose. Problems
 * that need no server (a number that is not a whole one) come back by field name.
 */
export function inputOf(draft: ProductDraft): { input: Record<string, unknown> } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const levels = draft.levels.map((l, level) => {
    const baseQty = level === 0 ? 1 : wholeOf(l.baseQty);
    if (baseQty === null || baseQty < 1) errors[`levels.${level}.baseQty`] = 'whole';
    return { level, label: l.label.trim(), baseQty: baseQty ?? 0, sellable: l.sellable };
  });
  const branchSettings = Object.entries(draft.branchSettings).map(([branchId, s]) => {
    const minQty = wholeOf(s.minQty);
    const reorderQty = wholeOf(s.reorderQty);
    if (minQty === null) errors[`branch.${branchId}.minQty`] = 'whole';
    if (reorderQty === null) errors[`branch.${branchId}.reorderQty`] = 'whole';
    return { branchId, minQty: minQty ?? 0, reorderQty: reorderQty ?? 0 };
  });
  if (Object.keys(errors).length > 0) return { errors };
  return {
    input: {
      tradeName: draft.tradeName,
      genericName: draft.genericName,
      activeIngredient: draft.activeIngredient,
      strength: draft.strength,
      form: draft.form,
      manufacturer: draft.manufacturer,
      rxLevel: draft.rxLevel,
      categoryId: draft.categoryId === '' ? null : draft.categoryId,
      requiresCold: draft.requiresCold,
      storageNote: draft.storageNote,
      shelfLocation: draft.shelfLocation,
      imageAssetId: draft.imageAssetId,
      levels,
      barcodes: draft.barcodes.map((b) => ({ code: b.code, level: b.level, ...(b.shared ? { shared: true } : {}) })),
      branchSettings,
    },
  };
}
