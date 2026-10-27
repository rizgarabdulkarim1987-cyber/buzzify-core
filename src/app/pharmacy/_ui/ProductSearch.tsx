'use client';

import { CircleAlert, FileDown, FileUp, PackageOpen, Plus, Search, SearchX, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchProducts, listProducts } from '@/app/pharmacy/_actions/catalog';
import type { Locale } from '@/lib/locale';
import type { PhMoney } from '@/server/domain/pharmacy/money';
import { formatPhMoney } from '@/server/domain/pharmacy/money';
import type { ProductCost, ProductSummary } from '@/server/pharmacy/products';
import type { SearchResult } from '@/server/pharmacy/search';
import { settle } from '@/studio/settle';
import { useLocale, useT } from '@/studio/i18n';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';

/** One row of the list, from a page of the catalog or from a search. */
interface Row {
  id: string;
  name: string;
  strength: string;
  form: string;
  packLabel: string;
  rxLevel?: ProductSummary['rxLevel'];
  active?: boolean;
  price?: PhMoney | null;
  matchedOn?: SearchResult['matchedOn'];
  cost?: ProductCost;
}

type SearchItem = SearchResult & { cost?: ProductCost };

const fromSummary = (p: ProductSummary): Row => ({
  id: p.id,
  name: p.tradeName,
  strength: p.strength,
  form: p.form,
  packLabel: p.packLabel,
  rxLevel: p.rxLevel,
  active: p.active,
  ...(p.cost ? { cost: p.cost } : {}),
});

const fromSearch = (s: SearchItem): Row => ({
  id: s.productId,
  name: s.label,
  strength: s.strength,
  form: s.form,
  packLabel: s.packLabel,
  price: s.price,
  matchedOn: s.matchedOn,
  ...(s.cost ? { cost: s.cost } : {}),
});

type ActiveFilter = 'active' | 'archived' | 'all';

/** A money amount as the menu writes it; null when it cannot be shown. */
function money(m: PhMoney | null | undefined, locale: Locale): string | null {
  if (!m) return null;
  try {
    return formatPhMoney({ amount: BigInt(m.amount), currency: m.currency }, locale);
  } catch {
    return null;
  }
}

/** Whether a key press belongs to a control the person is typing in. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export interface ProductSearchProps {
  initial: { items: ProductSummary[]; nextCursor: string | null };
  /** The person's role has `cost.view`: the cost column is drawn. Without it, nothing of cost reaches the page. */
  showCost: boolean;
  canManage: boolean;
  canImport: boolean;
  /** Whether the export links are drawn: the server allows any reader, the screen offers it to those who manage or report. */
  canExport?: boolean;
}

/**
 * The catalog: one central search (barcode, names, ingredient; `/` focuses it from anywhere on the page) over the list of
 * products. Every row shows strength, form and pack, so 500 mg and 1000 mg never look alike; a long name in any script
 * wraps and is never cut. Loading, empty, failed and offline each say so with an icon. Nothing moves.
 */
