import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeSearch } from '@/lib/search';

describe('normalizeSearch', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeSearch('  Flat   WHITE ')).toBe('flat white');
  });

  it('strips Latin diacritics', () => {
    expect(normalizeSearch('Crème Brûlée')).toBe('creme brulee');
  });

  it('unifies Arabic letter variants', () => {
    expect(normalizeSearch('إسبريسو')).toBe(normalizeSearch('اسبريسو'));
    expect(normalizeSearch('قهوة')).toBe(normalizeSearch('قهوه'));
    expect(normalizeSearch('شاي')).toBe(normalizeSearch('شای'));
  });

  it('removes Arabic marks and tatweel', () => {
    expect(normalizeSearch('قَهْوَة')).toBe(normalizeSearch('قهوة'));
    expect(normalizeSearch('قـهـوة')).toBe(normalizeSearch('قهوة'));
  });

  it('maps Arabic-Indic and Persian digits to Latin digits', () => {
    expect(normalizeSearch('٢٥٠ غ')).toContain('250');
    expect(normalizeSearch('۲۵۰')).toBe('250');
  });
});

describe('matchesQuery', () => {
  const key = normalizeSearch('Flat White فلات وايت Oat milk');

  it('matches every token regardless of order', () => {
    expect(matchesQuery(key, 'white flat')).toBe(true);
    expect(matchesQuery(key, 'oat')).toBe(true);
    expect(matchesQuery(key, 'espresso')).toBe(false);
  });

  it('matches across scripts', () => {
    expect(matchesQuery(key, 'وايت')).toBe(true);
  });

  it('treats empty and whitespace-only queries as match-all', () => {
    expect(matchesQuery(key, '')).toBe(true);
    expect(matchesQuery(key, '    ')).toBe(true);
  });

  it('never throws on regex metacharacters', () => {
    for (const hostile of ['(', '[', '*', '\\', '.*', '(?<', '$^', '+?']) {
      expect(() => matchesQuery(key, hostile)).not.toThrow();
    }
    expect(matchesQuery(key, '(')).toBe(false);
  });
});
