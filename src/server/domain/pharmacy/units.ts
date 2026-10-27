/** Unit ladders (tablet, strip, box) as pure functions. Quantities are whole numbers in the product's base unit. */

export type UnitLevel = { level: number; label: string; baseQty: number; sellable: boolean };

export type LadderCode =
  | 'NO_BASE'
  | 'BASE_NOT_ONE'
  | 'NOT_ASCENDING'
  | 'NOT_A_MULTIPLE'
  | 'NONE_SELLABLE'
  | 'DUPLICATE_LEVEL'
  | 'EMPTY_LABEL';

/**
 * A ladder is listed from the base up. Level 0 is the base with `baseQty` 1; level numbers and `baseQty` grow
 * strictly; each `baseQty` is a whole multiple of the one below; at least one level is sellable.
 */
export function validateLadder(levels: UnitLevel[]): { ok: true } | { ok: false; code: LadderCode } {
  const fail = (code: LadderCode) => ({ ok: false as const, code });
  if (levels.some((l) => l.label.trim() === '')) return fail('EMPTY_LABEL');
  if (new Set(levels.map((l) => l.level)).size !== levels.length) return fail('DUPLICATE_LEVEL');
  if (levels.length === 0 || levels[0]!.level !== 0) return fail('NO_BASE');
  if (levels[0]!.baseQty !== 1) return fail('BASE_NOT_ONE');
  for (let i = 1; i < levels.length; i++) {
    const below = levels[i - 1]!;
    const here = levels[i]!;
    if (here.level <= below.level || here.baseQty <= below.baseQty) return fail('NOT_ASCENDING');
    if (!Number.isSafeInteger(here.baseQty) || here.baseQty % below.baseQty !== 0) return fail('NOT_A_MULTIPLE');
  }
  if (!levels.some((l) => l.sellable)) return fail('NONE_SELLABLE');
  return { ok: true };
}

function assertWholeQty(qty: number): void {
  if (!Number.isSafeInteger(qty) || qty < 0) throw new RangeError(`Quantity must be a safe whole number: ${qty}`);
}

/** `qty` of the given level, in base units. Throws for an unknown level or a result beyond the safe integers. */
export function toBaseQty(levels: UnitLevel[], level: number, qty: number): number {
  assertWholeQty(qty);
  const found = levels.find((l) => l.level === level);
  if (!found) throw new RangeError(`Unknown unit level: ${level}`);
  const total = found.baseQty * qty;
  if (!Number.isSafeInteger(total)) throw new RangeError('Quantity is too large');
  return total;
}

/** A base quantity as whole units, largest level first, the remainder carried down. Empty levels are left out. */
export function splitQty(levels: UnitLevel[], baseQty: number): { level: number; label: string; qty: number }[] {
  assertWholeQty(baseQty);
  const parts: { level: number; label: string; qty: number }[] = [];
  let rest = baseQty;
  for (const l of [...levels].sort((a, b) => b.baseQty - a.baseQty)) {
    const qty = Math.floor(rest / l.baseQty);
    if (qty > 0) parts.push({ level: l.level, label: l.label, qty });
    rest -= qty * l.baseQty;
  }
  return parts;
}

export function sellableLevels(levels: UnitLevel[]): UnitLevel[] {
  return levels.filter((l) => l.sellable);
}
