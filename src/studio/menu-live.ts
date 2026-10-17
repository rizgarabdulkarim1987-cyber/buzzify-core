import type { MenuStatus } from '@/server/domain/menu-status';
import type { RestaurantStatus } from '@/server/domain/restaurant-profile';

/** What the Live version section knows about a menu. */
export interface LiveState {
  status: MenuStatus;
  restaurantStatus: RestaurantStatus;
  /** Whether the menu has a live revision, which is what guests are shown when it is available. */
  hasLiveRevision: boolean;
  /** Whether the draft differs from that revision. */
  unpublished: boolean;
}

/**
 * What the Live version section says about a menu, as message keys in reading order: what guests get at the address
 * now (the live revision, an unavailable page while the menu or its restaurant is suspended or archived, or a not-found
 * page for a menu never published), and whether the draft has changes that revision lacks. Only a published menu of an
 * active restaurant shows guests anything, so only there does "guests see the draft" apply.
 */
export function liveStateKeys(menu: LiveState): string[] {
  if (!menu.hasLiveRevision) return ['menus.live.none'];
  const draft = menu.unpublished ? 'menus.live.state.heldUnpublished' : 'menus.live.state.heldUpToDate';
  // The menu's own status first: it is what a person restores to bring it back.
  if (menu.status === 'SUSPENDED' || menu.status === 'ARCHIVED') return [`menus.live.state.${menu.status}`, draft];
  if (menu.restaurantStatus !== 'ACTIVE') return [`menus.live.state.restaurant.${menu.restaurantStatus}`, draft];
  return [menu.unpublished ? 'menus.live.unpublished' : 'menus.live.upToDate'];
}
