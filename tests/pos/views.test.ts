import { describe, expect, it } from 'vitest';
import { amountDigits, countKind, isLate, needsSheet, pickName, quickCash, typedAmount, tableTone, visibleProducts } from '@/lib/pos-view';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { tillNav } from '@/server/domain/pos/nav';
import type { TillProduct } from '@/server/pos/till-catalog';

const product = (id: string, categoryId: string, sortOrder: number, names: TillProduct['names'], extra: Partial<TillProduct> = {}): TillProduct => ({
  id,
  categoryId,
  sortOrder,
  names,
  price: 1000,
  available: true,
  hiddenFromGuests: false,
  sectionId: null,
  variants: [],
  groups: [],
  ...extra,
});

describe('the nav', () => {
  const keys = (role: (typeof POS_ROLES)[number]) => tillNav(role).map((page) => page.key);

  it('lists exactly what each role may open', () => {
    expect(keys('CASHIER')).toEqual(['tables', 'shift']);
    expect(keys('KITCHEN')).toEqual(['kitchen']);
    expect(keys('MANAGER')).toEqual(['tables', 'shift', 'kitchen', 'report', 'floor', 'catalog', 'staff', 'settings']);
    expect(keys('OWNER')).toEqual(keys('MANAGER'));
  });

  it('lists the QR ordering pages only while the restaurant has it on, and only for roles that may open them', () => {
    const withQr = (role: (typeof POS_ROLES)[number]) => tillNav(role, { qrOrdering: true }).map((page) => page.key);
    expect(withQr('CASHIER')).toEqual(['tables', 'requests', 'shift']);
    expect(withQr('KITCHEN')).toEqual(['kitchen']);
    expect(withQr('MANAGER')).toEqual(['tables', 'requests', 'shift', 'kitchen', 'report', 'floor', 'catalog', 'staff', 'qr', 'settings']);
    expect(tillNav('MANAGER', { qrOrdering: false }).map((page) => page.key)).not.toContain('requests');
  });
});

describe('table colours', () => {
  it('maps every state', () => {
    expect(['FREE', 'BUSY', 'READY', 'BILL_REQUESTED', 'PENDING_APPROVAL'].map((s) => tableTone(s as never))).toEqual(['free', 'busy', 'ready', 'bill', 'pending']);
  });
});

describe('quick cash', () => {
  it('starts with the exact amount and rounds up to notes', () => {
    expect(quickCash(41_250)).toEqual([41_250, 42_000, 45_000, 50_000, 100_000]);
    expect(quickCash(50_000)).toEqual([50_000, 100_000]);
    expect(quickCash(1)).toEqual([1, 1_000, 5_000, 10_000, 25_000]);
  });

  it('has nothing for a free order or a bad total', () => {
    expect(quickCash(0)).toEqual([]);
    expect(quickCash(-5)).toEqual([]);
    expect(quickCash(1.5)).toEqual([]);
  });
});

describe('a drawer count', () => {
  it('is exact, over or short', () => {
    expect([0, 500, -2_000].map(countKind)).toEqual(['exact', 'surplus', 'shortage']);
  });
});

describe('names and the product list', () => {
  it('prefers the person language, then the menu language, then any', () => {
    expect(pickName({ ar: 'برغر', en: 'Burger' }, 'en', 'ar')).toBe('Burger');
    expect(pickName({ ar: 'برغر' }, 'en', 'ar')).toBe('برغر');
    expect(pickName({ ckb: 'بەرگەر' }, 'en', 'ar')).toBe('بەرگەر');
    expect(pickName({}, 'en', 'ar')).toBe('');
  });

  const catalog = {
    products: [
      product('b', 'c1', 2, { en: 'Banana', ar: 'موز' }),
      product('a', 'c1', 1, { en: 'Apple', ar: 'تفاح' }),
      product('c', 'c2', 1, { en: 'Cola' }),
    ],
  };

  it('narrows by category and by text in any language, in menu order', () => {
    expect(visibleProducts(catalog, null, '').map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(visibleProducts(catalog, 'c1', '').map((p) => p.id)).toEqual(['a', 'b']);
    expect(visibleProducts(catalog, null, ' APP ').map((p) => p.id)).toEqual(['a']);
    expect(visibleProducts(catalog, null, 'موز').map((p) => p.id)).toEqual(['b']);
    expect(visibleProducts(catalog, 'c2', 'apple')).toEqual([]);
  });

  it('opens the sheet for sizes or option groups only', () => {
    expect(needsSheet({ variants: [], groups: [] })).toBe(false);
    expect(needsSheet({ variants: [{ id: 'v', names: {}, priceDelta: 0, isDefault: true }], groups: [] })).toBe(false);
    expect(needsSheet({ variants: [{ id: 'v', names: {}, priceDelta: 0, isDefault: true }, { id: 'w', names: {}, priceDelta: 1, isDefault: false }], groups: [] })).toBe(true);
    expect(needsSheet({ variants: [], groups: [{ id: 'g', names: {}, minSelect: 0, maxSelect: 1, options: [] }] })).toBe(true);
  });
});

describe('late kitchen cards', () => {
  it('warns after the limit, not at it', () => {
    expect(isLate(0, 15 * 60_000)).toBe(false);
    expect(isLate(0, 15 * 60_000 + 1)).toBe(true);
  });
});

describe('typed amounts', () => {
  it('keeps Latin digits whatever keyboard typed them, up to nine', () => {
    expect(amountDigits('٥٠٬٠٠٠')).toBe('50000');
    expect(amountDigits('۷۱ ۰۰۰')).toBe('71000');
    expect(amountDigits('12ab3,4')).toBe('1234');
    expect(amountDigits('1234567890')).toBe('123456789');
  });

  it('reads a typed amount, and says nothing for an empty one', () => {
    expect(typedAmount('٥٠٠٠٠')).toBe(50_000);
    expect(typedAmount(' 71,000 ')).toBe(71_000);
    expect(typedAmount('0')).toBe(0);
    expect(typedAmount('')).toBeNull();
    expect(typedAmount('   ')).toBeNull();
    expect(typedAmount('12x')).toBeNull();
  });
});
