import { describe, expect, it } from 'vitest';
import { identityKeyOf, sameProduct } from '@/server/domain/pharmacy/product-identity';

const base = { tradeName: 'Panadol', strength: '500 mg', form: 'tablet', manufacturer: 'GSK', packLabel: '24s' };

describe('product identity key', () => {
  it('Panadol 500 mg tablet 24s equals panadol 500MG Tablet 24s', () => {
    const b = { ...base, tradeName: 'panadol', strength: '500MG', form: 'Tablet' };
    expect(identityKeyOf(base)).toBe(identityKeyOf(b));
    expect(sameProduct(base, b)).toBe(true);
  });

  it('Arabic and Latin digits are the same (٥٠٠ and 500)', () => {
    expect(identityKeyOf({ ...base, strength: '٥٠٠ mg' })).toBe(identityKeyOf(base));
    expect(identityKeyOf({ ...base, strength: '۵۰۰ mg' })).toBe(identityKeyOf(base));
  });

  it('500 mg and 1000 mg are different products', () => {
    expect(sameProduct(base, { ...base, strength: '1000 mg' })).toBe(false);
  });

  it('10 and 100 stay different', () => {
    expect(sameProduct({ ...base, strength: '10 mg' }, { ...base, strength: '100 mg' })).toBe(false);
    expect(sameProduct({ ...base, strength: '2.5 mg' }, { ...base, strength: '25 mg' })).toBe(false);
  });

  it('tablet and syrup are different products', () => {
    expect(sameProduct(base, { ...base, form: 'syrup' })).toBe(false);
  });

  it('pack of 20 and pack of 24 are different products', () => {
    expect(sameProduct({ ...base, packLabel: 'pack of 20' }, { ...base, packLabel: 'pack of 24' })).toBe(false);
  });

  it('two manufacturers are different products', () => {
    expect(sameProduct(base, { ...base, manufacturer: 'Pfizer' })).toBe(false);
  });

  it('a field boundary is not blurred (a b | c differs from a | b c)', () => {
    expect(sameProduct({ ...base, tradeName: 'a b', strength: 'c' }, { ...base, tradeName: 'a', strength: 'b c' })).toBe(false);
  });

  it('a unit stays attached to its number (500 mg and 500mg)', () => {
    expect(identityKeyOf({ ...base, strength: '500mg' })).toBe(identityKeyOf(base));
    expect(identityKeyOf({ ...base, strength: '500   MG' })).toBe(identityKeyOf(base));
  });

  it('units mg, ملغ, ملغم, ml, مل, mcg and µg are unified', () => {
    for (const u of ['ملغ', 'ملغم', 'ملجم']) {
      expect(identityKeyOf({ ...base, strength: `٥٠٠ ${u}` })).toBe(identityKeyOf(base));
    }
    const syr = { ...base, strength: '5 ml' };
    expect(identityKeyOf({ ...syr, strength: '5 مل' })).toBe(identityKeyOf(syr));
    expect(identityKeyOf({ ...syr, strength: '٥مل' })).toBe(identityKeyOf(syr));
    const mcg = { ...base, strength: '50 mcg' };
    expect(identityKeyOf({ ...mcg, strength: '50 µg' })).toBe(identityKeyOf(mcg));
    expect(identityKeyOf({ ...mcg, strength: '50 μg' })).toBe(identityKeyOf(mcg));
  });

  it('different units stay different (mg, mcg, g, ml)', () => {
    const keys = ['500 mg', '500 mcg', '500 g', '500 ml'].map((s) => identityKeyOf({ ...base, strength: s }));
    expect(new Set(keys).size).toBe(4);
  });

  it('Arabic and Kurdish letter variants are unified', () => {
    const a = { ...base, tradeName: 'أموكسيسيلين كبسولة', form: 'كبسولة' };
    const b = { ...base, tradeName: 'اموكسيسیلین کبسولە', form: 'کبسولة' };
    expect(identityKeyOf(a)).toBe(identityKeyOf(b));
    expect(identityKeyOf({ ...base, tradeName: 'ڤيتامين ك' })).toBe(identityKeyOf({ ...base, tradeName: 'ڤيتامين ک' }));
    expect(identityKeyOf({ ...base, tradeName: 'مي' })).toBe(identityKeyOf({ ...base, tradeName: 'می' }));
    expect(identityKeyOf({ ...base, tradeName: 'مى' })).toBe(identityKeyOf({ ...base, tradeName: 'مي' }));
  });

  it('diacritics and tatweel are ignored', () => {
    expect(identityKeyOf({ ...base, tradeName: 'بَنَـادُول' })).toBe(identityKeyOf({ ...base, tradeName: 'بنادول' }));
  });

  it('whitespace and punctuation collapse', () => {
    expect(identityKeyOf({ ...base, tradeName: '  Panadol-  Extra ' })).toBe(identityKeyOf({ ...base, tradeName: 'panadol extra' }));
  });

  it('a percentage strength is not dropped (1% and 10%)', () => {
    expect(sameProduct({ ...base, strength: '1%' }, { ...base, strength: '10%' })).toBe(false);
    expect(sameProduct({ ...base, strength: '1%' }, { ...base, strength: '1' })).toBe(false);
  });

  it('120 mixed Arabic and Latin characters produce a key and never throw', () => {
    const mixed = 'Panadol بنادول '.repeat(8).slice(0, 120);
    expect(mixed).toHaveLength(120);
    const k = identityKeyOf({ ...base, tradeName: mixed });
    expect(typeof k).toBe('string');
    expect(k.length).toBeGreaterThan(0);
  });

  it('never throws on empty, emoji, lone surrogates or very long text', () => {
    const empty = { tradeName: '', strength: '', form: '', manufacturer: '', packLabel: '' };
    expect(() => identityKeyOf(empty)).not.toThrow();
    for (const s of ['💊💊', '\uD800', 'x'.repeat(200_000), '5 '.repeat(50_000), ' '.repeat(100_000) + 'a', '\u0000‮']) {
      expect(() => identityKeyOf({ ...base, tradeName: s, strength: s })).not.toThrow();
    }
    expect(sameProduct({ ...base, tradeName: '💊' }, { ...base, tradeName: '💉' })).toBe(false);
  });

  it('long adversarial input is fast and never throws', () => {
    const inputs = ['1'.repeat(200_000), '1.'.repeat(100_000), '1 '.repeat(100_000), 'ـ'.repeat(200_000), '.'.repeat(200_000), '٥'.repeat(200_000)];
    for (const s of inputs) {
      const started = performance.now();
      expect(() => identityKeyOf({ ...base, tradeName: s, strength: s, packLabel: s })).not.toThrow();
      expect(performance.now() - started).toBeLessThan(1000);
    }
    const a = identityKeyOf({ ...base, tradeName: 'x'.repeat(100_000) + 'a' });
    expect(typeof a).toBe('string');
  });

  it('a literal control character does not look like a decimal point', () => {
    expect(identityKeyOf({ ...base, strength: '1\u00012 mg' })).not.toBe(identityKeyOf({ ...base, strength: '1.2 mg' }));
  });

  it('the key is stable (same input twice)', () => {
    expect(identityKeyOf(base)).toBe(identityKeyOf({ ...base }));
  });
});
