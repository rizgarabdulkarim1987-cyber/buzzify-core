'use client';

import { useEffect, useMemo, useState } from 'react';
import { sellCosts } from '@/app/pharmacy/_actions/sales';
import type { SellCosts } from '@/server/pharmacy/sell-costs';
import { settle } from '@/studio/settle';
import { unitOf, type CartLine, type Currency, type Estimate } from '../sell-logic';
import type { LineCost } from './SaleLinesTable';

/** How long the cart must stay still before its cost is asked for (a scan burst asks once). */
export const COST_DEBOUNCE_MS = 300;

export interface CostLine {
  key: string;
  productId: string;
  unitId: string;
  qty: number;
  unitPriceMinor: string;
  discountMinor: string;
  batchId?: string;
}

/** What is sent for the cart: each priced line with its unit price and its own discount; an unpriced, invalid or blocked line is left out. */
export function costLinesOf(lines: readonly CartLine[], results: Estimate['lines']): CostLine[] {
  return lines.flatMap((line) => {
    const result = results.find((r) => r.key === line.key);
    const price = unitOf(line).priceMinor;
    if (!result || result.unpriced || result.invalid || line.blocked || price === null) return [];
    return [{ key: line.key, productId: line.productId, unitId: line.unitId, qty: line.qty, unitPriceMinor: price, discountMinor: String(result.discountMinor), ...(line.batchId ? { batchId: line.batchId } : {}) }];
  });
}

/**
 * The cost and profit of the cart's lines by line key (`ph.sell.costs`), for the cost columns and the details panel. Asked only
 * when `enabled` (the screen may show cost); the server still decides and answers a role without `cost.view` with nothing. Asked
 * once the cart has been still for COST_DEBOUNCE_MS, keyed on what was sent: an answer for a cart that changed since is dropped,
 * so a cell never shows another cart's cost. A line whose cost is unknown is not in the map (its cells stay empty).
 */
export function useLineCosts({ enabled, lines, results, currency }: { enabled: boolean; lines: readonly CartLine[]; results: Estimate['lines']; currency: Currency }): Readonly<Record<string, LineCost>> | undefined {
  const request = useMemo(() => costLinesOf(lines, results), [lines, results]);
  const sig = enabled && request.length > 0 ? JSON.stringify([currency, request]) : '';
  const [answer, setAnswer] = useState<{ sig: string; costs: Record<string, LineCost> } | null>(null);
  useEffect(() => {
    if (!sig) return;
    const [sentCurrency, sent] = JSON.parse(sig) as [Currency, CostLine[]];
    let cancelled = false;
    const timer = setTimeout(() => {
      void settle(() => sellCosts({ currency: sentCurrency, lines: sent })).then((result) => {
        if (cancelled || !result?.ok) return;
        const costs: Record<string, LineCost> = {};
        for (const l of (result.data as SellCosts).lines) {
          if (l.costMinor === null) continue;
          costs[l.key] = l.profitMinor == null ? { costMinor: l.costMinor } : { costMinor: l.costMinor, profitMinor: l.profitMinor };
        }
        setAnswer({ sig, costs });
      });
    }, COST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sig]);
  return sig && answer?.sig === sig ? answer.costs : undefined;
}
