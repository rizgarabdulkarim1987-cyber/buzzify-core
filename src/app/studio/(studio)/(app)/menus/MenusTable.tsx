'use client';

import type { ColumnDef, OnChangeFn, RowSelectionState, SortingState } from '@tanstack/react-table';
import { Archive, CirclePause, CirclePlay, Copy, ExternalLink, Files, MoreHorizontal, PencilLine, Send, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { bulkDeleteMenus, bulkMenuAction } from '@/app/studio/_actions/menus';
import { nextMenuStatus, type MenuStatus, type StatusAction } from '@/server/domain/menu-status';
import type { RestaurantStatus } from '@/server/domain/restaurant-profile';
import type { BulkAction, BulkResult, MenuSort } from '@/server/studio/services/menus';
import { formatDate, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { DataTable } from '@/studio/ui/DataTable';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { useFilterParams } from '@/studio/ui/FilterBar';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { DuplicateDialog, type DuplicateTarget } from './DuplicateDialog';
import { issueText, MenuStatusBadge } from './menu-text';

export interface MenuRow {
  id: string;
  name: string;
  slug: string;
  status: MenuStatus;
  restaurant: { id: string; name: string; clientId: string; city: string; status: RestaurantStatus };
  liveRevisionNumber: number | null;
  unpublished: boolean;
  updatedAt: string;
  publicUrl: string;
  can: { publish: boolean; status: boolean; duplicate: boolean; delete: boolean };
}

const SORTABLE: readonly string[] = ['name', 'restaurant', 'status', 'updatedAt'] satisfies MenuSort[];

/** Whether the status allows the change (an archived menu restores to whatever it was, so it always can). */
const statusAllows = (row: MenuRow, action: StatusAction) =>
  nextMenuStatus(row.status, action, { hasLiveRevision: row.liveRevisionNumber !== null, statusBeforeArchive: null }) !== null;

/** The bulk actions, each offered while it fits at least one selected menu; the server still decides each one. */
const BULK: ReadonlyArray<{ action: BulkAction; icon: ReactNode; allowed: (row: MenuRow) => boolean }> = [
  { action: 'publish', icon: <Send aria-hidden />, allowed: (row) => row.can.publish && row.status !== 'ARCHIVED' },
  { action: 'suspend', icon: <CirclePause aria-hidden />, allowed: (row) => row.can.status && statusAllows(row, 'suspend') },
  { action: 'archive', icon: <Archive aria-hidden />, allowed: (row) => row.can.status && statusAllows(row, 'archive') },
  { action: 'restore', icon: <CirclePlay aria-hidden />, allowed: (row) => row.can.status && statusAllows(row, 'restore') },
];

/** What a bulk action did, kept with the names the menus had when it ran (an archived one leaves the list). */
interface Report {
  results: BulkResult[];
  names: Map<string, string>;
}

/** The bulk action's report: how many changed, and each one that did not with the reason (a blocked publish's issues). */
function ReportDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  const t = useT();
  const failed = report.results.filter((result) => !result.ok);
  const done = report.results.length - failed.length;
  const reason = (result: BulkResult) => {
    if (result.issues?.some((issue) => issue.severity === 'block')) return t('menus.bulk.reason.blocked');
    const key = `menus.bulk.reason.${result.code}`;
    return t(key) === key ? t('menus.bulk.reason.other') : t(key);
  };
  return (
    <Dialog
      open
      width="md"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('menus.bulk.resultTitle')}
      description={t('menus.bulk.done', { count: done })}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {failed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text">{t('menus.bulk.failed', { count: failed.length })}</p>
          <ul aria-label={t('menus.bulk.failed', { count: failed.length })} className="flex flex-col divide-y divide-line rounded-md border border-line">
            {failed.map((result) => (
              <li key={result.menuId} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <span className="font-medium text-text">
                  <bdi>{report.names.get(result.menuId) ?? result.menuId}</bdi>
                </span>
                <span className="text-muted">{reason(result)}</span>
                {result.issues && (
                  <ul className="list-disc ps-5 text-muted">
                    {result.issues
                      .filter((issue) => issue.severity === 'block')
                      .map((issue, index) => (
                        <li key={index}>{issueText(t, issue)}</li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** One row's actions: open it, see its public page, copy its address, duplicate it. */
function RowActions({ row, onDuplicate }: { row: MenuRow; onDuplicate: () => void }) {
  const t = useT();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('menus.list.rowActions', { name: row.name })} icon={<MoreHorizontal aria-hidden />} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* A link item takes one child (Radix slots it), so its icon goes inside the link. */}
        <DropdownMenuItem asChild>
          <Link href={`/studio/menus/${row.id}`}>
            <PencilLine aria-hidden />
            {t('menus.open')}
          </Link>
        </DropdownMenuItem>
        {row.liveRevisionNumber !== null && (
          <DropdownMenuItem asChild>
            <a href={row.publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t('menus.viewPublic')}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          icon={<Copy aria-hidden />}
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(row.publicUrl);
              toast.success(t('menus.addressCopied'));
            } catch {
              toast.error(t('common.copyFailed'));
            }
          }}
        >
          {t('menus.copyAddress')}
        </DropdownMenuItem>
        {row.can.duplicate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Files aria-hidden />} onSelect={onDuplicate}>
              {t('menus.duplicate')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface MenusTableProps {
  rows: MenuRow[];
  sort: MenuSort;
  dir: 'asc' | 'desc';
  origin: string;
  /** Where a Super Admin may duplicate a menu to; empty for everyone else. */
  duplicateTargets: readonly DuplicateTarget[];
}

/**
 * The menus of one page. The server sorted them; a click on a header only asks for another sort in the address. Rows
 * can be selected for a bulk action, which runs each menu on its own and reports every one it could not change.
 */
export function MenusTable({ rows, sort, dir, origin, duplicateTargets }: MenusTableProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const { set } = useFilterParams();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [duplicating, setDuplicating] = useState<MenuRow | null>(null);

  // Only rows of this page count: a selection made before the filters changed does not reach rows no longer shown.
  const selected = rows.filter((row) => selection[row.id]);

  const columns = useMemo<ColumnDef<MenuRow, unknown>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: t('menus.list.name'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col py-1">
            <Link href={`/studio/menus/${row.original.id}`} className="truncate font-medium text-text underline-offset-2 hover:underline">
              {row.original.name}
            </Link>
            <span dir="ltr" className="truncate text-start font-mono text-xs text-muted rtl:text-end">
              /{row.original.slug}
            </span>
          </div>
        ),
      },
      {
        id: 'restaurant',
        accessorFn: (row) => row.restaurant.name,
        header: t('menus.list.restaurant'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col py-1">
            <Link href={`/studio/restaurants/${row.original.restaurant.id}`} className="truncate text-text underline-offset-2 hover:underline">
              {row.original.restaurant.name}
            </Link>
            <span dir="ltr" className="font-mono text-xs text-muted rtl:text-end">
              {row.original.restaurant.clientId}
            </span>
          </div>
        ),
      },
      {
        id: 'city',
        accessorFn: (row) => row.restaurant.city,
        header: t('menus.list.city'),
        enableSorting: false,
        meta: { width: '120px' },
        cell: ({ row }) => row.original.restaurant.city || <span className="text-muted">–</span>,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('menus.list.status'),
        meta: { width: '220px' },
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <MenuStatusBadge status={row.original.status} t={t} />
            {row.original.unpublished && <StatusBadge>{t('menus.unpublished')}</StatusBadge>}
          </span>
        ),
      },
      {
        id: 'live',
        accessorKey: 'liveRevisionNumber',
        header: t('menus.list.live'),
        enableSorting: false,
        meta: { width: '96px' },
        cell: ({ row }) =>
          row.original.liveRevisionNumber === null ? (
            <span className="text-muted">{t('menus.list.notLive')}</span>
          ) : (
            <span className="tabular-nums">{t('menus.list.revision', { number: numberFormat(locale).format(row.original.liveRevisionNumber) })}</span>
          ),
      },
      {
        id: 'updatedAt',
        accessorKey: 'updatedAt',
        header: t('menus.list.updated'),
        sortDescFirst: true,
        meta: { width: '132px' },
        cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDate(row.original.updatedAt, locale)}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.moreActions')}</span>,
        enableSorting: false,
        meta: { width: '48px', align: 'end' },
        cell: ({ row }) => <RowActions row={row.original} onDuplicate={() => setDuplicating(row.original)} />,
      },
    ],
    [t, locale],
  );

  const sorting: SortingState = [{ id: sort, desc: dir === 'desc' }];
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = (typeof updater === 'function' ? updater(sorting) : updater)[0];
    if (next && SORTABLE.includes(next.id)) set({ sort: next.id, dir: next.desc ? 'desc' : 'asc' });
  };

  const offered = BULK.filter((entry) => selected.some(entry.allowed));

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div
          role="region"
          aria-label={t('menus.bulk.label')}
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-line-strong bg-raised px-3 py-1.5"
        >
          <span className="me-2 text-sm font-medium text-text" aria-live="polite">
            {t('menus.bulk.selected', { count: selected.length })}
          </span>
          {offered.map(({ action, icon }) => (
            <Button key={action} size="sm" variant={action === 'publish' ? 'primary' : 'secondary'} icon={icon} onClick={() => setPending(action)}>
              {t(`menus.bulk.action.${action}`)}
            </Button>
          ))}
          {selected.some((row) => row.can.delete) && (
            <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => setDeleting(true)}>
              {t('menus.bulk.action.delete')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<X aria-hidden />} className="ms-auto" onClick={() => setSelection({})}>
            {t('menus.bulk.clear')}
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        caption={t('menus.list.caption')}
        sorting={sorting}
        onSortingChange={onSortingChange}
        selection={selection}
        onSelectionChange={setSelection}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending ? t(`menus.bulk.title.${pending}`, { count: selected.length }) : ''}
        body={pending ? t(`menus.bulk.body.${pending}`) : undefined}
        confirmLabel={pending ? t(`menus.bulk.action.${pending}`) : ''}
        tone={pending === 'publish' || pending === 'restore' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!pending) return true;
          const names = new Map(selected.map((row) => [row.id, row.name]));
          const result = await bulkMenuAction({ menuIds: selected.map((row) => row.id), action: pending });
          if (!result.ok) return refuse(result);
          setSelection({});
          setReport({ results: result.data.results, names });
          router.refresh();
          return true;
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('menus.bulk.title.delete', { count: selected.length })}
        body={t('menus.bulk.body.delete')}
        confirmLabel={t('menus.bulk.action.delete')}
        onConfirm={async (form) => {
          const names = new Map(selected.map((row) => [row.id, row.name]));
          const result = await bulkDeleteMenus({ menuIds: selected.map((row) => row.id), confirm: String(form.get('confirm') ?? '') });
          if (!result.ok) return refuse(result, ['confirm']);
          setSelection({});
          setReport({ results: result.data.results, names });
          router.refresh();
          return true;
        }}
      >
        {(errors) => (
          <Field label={t('menus.bulk.typeDelete')} error={errors.confirm}>
            <Input name="confirm" autoComplete="off" autoFocus />
          </Field>
        )}
      </ConfirmDialog>

      {report && <ReportDialog report={report} onClose={() => setReport(null)} />}

      {duplicating && (
        <DuplicateDialog
          menuId={duplicating.id}
          name={duplicating.name}
          slug={duplicating.slug}
          restaurantId={duplicating.restaurant.id}
          targets={duplicateTargets}
          origin={origin}
          onClose={() => setDuplicating(null)}
        />
      )}
    </div>
  );
}
