'use client';

import { MENU_STATUSES } from '@/server/domain/menu-status';
import { useT } from '@/studio/i18n';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FilterBar, SearchFilter, useFilterParams } from '@/studio/ui/FilterBar';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { LIST_PARAMS } from './list-params';

/** The list's filters. Each one is a parameter of the address, which the page reads, so a filtered list can be bookmarked and shared. */
export function MenuFilters({ cities, restaurants }: { cities: readonly string[]; restaurants: ReadonlyArray<{ id: string; name: string }> }) {
  const t = useT();
  const { params, set } = useFilterParams();
  const city = params.get('city') ?? '';
  const restaurant = params.get('restaurant') ?? '';

  return (
    <FilterBar params={LIST_PARAMS}>
      <SearchFilter placeholder={t('menus.search')} label={t('menus.searchLabel')} className="w-[26rem]" />
      <Field label={t('menus.filter.status')} hideLabel className="w-40">
        <Select
          value={params.get('status') ?? ''}
          onChange={(event) => set({ status: event.target.value || null })}
          options={[
            { value: '', label: t('menus.filter.notArchived') },
            ...MENU_STATUSES.map((status) => ({ value: status, label: t(`status.${status.toLowerCase()}`) })),
          ]}
        />
      </Field>
      {restaurants.length > 1 && (
        <Field label={t('menus.filter.restaurant')} hideLabel className="w-44">
          <Select
            value={restaurant}
            onChange={(event) => set({ restaurant: event.target.value || null })}
            options={[
              { value: '', label: t('menus.filter.allRestaurants') },
              ...(restaurant && !restaurants.some((option) => option.id === restaurant) ? [{ value: restaurant, label: restaurant }] : []),
              ...restaurants.map((option) => ({ value: option.id, label: option.name })),
            ]}
          />
        </Field>
      )}
      {cities.length > 1 && (
        <Field label={t('menus.filter.city')} hideLabel className="w-36">
          <Select
            value={city}
            onChange={(event) => set({ city: event.target.value || null })}
            options={[
              { value: '', label: t('menus.filter.allCities') },
              // A city from the address that none of the reader's restaurants has is still shown while it is selected.
              ...(city && !cities.includes(city) ? [{ value: city, label: city }] : []),
              ...cities.map((name) => ({ value: name, label: name })),
            ]}
          />
        </Field>
      )}
      <div role="group" aria-label={t('menus.filter.created')} className="flex items-center gap-1.5">
        <span aria-hidden className="text-sm text-muted">
          {t('menus.filter.created')}
        </span>
        <Field label={t('menus.filter.createdFrom')} hideLabel className="w-36">
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
        <Field label={t('menus.filter.createdTo')} hideLabel className="w-36">
          <Input
            type="date"
            value={params.get('createdTo') ?? ''}
            min={params.get('createdFrom') ?? undefined}
            onChange={(event) => set({ createdTo: event.target.value || null })}
          />
        </Field>
      </div>
      <Checkbox
        label={t('menus.filter.unpublished')}
        checked={params.get('unpublished') === '1'}
        onChange={(event) => set({ unpublished: event.target.checked ? '1' : null })}
        className="px-1 text-sm"
      />
    </FilterBar>
  );
}
