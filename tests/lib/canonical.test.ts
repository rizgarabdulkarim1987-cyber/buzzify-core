import { describe, expect, it } from 'vitest';
import { canonicalSet, canonicalStrings } from '@/lib/canonical';
import { LOCALES } from '@/lib/locale';
import { BADGES, DIETARY_TAGS } from '@/lib/product-tags';
import { DAYPARTS } from '@/server/domain/types';

describe('canonicalSet', () => {
  it('keeps each member once, in the order of the list it belongs to', () => {
    expect(canonicalSet(['LUNCH', 'BREAKFAST', 'LUNCH'], DAYPARTS)).toEqual(['BREAKFAST', 'LUNCH']);
    expect(canonicalSet(['ckb', 'en'], LOCALES)).toEqual(['en', 'ckb']);
    expect(canonicalSet(['RECOMMENDED', 'NEW'], BADGES)).toEqual(['NEW', 'RECOMMENDED']);
    expect(canonicalSet(['VEGAN', 'VEGETARIAN'], DIETARY_TAGS)).toEqual(['VEGETARIAN', 'VEGAN']);
  });

  it('gives the same answer for the same set in any order', () => {
    expect(canonicalSet(['HALAL', 'SPICY', 'VEGAN'], DIETARY_TAGS)).toEqual(canonicalSet(['VEGAN', 'HALAL', 'SPICY'], DIETARY_TAGS));
  });

  it('refuses a value the list does not have', () => {
    expect(() => canonicalSet(['BRUNCH'], DAYPARTS)).toThrow('Unknown value BRUNCH');
  });
});

describe('canonicalStrings', () => {
  it('trims, drops empties and repeats ignoring case, and sorts by code unit', () => {
    expect(canonicalStrings([' Nuts', 'milk', 'nuts', ''])).toEqual(['Nuts', 'milk']);
    expect(canonicalStrings(['sesame', '  ', 'Egg', 'egg '])).toEqual(['Egg', 'sesame']);
  });

  it('keeps Arabic-script entries and orders them after Latin ones', () => {
    expect(canonicalStrings(['شیر', 'gluten', 'شیر '])).toEqual(['gluten', 'شیر']);
  });
});
