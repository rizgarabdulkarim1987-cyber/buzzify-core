import { describe, expect, it } from 'vitest';
import { isJumpShortcut, type ShortcutKey } from '@/studio/shell/jump-shortcut';

const press = (key: Partial<ShortcutKey>): ShortcutKey => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: '', code: '', ...key });

describe('the Jump to shortcut', () => {
  it('is Ctrl+K, and Cmd+K on a Mac', () => {
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'k', code: 'KeyK' }))).toBe(true);
    expect(isJumpShortcut(press({ metaKey: true, key: 'k', code: 'KeyK' }))).toBe(true);
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'K', code: 'KeyK' }))).toBe(true);
  });

  it('works on Arabic and Sorani layouts, where the K key types another letter', () => {
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'ن', code: 'KeyK' }))).toBe(true);
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'ک', code: 'KeyK' }))).toBe(true);
  });

  it('follows the letter on layouts that put K elsewhere', () => {
    // Dvorak types k with the key in V's place.
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'k', code: 'KeyV' }))).toBe(true);
  });

  it('is nothing else', () => {
    expect(isJumpShortcut(press({ key: 'k', code: 'KeyK' }))).toBe(false);
    expect(isJumpShortcut(press({ ctrlKey: true, shiftKey: true, key: 'K', code: 'KeyK' }))).toBe(false);
    expect(isJumpShortcut(press({ ctrlKey: true, altKey: true, key: 'k', code: 'KeyK' }))).toBe(false);
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'ن', code: 'KeyN' }))).toBe(false);
    expect(isJumpShortcut(press({ ctrlKey: true, key: 'j', code: 'KeyJ' }))).toBe(false);
  });
});
