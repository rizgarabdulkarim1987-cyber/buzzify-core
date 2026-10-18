import { describe, expect, it } from 'vitest';
import { describeSuggestions } from '@/server/data/suggestion-view';
import type { SuggestionsResponse } from '@/server/domain/suggestions';
import type { CartInput, CatalogPromotion } from '@/server/domain/types';
import { at, IDS, makeCatalog } from '../domain/fixtures';

const fifthOff: CatalogPromotion = {
  id: 'cake-20',
  kind: 'DISCOUNT',
  percentOff: 20,
  productIds: [IDS.cheesecake, IDS.fries],
  categoryIds: [],
  startsOn: null,
  endsOn: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  roundTo: 5,
  translations: {},
  sortOrder: 0,
};
const cart: CartInput = { lines: [], bundles: [] };
const response: SuggestionsResponse = {
  daypart: 'LUNCH',
  signature: null,
  upgrades: [],
  pairings: [{ suggestionId: `pair:${IDS.fries}`, productId: IDS.fries, reason: '', score: 1, reasons: [] }],
  bundles: [],
  meal: [{ suggestionId: `meal:${IDS.cheesecake}`, productId: IDS.cheesecake, categoryId: 'cat-pastry' }],
};

describe('describeSuggestions', () => {
  it('names and prices the meal suggestions as it does pairings', () => {
    const view = describeSuggestions(makeCatalog(), response, 'en', cart, at(12));
    expect(view.meal).toEqual([
      {
        suggestionId: `meal:${IDS.cheesecake}`,
        productId: IDS.cheesecake,
        categoryId: 'cat-pastry',
        slug: IDS.cheesecake,
        name: IDS.cheesecake,
        price: 750,
        media: [],
        needsChoices: false,
        defaultVariantId: null,
      },
    ]);
  });

  it('shows the sale price of a suggested dish during a discount', () => {
    const view = describeSuggestions(makeCatalog({ promotions: [fifthOff] }), response, 'en', cart, at(12));
    expect(view.pairings[0]?.price).toBe(440);
    expect(view.meal[0]?.price).toBe(600);
  });
});
