import { CircleAlert, FileText, Lock, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { IntakeUsage } from '@/app/pharmacy/_ui/IntakeUsage';
import { BatchStatus } from '@/app/pharmacy/_ui/intake-parts';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { peopleOf } from '@/app/pharmacy/_ui/people';
import { phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { formatNumber } from '@/lib/pos-format';
import { aiPricingEnv } from '@/server/env';
import { usage } from '@/server/pharmacy/queries/intake';
import { batchList } from '@/server/pharmacy/queries/intake-review';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../catalog/access';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.intake.title') };
}

const STATUSES = ['OPEN', 'APPROVED', 'CANCELLED'] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Whether the model's price is set in the environment; a half-set price counts as not set (the AI then refuses to run). */
function pricingIsSet(): boolean {
  try {
    return aiPricingEnv() !== null;
  } catch {
    return false;
  }
}

/**
 * Invoice by photo, the batches: newest first, with the state, supplier, how many files and lines, who started it and the
 * files that need a person. A status filter, "Load more" by keyset, and for a role that may buy and see reports this
 * month's AI spending. Only a role with `purchase.manage` gets here; a role without `ai.use` sees the list and a disabled
 * "New batch" with the reason.
 */
export default async function IntakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.intake.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const status = STATUSES.find((s) => s === one(raw.status));
  const pages = pagesOf(one(raw.pages));
  const showUsage = roleMay(access.actor, 'report.view');
  const [page, usageView] = await Promise.all([
    loadPages((cursor) => query(batchList, { ...access.placeInput, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }), pages),
    showUsage ? query(usage, access.placeInput).catch(() => null) : Promise.resolve(null),
  ]);
  const people = await peopleOf(
    access.placeInput,
    page.items.map((b) => b.createdById),
  );
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/intake${text ? `?${text}` : ''}`;
  };
  const mayAi = roleMay(access.actor, 'ai.use');
  const canNew = g.writable.ok && mayAi && access.place.branchId !== null;
  // Why "New batch" is not available, in words: a read-only pharmacy has its own notice above; the others say it here.
  const why = !g.writable.ok ? null : !mayAi ? 'pharmacy.intake.noAi' : access.place.branchId === null ? 'pharmacy.intake.pickBranch' : null;
  const newButton = canNew ? (
    <Link href="/pharmacy/purchasing/intake/new" data-testid="intake-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
      <Plus aria-hidden />
      {t('pharmacy.intake.new')}
    </Link>
  ) : (
    <button type="button" disabled data-testid="intake-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
      <Plus aria-hidden />
      {t('pharmacy.intake.new')}
    </button>
  );
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.intake.title')} description={t('pharmacy.intake.intro')} actions={newButton} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        {why && (
          <p data-testid="intake-new-why" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t(why)}</span>
          </p>
        )}
        <OfflineNotice />
        {usageView && <IntakeUsage view={usageView} pricingSet={pricingIsSet()} t={t} />}
        <nav aria-label={t('pharmacy.intake.filter')} className="flex flex-wrap gap-2">
          <Link href={href({ status: undefined, pages: undefined })} aria-current={!status ? 'page' : undefined} className={buttonClasses(!status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: s, pages: undefined })} aria-current={s === status ? 'page' : undefined} className={buttonClasses(s === status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.intake.status.${s}`)}
            </Link>
          ))}
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="intake-empty">
            <EmptyState
              icon={status ? <SearchX /> : <FileText />}
              title={t(status ? 'pharmacy.intake.emptyFiltered' : 'pharmacy.intake.empty')}
              body={t(status ? 'pharmacy.intake.emptyFilteredBody' : 'pharmacy.intake.emptyBody')}
              action={
                !status && canNew ? (
                  <Link href="/pharmacy/purchasing/intake/new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
                    <Plus aria-hidden />
                    {t('pharmacy.intake.new')}
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.intake.title')} className="flex flex-col border-t border-line">
            {page.items.map((b) => (
              <li key={b.id} data-testid="intake-row" className="border-b border-line">
                <Link href={`/pharmacy/purchasing/intake/${b.id}`} className="flex min-h-11 min-w-0 flex-col gap-2 rounded-sm px-1 py-3 hover:bg-hover">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <BatchStatus status={b.status} t={t} />
                    <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                      {b.supplierName ?? <span className="text-muted">{t('pharmacy.intake.noSupplier')}</span>}
                    </span>
                    {b.invoiceNumber && (
                      <bdi dir="ltr" className="text-sm text-muted tabular-nums">
                        {b.invoiceNumber}
                      </bdi>
                    )}
                    {b.attentionCount > 0 && (
                      <span data-testid="intake-attention" className="inline-flex min-h-6 items-center gap-1.5 rounded-sm bg-danger-wash px-1.5 py-0.5 text-xs font-medium text-danger [&_svg]:size-3.5 [&_svg]:shrink-0">
                        <CircleAlert aria-hidden />
                        {t('pharmacy.intake.attention', { count: formatNumber(b.attentionCount) })}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                    <span>
                      {t('pharmacy.intake.files')}:{' '}
                      <bdi dir="ltr" className="tabular-nums">
                        {formatNumber(b.fileCount)}
                      </bdi>
                    </span>
                    <span>
                      {t('pharmacy.intake.lines')}:{' '}
                      <bdi dir="ltr" className="tabular-nums">
                        {formatNumber(b.rowCount)}
                      </bdi>
                    </span>
                    <span>{t('pharmacy.intake.createdBy', { name: people[b.createdById] ?? b.createdById.slice(0, 8) })}</span>
                    <bdi dir="ltr">{phDateTime(b.createdAt, locale)}</bdi>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.intake.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" data-testid="intake-more" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
