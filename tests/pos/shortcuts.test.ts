import { describe, expect, it } from 'vitest';
import { shortcutFor } from '@/lib/pos-shortcuts';

const press = (key: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe('till keyboard shortcuts', () => {
  it('maps / to search, F2 to pay and Escape to close', () => {
    expect(press('/')).toBe('search');
    expect(press('F2')).toBe('pay');
    expect(press('Escape')).toBe('close');
  });

  it('ignores every other key', () => {
    expect(press('a')).toBeNull();
    expect(press('Enter')).toBeNull();
  });

  it('does not fire while typing in a field, except Escape', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(press('/', { target: { tagName } })).toBeNull();
      expect(press('F2', { target: { tagName } })).toBeNull();
      expect(press('Escape', { target: { tagName } })).toBe('close');
    }
    expect(press('/', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
  });

  it('ignores a key pressed with ctrl, meta or alt', () => {
    expect(press('/', { ctrlKey: true })).toBeNull();
    expect(press('F2', { metaKey: true })).toBeNull();
    expect(press('Escape', { altKey: true })).toBeNull();
  });

  it('copes with no target', () => {
    expect(press('/', { target: null })).toBe('search');
  });
});
