import { Check, ChevronRight, Layers, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { PhPlaceChoice } from '@/server/pharmacy/actor';
import type { PhPlace } from '@/server/pharmacy/entry';

const CARD =
  'flex min-h-[72px] w-full min-w-0 items-center gap-3 rounded-ph-2xl bg-ph-card px-4 py-3 text-start text-base text-ph-text ring-1 ring-ph-line ' +
  'hover:bg-ph-g1 aria-[current=true]:ring-2 aria-[current=true]:ring-ph-g6';

/**
 * The business and branch picker: one group per pharmacy the person works in, its branches as option cards, and "All
 * branches" first for those who work across all of them; the current place is marked on its card in words. Each card posts
 * the choice to `/pharmacy/select/choose`, which checks it again and signs it into the place cookie; it works without
 * script. No motion.
 */
export function BranchPicker({ places, current, t }: { places: PhPlaceChoice[]; current: PhPlace | null; t: Translate }) {
  const isCurrent = (restaurantId: string, branchId: string | null) =>
    current?.restaurantId === restaurantId && current.branchId === branchId;

  const choice = (restaurantId: string, branchId: string | null, label: string, icon: ReactNode) => {
    const here = isCurrent(restaurantId, branchId);
    return (
      <li key={branchId ?? '*'}>
        <button type="submit" name="place" value={`${restaurantId}:${branchId ?? '*'}`} aria-current={here || undefined} className={CARD}>
          <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-ph-xl [&_svg]:size-5 ${here ? 'bg-ph-g8 text-ph-on-green' : 'bg-ph-g1 text-ph-g6'}`}>
            {icon}
          </span>
          {/* Isolated, so a Latin branch name keeps the page's alignment in Arabic and Sorani. */}
          <span className="min-w-0 flex-1 break-words font-semibold">
            <bdi>{label}</bdi>
          </span>
          {here ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-ph-g1 px-2.5 py-1 text-xs font-bold text-ph-g6">
              <Check aria-hidden className="size-3.5" />
              {t('pharmacy.select.current')}
            </span>
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ph-muted rtl:rotate-180" />
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {places.map((place) => (
        <form key={place.restaurantId} method="post" action="/pharmacy/select/choose">
          <fieldset className="flex min-w-0 flex-col">
            <legend className="mb-3 break-words text-sm font-bold text-ph-muted" dir="auto">
              {place.restaurantName}
            </legend>
            <ul className="flex flex-col gap-2.5">
              {place.allBranches ? choice(place.restaurantId, null, t('pharmacy.branch.all'), <Layers />) : null}
              {place.branches.map((branch) => choice(place.restaurantId, branch.id, branch.name, <MapPin />))}
            </ul>
          </fieldset>
        </form>
      ))}
    </div>
  );
}
