import { describe, expect, it } from 'vitest';
import type { ProductEditing } from '@/server/studio/services/content';
import { comparable, draftOf, toSave } from '@/studio/workspace/content/draft';
import { formatDeltaInput, parseDeltaInput } from '@/studio/workspace/content/shared';

const PRODUCT: ProductEditing = {
  id: 'p1',
  version: 3,
  slug: 'espresso',
  categoryId: 'c1',
  names: { en: 'Espresso' },
  descriptions: {},
  ingredients: {},
  price: 300,
  isSignature: false,
  isFeatured: false,
  allergens: ['milk'],
  dietary: [],
  badges: [],
  calories: null,
  cost: null,
  priority: 50,
  serves: null,
  lowStockThreshold: null,
  media: [],
  variants: [{ id: 'v1', version: 2, names: { en: 'Large' }, priceDelta: 100, isDefault: true }],
  groups: [
    {
      id: 'g1',
      version: 1,
      names: { en: 'Extras' },
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: 'o1', version: 1, names: { en: 'Oat milk' }, priceDelta: -50, isSuggested: true }],
    },
  ],
  missing: { names: ['ar', 'ckb'], descriptions: ['en', 'ar', 'ckb'] },
};
const BASE = { menuId: 'm1', productId: 'p1', version: 3, currency: 'USD' };

describe('price differences as typed', () => {
  it('reads a sign, Arabic-Indic digits and an empty field', () => {
    expect(parseDeltaInput('+1.00', 'USD')).toEqual({ ok: true, minor: 100 });
    expect(parseDeltaInput('-0.50', 'USD')).toEqual({ ok: true, minor: -50 });
    expect(parseDeltaInput('−0.50', 'USD')).toEqual({ ok: true, minor: -50 });
    expect(parseDeltaInput('١٫٢٥', 'USD')).toEqual({ ok: true, minor: 125 });
    expect(parseDeltaInput('', 'USD')).toEqual({ ok: true, minor: 0 });
    expect(parseDeltaInput('+250', 'IQD')).toEqual({ ok: true, minor: 250 });
    expect(parseDeltaInput('+1.005', 'USD')).toEqual({ ok: false, reason: 'TOO_PRECISE' });
  });

  it('writes a difference back with its sign', () => {
    expect(formatDeltaInput(100, 'USD')).toBe('+1.00');
    expect(formatDeltaInput(-50, 'USD')).toBe('-0.50');
    expect(formatDeltaInput(0, 'IQD')).toBe('0');
  });
});

describe('the drawer draft', () => {
  it('saves a product unchanged as it was read', () => {
    const result = toSave(draftOf(PRODUCT, 'USD'), BASE);
    expect(result).toEqual({
      ok: true,
      save: {
        menuId: 'm1',
        productId: 'p1',
        version: 3,
        slug: 'espresso',
        categoryId: 'c1',
        names: { en: 'Espresso' },
        descriptions: {},
        price: 300,
        isSignature: false,
        isFeatured: false,
        allergens: ['milk'],
        dietary: [],
        badges: [],
        calories: null,
        media: [],
        variants: [{ id: 'v1', version: 2, names: { en: 'Large' }, priceDelta: 100, isDefault: true }],
        groups: [
          {
            id: 'g1',
            version: 1,
            names: { en: 'Extras' },
            minSelect: 0,
            maxSelect: 1,
            options: [{ id: 'o1', version: 1, names: { en: 'Oat milk' }, priceDelta: -50, isSuggested: true }],
          },
        ],
        cost: null,
        priority: 50,
        serves: null,
        lowStockThreshold: null,
      },
    });
  });

  it('reads the sales fields as typed: a cost, how much to promote, how many it serves, when it runs low', () => {
    const draft = draftOf({ ...PRODUCT, cost: 90, priority: 75, serves: 4, lowStockThreshold: 3 }, 'USD');
    expect(draft).toMatchObject({ cost: '0.90', priority: 75, serves: '4', lowStockThreshold: '3' });
    const result = toSave({ ...draft, cost: '1.20', serves: '', lowStockThreshold: '٥' }, BASE);
    expect(result.ok && result.save).toMatchObject({ cost: 120, priority: 75, serves: null, lowStockThreshold: 5 });
    expect(toSave({ ...draft, cost: '' }, BASE)).toMatchObject({ ok: true, save: { cost: null } });
  });

  it('names a cost, a number of people and a threshold it cannot read', () => {
    const draft = { ...draftOf(PRODUCT, 'USD'), cost: 'lots', serves: '1', lowStockThreshold: '0' };
    expect(toSave(draft, BASE)).toEqual({
      ok: false,
      errors: { cost: 'content.price.notANumber', serves: 'content.serves.range', lowStockThreshold: 'content.lowStock.range' },
    });
  });

  it('names each field it cannot read, by the server’s paths', () => {
    const draft = draftOf(PRODUCT, 'USD');
    draft.price = 'four';
    draft.calories = '30000';
    draft.variants[0]!.priceDelta = '+1.234';
    draft.groups[0]!.minSelect = 'one';
    draft.groups[0]!.options[0]!.priceDelta = 'x';
    expect(toSave(draft, BASE)).toEqual({
      ok: false,
      errors: {
        price: 'content.price.notANumber',
        calories: 'content.calories.range',
        'variants.0.priceDelta': 'content.price.tooPrecise',
        'groups.0.minSelect': 'content.groups.wholeNumber',
        'groups.0.options.0.priceDelta': 'content.price.notANumber',
      },
    });
  });

  it('drops empty texts and counts only real changes as unsaved', () => {
    const draft = draftOf(PRODUCT, 'USD');
    const initial = comparable(draft);
    expect(comparable({ ...draft, media: [] })).toBe(initial);
    const named = { ...draft, names: { en: ' Espresso ', ar: '  ' } };
    expect(comparable(named)).not.toBe(initial);
    const result = toSave(named, BASE);
    expect(result.ok && result.save.names).toEqual({ en: 'Espresso' });
  });
});
