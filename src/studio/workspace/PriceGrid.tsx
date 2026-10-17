'use client';

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';
import { Percent } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { setPrice } from '@/app/studio/_actions/prices';
import { isLocale, type Locale } from '@/lib/locale';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import type { PriceGrid as Grid } from '@/server/studio/services/prices';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import { BulkPriceDialog } from './BulkPriceDialog';
import { displayName, formatMoney, PRICE_PROBLEM_KEYS } from './content/shared';

interface PriceRowView {
  id: string;
  kind: 'product' | 'variant';
  name: string;
  /** The size's name; null on a product's own row. */
  size: string | null;
  category: string;
  price: number;
  version: number;
  subRows?: PriceRowView[];
}

/**
 * One price as a cell the person types in, as in a spreadsheet: Enter (or leaving the cell) saves it at its row's
 * version, Escape puts the stored price back. A refusal stays on the cell; someone else's save in between reloads it.
 */
function PriceCell({ menuId, row, currency }: { menuId: string; row: PriceRowView; currency: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const stored = formatPriceInput(row.price, currency);
  const [value, setValue] = useState(stored);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = row.size ? t('prices.cellSize', { name: row.name, size: row.size }) : t('prices.cell', { name: row.name });

  const commit = async () => {
    if (value.trim() === stored || saving) return;
    const parsed = parsePriceInput(value, currency);
    if (!parsed.ok) return setProblem(t(PRICE_PROBLEM_KEYS[parsed.reason]));
    setSaving(true);
    const result = await setPrice({ menuId, target: { kind: row.kind, id: row.id, version: row.version }, price: parsed.minor });
    setSaving(false);
    if (result.ok) {
      setProblem(null);
      router.refresh();
      return;
    }
    const described = describeFailure(t, locale, result.error);
    if (result.error.code === 'CONFLICT') {
      toast.error(described.message);
      setValue(stored);
      router.refresh();
      return;
    }
    setProblem(described.fields.price ?? described.message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      setValue(stored);
      setProblem(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-busy={saving || undefined}
        inputMode="decimal"
        dir="ltr"
        className={cx(
          'h-7 w-28 rounded-sm border border-transparent bg-transparent px-2 text-end tabular-nums text-text transition-colors',
          'hover:border-line-strong focus:border-ink focus:bg-raised aria-invalid:border-danger',
          value.trim() !== stored && 'border-line-strong bg-raised',
        )}
      />
      {problem && (
        <span role="alert" className="text-xs text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}

/**
 * The Prices tab (spec 10.3): a row per product and per size, each price edited in place, a category filter, and
 * products chosen for a bulk change (none chosen: the category shown, or the whole menu).
 */
export function PriceGrid({ menuId, grid, canBulk }: { menuId: string; grid: Grid; canBulk: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [categoryId, setCategoryId] = useState('');
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulk, setBulk] = useState(false);
  const fallback: Locale = isLocale(grid.defaultLocale) ? grid.defaultLocale : 'en';
  const name = (names: Partial<Record<Locale, string>>) => displayName(names, locale, fallback);

  const data = useMemo<PriceRowView[]>(
    () =>
      grid.categories
        .filter((category) => categoryId === '' || category.id === categoryId)
        .flatMap((category) =>
          category.products.map((product) => ({
            id: product.id,
            kind: 'product' as const,
            name: name(product.names),
            size: null,
            category: name(category.names),
            price: product.price,
            version: product.version,
            subRows: product.variants.map((variant) => ({
              id: variant.id,
              kind: 'variant' as const,
              name: name(product.names),
              size: name(variant.names),
              category: name(category.names),
              price: variant.price,
              version: variant.version,
            })),
          })),
        ),
    // `name` reads only the locale and the fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, categoryId, locale],
  );

  const columns = useMemo<ColumnDef<PriceRowView>[]>(
    () => [
      ...(canBulk
        ? [
            {
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  aria-label={t('prices.selectAll')}
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected()}
                  onChange={table.getToggleAllRowsSelectedHandler()}
                />
              ),
              cell: ({ row }) =>
                row.depth === 0 ? (
                  <Checkbox
                    aria-label={t('prices.select', { name: row.original.name })}
                    checked={row.getIsSelected()}
                    onChange={row.getToggleSelectedHandler()}
                  />
                ) : null,
              meta: { width: '40px' },
            } satisfies ColumnDef<PriceRowView>,
          ]
        : []),
      {
        id: 'item',
        header: () => t('prices.item'),
        cell: ({ row }) =>
          row.original.size === null ? (
            <span className="font-medium text-text">{row.original.name}</span>
          ) : (
            <span className="ps-5 text-muted">{row.original.size}</span>
          ),
      },
      { id: 'category', header: () => t('prices.categoryColumn'), cell: ({ row }) => (row.depth === 0 ? <span className="text-muted">{row.original.category}</span> : null) },
      {
        id: 'price',
        header: () => t('prices.priceColumn', { currency: grid.currency }),
        cell: ({ row }) => <PriceCell key={`${row.original.id}:${row.original.version}:${row.original.price}`} menuId={menuId} row={row.original} currency={grid.currency} />,
        meta: { align: 'end', width: '160px' },
      },
    ],
    [canBulk, grid.currency, menuId, t],
  );

  // TanStack Table returns functions that change identity on every render, which is what it is designed for.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getSubRows: (row) => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    state: { rowSelection: selection, expanded: true },
    enableRowSelection: (row) => row.depth === 0,
    enableSubRowSelection: false,
    onRowSelectionChange: setSelection,
  });

  const selectedIds = Object.keys(selection).filter((id) => selection[id] && data.some((row) => row.id === id));
  const scope = selectedIds.length > 0 ? { productIds: selectedIds } : categoryId ? { categoryId } : {};
  const scopeLabel =
    selectedIds.length > 0
      ? t('prices.scope.selected', { count: numberFormat(locale).format(selectedIds.length) })
      : categoryId
        ? t('prices.scope.category', { name: data[0]?.category ?? '' })
        : t('prices.scope.menu');

  const categories = [{ value: '', label: t('prices.allCategories') }, ...grid.categories.map((category) => ({ value: category.id, label: name(category.names) }))];

  return (
    <div className="flex max-w-5xl flex-col gap-4 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t('prices.category')} className="w-64">
          <Select
            options={categories}
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setSelection({});
            }}
          />
        </Field>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{t('prices.step', { step: formatMoney(grid.step, grid.currency, locale) })}</span>
          {canBulk && (
            <Button variant="primary" icon={<Percent aria-hidden />} onClick={() => setBulk(true)} disabled={data.length === 0}>
              {t('prices.bulk.open')}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-raised">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('prices.caption')}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line">
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    style={header.column.columnDef.meta?.width ? { width: header.column.columnDef.meta.width } : undefined}
                    className={cx(
                      'h-9 px-3 text-xs font-medium text-muted first:ps-4 last:pe-4',
                      header.column.columnDef.meta?.align === 'end' ? 'text-end' : 'text-start',
                    )}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                  {t('prices.empty')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  aria-selected={row.depth === 0 && canBulk ? row.getIsSelected() : undefined}
                  className={cx('border-b border-line last:border-b-0', row.getIsSelected() ? 'bg-accent-wash' : row.depth > 0 ? 'bg-surface/60' : 'hover:bg-surface')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cx(
                        'h-10 px-3 py-1 align-middle first:ps-4 last:pe-4',
                        cell.column.columnDef.meta?.align === 'end' ? 'text-end' : 'text-start',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {bulk && (
        <BulkPriceDialog
          menuId={menuId}
          currency={grid.currency}
          selection={scope}
          scopeLabel={scopeLabel}
          onClose={() => setBulk(false)}
          onApplied={() => setSelection({})}
        />
      )}
    </div>
  );
}
