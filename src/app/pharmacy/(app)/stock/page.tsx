import { ArrowLeftRight, Lock, PackageOpen, SearchX, History, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { StockBlocked } from '@/app/pharmacy/_ui/StockBlocked';
import { StockList } from '@/app/pharmacy/_ui/StockList';
import { transfersWaiting } from '@/app/pharmacy/_ui/transfers-counts';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { getPhBranches, getPhPlaces } from '@/server/pharmacy/actor';
import { balances } from '@/server/pharmacy/queries/stock';
import { inTransit as inTransitQuery } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.stock.title') };
}

const PAGE_SIZE = 25;
type Params = { q?: string; stock?: string; low?: string; product?: string; cursor?: string };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Stock by product: the totals of each branch shown and the batches in the order they should be sold. Everyone on the
 * staff may look; changing stock follows the role, the pharmacy's state and having one branch chosen, and the page says
 * why the controls are missing. A support actor and a role without the screen get a sentence, not an empty page.
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale, places] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const sp: Params = { q: one(raw.q)?.slice(0, 100), stock: one(raw.stock), low: one(raw.low), product: one(raw.product), cursor: one(raw.cursor) };
  const { actor } = access;
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.stock.title')} description={t('pharmacy.stock.intro')} />;

  if (actor.role === null || !roleMay(actor, 'catalog.view')) {
    return (
      <>
        {header}
        <div data-testid="stock-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.stock.forbidden.title')} body={t(actor.role === null ? 'pharmacy.stock.forbidden.support' : 'pharmacy.stock.forbidden.role')} />
        </div>
      </>
    );
  }

  const q = sp.q?.trim() ?? '';
  const filtered = q !== '' || sp.stock === '1' || sp.low === '1' || Boolean(sp.product);
  const page = await query(balances, {
    ...access.placeInput,
    ...(q !== '' ? { search: q } : {}),
    ...(sp.stock === '1' ? { onlyWithStock: true } : {}),
    ...(sp.low === '1' ? { lowStock: true } : {}),
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
  const links = (over: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...over };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return `/pharmacy/stock${text ? `?${text}` : ''}`;
  };
  const canSeeMovements = roleMay(actor, 'report.view');

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!adjust.ok && <StockBlocked reason={adjust.reason} t={t} />}
        {adjust.ok && adjustBranchId === null && (
          <p data-testid="stock-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.stock.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />

        <form method="get" action="/pharmacy/stock" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="flex min-w-0 flex-col gap-3">
            <Field label={t('pharmacy.stock.search.label')} hint={t('pharmacy.stock.search.hint')}>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input name="q" type="search" dir="auto" autoComplete="off" enterKeyHint="search" defaultValue={q} className="min-h-11 ps-8" />
              </div>
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <label className="inline-flex min-h-11 items-center gap-2.5 text-sm text-text">
                <input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === '1'} className="size-5" />
                {t('pharmacy.stock.filter.withStock')}
              </label>
              <label className="inline-flex min-h-11 items-center gap-2.5 text-sm text-text">
                <input type="checkbox" name="low" value="1" defaultChecked={sp.low === '1'} className="size-5" />
                {t('pharmacy.stock.filter.low')}
              </label>
            </div>
            {sp.product && <input type="hidden" name="product" value={sp.product} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Search aria-hidden />
              {t('pharmacy.stock.filter.apply')}
            </button>
            {filtered && (
              <Link href="/pharmacy/stock" className={buttonClasses('ghost', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.filter.clear')}
              </Link>
            )}
          </div>
        </form>

        {sp.product && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text">
            <span>{t('pharmacy.stock.filter.product')}</span>
            <Link href={links({ product: undefined, cursor: undefined })} className="inline-flex min-h-11 items-center rounded-md px-2 font-medium underline underline-offset-2 hover:bg-hover">
              {t('pharmacy.stock.filter.productClear')}
            </Link>
          </p>
        )}
        {mayTransfer && waiting && (
          <p>
            <Link href="/pharmacy/stock/transfers" data-testid="stock-transfers-link" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
              <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.transfers.stockLink')}
              {waiting.send + waiting.receive > 0 && (
                <span data-testid="stock-transfers-count" className="tabular-nums">
                  {' · '}
                  {t('pharmacy.transfers.stockLinkCount', { count: `${waiting.send + waiting.receive}${waiting.more ? '+' : ''}` })}
                </span>
              )}
            </Link>
          </p>
        )}
        {canSeeMovements && (
          <p>
            <Link href="/pharmacy/stock/movements" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
              <History aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.stock.movementsLink')}
            </Link>
          </p>
        )}

        {page.items.length === 0 ? (
          <div data-testid="stock-empty">
            <EmptyState
              icon={filtered ? <SearchX /> : <PackageOpen />}
              title={t(filtered ? 'pharmacy.stock.empty.filtered' : 'pharmacy.stock.empty.title')}
              body={t(filtered ? 'pharmacy.stock.empty.filteredBody' : 'pharmacy.stock.empty.body')}
            />
          </div>
        ) : (
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
        )}

        {(page.nextCursor || sp.cursor) && (
          <nav aria-label={t('pharmacy.stock.title')} className="flex flex-wrap items-center gap-2">
            {sp.cursor && (
              <Link href={links({ cursor: undefined })} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={links({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
