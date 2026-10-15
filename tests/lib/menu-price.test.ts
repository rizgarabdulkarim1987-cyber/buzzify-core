import { describe, expect, it } from 'vitest';
import { unitPriceFromMenu } from '@/lib/menu-price';
import { buildMenuView } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { unitPrice } from '@/server/domain/catalog';
import { at, IDS, makeCatalog, product } from '../domain/fixtures';

const tenant = {
  id: 'r',
  slug: 'r',
  name: 'R',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  brand: { logoText: 'R', theme: 'dark', motionIntensity: 'subtle', tokens: {} },
} as unknown as TenantInfo;

describe('unitPriceFromMenu', () => {
  const discount = product({
    id: 'p-discount',
    basePrice: 100,
    groups: [
      {
        id: 'g',
        productId: 'p-discount',
        minSelect: 0,
        maxSelect: 1,
        translations: { en: { name: 'G' } },
        options: [
          {
            id: 'o-neg',
            groupId: 'g',
            priceDelta: -500,
            costDelta: null,
            isSuggested: false,
            suggestPriority: 0,
            isAvailable: true,
            translations: { en: { name: 'Neg' } },
          },
        ],
      },
    ],
  });
  const base = makeCatalog();
  const catalog = { ...base, products: [...base.products, discount] };
  const view = buildMenuView(catalog, tenant, 'en', at(12));

  it('matches the server unit price for every product, variant and single option', () => {
    for (const source of catalog.products) {
      const shown = view.products.find((p) => p.id === source.id)!;
      const variantIds: Array<string | null> = [null, ...source.variants.map((v) => v.id)];
      const optionSets: string[][] = [[], ...source.groups.flatMap((g) => g.options.map((o) => [o.id]))];
      for (const variantId of variantIds) {
        for (const optionIds of optionSets) {
          expect(unitPriceFromMenu(shown, variantId, optionIds), `${source.id} ${variantId} ${optionIds}`).toBe(
            unitPrice(source, variantId, optionIds).price,
          );
        }
      }
    }
  });

  it('matches for the burger with two options and clamps at zero', () => {
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(unitPriceFromMenu(burger, null, [IDS.optCheese, IDS.optDouble])).toBe(1300);
    const shown = view.products.find((p) => p.id === 'p-discount')!;
    expect(unitPriceFromMenu(shown, null, ['o-neg'])).toBe(0);
  });
});