export function ProductSearch({ initial, showCost, canManage, canImport, canExport = true }: ProductSearchProps) {
  const t = useT();
  const { locale } = useLocale();
  const searchBox = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ActiveFilter>('active');
  const [list, setList] = useState({ rows: initial.items.map(fromSummary), nextCursor: initial.nextCursor });
  const [found, setFound] = useState<Row[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [online, setOnline] = useState(true);
  const asked = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      searchBox.current?.querySelector('input')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const runSearch = useCallback(async (text: string) => {
    const ask = ++asked.current;
    if (text.trim() === '') {
      setFound(null);
      setState('idle');
      return;
    }
    setState('loading');
    const result = await settle(() => searchProducts({ q: text, includeInactive: true }));
    if (ask !== asked.current) return;
    if (!result.ok) {
      setState('failed');
      return;
    }
    setFound((result.data as SearchItem[]).map(fromSearch));
    setState('idle');
  }, []);

  // A pause in typing (or a scanner's Enter) starts the search; a newer one makes an older answer moot.
  useEffect(() => {
    if (q.trim() === '') return;
    const timer = setTimeout(() => void runSearch(q), 250);
    return () => clearTimeout(timer);
  }, [q, runSearch]);

  // Emptying the box goes straight back to the list (and drops any answer still on its way).
  const changeQuery = (text: string) => {
    setQ(text);
    if (text.trim() === '') void runSearch('');
  };

  const loadList = async (active: ActiveFilter, cursor: string | null) => {
    setState('loading');
    const result = await settle(() => listProducts({ active, cursor }));
    if (!result.ok) {
      setState('failed');
      return;
    }
    const page = result.data as { items: ProductSummary[]; nextCursor: string | null };
    setList((was) => ({ rows: [...(cursor ? was.rows : []), ...page.items.map(fromSummary)], nextCursor: page.nextCursor }));
    setState('idle');
  };

  const searching = q.trim() !== '';
  const rows = searching ? (found ?? []) : list.rows;
  const catalogEmpty = !searching && filter === 'active' && list.rows.length === 0 && state !== 'failed';

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canManage && (
        <Link href="/pharmacy/catalog/new" className={buttonClasses('primary', 'md')}>
          <Plus aria-hidden />
          {t('pharmacy.catalog.add')}
        </Link>
      )}
      {canImport && (
        <Link href="/pharmacy/catalog/import" className={buttonClasses('secondary', 'md')}>
          <FileUp aria-hidden />
          {t('pharmacy.catalog.import')}
        </Link>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {!catalogEmpty && actions}
        {!catalogEmpty && canExport && (
          <div className="flex flex-wrap items-center gap-2">
            <a href="/pharmacy/catalog/export?format=csv" className={buttonClasses('ghost', 'md')} download>
              <FileDown aria-hidden />
              {t('pharmacy.catalog.exportCsv')}
            </a>
            <a href="/pharmacy/catalog/export?format=xlsx" className={buttonClasses('ghost', 'md')} download>
              <FileDown aria-hidden />
              {t('pharmacy.catalog.exportXlsx')}
            </a>
          </div>
        )}
      </div>

      {!online && (
        <p data-testid="catalog-offline" role="status" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <WifiOff aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.catalog.offline')}</span>
        </p>
      )}

      {catalogEmpty ? (
        <div data-testid="catalog-empty">
          <EmptyState
            icon={<PackageOpen />}
            title={t('pharmacy.catalog.empty.title')}
            body={canManage || canImport ? t('pharmacy.catalog.empty.body') : t('pharmacy.catalog.empty.viewOnly')}
            action={canManage || canImport ? actions : undefined}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            <Field label={t('pharmacy.catalog.search.label')} hint={t('pharmacy.catalog.search.hint')}>
              <div ref={searchBox} className="relative">
                <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  type="search"
                  dir="auto"
                  autoComplete="off"
                  enterKeyHint="search"
                  value={q}
                  onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void runSearch(q);
                    }
                  }}
                  className="ps-8"
                />
              </div>
            </Field>
            {!searching && (
              <Field label={t('pharmacy.catalog.filter.label')}>
                <Select
                  value={filter}
                  onChange={(event) => {
                    const next = event.target.value as ActiveFilter;
                    setFilter(next);
                    void loadList(next, null);
                  }}
                  options={(['active', 'archived', 'all'] as const).map((value) => ({ value, label: t(`pharmacy.catalog.filter.${value}`) }))}
                />
              </Field>
            )}
          </div>

          <p role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted">
            {state === 'loading' ? (
              <>
                <Search aria-hidden className="size-4 shrink-0" />
                {t('pharmacy.catalog.search.searching')}
              </>
            ) : searching && found ? (
              found.length > 0 ? (
                t('pharmacy.catalog.search.count', { count: found.length })
              ) : null
            ) : null}
          </p>

          {state === 'failed' && (
            <div role="alert" className="flex flex-wrap items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span className="min-w-0 flex-1">{t('pharmacy.catalog.search.failed')}</span>
              <Button size="sm" onClick={() => (searching ? void runSearch(q) : void loadList(filter, null))}>
                {t('pharmacy.catalog.retry')}
              </Button>
            </div>
          )}

          {searching && found && found.length === 0 && state === 'idle' && (
            <EmptyState icon={<SearchX />} title={t('pharmacy.catalog.search.none', { q: `⁨${q.trim()}⁩` })} className="py-6" />
          )}

          {rows.length > 0 && (
            <ul aria-label={t('pharmacy.catalog.title')} className="flex flex-col border-t border-line">
              {rows.map((row) => (
                <ProductRow key={row.id} row={row} showCost={showCost} locale={locale} />
              ))}
            </ul>
          )}

          {!searching && list.nextCursor && (
            <div>
              <Button onClick={() => void loadList(filter, list.nextCursor)} pending={state === 'loading'}>
                {t('pharmacy.catalog.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProductRow({ row, showCost, locale }: { row: Row; showCost: boolean; locale: Locale }) {
  const t = useT();
  const details = [row.strength, row.form, row.packLabel].filter((part) => part.trim() !== '');
  const price = money(row.price, locale);
  return (
    <li
      data-testid="product-row"
      className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-line py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,9rem)_minmax(0,9rem)]"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={`/pharmacy/catalog/${row.id}`} className="min-w-0 rounded-sm text-base font-medium text-text underline-offset-2 hover:underline">
          <span data-testid="product-name" dir="auto" className="break-words [overflow-wrap:anywhere]">
            {row.name}
          </span>
        </Link>
        <div className="flex flex-wrap gap-1.5">
          {row.rxLevel && row.rxLevel !== 'OTC' && <StatusBadge tone="ink">{t(`pharmacy.catalog.rx.${row.rxLevel}`)}</StatusBadge>}
          {row.active === false && <StatusBadge>{t('pharmacy.catalog.archivedBadge')}</StatusBadge>}
          {row.matchedOn && row.matchedOn !== 'tradeName' && <StatusBadge>{t(`pharmacy.catalog.matched.${row.matchedOn}`)}</StatusBadge>}
        </div>
      </div>
      <p className="min-w-0 text-sm text-text">
        <span className="sr-only">{t('pharmacy.catalog.col.details')}: </span>
        <span dir="auto" className="break-words">
          {details.join(' · ')}
        </span>
      </p>
      {row.price !== undefined ? (
        <p className="text-sm text-text tabular-nums">
          <span className="text-muted md:sr-only">{t('pharmacy.catalog.col.price')}: </span>
          {price ?? <span className="text-muted">{t('pharmacy.catalog.noPrice')}</span>}
        </p>
      ) : (
        <span aria-hidden className="hidden md:block" />
      )}
      {showCost && row.cost ? (
        <p data-cost className="text-sm text-text tabular-nums">
          <span className="text-muted">{t('pharmacy.catalog.cost')}: </span>
          {row.cost.lastPurchaseMinor !== null && row.cost.currency ? (
            money({ amount: BigInt(row.cost.lastPurchaseMinor), currency: row.cost.currency }, locale)
          ) : (
            <span className="text-muted">{t('pharmacy.catalog.noCost')}</span>
          )}
        </p>
      ) : null}
    </li>
  );
}
