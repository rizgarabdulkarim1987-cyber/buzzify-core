import type { LabelSize, WorkstationSettings } from '@/server/domain/pharmacy/print-settings';
import { barsOf, Code128Error, type Bar } from './code128';
import { formatMinor, type Currency } from './sell-logic';

/**
 * Printing in the browser, pure (R7-8): the `@page` rules of an A4 sheet and of a label, the label sizes, how many labels a
 * sheet carries, and how a barcode is spread over a label. Browser print only: nothing here talks to a printer, opens a cash
 * drawer or prints without the person's own print dialog.
 */

/** The label sizes: the page IS the label. The 58 mm roll is continuous paper, so it is given a fixed 40 mm cut. */
export const LABEL_BOX: Record<LabelSize, { widthMm: number; heightMm: number }> = {
  '40x25': { widthMm: 40, heightMm: 25 },
  '50x30': { widthMm: 50, heightMm: 30 },
  '58': { widthMm: 58, heightMm: 40 },
};

export const pageCss = (settings: Pick<WorkstationSettings, 'paper' | 'marginMm'>): string => {
  const m = settings.marginMm;
  return `@page { size: ${settings.paper} portrait; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
};

export const labelCss = (size: LabelSize): string => `@page { size: ${LABEL_BOX[size].widthMm}mm ${LABEL_BOX[size].heightMm}mm; margin: 0; }`;

// Quantities ---------------------------------------------------------------------------------------------------------------

/** The most labels of one product or batch in one go, and on one sheet run. */
export const MAX_PER_ITEM = 200;
export const MAX_LABELS = 500;

export interface LabelPrice {
  amountMinor: string;
  currency: Currency;
}

export interface LabelItem {
  key: string;
  productId: string;
  name: string;
  strength: string;
  form: string;
  /** The product's barcode; null when it has none (the label then has no bars, in words). */
  barcode: string | null;
  lot: string | null;
  /** YYYY-MM-DD. */
  expiry: string | null;
  /** Null when the person may not see prices, or the product has none. */
  price: LabelPrice | null;
  qty: number;
}

/** A quantity typed for a label item: a whole number from 1 to the cap, or null. */
export function safeQty(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,4}$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 1 && n <= MAX_PER_ITEM ? n : null;
}

/** The labels to print, each item repeated by its quantity, in order, up to the cap. */
export function expandLabels(items: readonly LabelItem[]): { labels: LabelItem[]; truncated: boolean } {
  const labels: LabelItem[] = [];
  let truncated = false;
  for (const it of items) {
    for (let i = 0; i < it.qty; i++) {
      if (labels.length === MAX_LABELS) {
        truncated = true;
        break;
      }
      labels.push(it);
    }
    if (truncated) break;
  }
  return { labels, truncated };
}

export const priceText = (price: LabelPrice | null): string | null => (price ? formatMinor(BigInt(price.amountMinor), price.currency) : null);

// Barcode ------------------------------------------------------------------------------------------------------------------

/** Quiet zone on each side, in modules (Code 128 asks for 10). */
export const QUIET_MODULES = 10;
/** The inner padding of a label, in millimetres. */
export const PAD_MM = 1.5;
/** The narrowest bar a thermal label printer prints reliably (about 7.5 mil). */
export const MIN_MODULE_MM = 0.19;

export type LabelBarcode =
  | { ok: true; bars: Bar[]; viewModules: number; moduleMm: number; widthMm: number; fits: boolean }
  | { ok: false; reason: 'EMPTY' | 'CHARSET' | 'TOO_LONG' };

/** The bars of `text` spread over a label of `labelWidthMm`; `fits` is false when the bars would be too narrow to print reliably. */
export function labelBarcode(text: string, labelWidthMm: number): LabelBarcode {
  try {
    const { bars, modules } = barsOf(text);
    const viewModules = modules + 2 * QUIET_MODULES;
    const moduleMm = (labelWidthMm - 2 * PAD_MM) / viewModules;
    return { ok: true, bars: bars.map((b) => ({ x: b.x + QUIET_MODULES, w: b.w })), viewModules, moduleMm, widthMm: viewModules * moduleMm, fits: moduleMm >= MIN_MODULE_MM };
  } catch (error) {
    if (error instanceof Code128Error) return { ok: false, reason: error.reason };
    throw error;
  }
}

// Workstation --------------------------------------------------------------------------------------------------------------

/** A workstation name as typed: trimmed and cut to 40 characters, or null when empty. */
export function cleanWorkstation(text: string | null | undefined): string | null {
  const clean = (text ?? '').trim().slice(0, 40);
  return clean === '' ? null : clean;
}
