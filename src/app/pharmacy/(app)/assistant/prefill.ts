import { proposalInput, type ProposalInput } from '@/server/domain/pharmacy/assistant-domain';
import type { PhPlaceInput } from '@/server/pharmacy/place-input';
import { proposals } from '@/server/pharmacy/queries/assistant';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';

/**
 * The data that pre-fills an existing draft from an ACCEPTED assistant proposal. Reading it creates nothing: the person still presses Save on
 * the existing form, which checks its own permissions again. A proposal that is not accepted, is not this person's to see, or is another
 * kind than the draft asks for gives `null` and the form opens empty.
 */
export async function acceptedProposal(placeInput: PhPlaceInput, id: string | undefined, kind: ProposalInput['kind']): Promise<{ id: string; proposal: ProposalInput; branchId: string } | null> {
  if (!id || id.length > 64) return null;
  try {
    const rows = await query(proposals, { ...placeInput, status: 'ACCEPTED' });
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    const parsed = proposalInput.safeParse({ kind: row.kind, ...(row.payload as object) });
    return parsed.success && parsed.data.kind === kind ? { id: row.id, proposal: parsed.data, branchId: row.branchId } : null;
  } catch {
    return null;
  }
}

export interface PrefillLine {
  productId: string;
  productName: string;
  productMeta: string;
  units: Array<{ id: string; label: string; baseQty: number }>;
  unitId: string;
  /** In the base unit, as the form shows it. */
  qty: string;
}

/** The lines of a proposal as form lines in the product's base unit; a product that cannot be read is left out. */
export async function prefillLines(placeInput: PhPlaceInput, lines: ReadonlyArray<{ productId: string; qty: number }>): Promise<PrefillLine[]> {
  const out: PrefillLine[] = [];
  for (const line of lines) {
    try {
      const product = await query(getProduct, { ...placeInput, productId: line.productId });
      const units = [...product.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty }));
      const base = units[0];
      if (!base) continue;
      out.push({
        productId: product.id,
        productName: product.tradeName,
        productMeta: [product.strength, product.form].filter((p) => p.trim() !== '').join(' · '),
        units,
        unitId: base.id,
        qty: String(line.qty),
      });
    } catch {
      continue;
    }
  }
  return out;
}
