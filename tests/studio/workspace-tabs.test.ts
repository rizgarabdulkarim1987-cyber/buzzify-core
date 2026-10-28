import { describe, expect, it } from 'vitest';
import { effectivePermissions, parsePolicy } from '@/server/domain/permissions';
import { visibleTabs, WORKSPACE_TABS, type WorkspaceTab } from '@/studio/workspace/tabs';

const ALL_BUILT = new Set(WORKSPACE_TABS.map((tab) => tab.key));
const keys = (tabs: WorkspaceTab[]) => tabs.map((tab) => tab.key);

describe('the menu workspace tabs', () => {
  it('lists the tabs in order (spec 10.3 and the Sales tab), Design (template studio) before Brand and Motion after it, Content at the menu address itself', () => {
    expect(keys([...WORKSPACE_TABS])).toEqual(['content', 'prices', 'availability', 'sales', 'design', 'brand', 'motion', 'about', 'settings', 'qr', 'data', 'revisions', 'preview']);
    expect(WORKSPACE_TABS.find((tab) => tab.key === 'motion')).toMatchObject({ path: '/motion', needs: ['brand.edit'] });
    expect(WORKSPACE_TABS[0]!.path).toBe('');
    expect(WORKSPACE_TABS.find((tab) => tab.key === 'preview')!.path).toBe('/preview');
  });

  it('shows the About tab to anyone who may edit content, labelled in all three Studio languages', async () => {
    const owner = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: {} });
    expect(keys(visibleTabs(owner, new Set(['about'] as const)))).toEqual(['about']);
    expect(WORKSPACE_TABS.find((tab) => tab.key === 'about')).toMatchObject({ path: '/about', labelKey: 'workspace.tab.about', needs: ['content.edit'] });
    const { default: en } = await import('@/studio/messages/en');
    const { default: ar } = await import('@/studio/messages/ar');
    const { default: ckb } = await import('@/studio/messages/ckb');
    for (const catalog of [en, ar, ckb]) expect(catalog['workspace.tab.about']).toBeTruthy();
  });

  it('shows an owner Content, Prices, Availability, Sales, About, Revisions and Preview', () => {
    const owner = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: {} });
    expect(keys(visibleTabs(owner, ALL_BUILT))).toEqual(['content', 'prices', 'availability', 'sales', 'about', 'revisions', 'preview']);
  });

  it('hides Sales without content.edit', () => {
    const noEdit = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: parsePolicy({ OWNER: { grant: [], revoke: ['content.edit'] } }) });
    expect(keys(visibleTabs(noEdit, ALL_BUILT))).not.toContain('sales');
    expect(WORKSPACE_TABS.find((tab) => tab.key === 'sales')!.path).toBe('/sales');
  });

  it('shows a designer every tab, and hides Design, Brand and Motion when the client revokes brand.edit', () => {
    const designer = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: {} });
    expect(keys(visibleTabs(designer, ALL_BUILT))).toEqual([...ALL_BUILT]);
    const restricted = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: parsePolicy({ DESIGNER: { grant: [], revoke: ['brand.edit'] } }) });
    expect(keys(visibleTabs(restricted, ALL_BUILT))).not.toContain('brand');
    expect(keys(visibleTabs(restricted, ALL_BUILT))).not.toContain('design');
    expect(keys(visibleTabs(restricted, ALL_BUILT))).not.toContain('motion');
  });

  it('shows Prices to someone who may change prices only in bulk', () => {
    const bulkOnly = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: parsePolicy({ OWNER: { grant: [], revoke: ['content.prices'] } }) });
    expect(keys(visibleTabs(bulkOnly, ALL_BUILT))).toContain('prices');
  });

  it('shows only the tabs that exist yet', () => {
    const admin = effectivePermissions({ isSuperAdmin: true, role: null, policy: {} });
    expect(keys(visibleTabs(admin, new Set(['content', 'preview'] as const)))).toEqual(['content', 'preview']);
  });
});
