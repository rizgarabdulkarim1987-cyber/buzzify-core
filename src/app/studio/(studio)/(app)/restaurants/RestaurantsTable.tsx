'use client';

import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import type { PlanTier } from '@/server/domain/entitlements';
import type { BusinessSector, RestaurantStatus, RestaurantType } from '@/server/domain/restaurant-profile';
import { formatDate, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { DataTable } from '@/studio/ui/DataTable';
import { useFilterParams } from '@/studio/ui/FilterBar';
import { RestaurantStatusBadge } from './RestaurantStatusBadge';
import { SectorBadge } from './SectorBadge';
import type { SortKey } from './list-params';

export interface RestaurantRow {
  id: string;
  clientId: string;
  name: string;
  type: RestaurantType;
  sector: BusinessSector;
  city: string;
  status: RestaurantStatus;
  plan: PlanTier;
  menuCount: number;
  createdAt: string;
}

const SORTABLE: readonly string[] = ['name', 'city', 'createdAt'] satisfies SortKey[];

/** The restaurants of one page. The server sorted them; a click on a header only asks for another sort in the address. */
export function RestaurantsTable({
  rows,
  sort,
  dir,
  planNames,
}: {
  rows: RestaurantRow[];
  sort: SortKey;
  dir: 'asc' | 'desc';
  planNames: Record<PlanTier, string>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { set } = useFilterParams();
  const number = useMemo(() => numberFormat(locale), [locale]);

  const columns = useMemo<ColumnDef<RestaurantRow, unknown>[]>(
    () => [
      {
        id: 'clientId',
        accessorKey: 'clientId',
        header: t('restaurants.list.clientId'),
        enableSorting: false,
        meta: { width: '112px' },
        cell: ({ row }) => (
          <span dir="ltr" className="inline-block font-mono text-xs text-muted">
            {row.original.clientId}
          </span>
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: t('restaurants.list.name'),
        cell: ({ row }) => (
          <Link href={`/studio/restaurants/${row.original.id}`} className="font-medium text-text underline-offset-2 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: t('restaurants.list.type'),
        enableSorting: false,
        cell: ({ row }) => (row.original.sector === 'PHARMACY' ? <span className="text-muted">–</span> : t(`restaurants.type.${row.original.type}`)),
      },
      {
        id: 'sector',
        accessorKey: 'sector',
        header: t('restaurants.list.sector'),
        enableSorting: false,
        cell: ({ row }) => <SectorBadge sector={row.original.sector} t={t} />,
      },
      {
        id: 'city',
        accessorKey: 'city',
        header: t('restaurants.list.city'),
        cell: ({ row }) => row.original.city || <span className="text-muted">–</span>,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('restaurants.list.status'),
        enableSorting: false,
        cell: ({ row }) => <RestaurantStatusBadge status={row.original.status} t={t} />,
      },
      {
        id: 'plan',
        accessorKey: 'plan',
        header: t('restaurants.column.plan'),
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-text">{planNames[row.original.plan]}</span>,
      },
      {
        id: 'menuCount',
        accessorKey: 'menuCount',
        header: t('restaurants.list.menus'),
        enableSorting: false,
        meta: { align: 'end', width: '80px' },
        cell: ({ row }) =>
          row.original.sector === 'PHARMACY' ? <span className="text-muted">–</span> : <span className="tabular-nums">{number.format(row.original.menuCount)}</span>,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('restaurants.list.created'),
        sortDescFirst: true,
        meta: { width: '140px' },
        cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDate(row.original.createdAt, locale)}</span>,
      },
    ],
    [t, locale, number, planNames],
  );

  const sorting: SortingState = [{ id: sort, desc: dir === 'desc' }];
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = (typeof updater === 'function' ? updater(sorting) : updater)[0];
    if (next && SORTABLE.includes(next.id)) set({ sort: next.id, dir: next.desc ? 'desc' : 'asc' });
  };

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      caption={t('restaurants.list.caption')}
      sorting={sorting}
      onSortingChange={onSortingChange}
    />
  );
}
