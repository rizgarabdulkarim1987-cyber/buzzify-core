import { describe, expect, it } from 'vitest';
import { landingFigures, landingRange } from '@/app/pharmacy/_ui/reports-logic';

// 2026-10-27 09:00 UTC is 12:00 in Baghdad.
const NOW = new Date('2026-10-27T09:00:00.000Z');

describe('the reports landing period', () => {
  it('covers the same days as the chart: 7 and 30 days ending today, 12 months from the first of the 11th month back', () => {
    expect(landingRange('7d', NOW)).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(landingRange('30d', NOW)).toEqual({ from: '2026-09-28', to: '2026-10-27' });
    expect(landingRange('12m', NOW)).toEqual({ from: '2025-11-01', to: '2026-10-27' });
  });

  it('follows the Baghdad day: 22:30 UTC is already the next day there', () => {
    expect(landingRange('7d', new Date('2026-10-27T22:30:00.000Z'))).toEqual({ from: '2026-10-22', to: '2026-10-28' });
  });
});

const totals = (currency: 'IQD' | 'USD', over: Record<string, unknown> = {}) => ({
  currency,
  count: 4,
  grossMinor: '1100',
  discountMinor: '100',
  roundingMinor: '0',
  salesMinor: '1000',
  refundsMinor: '150',
  refundCount: 1,
  netMinor: '850',
  avgTicketMinor: '250',
  ...over,
});

describe('the reports landing figures', () => {
  it('reads the primary currency only, and the profit only when the margin was read', () => {
    const sales = { totals: [totals('IQD'), totals('USD', { count: 9, salesMinor: '77' })] };
    expect(landingFigures(sales, null, 'IQD')).toEqual({ salesMinor: '1000', invoices: 4, refundsMinor: '150', refundCount: 1, profitMinor: null });
    const margin = { totals: [{ currency: 'USD' as const, netMinor: '1', costMinor: '1', marginMinor: '5', marginBp: 1 }, { currency: 'IQD' as const, netMinor: '850', costMinor: '600', marginMinor: '250', marginBp: 2941 }] };
    expect(landingFigures(sales, margin, 'IQD').profitMinor).toBe('250');
    expect(landingFigures(sales, margin, 'USD')).toMatchObject({ salesMinor: '77', invoices: 9, profitMinor: '5' });
  });

  it('is zero, not missing, in a period with no sales; a margin with no IQD line is a zero profit', () => {
    expect(landingFigures({ totals: [] }, { totals: [] }, 'IQD')).toEqual({ salesMinor: '0', invoices: 0, refundsMinor: '0', refundCount: 0, profitMinor: '0' });
  });
});
