/**
 * A menu's lifecycle (spec 6.1). Publishing moves a draft to PUBLISHED (`publishMenu`); everything else a person does to
 * the status is one of three actions, and which ones are possible depends only on where the menu stands.
 */
export const MENU_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'] as const;

export type MenuStatus = (typeof MENU_STATUSES)[number];

export const STATUS_ACTIONS = ['suspend', 'archive', 'restore'] as const;

export type StatusAction = (typeof STATUS_ACTIONS)[number];

export interface StatusContext {
  /** Whether the menu has a revision guests can be shown. PUBLISHED and SUSPENDED need one. */
  hasLiveRevision: boolean;
  /** What the menu was before it was archived, which restoring it goes back to. */
  statusBeforeArchive: MenuStatus | null;
}

/** Statuses in which guests are shown (or kept from) a live revision. */
const NEEDS_LIVE_REVISION: ReadonlySet<MenuStatus> = new Set(['PUBLISHED', 'SUSPENDED']);

/**
 * Where `action` takes a menu that is `current`, or null when it is not allowed:
 *
 * - DRAFT: archive → ARCHIVED.
 * - PUBLISHED: suspend → SUSPENDED; archive → ARCHIVED.
 * - SUSPENDED: restore → PUBLISHED; archive → ARCHIVED.
 * - ARCHIVED: restore → the status before archiving (DRAFT when none is known).
 *
 * Restoring never lands on a status that shows a live revision when the menu has none: it becomes a DRAFT instead.
 */
export function nextMenuStatus(current: MenuStatus, action: StatusAction, ctx: StatusContext): MenuStatus | null {
  const restored = (target: MenuStatus): MenuStatus =>
    target === 'ARCHIVED' || (NEEDS_LIVE_REVISION.has(target) && !ctx.hasLiveRevision) ? 'DRAFT' : target;

  switch (current) {
    case 'DRAFT':
      return action === 'archive' ? 'ARCHIVED' : null;
    case 'PUBLISHED':
      if (action === 'suspend') return 'SUSPENDED';
      return action === 'archive' ? 'ARCHIVED' : null;
    case 'SUSPENDED':
      if (action === 'restore') return restored('PUBLISHED');
      return action === 'archive' ? 'ARCHIVED' : null;
    case 'ARCHIVED':
      return action === 'restore' ? restored(ctx.statusBeforeArchive ?? 'DRAFT') : null;
    default:
      return null;
  }
}
