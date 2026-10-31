'use client';

import { PLAN_TIERS, type PlanTier } from '@/server/domain/entitlements';
import { BUSINESS_SECTORS, RESTAURANT_STATUSES, RESTAURANT_TYPES } from '@/server/domain/restaurant-profile';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { FilterBar, SearchFilter, useFilterParams } from '@/studio/ui/FilterBar';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { LIST_PARAMS } from './list-params';

/** The list's filters. Each one is a parameter of the address, which the page reads, so a filtered list can be bookmarked and shared. */
export function RestaurantFilters({
  cities,
  planNames,
  showSector = true,
}: {
  cities: readonly string[];
  planNames: Record<PlanTier, string>;
  /** A Super Admin works in one project at a time, so for them the sector is the space, not a filter. */
  showSector?: boolean;
}) {
  const t = useT();
  const { params, set } = useFilterParams();
  const city = params.get('city') ?? '';

  return (
    <FilterBar params={LIST_PARAMS}>
      <SearchFilter placeholder={t('restaurants.search')} label={t('restaurants.searchLabel')} />
      <Field label={t('restaurants.filter.city')} hideLabel className="w-36">
        <Select
          value={city}
          onChange={(event) => set({ city: event.target.value || null })}
          options={[
            { value: '', label: t('restaurants.filter.allCities') },
            // A city from the address that none of the reader's restaurants has is still shown while it is selected.
            ...(city && !cities.includes(city) ? [{ value: city, label: city }] : []),
            ...cities.map((name) => ({ value: name, label: name })),
          ]}
        />
      </Field>
      <Field label={t('restaurants.filter.type')} hideLabel className="w-36">
        <Select
          value={params.get('type') ?? ''}
          onChange={(event) => set({ type: event.target.value || null })}
          options={[
            { value: '', label: t('restaurants.filter.allTypes') },
            ...RESTAURANT_TYPES.map((type) => ({ value: type, label: t(`restaurants.type.${type}`) })),
          ]}
        />
      </Field>
      {showSector && (
      <Field label={t('restaurants.filter.sector')} hideLabel className="w-36">
        <Select
          value={params.get('sector') ?? ''}
          onChange={(event) => set({ sector: event.target.value || null })}
          options={[
            { value: '', label: t('restaurants.filter.allSectors') },
            ...BUSINESS_SECTORS.map((sector) => ({ value: sector, label: t(`restaurants.sector.${sector}`) })),
          ]}
        />
      </Field>
      )}
      <Field label={t('restaurants.filter.status')} hideLabel className="w-36">
        <Select
          value={params.get('status') ?? ''}
          onChange={(event) => set({ status: event.target.value || null })}
          options={[
            { value: '', label: t('restaurants.filter.allStatuses') },
            ...RESTAURANT_STATUSES.map((status) => ({ value: status, label: t(`status.${status.toLowerCase()}`) })),
          ]}
        />
      </Field>
      <Field label={t('restaurants.filter.plan')} hideLabel className="w-36">
        <Select
          value={params.get('plan') ?? ''}
          onChange={(event) => set({ plan: event.target.value || null })}
          options={[{ value: '', label: t('restaurants.filter.allPlans') }, ...PLAN_TIERS.map((tier) => ({ value: tier, label: planNames[tier] }))]}
        />
      </Field>
      <div role="group" aria-label={t('restaurants.filter.created')} className="flex items-center gap-1.5">
        <span aria-hidden className="text-sm text-muted">
          {t('restaurants.filter.created')}
        </span>
        <Field label={t('restaurants.filter.createdFrom')} hideLabel className="w-36">
          <Input
            type="date"
            value={params.get('createdFrom') ?? ''}
            max={params.get('createdTo') ?? undefined}
            onChange={(event) => set({ createdFrom: event.target.value || null })}
          />
        </Field>
        <span aria-hidden className="text-muted">
          –
        </span>
        <Field label={t('restaurants.filter.createdTo')} hideLabel className="w-36">
          <Input
            type="date"
            value={params.get('createdTo') ?? ''}
            min={params.get('createdFrom') ?? undefined}
            onChange={(event) => set({ createdTo: event.target.value || null })}
          />
        </Field>
      </div>
    </FilterBar>
  );
}
