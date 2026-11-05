import { describe, expect, it } from 'vitest';
import { phActiveKey, phNav } from '@/app/pharmacy/_ui/nav';
import { PH_ROLES } from '@/server/domain/pharmacy/permissions';

const opts = { branchCount: 2, doctorEnabled: false };
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('phNav', () => {
  it('gives an owner the five primary places', () => {
    expect(keys(phNav('OWNER', opts).primary)).toEqual(['home', 'sell', 'stock', 'expiry', 'reports']);
  });

  it('ends with doctor when the AI doctor is enabled', () => {
    const primary = phNav('OWNER', { ...opts, doctorEnabled: true }).primary;
    expect(keys(primary).at(-1)).toBe('doctor');
  });

  it('badges stock and expiry', () => {
    const p = phNav('OWNER', opts).primary;
    expect(p.find((i) => i.key === 'stock')?.badge).toBe('lowStock');
    expect(p.find((i) => i.key === 'expiry')?.badge).toBe('expiring');
  });

  it('hides reports, purchasing and settings from a cashier', () => {
    const all = keys([...phNav('CASHIER', opts).primary, ...phNav('CASHIER', opts).more]);
    expect(all).not.toContain('reports');
    expect(all).not.toContain('purchasing');
    expect(all).not.toContain('settings');
  });

  it('gives support (null role) home only', () => {
    expect(keys(phNav(null, opts).primary)).toEqual(['home']);
    expect(phNav(null, opts).more).toEqual([]);
  });

  it('shows chain only with more than one branch', () => {
    const more = (n: number) => keys(phNav('OWNER', { ...opts, branchCount: n }).more);
    expect(more(1)).not.toContain('chain');
    expect(more(2)).toContain('chain');
  });

  it('shows settings to owner, branch manager and the pharmacists (who see only the dollar rate)', () => {
    for (const role of PH_ROLES) {
      const has = keys(phNav(role, opts).more).includes('settings');
      expect(has).toBe(role === 'OWNER' || role === 'BRANCH_MANAGER' || role === 'PHARMACIST_IN_CHARGE' || role === 'PHARMACIST');
    }
  });

  it('keeps every key once and every label under pharmacy.nav.', () => {
    for (const role of [...PH_ROLES, null]) {
      const { primary, more } = phNav(role, { branchCount: 3, doctorEnabled: true });
      const all = [...primary, ...more];
      expect(new Set(keys(all)).size).toBe(all.length);
      for (const i of all) expect(i.labelKey.startsWith('pharmacy.nav.')).toBe(true);
    }
  });
});

describe('phActiveKey', () => {
  it.each([
    ['/pharmacy/stock/expiry', 'expiry'],
    ['/pharmacy/stock/counts/x', 'counts'],
    ['/pharmacy/stock', 'stock'],
    ['/pharmacy/catalog/new', 'catalog'],
    ['/pharmacy/home', 'home'],
    ['/pharmacy/print/labels', 'labels'],
    ['/pharmacy/unknown', null],
    ['/pharmacy/stocks', null],
  ])('%s -> %s', (path, key) => {
    expect(phActiveKey(path)).toBe(key);
  });
});
