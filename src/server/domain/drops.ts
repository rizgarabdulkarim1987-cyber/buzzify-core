import type { LiveOverlay } from './snapshot';

/**
 * Limited drops (plan feature `selling.limitedDrops`, spec 2026-11-01-project-6-limited-drops-design.md): a dish on the
 * menu only between two instants. Read live, laid over the overlay for the moment of the request, so the edges are exact.
 */

export type DropState = 'soon' | 'live' | 'over';

export const dropState = (startsAt: string, endsAt: string, now: Date): DropState => {
  const t = now.getTime();
  return t < Date.parse(startsAt) ? 'soon' : t >= Date.parse(endsAt) ? 'over' : 'live';
};

/**
 * The overlay for `now`: a dish with a window that has not begun or has ended is hidden (with the bundles and rules naming
 * it), a dish inside its window keeps its end for the label. A plan without the feature ignores windows entirely.
 */
export function applyDrops(overlay: LiveOverlay, now: Date, enabled: boolean): LiveOverlay {
  const products: LiveOverlay['products'] = {};
  for (const [id, entry] of Object.entries(overlay.products)) {
    const { dropStartsAt, dropEndsAt, ...rest } = entry;
    if (!enabled || dropStartsAt === undefined || dropEndsAt === undefined) {
      products[id] = rest;
      continue;
    }
    products[id] = dropState(dropStartsAt, dropEndsAt, now) === 'live' ? { ...rest, dropEndsAt } : { ...rest, isHidden: true };
  }
  return { ...overlay, products };
}
