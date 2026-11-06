import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PhNavItem, PhShellLink } from '@/app/pharmacy/_ui/nav';
import { PH_ROLES } from '@/server/domain/pharmacy/permissions';

vi.mock('next/navigation', () => ({ usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));

const { phNav, PH_STOCK_HREF } = await import('@/app/pharmacy/_ui/nav');
const { Rail } = await import('@/app/pharmacy/_ui/Rail');

const opts = { branchCount: 2, doctorEnabled: false };
const keys = (items: { key: string }[]) => items.map((i) => i.key);

// Every place the old navigation reached for an owner, route unchanged.
const OLD_ROUTES = [
  '/pharmacy/home', '/pharmacy/sell', '/pharmacy/stock', '/pharmacy/stock/expiry', '/pharmacy/reports', '/pharmacy/catalog',
  '/pharmacy/shifts', '/pharmacy/sales', '/pharmacy/returns', '/pharmacy/prescriptions', '/pharmacy/customers',
  '/pharmacy/stock/counts', '/pharmacy/stock/receive', '/pharmacy/stock/transfers', '/pharmacy/purchasing',
  '/pharmacy/stock/movements', '/pharmacy/assistant', '/pharmacy/print/labels', '/pharmacy/chain', '/pharmacy/settings',
];

describe('simplified pharmacy navigation', () => {
  it('has exactly five primary places in order', () => {
    expect(keys(phNav('OWNER', opts).primary)).toEqual(['sell', 'stock', 'catalog', 'customers', 'reports']);
  });

  it('adds the AI Doctor right after Reports only when enabled', () => {
    expect(keys(phNav('OWNER', { ...opts, doctorEnabled: true }).primary)).toEqual(['sell', 'stock', 'catalog', 'customers', 'reports', 'doctor']);
    expect(keys(phNav('OWNER', opts).primary)).not.toContain('doctor');
  });

  it('points Stock at one constant: the fast entry screen', () => {
    expect(PH_STOCK_HREF).toBe('/pharmacy/stock/entry');
    expect(phNav('OWNER', opts).primary.find((i) => i.key === 'stock')?.href).toBe(PH_STOCK_HREF);
  });

  it('keeps every previously reachable route reachable', () => {
    const nav = phNav('OWNER', { ...opts, doctorEnabled: true });
    const hrefs = new Set([...nav.primary, ...nav.more].map((i) => i.href));
    for (const route of OLD_ROUTES) expect(hrefs, route).toContain(route);
  });

  it('groups More under Daily, Stock and Purchasing, with the same items as the flat list', () => {
    const nav = phNav('OWNER', opts);
    expect(nav.groups.map((g) => g.key)).toEqual(['daily', 'stock', 'purchasing']);
    expect(nav.groups.map((g) => g.labelKey)).toEqual(['pharmacy.nav.group.daily', 'pharmacy.nav.group.stock', 'pharmacy.nav.group.purchasing']);
    expect(keys(nav.groups.flatMap((g) => g.items))).toEqual(keys(nav.more));
    expect(keys(nav.more)).not.toEqual(expect.arrayContaining(['sell']));
  });

  it('keeps the stock badge on Stock and moves the expiry badge into More', () => {
    const nav = phNav('OWNER', opts);
    expect(nav.primary.find((i) => i.key === 'stock')?.badge).toBe('lowStock');
    expect(nav.more.find((i) => i.key === 'expiry')?.badge).toBe('expiring');
  });

  it('keeps role-hidden places hidden and drops empty groups', () => {
    for (const role of PH_ROLES) {
      const nav = phNav(role, opts);
      const all = keys([...nav.primary, ...nav.more]);
      if (role === 'CASHIER') for (const k of ['reports', 'purchasing', 'settings', 'receiving']) expect(all).not.toContain(k);
      for (const g of nav.groups) expect(g.items.length).toBeGreaterThan(0);
    }
    expect(keys(phNav('CASHIER', opts).primary)).not.toContain('reports');
  });

  it('gives support (null role) home only, no More', () => {
    const nav = phNav(null, opts);
    expect(keys(nav.primary)).toEqual(['home']);
    expect(nav.more).toEqual([]);
    expect(nav.groups).toEqual([]);
  });

  it('draws the rail with the More count and group headings', () => {
    const nav = phNav('OWNER', opts);
    const link = (i: PhNavItem): PhShellLink => ({ key: i.key, href: i.href, label: `L-${i.key}`, icon: i.icon });
    const html = renderToStaticMarkup(
      createElement(Rail, {
        primary: nav.primary.map(link),
        groups: nav.groups.map((g) => ({ key: g.key, label: `G-${g.key}`, links: g.items.map(link) })),
        navLabel: 'nav',
        moreLabel: 'More',
        moreCount: 4,
      }),
    );
    expect(html).toContain('G-daily');
    expect(html).toContain('G-stock');
    expect(html).toContain('G-purchasing');
    expect(html).toMatch(/More[\s\S]*?>4</);
  });
});
