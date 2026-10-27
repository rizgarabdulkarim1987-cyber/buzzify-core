/**
 * A bulk price change worked out before anything is written: each row's price before and after, rounded to a step,
 * and a hash of the whole preview that pins what the person saw. Pure: no clock, no database. Money stays BigInt end to
 * end; a percent is in basis points (1% = 100) and is applied to the exact value, so rounding sees the true fraction.
 */

import { createHash } from 'node:crypto';
import type { Currency } from './money';

export type BulkChange = { kind: 'percent'; basisPoints: number } | { kind: 'fixed'; amount: bigint };
export type RoundingMode = 'nearest' | 'up' | 'down';
export interface BulkRounding {
  /** The step in minor units (250 IQD, 25 cents); 1 rounds to the minor unit. */
  step: bigint;
  /** `nearest` rounds half way up; `up` and `down` go to the step above or below unless already on one. */
  mode: RoundingMode;
}

export interface BulkRowInput {
  productId: string;
  unitId: string;
  currency: Currency;
  current: bigint;
}

export interface BulkRowPreview {
  productId: string;
  unitId: string;
  currency: Currency;
  before: bigint;
  after: bigint;
}

export interface BulkPreviewInput {
  rows: readonly BulkRowInput[];
  change: BulkChange;
  rounding: BulkRounding;
  /** When the new prices start: part of the hash, so a preview for another date does not match. */
  validFrom?: Date;
}

/** A row the change cannot apply to: it would take the price below zero. */
export class BulkPriceError extends Error {
  readonly code = 'NEGATIVE_PRICE';
  constructor(
    readonly productId: string,
    readonly unitId: string,
  ) {
    super(`The change takes the price of ${productId}/${unitId} below zero`);
    this.name = 'BulkPriceError';
  }
}

const BASIS = 10_000n;

/**
 * `numerator / denominator` (not negative) rounded to a multiple of `step`: `down` to the multiple at or below, `up` to
 * the one at or above, `nearest` to the closer one, half way going up. Integer arithmetic only.
 */
export function roundToStep(numerator: bigint, denominator: bigint, step: bigint, mode: RoundingMode): bigint {
  if (step < 1n) throw new RangeError('The rounding step must be at least 1');
  if (denominator < 1n) throw new RangeError('The denominator must be at least 1');
  if (numerator < 0n) throw new RangeError('Only an amount of zero or more is rounded');
  const unit = denominator * step;
  const whole = numerator / unit;
  const rest = numerator % unit;
  if (rest === 0n || mode === 'down') return whole * step;
  if (mode === 'up') return (whole + 1n) * step;
  return (2n * rest >= unit ? whole + 1n : whole) * step;
}

/** The new price of one row, as the exact fraction `numerator / denominator`. */
function changed(current: bigint, change: BulkChange): [bigint, bigint] {
  if (change.kind === 'fixed') return [current + change.amount, 1n];
  return [current * (BASIS + BigInt(change.basisPoints)), BASIS];
}

const byKey = (a: BulkRowInput, b: BulkRowInput): number =>
  a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;

/** The canonical text the hash is taken of: arrays in a fixed order, amounts as decimal strings. */
function canonical(rows: readonly BulkRowPreview[], input: BulkPreviewInput): string {
  const change = input.change.kind === 'percent' ? ['percent', String(input.change.basisPoints)] : ['fixed', input.change.amount.toString()];
  return JSON.stringify({
    v: 1,
    rows: rows.map((r) => [r.productId, r.unitId, r.currency, r.before.toString(), r.after.toString()]),
    change,
    rounding: [input.rounding.step.toString(), input.rounding.mode],
    validFrom: input.validFrom ? input.validFrom.toISOString() : null,
  });
}

/**
 * The preview of a bulk change: the rows in product, unit and currency order with their price before and after, and a
 * SHA-256 of the rows, the change, the rounding and the start date. A row the change takes below zero is refused
 * (`BulkPriceError`), never clamped.
 */
export function previewBulk(input: BulkPreviewInput): { rows: BulkRowPreview[]; previewHash: string } {
  if (input.change.kind === 'percent' && !Number.isSafeInteger(input.change.basisPoints)) {
    throw new RangeError('A percent change is a whole number of basis points');
  }
  if (input.rounding.step < 1n) throw new RangeError('The rounding step must be at least 1');
  const rows = [...input.rows].sort(byKey).map((row): BulkRowPreview => {
    if (row.current < 0n) throw new RangeError('A current price is zero or more');
    const [numerator, denominator] = changed(row.current, input.change);
    if (numerator < 0n) throw new BulkPriceError(row.productId, row.unitId);
    return {
      productId: row.productId,
      unitId: row.unitId,
      currency: row.currency,
      before: row.current,
      after: roundToStep(numerator, denominator, input.rounding.step, input.rounding.mode),
    };
  });
  return { rows, previewHash: createHash('sha256').update(canonical(rows, input)).digest('hex') };
}
