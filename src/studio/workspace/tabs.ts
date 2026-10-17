import type { Permission } from '@/server/domain/permissions';

/**
 * The tabs of a menu's workspace (spec 10.3), in order. A tab shows when the person holds any of the permissions it
 * needs (`view`: anyone who may open the menu), and is hidden, never disabled, otherwise (spec 10.1).
 */

export type WorkspaceTabKey = 'content' | 'prices' | 'availability' | 'brand' | 'settings' | 'qr' | 'data' | 'revisions' | 'preview';

export interface WorkspaceTab {
  key: WorkspaceTabKey;
  /** Under `/studio/menus/{id}`: `''` for Content, the menu's own address. */
  path: string;
  labelKey: string;
  /** `view`, or the permissions of which any one shows the tab. */
  needs: 'view' | readonly Permission[];
}

export const WORKSPACE_TABS: readonly WorkspaceTab[] = [
  { key: 'content', path: '', labelKey: 'workspace.tab.content', needs: ['content.edit'] },
  { key: 'prices', path: '/prices', labelKey: 'workspace.tab.prices', needs: ['content.prices', 'prices.bulk'] },
  { key: 'availability', path: '/availability', labelKey: 'workspace.tab.availability', needs: ['content.availability'] },
  { key: 'brand', path: '/brand', labelKey: 'workspace.tab.brand', needs: ['brand.edit'] },
  { key: 'settings', path: '/settings', labelKey: 'workspace.tab.settings', needs: ['menu.settings'] },
  { key: 'qr', path: '/qr', labelKey: 'workspace.tab.qr', needs: ['qr.manage'] },
  { key: 'data', path: '/data', labelKey: 'workspace.tab.data', needs: ['import.run', 'export.run'] },
  { key: 'revisions', path: '/revisions', labelKey: 'workspace.tab.revisions', needs: 'view' },
  { key: 'preview', path: '/preview', labelKey: 'workspace.tab.preview', needs: 'view' },
];

/** The tabs whose pages exist so far; each part of the workspace adds its own when it ships. */
export const BUILT_TABS: ReadonlySet<WorkspaceTabKey> = new Set<WorkspaceTabKey>(['content', 'preview']);

/** The tabs a person sees: built, and allowed to them. */
export function visibleTabs(permissions: ReadonlySet<Permission>, built: ReadonlySet<WorkspaceTabKey> = BUILT_TABS): WorkspaceTab[] {
  return WORKSPACE_TABS.filter(
    (tab) => built.has(tab.key) && (tab.needs === 'view' || tab.needs.some((permission) => permissions.has(permission))),
  );
}
