import { Lock, ListX, ScrollText, Search, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MovementList } from '@/app/pharmacy/_ui/MovementList';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { StockBlocked } from '@/app/pharmacy/_ui/StockBlocked';
import { movements } from '@/server/pharmacy/queries/stock';
import { MOVEMENT_TYPES } from '@/server/pharmacy/stock-reads';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Select } from '@/studio/ui/Select';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.movements.title') };
}

const PAGE_SIZE = 50;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The stock ledger, newest first, filtered by product, type and dates. For the roles that read reports; the others and a
 * support actor get a sentence saying so. Reversing a change is offered to those who may adjust stock, in the chosen
 * branch, and only for the kinds the server allows.
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const header = (
    <PageHeader
      className="max-sm:px-4"
      title={t('pharmacy.movements.title')}
      description={t('pharmacy.movements.intro')}
      above={
        <Link href="/pharmacy/stock" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
          <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
          {t('pharmacy.movements.back')}
        </Link>
      }
    />
  );

  if (actor.role === null || !roleMay(actor, 'report.view')) {
    return (
      <>
        {header}
        <div data-testid="movements-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.movements.forbidden.title')} body={t(actor.role === null ? 'pharmacy.movements.forbidden.support' : 'pharmacy.movements.forbidden.role')} />
        </div>
      </>
    );
  }

  const type = MOVEMENT_TYPES.find((value) => value === one(raw.type));
  const from = DATE.test(one(raw.from) ?? '') ? one(raw.from) : undefined;
  const to = DATE.test(one(raw.to) ?? '') ? one(raw.to) : undefined;
  const product = one(raw.product)?.slice(0, 64) || undefined;
  const cursor = one(raw.cursor)?.slice(0, 64) || undefined;
  const filtered = Boolean(type || from || to || product);

  const page = await query(movements, {
    ...access.placeInput,
    ...(type ? { type } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(product ? { productId: product } : {}),
    ...(cursor ? { cursor } : {}),
    pageSize: PAGE_SIZE,
  });

  const adjust = access.writable('stock.adjust');
  const reverseBranchId = adjust.ok ? access.place.branchId : null;
  const link = (over: { cursor?: string | undefined; product?: string | undefined }) => {
    const next = new URLSearchParams();
    const merged = { type, from, to, product, ...over };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    if (over.cursor) next.set('cursor', over.cursor);
    const text = next.toString();
    return `/pharmacy/stock/movements${text ? `?${text}` : ''}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!adjust.ok && <StockBlocked reason={adjust.reason} t={t} />}
        {adjust.ok && reverseBranchId === null && (
          <p data-testid="movements-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.movements.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />

        <form method="get" action="/pharmacy/stock/movements" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <Field label={t('pharmacy.movements.filter.type')}>
            <Select
              name="type"
              defaultValue={type ?? ''}
              className="[&_select]:min-h-11"
              options={[{ value: '', label: t('pharmacy.movements.filter.anyType') }, ...MOVEMENT_TYPES.map((value) => ({ value, label: t(`pharmacy.movements.type.${value}`) }))]}
            />
          </Field>
          <Field label={t('pharmacy.movements.filter.from')}>
            <Input name="from" type="date" dir="ltr" defaultValue={from ?? ''} className="min-h-11" />
          </Field>
          <Field label={t('pharmacy.movements.filter.to')}>
            <Input name="to" type="date" dir="ltr" defaultValue={to ?? ''} className="min-h-11" />
          </Field>
          {product && <input type="hidden" name="product" value={product} />}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Search aria-hidden />
              {t('pharmacy.movements.filter.apply')}
            </button>
            {filtered && (
              <Link href="/pharmacy/stock/movements" className={buttonClasses('ghost', 'lg', 'min-h-11')}>
                {t('pharmacy.movements.filter.clear')}
              </Link>
            )}
          </div>
        </form>

        {product && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text">
            <span>{t('pharmacy.movements.filter.product')}</span>
            <Link href={link({ product: undefined })} className="inline-flex min-h-11 items-center rounded-md px-2 font-medium underline underline-offset-2 hover:bg-hover">
              {t('pharmacy.movements.filter.productClear')}
            </Link>
          </p>
        )}

        {page.items.length === 0 ? (
          <div data-testid="movements-empty">
            <EmptyState
              icon={filtered ? <ListX /> : <ScrollText />}
              title={t(filtered ? 'pharmacy.movements.empty.filtered' : 'pharmacy.movements.empty.title')}
              body={t(filtered ? 'pharmacy.movements.empty.filteredBody' : 'pharmacy.movements.empty.body')}
            />
          </div>
        ) : (
          <MovementList items={page.items} t={t} reverseBranchId={reverseBranchId} />
        )}

        {(page.nextCursor || cursor) && (
          <nav aria-label={t('pharmacy.movements.title')} className="flex flex-wrap items-center gap-2">
            {cursor && (
              <Link href={link({})} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={link({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
