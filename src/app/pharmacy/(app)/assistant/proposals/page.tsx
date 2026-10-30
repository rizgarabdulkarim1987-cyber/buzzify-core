import { CircleCheck, CircleDashed, CircleX, Lock, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { proposalState } from '@/app/pharmacy/_ui/assistant-logic';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { Name } from '@/app/pharmacy/_ui/reports-parts';
import { getPhBranches } from '@/server/pharmacy/actor';
import { proposals } from '@/server/pharmacy/queries/assistant';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.assistant.proposals.title') };
}

const STATE_ICON = { open: CircleDashed, accepted: CircleCheck, dismissed: CircleX } as const;

/** The assistant's suggestions of the person's branches (`ai.use`): what each would hand over to, and whether it was decided. Reading stays open while the pharmacy is read-only. */
export default async function ProposalsPage() {
  const g = await phGate({
    permission: 'ai.use',
    titleKey: 'pharmacy.assistant.proposals.title',
    backTo: { href: '/pharmacy/assistant', labelKey: 'pharmacy.assistant.back' },
    testid: 'proposals-forbidden',
    messages: 'pharmacy.assistant.proposals',
  });
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const [rows, all] = await Promise.all([query(proposals, access.placeInput), getPhBranches(access.actor.restaurantId)]);
  const names = new Map(all.map((b) => [b.id, b.name]));
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.assistant.proposals.title')} description={t('pharmacy.assistant.proposals.intro')} above={g.back} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8" data-testid="proposals">
        {rows.length === 0 ? (
          <EmptyState icon={<Sparkles />} title={t('pharmacy.assistant.proposals.empty.title')} body={t('pharmacy.assistant.proposals.empty.body')} />
        ) : (
          <ul className="flex flex-col border-t border-line" data-testid="proposal-list">
            {rows.map((r) => {
              const state = proposalState(r);
              const Icon = STATE_ICON[state];
              const lines = (r.payload as { lines?: unknown[] } | null)?.lines?.length ?? 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line py-3 text-sm" data-testid="proposal-row" data-state={state}>
                  <Link href={`/pharmacy/assistant/proposals/${r.id}`} className="inline-flex min-h-11 items-center rounded-md px-1 font-semibold text-text underline underline-offset-2 hover:bg-hover">
                    {t(`pharmacy.assistant.kind.${r.kind}`)}
                  </Link>
                  <span className="inline-flex items-center gap-1.5 text-text">
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {t(`pharmacy.assistant.state.${state}`)}
                  </span>
                  <span className="text-muted">
                    <Name>{names.get(r.branchId) ?? t('pharmacy.assistant.otherBranch')}</Name>
                  </span>
                  <span className="text-muted">{t('pharmacy.assistant.proposals.lines', { n: lines })}</span>
                  <span className="ms-auto text-muted">
                    <bdi dir="ltr" className="tabular-nums">
                      {phDate(r.createdAt, locale)}
                    </bdi>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="flex items-start gap-2 text-xs text-muted">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          {t('pharmacy.assistant.proposals.note')}
        </p>
      </div>
    </>
  );
}
