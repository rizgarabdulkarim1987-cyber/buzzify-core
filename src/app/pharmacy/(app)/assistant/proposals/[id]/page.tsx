import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { proposalState } from '@/app/pharmacy/_ui/assistant-logic';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { ProposalActions } from '@/app/pharmacy/_ui/ProposalActions';
import { Day, Name, Num } from '@/app/pharmacy/_ui/reports-parts';
import { proposalInput } from '@/server/domain/pharmacy/assistant-domain';
import { getPhBranches } from '@/server/pharmacy/actor';
import { proposals } from '@/server/pharmacy/queries/assistant';
import { get as getProduct } from '@/server/pharmacy/queries/products';
import { balances } from '@/server/pharmacy/queries/stock';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.assistant.review.title') };
}

/**
 * One suggestion, spelled out: what it is, for which branch, the products and quantities, and exactly what accepting does (it creates
 * nothing; it opens a pre-filled draft). A suggestion that is not the person's to see is not found. Nothing personal is on this page.
 */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await phGate({
    permission: 'ai.use',
    titleKey: 'pharmacy.assistant.review.title',
    backTo: { href: '/pharmacy/assistant/proposals', labelKey: 'pharmacy.assistant.proposals.back' },
    testid: 'proposals-forbidden',
    messages: 'pharmacy.assistant.proposals',
  });
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const rows = await query(proposals, access.placeInput);
  const row = rows.find((r) => r.id === id.slice(0, 64));
  if (!row) notFound();
  const state = proposalState(row);
  const parsed = proposalInput.safeParse({ kind: row.kind, ...(row.payload as object) });
  const all = await getPhBranches(access.actor.restaurantId);
  const names = new Map(all.map((b) => [b.id, b.name]));
  const branch = (b: string) => names.get(b) ?? t('pharmacy.assistant.otherBranch');

  const lines = parsed.success ? parsed.data.lines : [];
  const products = new Map<string, { name: string; meta: string }>();
  const lots = new Map<string, { lot: string; expiry: string }>();
  await Promise.all(
    [...new Set(lines.map((l) => l.productId))].map(async (productId) => {
      try {
        const p = await query(getProduct, { ...access.placeInput, productId });
        products.set(productId, { name: p.tradeName, meta: [p.strength, p.form].filter((x) => x.trim() !== '').join(' · ') });
        if (row.kind === 'SUPPLIER_RETURN') {
          const stock = await query(balances, { ...access.placeInput, productId, pageSize: 1 });
          for (const b of stock.items[0]?.batches ?? []) lots.set(b.batchId, { lot: b.lot, expiry: b.expiryDate });
        }
      } catch {
        // A product that cannot be read is shown without a name.
      }
    }),
  );

  return (
    <>
      <PageHeader className="max-sm:px-4" title={t(`pharmacy.assistant.kind.${row.kind}`)} description={t('pharmacy.assistant.review.title')} above={g.back} />
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="proposal-review" data-state={state}>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted">{t('pharmacy.assistant.review.branch')}</dt>
            <dd className="text-sm text-text">
              <Name>{branch(row.branchId)}</Name>
              {parsed.success && parsed.data.kind === 'TRANSFER' && (
                <>
                  {' → '}
                  <Name>{branch(parsed.data.toBranchId)}</Name>
                </>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted">{t('pharmacy.assistant.review.status')}</dt>
            <dd className="text-sm text-text">{t(`pharmacy.assistant.state.${state}`)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted">{t('pharmacy.assistant.review.made')}</dt>
            <dd className="text-sm text-text">
              <bdi dir="ltr" className="tabular-nums">
                {phDate(row.createdAt, locale)}
              </bdi>
            </dd>
          </div>
        </dl>

        <section aria-label={t('pharmacy.assistant.review.lines')} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-text">{t('pharmacy.assistant.review.lines')}</h2>
          {parsed.success ? (
            <div role="region" aria-label={t('pharmacy.assistant.review.lines')} tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[28rem] border-collapse" data-testid="proposal-lines">
                <thead className="border-b border-line bg-surface">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted">
                      {t('pharmacy.assistant.col.product')}
                    </th>
                    {row.kind === 'SUPPLIER_RETURN' && (
                      <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted">
                        {t('pharmacy.assistant.col.lot')}
                      </th>
                    )}
                    <th scope="col" className="px-3 py-2 text-start text-xs font-semibold text-muted">
                      {t('pharmacy.assistant.review.qty')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const p = products.get(l.productId);
                    const lot = 'batchId' in l && typeof l.batchId === 'string' ? lots.get(l.batchId) : undefined;
                    return (
                      <tr key={`${l.productId}:${i}`} className="border-b border-line last:border-0" data-testid="proposal-line">
                        <td className="px-3 py-2 text-sm text-text">
                          {p ? (
                            <>
                              <Name>{p.name}</Name>
                              <span className="block text-xs text-muted">
                                <Name>{p.meta}</Name>
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">{t('pharmacy.assistant.review.unknownProduct')}</span>
                          )}
                        </td>
                        {row.kind === 'SUPPLIER_RETURN' && (
                          <td className="px-3 py-2 text-sm text-text">
                            {lot ? (
                              <>
                                <Name>{lot.lot}</Name> · <Day day={lot.expiry} />
                              </>
                            ) : (
                              <span className="text-muted">{t('pharmacy.assistant.review.unknownLot')}</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 text-sm text-text">
                          <Num value={l.qty} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text" data-testid="proposal-unusable">
              <Info aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.assistant.review.unusable')}
            </p>
          )}
        </section>

        <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text" data-testid="proposal-effect">
          <Info aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{t(`pharmacy.assistant.effect.${row.kind}`)}</span>
        </p>

        <ProposalActions proposalId={row.id} kind={row.kind} state={state} decidedAt={row.decidedAt} writable={access.writable('ai.use')} />
      </div>
    </>
  );
}
