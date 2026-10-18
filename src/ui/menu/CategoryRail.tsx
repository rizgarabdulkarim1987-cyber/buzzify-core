'use client';

import { useSyncExternalStore } from 'react';
import { railStyleFromQuery, type RailStyle } from '@/lib/rail';
import { useApp } from '@/ui/AppProviders';
import { DeckRail } from './rail/DeckRail';
import { DrumRail } from './rail/DrumRail';
import { FlapRail } from './rail/FlapRail';
import { GrainsRail } from './rail/GrainsRail';
import { PlainRail } from './rail/PlainRail';
import type { RailProps } from './rail/types';

export type { RailCategory } from './rail/types';

// The address does not change while the menu is open, so there is nothing to subscribe to.
const noSubscription = () => () => {};
const readSearch = () => window.location.search;
const noSearch = () => '';

/** The rail style in use: a `?rail=` preview of a style the restaurant's plan includes, otherwise its own. */
export function useRailStyle(): RailStyle {
  const { tenant } = useApp();
  const search = useSyncExternalStore(noSubscription, readSearch, noSearch);
  const previewed = railStyleFromQuery(search);
  return previewed !== null && tenant.features.rails.includes(previewed) ? previewed : tenant.railStyle;
}

/**
 * The menu's category navigation, moving in the style the restaurant chose in its brand settings. `?rail=` in
 * the address previews another style without changing the setting.
 */
export function CategoryRail(props: RailProps) {
  switch (useRailStyle()) {
    case 'deck':
      return <DeckRail {...props} />;
    case 'grains':
      return <GrainsRail {...props} />;
    case 'drum':
      return <DrumRail {...props} />;
    case 'flap':
      return <FlapRail {...props} />;
    default:
      return <PlainRail {...props} />;
  }
}
