import { describe, expect, it } from 'vitest';
import { createTranslator, type Messages } from '@/lib/i18n';

const catalog: Record<'en' | 'ar' | 'ckb', Messages> = {
  en: {
    hello: 'Hello {name}',
    only_en: 'Only English',
    items_one: '{count} item',
    items_other: '{count} items',
  },
  ar: {
    hello: 'مرحبا {name}',
    items_one: 'عنصر واحد',
    items_two: 'عنصران',
    items_few: '{count} عناصر',
    items_many: '{count} عنصرًا',
    items_other: '{count} عنصر',
  },
  ckb: {
    hello: 'سڵاو {name}',
    items_one: '{count} بەرهەم',
    items_other: '{count} بەرهەم',
  },
};

describe('createTranslator', () => {
  it('interpolates parameters', () => {
    expect(createTranslator('en', catalog)('hello', { name: 'Sara' })).toBe('Hello Sara');
    expect(createTranslator('ar', catalog)('hello', { name: 'سارة' })).toBe('مرحبا سارة');
  });

  it('falls back to English then to the key', () => {
    expect(createTranslator('ar', catalog)('only_en')).toBe('Only English');
    expect(createTranslator('en', catalog)('missing.key')).toBe('missing.key');
  });

  it('leaves unknown placeholders visible instead of throwing', () => {
    expect(createTranslator('en', catalog)('hello')).toBe('Hello {name}');
  });

  it('selects plural forms by locale rules', () => {
    const en = createTranslator('en', catalog);
    expect(en('items', { count: 1 })).toBe('1 item');
    expect(en('items', { count: 3 })).toBe('3 items');
    const ar = createTranslator('ar', catalog);
    expect(ar('items', { count: 1 })).toBe('عنصر واحد');
    expect(ar('items', { count: 2 })).toBe('عنصران');
    expect(ar('items', { count: 5 })).toBe('5 عناصر');
    expect(ar('items', { count: 11 })).toBe('11 عنصرًا');
    expect(ar('items', { count: 100 })).toBe('100 عنصر');
  });
});
