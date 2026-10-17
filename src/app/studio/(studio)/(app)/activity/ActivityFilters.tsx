'use client';

import { AUDIT_ACTIONS } from '@/server/domain/audit-actions';
import { useT } from '@/studio/i18n';
import { findMenuOptions, findPersonOptions, findRestaurantOptions } from '@/studio/pickers';
import { Field } from '@/studio/ui/Field';
import { FilterBar, useFilterParams } from '@/studio/ui/FilterBar';
import { Input } from '@/studio/ui/Input';
import { Picker, type PickerOption } from '@/studio/ui/Picker';
import { Select } from '@/studio/ui/Select';
import { LIST_PARAMS } from './list-params';

/** What a filter holds, as the page read it: the id from the address, and its name when it still exists. */
export interface SelectedFilters {
  actor: { id: string; name: string | null } | null;
  restaurant: { id: string; name: string | null } | null;
  menu: { id: string; name: string | null } | null;
}

const asOption = (selected: { id: string; name: string | null } | null): PickerOption | null =>
  selected ? { value: selected.id, label: selected.name ?? selected.id } : null;

/**
 * The log's filters: a person, a restaurant and a menu (each chosen by typing part of the name, never from a list of
 * everything), an action, and a range of days. Each one is a parameter of the address, which the page reads, so a
 * filtered log is a link.
 */
export function ActivityFilters({ selected }: { selected: SelectedFilters }) {
  const t = useT();
  const { params, set } = useFilterParams();

  return (
    <FilterBar params={LIST_PARAMS}>
      <Field label={t('activity.filter.actor')} hideLabel className="w-52">
        <Picker
          clearable
          value={asOption(selected.actor)}
          onChange={(option) => set({ actor: option?.value ?? null })}
          search={findPersonOptions}
          placeholder={t('activity.filter.anyActor')}
        />
      </Field>
      <Field label={t('activity.filter.restaurant')} hideLabel className="w-52">
        <Picker
          clearable
          value={asOption(selected.restaurant)}
          onChange={(option) => set({ restaurant: option?.value ?? null })}
          search={findRestaurantOptions}
          placeholder={t('activity.filter.anyRestaurant')}
        />
      </Field>
      <Field label={t('activity.filter.menu')} hideLabel className="w-52">
        <Picker
          clearable
          value={asOption(selected.menu)}
          onChange={(option) => set({ menu: option?.value ?? null })}
          search={findMenuOptions}
          placeholder={t('activity.filter.anyMenu')}
        />
      </Field>
      <Field label={t('activity.filter.action')} hideLabel className="w-64">
        <Select
          value={params.get('action') ?? ''}
          onChange={(event) => set({ action: event.target.value || null })}
          options={[
            { value: '', label: t('activity.filter.anyAction') },
            ...AUDIT_ACTIONS.map((action) => ({ value: action, label: t(`activity.action.${action}`) })),
          ]}
        />
      </Field>
      <div role="group" aria-label={t('activity.filter.date')} className="flex items-center gap-1.5">
        <Field label={t('activity.filter.from')} hideLabel className="w-36">
          <Input
            type="date"
            value={params.get('from') ?? ''}
            max={params.get('to') ?? undefined}
            onChange={(event) => set({ from: event.target.value || null })}
          />
        </Field>
        <span aria-hidden className="text-muted">
          –
        </span>
        <Field label={t('activity.filter.to')} hideLabel className="w-36">
          <Input
            type="date"
            value={params.get('to') ?? ''}
            min={params.get('from') ?? undefined}
            onChange={(event) => set({ to: event.target.value || null })}
          />
        </Field>
      </div>
    </FilterBar>
  );
}
