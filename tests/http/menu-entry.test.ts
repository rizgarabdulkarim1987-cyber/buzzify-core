import { describe, expect, it } from 'vitest';
import { entryTarget } from '@/server/http/menu-entry';

/** Where a language-less menu address sends a visitor (docs/superpowers/specs/2026-10-29-menu-intro-design.md): every scan meets the intro. */

const ON = { slug: 'zhamitos', locale: 'en', intro: true } as const;
const OFF = { slug: 'zhamitos', locale: 'en', intro: false } as const;

describe('the entry address of a menu with the intro on', () => {
  it('sends the plain address to the intro, keeping the query', () => {
    expect(entryTarget({ ...ON, subpath: '', search: '' })).toBe('/zhamitos/intro');
    expect(entryTarget({ ...ON, subpath: '', search: '?src=card' })).toBe('/zhamitos/intro?src=card');
  });

  it('sends a table code to the intro too, carrying the table and the query', () => {
    expect(entryTarget({ ...ON, subpath: '/t/4', search: '' })).toBe('/zhamitos/intro?table=4');
    expect(entryTarget({ ...ON, subpath: '/t/04', search: '?qr=abc' })).toBe('/zhamitos/intro?qr=abc&table=04');
  });

  it('takes no table from the visitor’s own query on the plain address', () => {
    expect(entryTarget({ ...ON, subpath: '', search: '?table=9&src=card' })).toBe('/zhamitos/intro?src=card');
  });

  it('leaves a table that is not a table number to the menu, which answers not found', () => {
    expect(entryTarget({ ...ON, subpath: '/t/abc', search: '' })).toBe('/zhamitos/en/t/abc');
    expect(entryTarget({ ...ON, subpath: '/t/0', search: '' })).toBe('/zhamitos/en/t/0');
  });
});

describe('the entry address of a menu with the intro off', () => {
  it('goes straight to the menu in the visitor’s language, table and query kept', () => {
    expect(entryTarget({ ...OFF, subpath: '', search: '' })).toBe('/zhamitos/en');
    expect(entryTarget({ ...OFF, subpath: '/t/4', search: '?qr=abc' })).toBe('/zhamitos/en/t/4?qr=abc');
  });
});
