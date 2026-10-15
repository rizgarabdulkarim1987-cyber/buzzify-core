import { MAX_LINES, MAX_QUANTITY, type CartBundleInput, type CartInput, type CartLineInput } from '@/server/domain/types';

const EMPTY: CartInput = { lines: [], bundles: [] };

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function quantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Validates a cart read from storage. Anything malformed is dropped rather than trusted. */
export function sanitizeCart(raw: unknown): CartInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY };
  const source = raw as { lines?: unknown; bundles?: unknown };

  const lines: CartLineInput[] = [];
  if (Array.isArray(source.lines)) {
    for (const entry of source.lines) {
      if (lines.length >= MAX_LINES) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const line = entry as Record<string, unknown>;
      if (!text(line.productId) || !quantity(line.quantity)) continue;
      if (!(line.variantId === null || text(line.variantId))) continue;
      if (!Array.isArray(line.optionIds)) continue;
      lines.push({
        productId: line.productId,
        variantId: line.variantId as string | null,
        optionIds: line.optionIds.filter(text).slice(0, 20),
        quantity: Math.min(MAX_QUANTITY, line.quantity),
      });
    }
  }

  const bundles: CartBundleInput[] = [];
  if (Array.isArray(source.bundles)) {
    for (const entry of source.bundles) {
      if (bundles.length >= 10) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const bundle = entry as Record<string, unknown>;
      if (!text(bundle.bundleId) || !quantity(bundle.quantity)) continue;
      bundles.push({ bundleId: bundle.bundleId, quantity: Math.min(MAX_QUANTITY, bundle.quantity) });
    }
  }
  return { lines, bundles };
}
