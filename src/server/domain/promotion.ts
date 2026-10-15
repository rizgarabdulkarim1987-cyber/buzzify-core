import { daypartNow, inDaypart, marginRatio, orderability } from './catalog';
import type { EngineConfig } from './config';
import type { Catalog } from './types';

export interface PromotionResult {
  productId: string;
  eligible: boolean;
  score: number;
  reasons: string[];
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function scoreProducts(catalog: Catalog, now: Date, config: EngineConfig): PromotionResult[] {
  const current = daypartNow(catalog, now);
  const w = config.weights;

  return catalog.products
    .map<PromotionResult>((product) => {
      const state = orderability(product, current);
      const dayOk = inDaypart(product.dayparts, current);
      const eligible = state === 'OK' && dayOk;
      const margin = marginRatio(product.basePrice, product.cost);
      const explicitDaypart = product.dayparts.length > 0 && current !== null && product.dayparts.includes(current);
      const lowStock =
        product.stockCount !== null && product.lowStockThreshold !== null && product.stockCount <= product.lowStockThreshold;

      const score =
        w.margin * margin +
        w.popularity * (product.popularity / 100) +
        w.priority * (product.priority / 100) +
        (explicitDaypart ? w.daypart : 0) -
        (lowStock ? w.stockPenalty : 0);

      const reasons = [
        product.cost === null ? 'cost unknown (neutral margin)' : `margin ${Math.round(margin * 100)}%`,
        `popularity ${product.popularity}`,
        `priority ${product.priority}`,
      ];
      if (explicitDaypart) reasons.push('matches current daypart');
      if (lowStock) reasons.push('low stock');
      if (state !== 'OK') reasons.push(`not orderable: ${state}`);
      else if (!dayOk) reasons.push('outside its dayparts');

      return { productId: product.id, eligible, score: round4(score), reasons };
    })
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
}

export function pickSignature(catalog: Catalog, now: Date, config: EngineConfig): PromotionResult | null {
  const ranked = scoreProducts(catalog, now, config).filter((result) => result.eligible);
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
  const signature = ranked.find((result) => byId.get(result.productId)?.isSignature);
  if (signature) return signature;
  return ranked.find((result) => byId.get(result.productId)?.isFeatured) ?? null;
}
