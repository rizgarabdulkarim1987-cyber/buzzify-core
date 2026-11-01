'use client';

import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { deleteRestaurant } from '@/app/studio/_actions/restaurants';
import type { PlanTier } from '@/server/domain/entitlements';
import type { BusinessSector, RestaurantStatus, RestaurantType } from '@/server/domain/restaurant-profile';
import { formatDate, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { DataTable } from '@/studio/ui/DataTable';
import { Field } from '@/studio/ui/Field';
import { useFilterParams } from '@/studio/ui/FilterBar';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
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
  canDelete = false,
  showSector = true,
}: {
  rows: RestaurantRow[];
  sort: SortKey;
  dir: 'asc' | 'desc';
  planNames: Record<PlanTier, string>;
  /** Super Admins only; the server checks again when the deletion is asked for. */
  canDelete?: boolean;
  /** The sector column: for a Super Admin the space is the sector, so it is left out. */
  showSector?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const { set } = useFilterParams();
  const [doomed, setDoomed] = useState<RestaurantRow | null>(null);
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
        cell: ({ row }) => (row.original.sector !== 'FOOD' ? <span className="text-muted">–</span> : t(`restaurants.type.${row.original.type}`)),
      },
      ...(showSector
        ? [
            {
              id: 'sector',
              accessorKey: 'sector',
              header: t('restaurants.list.sector'),
              enableSorting: false,
              cell: ({ row }) => <SectorBadge sector={row.original.sector} t={t} />,
            } satisfies ColumnDef<RestaurantRow, unknown>,
          ]
        : []),
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
          row.original.sector !== 'FOOD' ? <span className="text-muted">–</span> : <span className="tabular-nums">{number.format(row.original.menuCount)}</span>,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('restaurants.list.created'),
        sortDescFirst: true,
        meta: { width: '140px' },
        cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDate(row.original.createdAt, locale)}</span>,
      },
      ...(canDelete
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{t('restaurants.delete')}</span>,
              enableSorting: false,
              meta: { align: 'end' as const, width: '48px' },
              cell: ({ row }) => (
                <IconButton label={t('restaurants.delete')} icon={<Trash2 aria-hidden />} size="sm" className="hover:text-danger" onClick={() => setDoomed(row.original)} />
              ),
            } satisfies ColumnDef<RestaurantRow, unknown>,
          ]
        : []),
    ],
    [t, locale, number, planNames, canDelete, showSector],
  );

  const sorting: SortingState = [{ id: sort, desc: dir === 'desc' }];
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = (typeof updater === 'function' ? updater(sorting) : updater)[0];
    if (next && SORTABLE.includes(next.id)) set({ sort: next.id, dir: next.desc ? 'desc' : 'asc' });
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        caption={t('restaurants.list.caption')}
        sorting={sorting}
        onSortingChange={onSortingChange}
      />
      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(open) => {
          if (!open) setDoomed(null);
        }}
        title={isolated(t('restaurants.delete.title'), { name: doomed?.name ?? '' })}
        body={doomed && doomed.menuCount > 0 ? t('restaurants.delete.hasMenus') : t('restaurants.delete.body')}
        confirmLabel={t('restaurants.delete.confirm')}
        onConfirm={async (form) => {
          if (!doomed) return true;
          const result = await deleteRestaurant({ restaurantId: doomed.id, confirmName: String(form.get('confirmName') ?? '') });
          if (!result.ok) return refuse(result, ['confirmName']);
          toast.success(t('restaurants.delete.done'));
          router.refresh();
          return true;
        }}
      >
        {(errors) => (
          <Field label={isolated(t('restaurants.delete.typeName'), { name: doomed?.name ?? '' })} error={errors.confirmName}>
            <Input name="confirmName" autoComplete="off" autoFocus />
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}
