import { Check, Layers, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { PhPlaceChoice } from '@/server/pharmacy/actor';
import type { PhPlace } from '@/server/pharmacy/entry';

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-md border border-line bg-raised px-4 py-2 text-start text-base text-text ' +
  'hover:bg-hover active:bg-pressed aria-[current=true]:border-line-strong aria-[current=true]:bg-surface';

/**
 * The business and branch picker: one group per pharmacy the person works in, its branches as buttons, and "All
 * branches" first for those who work across all of them. Each button posts the choice to `/pharmacy/select/choose`,
 * which checks it again and signs it into the place cookie; it works without script. No motion.
 */
export function BranchPicker({ places, current, t }: { places: PhPlaceChoice[]; current: PhPlace | null; t: Translate }) {
  const isCurrent = (restaurantId: string, branchId: string | null) =>
    current?.restaurantId === restaurantId && current.branchId === branchId;

  const choice = (restaurantId: string, branchId: string | null, label: string, icon: ReactNode) => {
    const here = isCurrent(restaurantId, branchId);
    return (
      <li key={branchId ?? '*'}>
        <button type="submit" name="place" value={`${restaurantId}:${branchId ?? '*'}`} aria-current={here || undefined} className={ROW}>
          <span aria-hidden className="shrink-0 text-muted [&_svg]:size-5">
            {icon}
          </span>
          {/* Isolated, so a Latin branch name keeps the page's alignment in Arabic and Sorani. */}
          <span className="min-w-0 flex-1 break-words font-medium">
            <bdi>{label}</bdi>
          </span>
          {here ? (
            <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
              <Check aria-hidden className="size-4" />
              {t('pharmacy.select.current')}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {places.map((place) => (
        <form key={place.restaurantId} method="post" action="/pharmacy/select/choose">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 break-words text-lg font-semibold text-text" dir="auto">
              {place.restaurantName}
            </legend>
            <ul className="flex flex-col gap-2">
              {place.allBranches ? choice(place.restaurantId, null, t('pharmacy.branch.all'), <Layers />) : null}
              {place.branches.map((branch) => choice(place.restaurantId, branch.id, branch.name, <MapPin />))}
            </ul>
          </fieldset>
        </form>
      ))}
    </div>
  );
}
