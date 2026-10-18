import { describe, expect, it } from 'vitest';
import { localDigits } from '@/lib/digits';
import { getTranslator } from '@/lib/messages';

describe('the sales labels guests read', () => {
  it('writes times and percentages in the menu’s own digits', () => {
    expect(localDigits('19:00', 'arab')).toBe('١٩:٠٠');
    expect(localDigits('20', 'arab')).toBe('٢٠');
    expect(localDigits('19:00', 'latn')).toBe('19:00');
  });

  it('counts portions left in the grammar of each language', () => {
    const ar = getTranslator('ar');
    expect(ar('menu.fewLeft', { count: 1, n: '١' })).toBe('بقي واحد فقط');
    expect(ar('menu.fewLeft', { count: 2, n: '٢' })).toBe('بقي اثنان فقط');
    expect(ar('menu.fewLeft', { count: 3, n: '٣' })).toBe('بقي ٣ فقط');
    expect(getTranslator('en')('menu.fewLeft', { count: 1, n: '1' })).toBe('Only 1 left');
    expect(getTranslator('ckb')('menu.fewLeft', { count: 4, n: '٤' })).toBe('تەنها ٤ ماوە');
  });

  it('says how many a dish serves in the grammar of each language', () => {
    const ar = getTranslator('ar');
    expect(ar('menu.serves', { count: 2, n: '٢', price: '٥٫٠٠' })).toBe('لشخصين · ٥٫٠٠ للشخص');
    expect(ar('menu.serves', { count: 4, n: '٤', price: '٢٫٥٠' })).toBe('لـ ٤ أشخاص · ٢٫٥٠ للشخص');
    expect(ar('menu.serves', { count: 12, n: '١٢', price: '١' })).toBe('لـ ١٢ شخصًا · ١ للشخص');
    expect(getTranslator('en')('menu.serves', { count: 4, n: '4', price: '2.50' })).toBe('For 4 · 2.50 each');
  });
});
