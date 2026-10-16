'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Checkbox } from './Checkbox';
import { cx } from './cx';

/** Per-column presentation: alignment, a fixed width, and whether the header sorts. */
declare module '@tanstack/react-table' {
  // The generic parameters are TanStack's own signature for this extension point.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: 'start' | 'end';
    /** A CSS width for the column, such as `120px` or `30%`. */
    width?: string;
  }
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, never>[] | ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  /** What the table lists, for screen readers. */
  caption: string;
  /**
   * The sort the server applied. Lists sort on the server (they are paged), so a header click only reports the wanted
   * sort; the page puts it in the address and loads again.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Rows chosen for a bulk action, by row id. Leave out for a table without selection. */
  selection?: RowSelectionState;
  onSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
}

/**
 * The Studio's table: 13 px text, 40 px rows, figures in tabular numerals, sorting and selection reported to the page.
 * Selected rows carry the amber wash and an amber edge at the row's start.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  caption,
  sorting,
  onSortingChange,
  selection,
  onSelectionChange,
  empty,
}: DataTableProps<T>) {
  const t = useT();
  const selectable = selection !== undefined;

  const allColumns = useMemo(() => {
    const base = columns as ColumnDef<T, unknown>[];
    if (!selectable) return base;
    const select: ColumnDef<T, unknown> = {
      id: '__select',
      enableSorting: false,
      meta: { width: '40px' },
      header: ({ table }) => (
        <Checkbox
          aria-label={t('common.selectAll')}
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox aria-label={t('common.selectRow')} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
      ),
    };
    return [select, ...base];
  }, [columns, selectable, t]);

  // TanStack Table returns functions that change identity on every render, which is what it is designed for; the React
  // compiler is not used in this project.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSortingRemoval: false,
    enableRowSelection: selectable,
    state: { ...(sorting ? { sorting } : {}), ...(selection ? { rowSelection: selection } : {}) },
    ...(onSortingChange ? { onSortingChange } : {}),
    ...(onSelectionChange ? { onRowSelectionChange: onSelectionChange } : {}),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {table.getVisibleLeafColumns().map((column) => (
            <col key={column.id} style={column.columnDef.meta?.width ? { width: column.columnDef.meta.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-line">
              {group.headers.map((header) => {
                const sortable = Boolean(onSortingChange) && header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                const end = header.column.columnDef.meta?.align === 'end';
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    className={cx('h-9 px-3 text-xs font-medium text-muted first:ps-4 last:pe-4', end ? 'text-end' : 'text-start')}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cx(
                          '-mx-1 inline-flex h-7 items-center gap-1 rounded-sm px-1 hover:bg-hover hover:text-text',
                          sorted && 'text-text',
                        )}
                      >
                        {label}
                        {sorted === 'asc' ? (
                          <ArrowUp aria-hidden className="size-3.5" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown aria-hidden className="size-3.5" />
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-10">
                {empty ?? <p className="text-center text-muted">{t('common.noResults')}</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const selected = row.getIsSelected();
              return (
                <tr
                  key={row.id}
                  aria-selected={selectable ? selected : undefined}
                  className={cx('border-b border-line transition-colors duration-150', selected ? 'bg-accent-wash' : 'hover:bg-surface')}
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <td
                      key={cell.id}
                      className={cx(
                        'h-10 px-3 align-middle text-text first:ps-4 last:pe-4',
                        cell.column.columnDef.meta?.align === 'end' ? 'text-end' : 'text-start',
                        index === 0 && 'border-s-2',
                        index === 0 && (selected ? 'border-s-accent' : 'border-s-transparent'),
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
