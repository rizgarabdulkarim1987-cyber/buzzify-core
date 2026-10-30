import { describe, expect, it } from 'vitest';
import { countParams, durationParts, listParts } from '@/app/pharmacy/_ui/reports-logic';
import { getStudioTranslator } from '@/studio/messages';

/**
 * Sentences with a number in the report screens pick their plural form from the NUMBER (`count`), in every language: "1 line", "2 lines",
 * Arabic one/two/few/many, Sorani one/other. A count handed over as text never gets a plural form, which is how "1 lines" was shipped.
 * (ar and ckb texts are machine-drafted and wait for a native review; these tests hold the grammar rule, not the wording.)
 */
const en = getStudioTranslator('en');
const ar = getStudioTranslator('ar');
const ckb = getStudioTranslator('ckb');
const NOTICES = ['pharmacy.reports.notice.margin.costMissing', 'pharmacy.reports.notice.margin.otherCurrency', 'pharmacy.reports.notice.valuation.incomplete'];

describe('counts in notices', () => {
  it('English: one line, two lines', () => {
    expect(en(NOTICES[0]!, countParams(1))).toBe('Cost is missing on 1 line, so it is left out of the margin.');
    expect(en(NOTICES[0]!, countParams(2))).toBe('Cost is missing on 2 lines, so they are left out of the margin.');
    expect(en(NOTICES[1]!, countParams(1))).toBe('1 line was sold in a different currency than its cost, so it is left out.');
    expect(en(NOTICES[1]!, countParams(3))).toBe('3 lines were sold in a different currency than their cost, so they are left out.');
    expect(en(NOTICES[2]!, countParams(1))).toBe('The value is incomplete: 1 stock row has no cost on record.');
    expect(en(NOTICES[2]!, countParams(4))).toBe('The value is incomplete: 4 stock rows have no cost on record.');
  });

  it('a count given as text keeps the generic form: the bug the numbers prevent', () => {
    // The one-line sentence needs the number, not a string.
    expect(en(NOTICES[0]!, { count: '1', n: '1' })).not.toContain('1 line,');
  });

  it('Arabic has its own forms for 1, 2, 3 to 10, 11 and more', () => {
    const forms = [1, 2, 3, 10, 11, 100].map((n) => ar(NOTICES[0]!, countParams(n)));
    expect(forms[0]).toContain('سطر واحد');
    expect(forms[1]).toContain('سطرين');
    expect(forms[2]).toContain('3 أسطر');
    expect(forms[3]).toContain('10 أسطر');
    expect(forms[4]).toContain('11 سطرًا');
    expect(forms[5]).toContain('100 سطر،');
    expect(new Set(forms).size).toBe(6);
  });

  it('Sorani has one and other', () => {
    expect(ckb(NOTICES[0]!, countParams(1))).toContain('یەک دێڕ');
    expect(ckb(NOTICES[0]!, countParams(5))).toContain('5 دێڕ');
  });

  it('no placeholder is left in any language, for the counts a screen shows', () => {
    for (const t of [en, ar, ckb]) {
      for (const key of NOTICES) for (const n of [1, 2, 3, 5, 11, 25, 100, 1200]) expect(t(key, countParams(n)), `${key} ${n}`).not.toMatch(/\{\w+\}/);
    }
  });

  it('numbers are written with Latin digits and a thousands comma in every language', () => {
    expect(countParams(1200)).toEqual({ count: 1200, n: '1,200' });
    for (const t of [en, ar, ckb]) expect(t(NOTICES[2]!, countParams(1200))).toContain('1,200');
  });
});

describe('durations', () => {
  it('minutes under an hour (at least one), hours with one decimal from an hour up', () => {
    expect(durationParts(10)).toEqual({ unit: 'minutes', count: 1, text: '1' });
    expect(durationParts(90)).toEqual({ unit: 'minutes', count: 2, text: '2' });
    expect(durationParts(3600)).toEqual({ unit: 'hours', count: 1, text: '1' });
    expect(durationParts(5400)).toEqual({ unit: 'hours', count: 1.5, text: '1.5' });
    expect(durationParts(7 * 3600)).toEqual({ unit: 'hours', count: 7, text: '7' });
  });
  it('"1 hour" and "1 minute", never "1 hours" or "1 minutes", in English; the other languages have their forms too', () => {
    const say = (t: typeof en, s: number) => {
      const d = durationParts(s);
      return t(`pharmacy.reports.transfers.${d.unit}`, { count: d.count, n: d.text });
    };
    expect(say(en, 30)).toBe('1 minute');
    expect(say(en, 300)).toBe('5 minutes');
    expect(say(en, 3600)).toBe('1 hour');
    expect(say(en, 5400)).toBe('1.5 hours');
    expect(say(ar, 30)).toBe('دقيقة واحدة');
    expect(say(ar, 120)).toBe('دقيقتان');
    expect(say(ar, 5 * 60)).toBe('5 دقائق');
    expect(say(ar, 3600)).toBe('ساعة واحدة');
    expect(say(ar, 2 * 3600)).toBe('ساعتان');
    expect(say(ckb, 3600)).toBe('یەک کاتژمێر');
    expect(say(ckb, 3 * 3600)).toBe('3 کاتژمێر');
  });
});

describe('the chain scope sentence and the list of branch names', () => {
  it('the sentence follows the number of branches', () => {
    expect(en('pharmacy.chain.scope', countParams(2))).toBe('The total is the total of the 2 branches you see:');
    expect(ar('pharmacy.chain.scope', countParams(2))).toContain('الفرعين');
    expect(ar('pharmacy.chain.scope', countParams(5))).toContain('5');
    expect(ckb('pharmacy.chain.scope', countParams(3))).toContain('3 لقە');
  });
  it('names are joined in the reader\'s language and each stays a part of its own', () => {
    const text = (locale: string, names: string[]) => listParts(names, locale).map((p) => p.value).join('');
    const items = (locale: string, names: string[]) => listParts(names, locale).filter((p) => p.kind === 'item').map((p) => p.value);
    expect(text('en', ['Alpha', 'Bravo'])).toBe('Alpha and Bravo');
    expect(text('en', ['Alpha', 'Bravo', 'Cairo'])).toBe('Alpha, Bravo, and Cairo');
    expect(text('ar', ['الفرع أ', 'Bravo', 'ج'])).toBe('الفرع أ، Bravo و ج');
    expect(text('ckb', ['A', 'B'])).toBe('A و B');
    expect(text('ar', ['A'])).toBe('A');
    expect(items('ar', ['الفرع أ', 'Bravo', 'ج'])).toEqual(['الفرع أ', 'Bravo', 'ج']);
    // The Latin comma never appears in an Arabic or Sorani list.
    expect(text('ar', ['A', 'B', 'C'])).not.toContain(', ');
  });
});

describe('the Arabic and Sorani expiry list is about batches that expire (expired AND expiring), not only expired ones', () => {
  it('says "expire", not "expired"', () => {
    expect(ar('pharmacy.reports.expiry.rows')).toBe('الدفعات التي تنتهي صلاحيتها');
    expect(ckb('pharmacy.reports.expiry.rows')).toBe('ئەو گروپانەی بەسەردەچن');
    expect(en('pharmacy.reports.expiry.rows')).toBe('Batches that expire');
  });
});
