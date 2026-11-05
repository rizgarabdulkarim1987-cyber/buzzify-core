import { canPh, type PhPermission, type PhRole } from '@/server/domain/pharmacy/permissions';

export type PhNavKey =
  | 'home' | 'sell' | 'stock' | 'expiry' | 'reports' | 'doctor'
  | 'sales' | 'returns' | 'shifts' | 'prescriptions' | 'customers' | 'catalog'
  | 'receiving' | 'counts' | 'transfers' | 'movements' | 'purchasing' | 'labels'
  | 'chain' | 'assistant' | 'settings';

/** Lucide icon names (kebab-case) the shell maps to components. */
export type PhIconName =
  | 'house' | 'shopping-cart' | 'boxes' | 'clock' | 'chart-bar' | 'stethoscope'
  | 'receipt' | 'undo-2' | 'timer' | 'clipboard-list' | 'user-round' | 'pill'
  | 'truck' | 'clipboard-check' | 'arrow-left-right' | 'history' | 'shopping-bag'
  | 'tag' | 'network' | 'sparkles' | 'settings';

export interface PhNavItem {
  key: PhNavKey;
  href: string;
  labelKey: string;
  icon: PhIconName;
  badge?: 'lowStock' | 'expiring';
}

/** A nav item as the shell's client parts draw it: label already translated, counter already read. */
export interface PhShellLink {
  key: PhNavKey;
  href: string;
  label: string;
  icon: PhIconName;
  /** The counter pill (low stock, expiring); absent or 0 draws none. */
  count?: number;
}

interface Entry extends PhNavItem {
  /** Same condition the old Shell.tsx used for this link; a role is never null here. */
  allow: (role: PhRole, ctx: { branchCount: number }) => boolean;
}

const any = (...p: PhPermission[]) => (role: PhRole) => p.some((x) => canPh(role, x));

const PRIMARY: Entry[] = [
  { key: 'home', href: '/pharmacy/home', labelKey: 'pharmacy.nav.home', icon: 'house', allow: () => true },
  { key: 'sell', href: '/pharmacy/sell', labelKey: 'pharmacy.nav.sell', icon: 'shopping-cart', allow: any('shift.use') },
  { key: 'stock', href: '/pharmacy/stock', labelKey: 'pharmacy.nav.stock', icon: 'boxes', badge: 'lowStock', allow: any('catalog.view') },
  { key: 'expiry', href: '/pharmacy/stock/expiry', labelKey: 'pharmacy.nav.expiry', icon: 'clock', badge: 'expiring', allow: any('catalog.view') },
  { key: 'reports', href: '/pharmacy/reports', labelKey: 'pharmacy.nav.reports', icon: 'chart-bar', allow: any('report.view') },
];

const MORE: Entry[] = [
  { key: 'catalog', href: '/pharmacy/catalog', labelKey: 'pharmacy.nav.catalog', icon: 'pill', allow: () => true },
  { key: 'shifts', href: '/pharmacy/shifts', labelKey: 'pharmacy.nav.shifts', icon: 'timer', allow: any('shift.use', 'report.view') },
  { key: 'sales', href: '/pharmacy/sales', labelKey: 'pharmacy.nav.sales', icon: 'receipt', allow: any('shift.use', 'report.view') },
  { key: 'returns', href: '/pharmacy/returns', labelKey: 'pharmacy.nav.returns', icon: 'undo-2', allow: any('return.approve', 'report.view') },
  { key: 'prescriptions', href: '/pharmacy/prescriptions', labelKey: 'pharmacy.nav.prescriptions', icon: 'clipboard-list', allow: any('rx.dispense') },
  { key: 'customers', href: '/pharmacy/customers', labelKey: 'pharmacy.nav.customers', icon: 'user-round', allow: any('customer.manage', 'credit.sell') },
  { key: 'counts', href: '/pharmacy/stock/counts', labelKey: 'pharmacy.nav.counts', icon: 'clipboard-check', allow: any('stock.count') },
  { key: 'receiving', href: '/pharmacy/stock/receive', labelKey: 'pharmacy.nav.receiving', icon: 'truck', allow: any('purchase.manage') },
  { key: 'transfers', href: '/pharmacy/stock/transfers', labelKey: 'pharmacy.nav.transfers', icon: 'arrow-left-right', allow: any('transfer.manage') },
  { key: 'purchasing', href: '/pharmacy/purchasing', labelKey: 'pharmacy.nav.purchasing', icon: 'shopping-bag', allow: any('purchase.manage') },
  { key: 'movements', href: '/pharmacy/stock/movements', labelKey: 'pharmacy.nav.movements', icon: 'history', allow: any('report.view') },
  { key: 'assistant', href: '/pharmacy/assistant', labelKey: 'pharmacy.nav.assistant', icon: 'sparkles', allow: any('catalog.view') },
  { key: 'labels', href: '/pharmacy/print/labels', labelKey: 'pharmacy.nav.labels', icon: 'tag', allow: any('catalog.view') },
  {
    key: 'chain', href: '/pharmacy/chain', labelKey: 'pharmacy.nav.chain', icon: 'network',
    allow: (role, ctx) => canPh(role, 'report.view') && ctx.branchCount > 1,
  },
  { key: 'settings', href: '/pharmacy/settings', labelKey: 'pharmacy.nav.settings', icon: 'settings', allow: (role) => role === 'OWNER' || role === 'BRANCH_MANAGER' || role === 'PHARMACIST_IN_CHARGE' || role === 'PHARMACIST' },
];

const DOCTOR: PhNavItem = { key: 'doctor', href: '/pharmacy/doctor', labelKey: 'pharmacy.nav.doctor', icon: 'stethoscope' };

const strip = ({ key, href, labelKey, icon, badge }: Entry): PhNavItem => ({ key, href, labelKey, icon, ...(badge ? { badge } : {}) });

/** The places this role may open: a short primary row and the rest under "more". `null` (support) sees home only. */
export function phNav(
  role: PhRole | null,
  opts: { branchCount: number; doctorEnabled: boolean },
): { primary: PhNavItem[]; more: PhNavItem[] } {
  if (role === null) return { primary: [strip(PRIMARY[0])], more: [] };
  const ok = (e: Entry) => e.allow(role, opts);
  const primary = PRIMARY.filter(ok).map(strip);
  if (opts.doctorEnabled) primary.push({ ...DOCTOR });
  return { primary, more: MORE.filter(ok).map(strip) };
}

const ALL: PhNavItem[] = [...PRIMARY, ...MORE, { ...DOCTOR }];

/** The nav place a pathname belongs to: the longest matching href prefix, on segment boundaries. */
export function phActiveKey(pathname: string): PhNavKey | null {
  let best: PhNavItem | null = null;
  for (const item of ALL) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ? best.key : null;
}
