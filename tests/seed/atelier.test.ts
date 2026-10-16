import { describe, expect, it } from 'vitest';
import { ATELIER, type SeedData } from '../../prisma/seed/atelier';
import { validateSeed } from '../../prisma/seed/validate';

const clone = (): SeedData => structuredClone(ATELIER);

describe('ATELIER seed', () => {
  it('passes every integrity check', () => {
    expect(validateSeed(ATELIER)).toEqual([]);
  });

  it('meets the demo requirements', () => {
    expect(ATELIER.products).toHaveLength(24);
    expect(ATELIER.categories).toHaveLength(5);
    expect(ATELIER.tables).toContain(4);
    expect(ATELIER.bundles.length).toBeGreaterThanOrEqual(2);
    expect(ATELIER.pairingRules.length).toBeGreaterThanOrEqual(10);
    expect(ATELIER.upsellRules.length).toBeGreaterThanOrEqual(1);
    for (const category of ATELIER.categories) {
      expect(ATELIER.products.some((p) => p.category === category.slug)).toBe(true);
    }
  });

  it('describes the café as a restaurant of its own', () => {
    expect(ATELIER.profile).toMatchObject({ name: 'ATELIER', type: 'CAFE', city: 'Erbil', country: 'Iraq' });
  });

  it('provides visual art for every product', () => {
    for (const product of ATELIER.products) {
      expect(product.art.length).toBeGreaterThan(0);
      expect(product.tone).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('tells the 3D burger what each extra does', () => {
    const burger = ATELIER.products.find((p) => p.slug === 'atelier-burger')!;
    const keys = burger.groups!.flatMap((g) => g.options).map((o) => o.visualKey);
    expect(keys).toEqual(['cheese', 'patty', 'bacon']);
  });

  it('has unique slugs and a single default variant per variant list', () => {
    const slugs = ATELIER.products.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const product of ATELIER.products) {
      if (!product.variants) continue;
      expect(product.variants.filter((v) => v.isDefault)).toHaveLength(1);
    }
  });
});

describe('validateSeed', () => {
  it('flags a bundle that is not cheaper than its items', () => {
    const data = clone();
    data.bundles[0]!.price = 99_999;
    expect(validateSeed(data).join('\n')).toMatch(/not cheaper/i);
  });

  it('flags a missing Sorani translation', () => {
    const data = clone();
    data.products[0]!.name.ckb = '';
    expect(validateSeed(data).join('\n')).toMatch(/ckb/);
  });

  it('flags Arabic text that is not in Arabic script', () => {
    const data = clone();
    data.products[0]!.description.ar = 'Latin text';
    expect(validateSeed(data).join('\n')).toMatch(/Arabic script/);
  });

  it('flags a pairing rule that points at an unknown product', () => {
    const data = clone();
    data.pairingRules[0]!.target = 'does-not-exist';
    expect(validateSeed(data).join('\n')).toMatch(/does-not-exist/);
  });

  it('flags an option visual key the stage does not know', () => {
    const data = clone();
    data.products.find((p) => p.slug === 'atelier-burger')!.groups![0]!.options[0]!.visualKey = 'sparkles' as never;
    expect(validateSeed(data).join('\n')).toMatch(/visualKey/);
  });

  it('flags a restaurant profile without a name', () => {
    const data = clone();
    data.profile.name = '  ';
    expect(validateSeed(data).join('\n')).toMatch(/profile/i);
  });

  it('flags a cost at or above the price', () => {
    const data = clone();
    data.products[0]!.cost = data.products[0]!.price;
    expect(validateSeed(data).join('\n')).toMatch(/cost/i);
  });
});
