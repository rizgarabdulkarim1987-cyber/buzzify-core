import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhRole } from '@/server/domain/pharmacy/permissions';

/**
 * The fast entry page's gate (Task 14): the receiving permission, a writable pharmacy and one branch. A role that may only
 * look at stock is sent to the stock list (the nav's Stock item opens this page for everyone); support is told why.
 */

const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: nav.redirect, notFound: vi.fn(), useRouter: () => ({}), usePathname: () => '/' }));
const access = vi.hoisted(() => ({ catalogAccess: vi.fn() }));
vi.mock('@/app/pharmacy/(app)/catalog/access', async (orig) => ({ ...(await orig<object>()), catalogAccess: access.catalogAccess }));
const invoke = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/server/studio/framework/invoke', () => invoke);
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));

const { default: StockEntryPage } = await import('@/app/pharmacy/(app)/stock/entry/page');
const { EntryScreen } = await import('@/app/pharmacy/_ui/entry/EntryScreen');

function accessFor(role: PhRole | null, opts: { branchId?: string | null; state?: 'open' | 'readOnly' } = {}) {
  const branchId = opts.branchId === undefined ? 'b1' : opts.branchId;
  return {
    actor: { role, userId: 'u1', restaurantId: 'r1', allBranches: role === 'OWNER', branchIds: ['b1'] },
    gate: null,
    placeInput: { restaurantId: 'r1', ...(branchId ? { branchId } : {}) },
    place: { branchId, branchName: branchId ? 'Main' : null },
    showCost: role === 'OWNER' || role === 'STOCK',
    writable: () => (role === null ? { ok: false, reason: 'support' } : opts.state === 'readOnly' ? { ok: false, reason: 'readOnly', until: '2026-12-01T00:00:00Z' } : { ok: true }),
  };
}

beforeEach(() => {
  nav.redirect.mockClear();
  invoke.query.mockReset();
});

describe('the fast entry page', () => {
  it('sends a role that may only look at stock to the stock list', async () => {
    for (const role of ['CASHIER', 'PHARMACIST'] as const) {
      access.catalogAccess.mockResolvedValueOnce(accessFor(role));
      await expect(StockEntryPage()).rejects.toThrow('REDIRECT /pharmacy/stock');
    }
    expect(invoke.query).not.toHaveBeenCalled();
  });

  it('tells support why, with a way to the stock list, and reads nothing', async () => {
    access.catalogAccess.mockResolvedValueOnce(accessFor(null));
    const html = renderToStaticMarkup((await StockEntryPage()) as ReactElement);
    expect(html).toContain('data-testid="entry-forbidden"');
    expect(html).toContain('href="/pharmacy/stock"');
    expect(invoke.query).not.toHaveBeenCalled();
  });

  it('asks for one branch when "All branches" is chosen', async () => {
    access.catalogAccess.mockResolvedValueOnce(accessFor('OWNER', { branchId: null }));
    const html = renderToStaticMarkup((await StockEntryPage()) as ReactElement);
    expect(html).toContain('data-testid="entry-pick-branch"');
    expect(invoke.query).not.toHaveBeenCalled();
  });

  it('gives a receiving role the screen with its price and cost rights, the open entry and every live supplier', async () => {
    invoke.query.mockImplementation(async (def: { name: string }, input: { cursor?: string }) => {
      if (def.name === 'ph.stock.entry.draft') return { draft: null };
      // Two pages of suppliers: the page reads them all.
      return input.cursor ? { items: [{ id: 's2', name: 'East' }], nextCursor: null } : { items: [{ id: 's1', name: 'Hakeem' }], nextCursor: 's1' };
    });
    access.catalogAccess.mockResolvedValueOnce(accessFor('STOCK'));
    const stock = await StockEntryPage();
    expect(isValidElement(stock) && stock.type).toBe(EntryScreen);
    expect((stock as ReactElement<Record<string, unknown>>).props).toMatchObject({ canChangePrice: false, canSeeCost: true, initialDraft: null, suppliers: [{ id: 's1', name: 'Hakeem' }, { id: 's2', name: 'East' }] });
    access.catalogAccess.mockResolvedValueOnce(accessFor('OWNER'));
    const owner = (await StockEntryPage()) as ReactElement<Record<string, unknown>>;
    expect(owner.props).toMatchObject({ canChangePrice: true, canSeeCost: true });
  });
});
