import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The report screens fetch NOTHING for a person who may not see them (phase 6, task 6). The page returns the blocked state before any read:
 * the report wrappers and the branch list are never called for a role without `report.view`, and for the margin they are not called without
 * `profit.view` and `cost.view`. (The end-to-end suite shows the same on screen; this proves the calls, which a browser cannot see.)
 */
const state = vi.hoisted(() => ({ role: 'CASHIER' as string | null }));
const fetched = vi.hoisted(() => vi.fn(async () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } })));
const branches = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@/app/pharmacy/_actions/reports', () => ({
  salesReport: fetched,
  returnsReport: fetched,
  discountsReport: fetched,
  marginReport: fetched,
  stockValuationReport: fetched,
  expiryReport: fetched,
  damagedReport: fetched,
  transfersReport: fetched,
  lowStockReport: fetched,
  chainDashboard: fetched,
  exportReport: fetched,
}));
vi.mock('@/server/pharmacy/actor', () => {
  const actor = () => ({ restaurantId: 'r1', role: state.role, branchIds: ['b1', 'b2'], locale: 'en', userId: 'u1', support: null });
  return {
    getPhAccess: async () => ({ signedIn: true, actor: actor(), gate: { state: 'open' }, place: { restaurantId: 'r1', branchId: null, branchName: null } }),
    currentPhPlaceInput: async () => ({ restaurantId: 'r1' }),
    getPhBranches: branches,
  };
});
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));

const { default: ReportPage } = await import('@/app/pharmacy/(app)/reports/[report]/page');
const { default: ReportsIndexPage } = await import('@/app/pharmacy/(app)/reports/page');
const { default: ChainPage } = await import('@/app/pharmacy/(app)/chain/page');

const SLUGS = ['sales', 'returns', 'discounts', 'margin', 'stock-valuation', 'expiry', 'damaged', 'transfers', 'low-stock'];
/** The `data-testid`s of an element tree (props and children only: the element types are components and may be circular). */
function text(node: unknown): string {
  const ids: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object' || n === null || !('props' in n)) return;
    const props = (n as { props: Record<string, unknown> }).props;
    if (typeof props['data-testid'] === 'string') ids.push(props['data-testid']);
    for (const value of Object.values(props)) walk(value);
  };
  walk(node);
  return ids.join(' ');
}
const page = (slug: string) => ReportPage({ params: Promise.resolve({ report: slug }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  fetched.mockClear();
  branches.mockClear();
});

describe('a role without report.view', () => {
  it.each(['CASHIER', 'PHARMACIST', 'STOCK'])('%s sees the blocked state on the index, every report and the chain, and nothing is read', async (role) => {
    state.role = role;
    expect(text(await ReportsIndexPage())).toContain('reports-forbidden');
    for (const slug of SLUGS) expect(text(await page(slug)), `${role} ${slug}`).toContain('reports-forbidden');
    expect(text(await ChainPage({ searchParams: Promise.resolve({}) }))).toContain('reports-forbidden');
    expect(fetched).not.toHaveBeenCalled();
    expect(branches).not.toHaveBeenCalled();
  });

  it('a support actor (no role) is blocked the same way', async () => {
    state.role = null;
    for (const slug of SLUGS) expect(text(await page(slug))).toContain('reports-forbidden');
    expect(fetched).not.toHaveBeenCalled();
    expect(branches).not.toHaveBeenCalled();
  });
});

describe('the margin without its two permissions', () => {
  it('a pharmacist in charge (report.view, no profit.view) sees the gated state and nothing is read for the margin', async () => {
    state.role = 'PHARMACIST_IN_CHARGE';
    expect(text(await page('margin'))).toContain('report-gated');
    expect(fetched).not.toHaveBeenCalled();
    expect(branches).not.toHaveBeenCalled();
  });
  it('the same role does read the reports it may see (the check above is not a mock that never answers)', async () => {
    state.role = 'PHARMACIST_IN_CHARGE';
    await page('sales');
    expect(branches).toHaveBeenCalled();
    expect(fetched).toHaveBeenCalled();
  });
});
