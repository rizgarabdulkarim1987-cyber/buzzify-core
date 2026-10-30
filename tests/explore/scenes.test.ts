import { describe, expect, it } from 'vitest';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { buildScenes } from '@/ui/explore/scenes';

function product(overrides: Partial<MenuProductView> & { id: string; categoryId: string }): MenuProductView {
  return {
    slug: overrides.id,
    name: overrides.id,
    description: '',
    basePrice: 500,
    displayPrice: 500,
    needsChoices: false,
    orderState: 'OK',
    isSignature: false,
    media: [],
    allergens: [],
    ingredients: [],
    searchKey: overrides.id,
    groups: [],
    variants: [],
    ...overrides,
  };
}

const art = (kind: 'cup' | 'burger' | 'glass' | 'pastry', model?: string) =>
  [{ kind: 'art', art: kind, tone: '#a5662f', ...(model ? { model } : {}) }] as MenuProductView['media'];

const view = (products: MenuProductView[]): MenuView => ({
  restaurant: { slug: 't', name: 'T', currency: 'USD', numeralSystem: 'latn', locales: ['en'], defaultLocale: 'en' },
  daypart: null,
  categories: [
    { id: 'c1', slug: 'coffee', name: 'Coffee', dish: 'cup' },
    { id: 'c2', slug: 'plates', name: 'Plates', dish: 'burger' },
    { id: 'c3', slug: 'cold', name: 'Cold', dish: 'glass' },
  ],
  products,
  signatureProductId: null,
  priceStyle: 'symbol',
  offers: [],
  showcase: { aboveSearch: [], belowSearch: [] },
});

describe('buildScenes', () => {
  it('makes one scene per category from its signature, in category order', () => {
    const scenes = buildScenes(
      view([
        product({ id: 'burger', categoryId: 'c2', isSignature: true, media: art('burger') }),
        product({ id: 'flat', categoryId: 'c1', isSignature: true, media: art('cup') }),
        product({ id: 'glass', categoryId: 'c3', isSignature: true, media: art('glass') }),
      ]),
    );
    expect(scenes.map((s) => s.slug)).toEqual(['flat', 'burger', 'glass']);
    expect(scenes.map((s) => s.art)).toEqual(['cup', 'burger', 'glass']);
    expect(scenes[0]?.categoryName).toBe('Coffee');
  });

  it('skips products that are not signatures or have no 3D model', () => {
    const scenes = buildScenes(
      view([
        product({ id: 'plain', categoryId: 'c1', isSignature: false, media: art('cup') }),
        product({ id: 'pastry', categoryId: 'c2', isSignature: true, media: art('pastry') }),
        product({ id: 'noart', categoryId: 'c3', isSignature: true, media: [] }),
      ]),
    );
    expect(scenes).toEqual([]);
  });

  it('uses an explicit model for pastry art', () => {
    const scenes = buildScenes(
      view([product({ id: 'mille', categoryId: 'c2', isSignature: true, media: art('pastry', 'millefeuille') })]),
    );
    expect(scenes[0]?.art).toBe('millefeuille');
  });

  it('stages a dish whose photo comes first and whose model is named after it', () => {
    const media = [
      { kind: 'image', url: '/bag.webp', alt: 'Loaded bag', width: 800, height: 800 },
      { kind: 'art', art: 'bowl', tone: '#e89a2c', model: 'bagchicken' },
    ] as MenuProductView['media'];
    const scenes = buildScenes(view([product({ id: 'bag', categoryId: 'c2', isSignature: true, media })]));
    expect(scenes.map((s) => s.art)).toEqual(['bagchicken']);
    expect(scenes[0]?.scan).toBeUndefined();
  });

  it('passes a scanned model on to the scene', () => {
    const media = [{ kind: 'art', art: 'bowl', tone: '#e89a2c', model: 'bagchicken', scan: '/api/assets/models/bag.glb' }] as MenuProductView['media'];
    const scenes = buildScenes(view([product({ id: 'bag', categoryId: 'c2', isSignature: true, media })]));
    expect(scenes[0]?.scan).toBe('/api/assets/models/bag.glb');
  });

  it('takes the first signature of a category and ignores sold-out dishes that cannot be ordered', () => {
    const scenes = buildScenes(
      view([
        product({ id: 'out', categoryId: 'c1', isSignature: true, media: art('cup'), orderState: 'OUT_OF_STOCK' }),
        product({ id: 'ok', categoryId: 'c1', isSignature: true, media: art('cup') }),
        product({ id: 'second', categoryId: 'c1', isSignature: true, media: art('cup') }),
      ]),
    );
    expect(scenes.map((s) => s.slug)).toEqual(['ok']);
  });
});
