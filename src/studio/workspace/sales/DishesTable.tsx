'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Check, RotateCcw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { setSelling } from '@/app/studio/_actions/content';
import { BADGES, type Badge } from '@/lib/product-tags';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import type { SalesDishes } from '@/server/studio/services/sales';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { IconButton } from '@/studio/ui/IconButton';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { PRICE_PROBLEM_KEYS } from '../content/shared';
import { wholeNumber } from '../content/draft';
import { PageIntro, useNamer } from './shared';
import { strengthLevel } from './levels';

type View = SalesDishes & { canPrice: boolean };

/** A dish as the table shows it: the stored values, and the version a save is made at. */
interface DishRow {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  version: number;
  isSignature: boolean;
  isFeatured: boolean;
  badges: Badge[];
  cost: number | null;
  priority: number;
  serves: number | null;
  lowStockThreshold: number | null;
}

/** What the person has changed on a row and not saved: numbers as typed, so a half-typed value is not lost. */
interface Edit {
  isSignature?: boolean;
  isFeatured?: boolean;
  badges?: Badge[];
  cost?: string;
  priority?: number;
  serves?: string;
  lowStockThreshold?: string;
}

const without = <T,>(record: Record<string, T>, id: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** The messages under a row's inputs, by field. */
type Problems = Partial<Record<keyof Edit, string>>;

/** The label a column's cell carries on a phone, where the header row is hidden. */
const CARD_LABELS: Record<string, string> = {
  signature: 'content.signature',
  featured: 'content.featured',
  badges: 'content.tags.badges',
  priority: 'salesDishes.col.priority',
  serves: 'content.serves.label',
  lowStock: 'salesDishes.col.lowStock',
  cost: 'salesDishes.col.cost',
};

const PROMOTE_LEVELS = [50, 75, 100] as const;

const INPUT_CLASSES = cx(
  'h-8 w-full rounded-sm border border-line-strong bg-raised px-2 text-base tabular-nums text-text transition-colors',
  'placeholder:text-muted hover:border-muted focus:border-ink aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-45',
);

/**
 * Sales > Dishes: every dish's selling settings in one table (docs/superpowers/specs/2026-10-30-sales-dishes-page-design.md).
 * A row's changes are saved on their own, at the row's version, with its Save or with "Save all". Someone else's save in
 * between is named and the row is read again. On a phone each row is a card.
 */
export function DishesTable({ menuId, view }: { menuId: string; view: View }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const name = useNamer(view.defaultLocale);
  const { currency, canPrice } = view;
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [problems, setProblems] = useState<Record<string, Problems>>({});
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  const all = useMemo<DishRow[]>(
    () =>
      view.categories.flatMap((category) =>
        category.products.map((product) => ({
          id: product.id,
          name: name(product.names),
          categoryId: category.id,
          category: name(category.names),
          version: product.version,
          isSignature: product.isSignature,
          isFeatured: product.isFeatured,
          badges: product.badges,
          cost: product.cost,
          priority: product.priority,
          serves: product.serves,
          lowStockThreshold: product.lowStockThreshold,
        })),
      ),
    [view, name],
  );
  const byId = useMemo(() => new Map(all.map((row) => [row.id, row])), [all]);

  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(locale);
    return all.filter((row) => (categoryId === '' || row.categoryId === categoryId) && (needle === '' || row.name.toLocaleLowerCase(locale).includes(needle)));
  }, [all, categoryId, search, locale]);

  /** The save a row's edit makes (only the fields that differ from what is stored), or what to fix first. */
  const buildSave = (row: DishRow, edit: Edit): { save: Record<string, unknown>; problems: Problems } => {
    const save: Record<string, unknown> = {};
    const found: Problems = {};
    if (edit.isSignature !== undefined && edit.isSignature !== row.isSignature) save.isSignature = edit.isSignature;
    if (edit.isFeatured !== undefined && edit.isFeatured !== row.isFeatured) save.isFeatured = edit.isFeatured;
    if (edit.badges !== undefined && !sameList(edit.badges, row.badges)) save.badges = edit.badges;
    if (edit.priority !== undefined && edit.priority !== strengthLevel(row.priority)) save.priority = edit.priority;
    if (edit.cost !== undefined) {
      if (edit.cost.trim() === '') {
        if (row.cost !== null) save.cost = null;
      } else {
        const parsed = parsePriceInput(edit.cost, currency);
        if (!parsed.ok) found.cost = t(PRICE_PROBLEM_KEYS[parsed.reason]);
        else if (parsed.minor !== row.cost) save.cost = parsed.minor;
      }
    }
    if (edit.serves !== undefined) {
      const value = edit.serves.trim() === '' ? null : wholeNumber(edit.serves);
      if (value !== null && (value < 2 || value > 20)) found.serves = t('content.serves.range');
      else if (edit.serves.trim() !== '' && value === null) found.serves = t('content.serves.range');
      else if (value !== row.serves) save.serves = value;
    }
    if (edit.lowStockThreshold !== undefined) {
      const value = edit.lowStockThreshold.trim() === '' ? null : wholeNumber(edit.lowStockThreshold);
      if (edit.lowStockThreshold.trim() !== '' && (value === null || value < 1 || value > 999)) found.lowStockThreshold = t('content.lowStock.range');
      else if (value !== row.lowStockThreshold) save.lowStockThreshold = value;
    }
    return { save, problems: found };
  };

  const dirtyIds = Object.keys(edits).filter((id) => {
    const row = byId.get(id);
    return row !== undefined && (Object.keys(buildSave(row, edits[id]!).save).length > 0 || Object.keys(buildSave(row, edits[id]!).problems).length > 0);
  });

  const change = (id: string, patch: Edit) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const drop = (id: string) => {
    setEdits((current) => without(current, id));
    setProblems((current) => without(current, id));
  };

  /** Saves one row; true when it is saved (or had nothing to save). */
  const saveRow = async (id: string): Promise<boolean> => {
    const row = byId.get(id);
    const edit = edits[id];
    if (!row || !edit) return true;
    const built = buildSave(row, edit);
    if (Object.keys(built.problems).length > 0) {
      setProblems((current) => ({ ...current, [id]: built.problems }));
      return false;
    }
    if (Object.keys(built.save).length === 0) {
      drop(id);
      return true;
    }
    setSaving((current) => new Set(current).add(id));
    const result = await setSelling({ menuId, productId: id, version: row.version, ...built.save });
    setSaving((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (result.ok) {
      drop(id);
      return true;
    }
    const described = describeFailure(t, locale, result.error);
    if (result.error.code === 'CONFLICT') {
      // Someone saved this dish first: show theirs, and leave the person to make the change again.
      toast.error(`${row.name}: ${described.message}`);
      drop(id);
      router.refresh();
      return false;
    }
    const byField: Problems = {};
    for (const [field, message] of Object.entries(described.fields)) byField[field as keyof Edit] = message;
    if (Object.keys(byField).length > 0) setProblems((current) => ({ ...current, [id]: byField }));
    else toast.error(`${row.name}: ${described.message}`);
    return false;
  };

  const saveOne = async (id: string) => {
    if (await saveRow(id)) {
      toast.success(t('sales.saved'));
      router.refresh();
    }
  };

  const saveAll = async () => {
    let saved = 0;
    for (const id of dirtyIds) if (await saveRow(id)) saved += 1;
    if (saved > 0) {
      toast.success(t('salesDishes.savedMany', { count: numberFormat(locale).format(saved) }));
      router.refresh();
    }
  };

  const columns = useMemo<ColumnDef<DishRow>[]>(() => {
    const field = (key: string) => t(key);
    const label = (row: DishRow, key: string) => t('salesDishes.aria', { field: field(key), name: row.name });
    return [
      {
        id: 'dish',
        header: () => t('salesDishes.col.dish'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-text">{row.original.name}</span>
            {edits[row.original.id] && dirtyIds.includes(row.original.id) && <span className="text-xs text-muted">{t('salesDishes.unsaved')}</span>}
          </span>
        ),
      },
      {
        id: 'signature',
        header: () => t('content.signature'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Switch
              aria-label={label(r, 'content.signature')}
              checked={edits[r.id]?.isSignature ?? r.isSignature}
              onCheckedChange={(isSignature) => change(r.id, { isSignature })}
            />
          );
        },
      },
      {
        id: 'featured',
        header: () => t('content.featured'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Switch
              aria-label={label(r, 'content.featured')}
              checked={edits[r.id]?.isFeatured ?? r.isFeatured}
              onCheckedChange={(isFeatured) => change(r.id, { isFeatured })}
            />
          );
        },
      },
      {
        id: 'badges',
        header: () => t('content.tags.badges'),
        cell: ({ row }) => {
          const r = row.original;
          const current = edits[r.id]?.badges ?? r.badges;
          return (
            <div role="group" aria-label={label(r, 'content.tags.badges')} className="flex flex-wrap gap-1">
              {BADGES.map((badge) => {
                const on = current.includes(badge);
                return (
                  <button
                    key={badge}
                    type="button"
                    aria-pressed={on}
                    onClick={() => change(r.id, { badges: BADGES.filter((entry) => (entry === badge ? !on : current.includes(entry))) })}
                    className={cx(
                      'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors duration-150',
                      on ? 'border-ink bg-ink text-on-ink hover:bg-ink-hover' : 'border-line-strong bg-raised text-text hover:bg-hover',
                    )}
                  >
                    {on && <Check aria-hidden className="size-3" />}
                    {t(`content.badge.${badge}`)}
                  </button>
                );
              })}
            </div>
          );
        },
      },
      {
        id: 'priority',
        header: () => t('salesDishes.col.priority'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Select
              className="w-28 md:w-24"
              aria-label={label(r, 'salesDishes.col.priority')}
              options={PROMOTE_LEVELS.map((level) => ({ value: String(level), label: t(`content.priority.${level}`) }))}
              value={String(edits[r.id]?.priority ?? strengthLevel(r.priority))}
              onChange={(event) => change(r.id, { priority: Number(event.target.value) })}
            />
          );
        },
      },
      {
        id: 'serves',
        header: () => t('content.serves.label'),
        cell: ({ row }) => {
          const r = row.original;
          const problem = problems[r.id]?.serves;
          return (
            <NumberCell
              label={label(r, 'content.serves.label')}
              value={edits[r.id]?.serves ?? (r.serves === null ? '' : String(r.serves))}
              problem={problem}
              onChange={(serves) => change(r.id, { serves })}
              onEnter={() => void saveOne(r.id)}
            />
          );
        },
      },
      {
        id: 'lowStock',
        header: () => t('salesDishes.col.lowStock'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <NumberCell
              label={label(r, 'salesDishes.col.lowStock')}
              value={edits[r.id]?.lowStockThreshold ?? (r.lowStockThreshold === null ? '' : String(r.lowStockThreshold))}
              problem={problems[r.id]?.lowStockThreshold}
              onChange={(lowStockThreshold) => change(r.id, { lowStockThreshold })}
              onEnter={() => void saveOne(r.id)}
            />
          );
        },
      },
      {
        id: 'cost',
        header: () => t('salesDishes.col.cost', { currency }),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <NumberCell
              label={label(r, 'content.cost.label')}
              value={edits[r.id]?.cost ?? (r.cost === null ? '' : formatPriceInput(r.cost, currency))}
              problem={problems[r.id]?.cost}
              decimal
              disabled={!canPrice}
              title={canPrice ? undefined : t('content.price.locked')}
              onChange={(cost) => change(r.id, { cost })}
              onEnter={() => void saveOne(r.id)}
            />
          );
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('salesDishes.col.actions')}</span>,
        cell: ({ row }) => {
          const r = row.original;
          const dirty = dirtyIds.includes(r.id);
          return (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="primary" disabled={!dirty} pending={saving.has(r.id)} onClick={() => void saveOne(r.id)} aria-label={t('salesDishes.saveRow', { name: r.name })}>
                {t('common.save')}
              </Button>
              <IconButton label={t('salesDishes.undoRow', { name: r.name })} icon={<RotateCcw aria-hidden />} size="sm" disabled={!dirty || saving.has(r.id)} onClick={() => drop(r.id)} />
            </div>
          );
        },
      },
    ];
    // The row handlers read the current edits and rows on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, edits, problems, saving, currency, canPrice, byId, dirtyIds.join(',')]);

  // TanStack Table returns functions that change identity on every render, which is what it is designed for.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: shown, columns, getRowId: (row) => row.id, getCoreRowModel: getCoreRowModel() });

  const categories = [{ value: '', label: t('prices.allCategories') }, ...view.categories.map((category) => ({ value: category.id, label: name(category.names) }))];
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-4 px-4 pb-24 pt-6 sm:px-8">
      <PageIntro title={t('salesDishes.title')} body={t('salesDishes.body')} />

      {all.length === 0 ? (
        <EmptyState title={t('salesDishes.noDishes')} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-full flex-col gap-1 sm:w-64">
              <span className="text-sm font-medium text-text">{t('prices.category')}</span>
              <Select
                options={categories}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              />
            </label>
            <label className="flex w-full flex-col gap-1 sm:w-64">
              <span className="text-sm font-medium text-text">{t('salesDishes.search')}</span>
              <span className="relative">
                <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={cx(INPUT_CLASSES, 'h-9 ps-8 tabular-nums')}
                />
              </span>
            </label>
            <div className="ms-auto flex items-center gap-3">
              {dirtyIds.length > 0 && <span className="text-sm text-muted">{t('salesDishes.changed', { count: numberFormat(locale).format(dirtyIds.length) })}</span>}
              <Button variant="primary" disabled={dirtyIds.length === 0 || saving.size > 0} pending={saving.size > 0} onClick={() => void saveAll()}>
                {t('salesDishes.saveAll')}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-raised md:overflow-x-auto">
            <table className="block w-full border-collapse text-sm md:table">
              <caption className="sr-only">{t('salesDishes.caption')}</caption>
              <thead className="hidden md:table-header-group">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id} className="border-b border-line">
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" className="h-9 whitespace-nowrap px-2 text-start text-xs font-medium text-muted first:ps-4 last:pe-4">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="block md:table-row-group">
                {rows.length === 0 ? (
                  <tr className="block md:table-row">
                    <td colSpan={columns.length} className="block px-4 py-10 text-center text-muted md:table-cell">
                      {t('salesDishes.empty')}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const first = index === 0 || rows[index - 1]!.original.categoryId !== row.original.categoryId;
                    const dirty = dirtyIds.includes(row.original.id);
                    return (
                      <Fragment key={row.id}>
                        {first && (
                          <tr className="block border-b border-line bg-surface md:table-row">
                            <th scope="rowgroup" colSpan={columns.length} className="block px-4 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted md:table-cell">
                              {row.original.category}
                            </th>
                          </tr>
                        )}
                        <tr
                          className={cx(
                            'block border-b border-line px-4 py-3 last:border-b-0 md:table-row md:p-0',
                            dirty ? 'bg-accent-wash' : 'hover:bg-surface',
                          )}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td
                              key={cell.id}
                              className={cx(
                                'flex items-center justify-between gap-3 py-1.5 md:table-cell md:h-12 md:px-2 md:align-middle md:first:ps-4 md:last:pe-4',
                                cell.column.id === 'dish' && 'md:max-w-36',
                                cell.column.id === 'badges' && 'md:min-w-44',
                                (cell.column.id === 'serves' || cell.column.id === 'lowStock') && 'md:w-16',
                                cell.column.id === 'cost' && 'md:w-20',
                                cell.column.id === 'priority' && 'md:w-28',
                              )}
                            >
                              {CARD_LABELS[cell.column.id] ? (
                                <span className="shrink-0 text-sm text-muted md:hidden">{t(CARD_LABELS[cell.column.id]!, { currency })}</span>
                              ) : null}
                              <div className={cx('min-w-0', CARD_LABELS[cell.column.id] ? 'ms-auto md:ms-0' : 'w-full md:w-auto')}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** A small number input in a cell; Enter saves the row, and the message of a refusal sits under it. */
function NumberCell({
  label,
  value,
  problem,
  decimal = false,
  disabled = false,
  title,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  problem?: string | undefined;
  decimal?: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 md:items-start">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onEnter();
          }
        }}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        inputMode={decimal ? 'decimal' : 'numeric'}
        dir="ltr"
        disabled={disabled}
        title={title}
        className={cx(INPUT_CLASSES, 'w-24 text-end md:w-16')}
      />
      {problem && (
        <span role="alert" className="max-w-40 text-xs text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}
