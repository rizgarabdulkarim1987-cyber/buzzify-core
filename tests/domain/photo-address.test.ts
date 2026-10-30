import { describe, expect, it } from 'vitest';
import { addressOfFile } from '@/server/studio/services/photos';

describe('addressOfFile', () => {
  it('is the file name without its extension, in lower case', () => {
    expect(addressOfFile('adana-kebab.jpg')).toBe('adana-kebab');
    expect(addressOfFile('Iced-Latte.JPEG')).toBe('iced-latte');
  });
  it('ignores a folder in the name and keeps dots inside it', () => {
    expect(addressOfFile('photos/small/flat-white.webp')).toBe('flat-white');
  });
  it('keeps a name that has no extension', () => {
    expect(addressOfFile('espresso')).toBe('espresso');
  });
});
