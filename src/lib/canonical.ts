/**
 * Sets that are stored as lists (a product's dayparts, dietary tags, badges and allergens, a menu's languages) are
 * hashed in the order they are stored. Writing them in one fixed order means saving the same set again never looks
 * like an unpublished change.
 */

/** Code-unit order, the same on every machine and in every locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The members of `values`, each once, in the order `order` lists them. A value `order` does not have throws: inputs
 * are validated before they reach this, so one here is a bug.
 */
export function canonicalSet<T extends string>(values: readonly string[], order: readonly T[]): T[] {
  const wanted = new Set(values);
  for (const value of wanted) {
    if (!(order as readonly string[]).includes(value)) throw new Error(`Unknown value ${value}`);
  }
  return order.filter((member) => wanted.has(member));
}

/**
 * Free-text tags (allergens): trimmed, empty ones dropped, a repeat that differs only in letter case dropped (the first
 * spelling is kept), and sorted by code unit.
 */
export function canonicalStrings(values: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()].sort(compare);
}
