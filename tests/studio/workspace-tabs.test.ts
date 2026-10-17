import { describe, expect, it } from 'vitest';
import { effectivePermissions, parsePolicy } from '@/server/domain/permissions';
import { visibleTabs, WORKSPACE_TABS, type WorkspaceTab } from '@/studio/workspace/tabs';

const ALL_BUILT = new Set(WORKSPACE_TABS.map((tab) => tab.key));
const keys = (tabs: WorkspaceTab[]) => tabs.map((tab) => tab.key);

describe('the menu workspace tabs', () => {
  it('lists the nine tabs of spec 10.3 in order, Content at the menu address itself', () => {
    expect(keys([...WORKSPACE_TABS])).toEqual(['content', 'prices', 'availability', 'brand', 'settings', 'qr', 'data', 'revisions', 'preview']);
    expect(WORKSPACE_TABS[0]!.path).toBe('');
    expect(WORKSPACE_TABS.find((tab) => tab.key === 'preview')!.path).toBe('/preview');
  });

  it('shows an owner Content, Prices, Availability, Revisions and Preview', () => {
    const owner = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: {} });
    expect(keys(visibleTabs(owner, ALL_BUILT))).toEqual(['content', 'prices', 'availability', 'revisions', 'preview']);
  });

  it('shows a designer every tab, and hides Brand when the client revokes brand.edit', () => {
    const designer = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: {} });
    expect(keys(visibleTabs(designer, ALL_BUILT))).toEqual([...ALL_BUILT]);
    const restricted = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: parsePolicy({ DESIGNER: { grant: [], revoke: ['brand.edit'] } }) });
    expect(keys(visibleTabs(restricted, ALL_BUILT))).not.toContain('brand');
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
