import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { pickSignature, scoreProducts } from '@/server/domain/promotion';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const noon = at(12);
const morning = at(9);
const byId = (results: ReturnType<typeof scoreProducts>, id: string) => results.find((r) => r.productId === id);

describe('scoreProducts', () => {
  it('marks unavailable, sold-out and out-of-daypart products ineligible', () => {
    const catalog = makeCatalog({
      products: [
        product({ id: 'a', isAvailable: false }),
        product({ id: 'b', stockCount: 0 }),
        product({ id: 'c', dayparts: ['DINNER'] }),
        product({ id: 'd' }),
      ],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'a')?.eligible).toBe(false);
    expect(byId(results, 'b')?.eligible).toBe(false);
    expect(byId(results, 'c')?.eligible).toBe(false);
    expect(byId(results, 'd')?.eligible).toBe(true);
  });

  it('treats an unknown cost as neutral and says so', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'known', basePrice: 1000, cost: 500 }), product({ id: 'unknown', basePrice: 1000, cost: null })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'unknown')?.score).toBe(byId(results, 'known')?.score);
    expect(byId(results, 'unknown')?.reasons.join(' ')).toMatch(/cost unknown/);
  });

  it('prefers higher margin when everything else is equal', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'low', basePrice: 1000, cost: 800 }), product({ id: 'high', basePrice: 1000, cost: 200 })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(results[0]?.productId).toBe('high');
  });

  it('boosts a product whose daypart matches the current one', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'plain' }), product({ id: 'breakfast', dayparts: ['BREAKFAST'] })],
    });
    const results = scoreProducts(catalog, morning, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'breakfast')?.score).toBeGreaterThan(byId(results, 'plain')?.score ?? 0);
    expect(byId(results, 'breakfast')?.reasons.join(' ')).toMatch(/daypart/);
  });

  it('penalises low stock', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'fine' }), product({ id: 'scarce', stockCount: 1, lowStockThreshold: 3 })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'scarce')?.score).toBeLessThan(byId(results, 'fine')?.score ?? 0);
    expect(byId(results, 'scarce')?.reasons.join(' ')).toMatch(/low stock/);
  });

  it('breaks ties by product id', () => {
    const catalog = makeCatalog({ products: [product({ id: 'b' }), product({ id: 'a' })] });
    expect(scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG).map((r) => r.productId)).toEqual(['a', 'b']);
  });
});

describe('pickSignature', () => {
  it('chooses the best eligible signature product', () => {
    let catalog = makeCatalog();
    catalog = withProduct(catalog, IDS.croissant, { isSignature: true });
    catalog = withProduct(catalog, IDS.cheesecake, { isSignature: true });
    expect(pickSignature(catalog, morning, DEFAULT_ENGINE_CONFIG)?.productId).toBe(IDS.croissant);
  });

  it('skips ineligible signatures and falls back to featured products', () => {
    let catalog = makeCatalog();
    catalog = withProduct(catalog, IDS.croissant, { isSignature: true, isAvailable: false });
    catalog = withProduct(catalog, IDS.fries, { isFeatured: true });
    expect(pickSignature(catalog, noon, DEFAULT_ENGINE_CONFIG)?.productId).toBe(IDS.fries);
  });

  it('returns null when nothing qualifies', () => {
    expect(pickSignature(makeCatalog(), noon, DEFAULT_ENGINE_CONFIG)).toBeNull();
  });
});
