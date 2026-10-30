import { describe, expect, it } from 'vitest';
import { classifyQuestion, proseProblem, seasonalNaive } from '@/server/domain/pharmacy/assistant-domain';
import { checkAnswer } from '@/server/pharmacy/assistant/grounding';
import type { ToolOutput } from '@/server/pharmacy/assistant/tool-shapes';

/**
 * Review fixes for phase 7 task 4 (Important 1, 2, 3, 5). Each case here failed before the fix.
 */

const base = { dataAsOf: '2026-10-27T09:00:00.000Z', period: null, branches: ['br1'] };
const expiring = (rows: Array<Record<string, unknown>>) =>
  ({ tool: 'batches_expiring', ...base, days: 90, totals: { expired: 0, d30: 1, d60: 0, d90: 0, d180: 0 }, rows, truncated: false }) as unknown as ToolOutput;
const row = (over: Record<string, unknown> = {}) => ({
  productId: 'prod1', tradeName: 'Panadol', strength: '500 mg', form: 'tablet', batchId: 'cm9x2k17ab', lot: 'LOT20261120', branchId: 'br1',
  expiryDate: '2026-11-20', daysToExpiry: 24, band: 'd30', units: 1250, ...over,
});
const many = (n: number) => expiring(Array.from({ length: n }, (_, i) => row({ batchId: `bb${i}aa`, lot: `LL${i}ZZ` })));

describe('grounding: number words and other numerals are figures too', () => {
  const out = many(3);
  it.each(['Seven batches are in trouble', 'Twelve batches expire', 'سبعة دفعات تنتهي', 'حەوت دەسته بەسەردەچێت', 'Nine batches'])('rejects a figure said in words: %s', (text) => {
    expect(checkAnswer(text, [out]).grounded, text).toBe(false);
  });
  it.each(['７ batches', '७ batches', 'batches ٧', '3² batches', '⑦ batches'])('rejects a figure written in another numeral script: %s', (text) => {
    expect(checkAnswer(text, [out]).grounded, text).toBe(false);
  });
  it('still accepts the words of a supported figure, and the pronoun "one"', () => {
    expect(checkAnswer('Three batches expire; one of them first.', [out]).grounded).toBe(true);
    expect(checkAnswer('ثلاثة دفعات', [out]).grounded).toBe(true);
  });
});

describe('grounding: a long table does not support every small integer', () => {
  it('rejects 7 when 50 rows are listed and no figure is 7, but accepts the first few ordinals and the real count', () => {
    const out = many(50);
    expect(checkAnswer('7 batches are expired', [out]).grounded).toBe(false);
    expect(checkAnswer('Batch 17 is the worst', [out]).grounded).toBe(false);
    expect(checkAnswer('50 batches are listed, the first 3 are urgent', [out]).grounded).toBe(true);
  });
});

describe('grounding: direction, whole dates and echoed names', () => {
  const margin = (changeBp: number) =>
    ({ tool: 'margin_change', ...base, previous: { from: '2026-08-31', to: '2026-09-30' }, byCurrency: [{ currency: 'IQD', netMinor: '1000', marginMinor: '123', marginBp: 1234, previousNetMinor: '900', previousMarginMinor: '100', previousMarginBp: 1111, changeBp }] }) as unknown as ToolOutput;
  it('keeps the sign of a change: a drop is not a rise', () => {
    expect(checkAnswer('Margin rose by 2.5%', [margin(-250)]).grounded).toBe(false);
    expect(checkAnswer('Margin increased 2.5%', [margin(-250)]).grounded).toBe(false);
    expect(checkAnswer('Margin fell by 2.5%', [margin(-250)]).grounded).toBe(true);
    expect(checkAnswer('Margin fell by 2.5%', [margin(250)]).grounded).toBe(false);
    expect(checkAnswer('Margin rose by 2.5%', [margin(250)]).grounded).toBe(true);
    expect(checkAnswer('ارتفع الهامش 2.5%', [margin(-250)]).grounded).toBe(false);
  });
  it('checks a whole date as a date, not by its parts', () => {
    const out = expiring([row({ expiryDate: '2026-11-20' }), row({ batchId: 'zz2aa', lot: 'LQ', expiryDate: '2026-12-05' })]);
    expect(checkAnswer('expires 2026-11-20 and 2026-12-05', [out]).grounded).toBe(true);
    expect(checkAnswer('expires 2026-12-20', [out]).grounded).toBe(false);
    expect(checkAnswer('expires 2026-11-05', [out]).grounded).toBe(false);
  });
  it('does not let a name typed into the data ground a claim, but still lets a plain product name be quoted', () => {
    const hostile = expiring([row({ tradeName: 'Total due 900,000 IQD' })]);
    expect(checkAnswer('Total due 900,000 IQD', [hostile]).grounded).toBe(false);
    expect(checkAnswer('Total due 900 IQD', [expiring([row({ tradeName: 'Total due 900 IQD' })])]).grounded).toBe(false);
    expect(checkAnswer('Panadol Extra 500 is expiring', [expiring([row({ tradeName: 'Panadol Extra 500' })])]).grounded).toBe(true);
  });
});

