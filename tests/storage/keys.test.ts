import { describe, expect, it } from 'vitest';
import { assetKey, exportKey, IMMUTABLE_CACHE, importKey, isPublicKey, isValidKey, uploadKey } from '@/server/storage/keys';

const HASH = 'a'.repeat(64);

describe('storage keys', () => {
  it('files a restaurant asset under the restaurant and its content hash, a shared one under shared/', () => {
    expect(assetKey({ restaurantId: 'cr1' }, HASH, 'webp-640', 'webp')).toBe(`r/cr1/${HASH}/webp-640.webp`);
    expect(assetKey({ restaurantId: null }, HASH, 'original', 'svg')).toBe(`shared/${HASH}/original.svg`);
  });

  it('keeps uploads, imports and exports apart from public files', () => {
    expect(uploadKey({ restaurantId: 'cr1' }, 'u1')).toBe('uploads/cr1/u1');
    expect(uploadKey({ restaurantId: null }, 'u1')).toBe('uploads/shared/u1');
    expect(importKey('cm1', 'i1')).toBe('imports/cm1/i1');
    expect(exportKey('cm1', 'e1', 'Atelier Menu (final).XLSX')).toBe('exports/cm1/e1/atelier-menu-final-.xlsx');
    expect(exportKey('cm1', 'e1', 'منيو.csv')).toBe('exports/cm1/e1/file.csv');
  });

  it('serves only asset keys publicly', () => {
    expect(isPublicKey(`r/cr1/${HASH}/webp-640.webp`)).toBe(true);
    expect(isPublicKey(`shared/${HASH}/original.svg`)).toBe(true);
    expect(isPublicKey('uploads/cr1/u1')).toBe(false);
    expect(isPublicKey('exports/cm1/e1/a.csv')).toBe(false);
    expect(isPublicKey('rx/cr1/a')).toBe(false);
  });

  it.each(['../x', 'r/../uploads/a', 'R/abc', 'r/a b', '/r/a', 'r//a', 'r/a/', '', 'r/a\\b'])('refuses the key %j', (key) => {
    expect(isValidKey(key)).toBe(false);
  });

  it('refuses to build a key from an id that would escape its folder', () => {
    expect(() => uploadKey({ restaurantId: '../shared' }, 'u1')).toThrow();
    expect(() => assetKey({ restaurantId: 'cr1' }, '../x', 'original', 'png')).toThrow();
  });

  it('caches public files for a year, immutably', () => {
    expect(IMMUTABLE_CACHE).toBe('public, max-age=31536000, immutable');
  });
});
