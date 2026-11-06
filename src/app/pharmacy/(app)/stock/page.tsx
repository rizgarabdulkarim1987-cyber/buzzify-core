import { ArrowLeftRight, Download, History, Lock, PackageOpen, Plus, ScanBarcode, Search, SearchX, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { StockBlocked } from '@/app/pharmacy/_ui/StockBlocked';
import { StockList, StockListHead } from '@/app/pharmacy/_ui/StockList';
import { filterQuery, parseStockFilter, productCount, STOCK_FILTERS, type StockFilter } from '@/app/pharmacy/_ui/stock-logic';
import { transfersWaiting } from '@/app/pharmacy/_ui/transfers-counts';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { getPhBranches, getPhPlaces } from '@/server/pharmacy/actor';
import { balances } from '@/server/pharmacy/queries/stock';
import { inTransit as inTransitQuery } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.stock.title') };
}

/** The most rows one page carries (the query's maximum); the rest are behind "Next". */
const PAGE_SIZE = 100;
type Params = { q?: string; filter?: string; stock?: string; product?: string; cursor?: string };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The redesign's 44px controls (`--ph-*`), kept here: the Sell screen's are in a client module. */
const TOUCH = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ph-xl px-3 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0';
const BTN = `${TOUCH} border border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas`;
const PRIMARY = `${TOUCH} bg-ph-g8 px-4 text-ph-on-green hover:bg-ph-g9`;
const QUIET = 'inline-flex min-h-11 items-center gap-2 rounded-ph-xl px-2 text-sm font-medium text-ph-text underline underline-offset-2 hover:bg-ph-card [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * Stock by product: a count, the actions the role allows, a search and four filter chips over one card that scrolls on its
 * own, a 52px row per product that opens on the totals of each branch and the batches in the order they should be sold.
 * Everyone on the staff may look; changing stock follows the role, the pharmacy's state and having one branch chosen, and
 * the page says why the controls are missing. A support actor and a role without the screen get a sentence, not an empty page.
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale, places] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  // `?low=1` was the old checkbox: it still means the Low chip.
  const filter: StockFilter = one(raw.low) === '1' && one(raw.filter) === undefined ? 'low' : parseStockFilter(one(raw.filter));
  const sp: Params = {
    q: one(raw.q)?.slice(0, 100),
    ...(filter !== 'all' ? { filter } : {}),
    stock: one(raw.stock),
    product: one(raw.product),
    cursor: one(raw.cursor),
  };
  const { actor } = access;
  const title = (count?: ReactNode) => (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="break-words text-[26px] font-bold leading-8 tracking-tight text-ph-text" dir="auto">
        {t('pharmacy.stock.title')}
      </h1>
      {count}
    </div>
  );

  if (actor.role === null || !roleMay(actor, 'catalog.view')) {
    return (
      <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-8">
        {title()}
        <div data-testid="stock-forbidden">
          <EmptyState icon={<Lock />} title={t('pharmacy.stock.forbidden.title')} body={t(actor.role === null ? 'pharmacy.stock.forbidden.support' : 'pharmacy.stock.forbidden.role')} />
        </div>
      </div>
    );
  }

  const q = sp.q?.trim() ?? '';
  const filtered = q !== '' || filter !== 'all' || sp.stock === '1' || Boolean(sp.product);
  const page = await query(balances, {
    ...access.placeInput,
    ...(q !== '' ? { search: q } : {}),
    ...(sp.stock === '1' ? { onlyWithStock: true } : {}),
    ...filterQuery(filter),
    ...(sp.product ? { productId: sp.product } : {}),
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
    pageSize: PAGE_SIZE,
  });

  // Transfers: a read-only "on the road" line per product and the open-transfer count, for roles that move stock. They change no stock figure.
  const mayTransfer = roleMay(actor, 'transfer.manage');
  const [road, waiting] = mayTransfer
    ? await Promise.all([
        query(inTransitQuery, { ...access.placeInput, ...(sp.product ? { productId: sp.product } : {}) }),
        transfersWaiting(access.placeInput, { allBranches: actor.allBranches, branchIds: actor.branchIds }),
      ])
    : [null, null];
  const inTransit: Record<string, { toBranchId: string; qty: number }[]> = {};
  for (const item of road ?? []) {
    const rows = (inTransit[item.productId] ??= []);
    const found = rows.find((r) => r.toBranchId === item.toBranchId);
    if (found) found.qty += item.qty;
    else rows.push({ toBranchId: item.toBranchId, qty: item.qty });
  }
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  // The destination of a transfer may be a branch the person does not work in: its name comes from the business's list.
  const everyBranch = mayTransfer ? await getPhBranches(actor.restaurantId) : [];
  const branchNames = Object.fromEntries([...everyBranch, ...branches].map((b) => [b.id, b.name]));
  const adjust = access.writable('stock.adjust');
  const adjustBranchId = adjust.ok ? access.place.branchId : null;
  const canAdd = access.writable('catalog.manage').ok;
  const canImport = access.writable('import.apply').ok;
  const canExport = roleMay(actor, 'catalog.manage') || roleMay(actor, 'report.view');
  // Fast product entry: the nav's Stock item opens it for a role that receives goods; this is its way back from the list.
  const canEntry = roleMay(actor, 'purchase.manage');
  const links = (over: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...over };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return `/pharmacy/stock${text ? `?${text}` : ''}`;
  };
  const canSeeMovements = roleMay(actor, 'report.view');

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3 px-4 py-5 sm:px-8 md:flex-1">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        {title(
          <span data-testid="stock-count" className="text-sm font-medium text-ph-muted tabular-nums">
            {productCount(t, page.total)}
          </span>,
        )}
        {(canImport || canExport || canAdd || canEntry) && (
          <div className="flex flex-wrap items-center gap-2">
            {canEntry && (
              <Link href="/pharmacy/stock/entry" data-testid="stock-entry-link" className={canAdd ? BTN : PRIMARY}>
                <ScanBarcode aria-hidden />
                {t('pharmacy.stock.entryLink')}
              </Link>
            )}
            {canImport && (
              <Link href="/pharmacy/catalog/import" className={BTN}>
                <Upload aria-hidden />
                {t('pharmacy.stock.import')}
              </Link>
            )}
            {canExport && (
              <a href="/pharmacy/catalog/export?format=xlsx" download className={BTN}>
                <Download aria-hidden />
                {t('pharmacy.stock.export')}
              </a>
            )}
            {canAdd && (
              <Link href="/pharmacy/catalog/new" data-testid="stock-new-product" className={PRIMARY}>
                <Plus aria-hidden />
                {t('pharmacy.stock.new')}
              </Link>
            )}
          </div>
        )}
      </div>

      {!adjust.ok && <StockBlocked reason={adjust.reason} t={t} />}
      {adjust.ok && adjustBranchId === null && (
        <p data-testid="stock-pick-branch" className="flex items-start gap-2.5 rounded-ph-xl border border-ph-line bg-ph-card px-3 py-2.5 text-sm text-ph-text">
          <Lock aria-hidden className="mt-px size-4 shrink-0 text-ph-muted" />
          <span className="min-w-0">{t('pharmacy.stock.pickBranch')}</span>
        </p>
      )}
      <OfflineNotice />

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <form method="get" action="/pharmacy/stock" role="search" className="flex min-w-0 flex-[1_1_18rem] items-center gap-2">
          <label className="relative flex min-w-0 flex-1">
            <span className="sr-only">{t('pharmacy.stock.search.label')}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ph-muted" />
            <input
              name="q"
              type="search"
              dir="auto"
              autoComplete="off"
              enterKeyHint="search"
              defaultValue={q}
              placeholder={t('pharmacy.stock.search.hint')}
              className="min-h-11 w-full min-w-0 rounded-ph-xl border border-ph-line bg-ph-card ps-9 pe-3 text-base text-ph-text placeholder:text-ph-muted focus:border-ph-accent"
            />
          </label>
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
          {sp.stock === '1' && <input type="hidden" name="stock" value="1" />}
          {sp.product && <input type="hidden" name="product" value={sp.product} />}
          <button type="submit" className={BTN} aria-label={t('pharmacy.stock.filter.apply')}>
            <Search aria-hidden />
            <span className="max-sm:sr-only">{t('pharmacy.stock.filter.apply')}</span>
          </button>
        </form>
        <nav aria-label={t('pharmacy.stock.chips')} className="flex min-w-0 flex-wrap items-center gap-2">
          {STOCK_FILTERS.map((chip) => {
            const active = chip === filter;
            return (
              <Link
                key={chip}
                href={links({ filter: chip === 'all' ? undefined : chip, cursor: undefined })}
                data-testid={`stock-filter-${chip}`}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
                  active ? 'border-transparent bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas'
                }`}
              >
                {t(`pharmacy.stock.chip.${chip}`)}
              </Link>
            );
          })}
        </nav>
      </div>

      {(sp.product || (mayTransfer && waiting) || canSeeMovements || filtered) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ph-text">
          {sp.product && (
            <>
              <span>{t('pharmacy.stock.filter.product')}</span>
              <Link href={links({ product: undefined, cursor: undefined })} className={QUIET}>
                {t('pharmacy.stock.filter.productClear')}
              </Link>
            </>
          )}
          {filtered && (
            <Link href="/pharmacy/stock" className={QUIET}>
              {t('pharmacy.stock.filter.clear')}
            </Link>
          )}
          {mayTransfer && waiting && (
            <Link href="/pharmacy/stock/transfers" data-testid="stock-transfers-link" className={QUIET}>
              <ArrowLeftRight aria-hidden />
              {t('pharmacy.transfers.stockLink')}
              {waiting.send + waiting.receive > 0 && (
                <span data-testid="stock-transfers-count" className="tabular-nums">
                  {' · '}
                  {t('pharmacy.transfers.stockLinkCount', { count: `${waiting.send + waiting.receive}${waiting.more ? '+' : ''}` })}
                </span>
              )}
            </Link>
          )}
          {canSeeMovements && (
            <Link href="/pharmacy/stock/movements" className={QUIET}>
              <History aria-hidden />
              {t('pharmacy.stock.movementsLink')}
            </Link>
          )}
        </div>
      )}

      <section data-testid="stock-card" aria-label={t('pharmacy.stock.title')} className="relative flex min-w-0 flex-col rounded-ph-2xl bg-ph-card md:min-h-0 md:flex-1 md:overflow-y-auto">
        {page.items.length === 0 ? (
          <div data-testid="stock-empty" className="p-4">
            <EmptyState
              icon={filtered ? <SearchX /> : <PackageOpen />}
              title={t(filtered ? 'pharmacy.stock.empty.filtered' : 'pharmacy.stock.empty.title')}
              body={t(filtered ? 'pharmacy.stock.empty.filteredBody' : 'pharmacy.stock.empty.body')}
            />
          </div>
        ) : (
          <>
            <StockListHead t={t} />
            <StockList
              items={page.items}
              t={t}
              locale={locale}
              today={utcToday()}
              branchNames={branchNames}
              showCost={access.showCost}
              adjustBranchId={adjustBranchId}
              {...(mayTransfer ? { inTransit } : {})}
            />
          </>
        )}

        {(page.nextCursor || sp.cursor) && (
          <nav aria-label={t('pharmacy.stock.title')} className="flex flex-wrap items-center gap-2 p-3">
            {sp.cursor && (
              <Link href={links({ cursor: undefined })} className={BTN}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={links({ cursor: page.nextCursor })} rel="next" className={BTN}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
