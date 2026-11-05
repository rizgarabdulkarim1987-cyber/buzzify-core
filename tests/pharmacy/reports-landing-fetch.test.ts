import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the reports landing reads (pharmacy redesign, task 10): the home figures for the chart, the sales report of the same days (by
 * product, in the primary currency, five rows) for the cards and the top products, and the margin only for a role with `profit.view`
 * and `cost.view`. A role without `report.view` reads nothing at all.
 */
const state = vi.hoisted(() => ({ role: 'OWNER' as string | null }));
const calls = vi.hoisted(() => ({
  sales: vi.fn(async () => ({ ok: true, data: { totals: [], rows: [], labels: { branch: {}, product: {}, category: {}, user: {} } } })),
  margin: vi.fn(async () => ({ ok: true, data: { totals: [] } })),
  other: vi.fn(async () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } })),
  home: vi.fn(async () => ({ currency: 'IQD', salesVisible: true, salesToday: 0, salesYesterday: 0, invoicesToday: 0, lowStock: 0, expiring90: 0, series: [], attention: [], otherCurrencies: false })),
}));

vi.mock('@/app/pharmacy/_actions/reports', () => ({
  salesReport: calls.sales,
  marginReport: calls.margin,
  returnsReport: calls.other,
  discountsReport: calls.other,
  stockValuationReport: calls.other,
  expiryReport: calls.other,
  damagedReport: calls.other,
  transfersReport: calls.other,
  lowStockReport: calls.other,
  chainDashboard: calls.other,
  exportReport: calls.other,
}));
vi.mock('@/server/pharmacy/home', () => ({ getHomeFigures: calls.home }));
vi.mock('@/server/pharmacy/actor', () => {
  const actor = () => ({ restaurantId: 'r1', role: state.role, branchIds: ['b1'], locale: 'en', userId: 'u1', support: null });
  return {
    getPhAccess: async () => ({ signedIn: true, actor: actor(), gate: { state: 'open' }, place: { restaurantId: 'r1', branchId: 'b1', branchName: 'Main' } }),
    currentPhPlaceInput: async () => ({ restaurantId: 'r1' }),
    getPhBranches: async () => [],
  };
});
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));

const { default: ReportsIndexPage } = await import('@/app/pharmacy/(app)/reports/page');

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockClear();
});

describe('the reports landing', () => {
  it('reads the chart for every branch of the person and the sales report of the same period, never the margin without profit.view', async () => {
    state.role = 'PHARMACIST_IN_CHARGE';
    await ReportsIndexPage({ searchParams: Promise.resolve({ period: '30d' }) });
    expect(calls.home).toHaveBeenCalledWith(expect.objectContaining({ branchId: null, period: '30d' }));
    expect(calls.sales).toHaveBeenCalledTimes(1);
    expect(calls.sales).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'product', currency: 'IQD', take: 5 }));
    expect(calls.margin).not.toHaveBeenCalled();
  });

  it('reads the margin of the same days for a role with profit.view and cost.view', async () => {
    state.role = 'OWNER';
    await ReportsIndexPage({ searchParams: Promise.resolve({}) });
    const [salesInput] = calls.sales.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(calls.margin).toHaveBeenCalledWith(expect.objectContaining({ from: salesInput.from, to: salesInput.to, currency: 'IQD' }));
  });

  it('reads nothing for a role without report.view', async () => {
    state.role = 'CASHIER';
    await ReportsIndexPage({ searchParams: Promise.resolve({}) });
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });
});