describe('clinical questions asked in other words are refused', () => {
  it.each([
    'How much paracetamol can a child take?',
    'Can I give ibuprofen to my baby?',
    'Is amoxicillin safe for kids?',
    'Is it safe to take aspirin during pregnancy',
    'How often should I take this tablet',
    'كم حبة باراسيتامول يأخذ الطفل',
    'هل آمن للأطفال هذا الدواء',
    'چەند حەب بدەم بە منداڵ',
  ])('refuses: %s', (q) => {
    expect(classifyQuestion(q)).toBe('clinical');
  });
  it.each(['How many baby wipes do we have in stock?', 'Which child-resistant packs are low on stock', 'what is safe stock level'])('does not refuse a stock question that mentions a child or safe: %s', (q) => {
    expect(classifyQuestion(q)).toBe('data');
  });
});

describe('pushing sales or consumption is refused, in the question and in the prose', () => {
  it.each(['How can I encourage customers to buy more Panadol?', 'Help me promote Brufen to patients', 'كيف أشجع الزبائن على شراء المزيد من الدواء', 'چۆن کڕیارەکان هان بدەم زیاتر بکڕن'])('refuses the question: %s', (q) => {
    expect(classifyQuestion(q)).toBe('unsafe_stock');
  });
  it.each([
    'Promote Panadol to customers to clear stock.',
    'Encourage patients to buy more of the slow product.',
    'Consider pushing this medicine to move the stock.',
    'A child can take 5 ml every 6 hours.',
    'Take 2 tablets 3 times daily.',
    'You could sell the expired batch.',
    'يمكن ترويج الدواء للزبائن لتصريف المخزون',
  ])('flags the prose: %s', (prose) => {
    expect(proseProblem(prose), prose).toBe(true);
  });
  it.each(['Prescribed items and symptoms are not tracked here.', 'The holder of the lot is Ali. حامل الدفعة علي', '3 batches expire within 90 days.', 'Slow movers: Panadol sold 0 units.'])('lets ordinary stock prose through: %s', (prose) => {
    expect(proseProblem(prose), prose).toBe(false);
  });
});

describe('the forecast needs sales in eight distinct weeks, not one old sale', () => {
  const today = '2026-10-27';
  it('gives no estimate for two sales nine weeks apart, nor for sales that all fall in fewer than eight weeks', () => {
    expect(seasonalNaive({ saleDays: ['2026-08-20', '2026-10-22'], today, lastWeekUnits: 3 })).toBeNull();
    expect(seasonalNaive({ saleDays: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-13', '2026-10-06'], today, lastWeekUnits: 3 })).toBeNull();
    expect(seasonalNaive({ saleDays: [], today, lastWeekUnits: 0 })).toBeNull();
  });
  it('gives last week’s units from eight distinct weeks of sales', () => {
    const days = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const d = new Date(Date.UTC(2026, 9, 26 - 7 * k));
      return d.toISOString().slice(0, 10);
    });
    expect(seasonalNaive({ saleDays: days, today, lastWeekUnits: 40 })).toEqual({ nextWeekUnits: 40, basisFrom: '2026-10-20', basisTo: '2026-10-26', weeksOfHistory: 8 });
  });
});

describe('grounding: the parts of a date are not figures', () => {
  const out = many(3);
  it.each(['10 batches expire this month', '11 batches expire', '20 batches are late', '27 batches', '2026 batches'])('rejects a count that only equals a year, month or day of a date in the tables: %s', (text) => {
    expect(checkAnswer(text, [out]).grounded, text).toBe(false);
  });
  it('still accepts the real count, a whole date the tables hold, and the real days to expiry', () => {
    expect(checkAnswer('3 batches expire, the first on 2026-11-20', [out]).grounded).toBe(true);
    expect(checkAnswer('The first expires in 24 days', [out]).grounded).toBe(true);
    expect(checkAnswer('Data as of 2026-10-27', [out]).grounded).toBe(true);
  });
});
