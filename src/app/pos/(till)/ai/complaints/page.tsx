import type { Metadata } from 'next';
import { formatStamp } from '@/lib/pos-format';
import { query } from '@/server/studio/framework/invoke';
import { posAiComplaintLabels } from '@/server/studio/queries/pos-ai';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { ComplaintLabeler } from '@/app/pos/_ui/ai/ComplaintLabeler';
import { AiOff } from '@/app/pos/_ui/ai/view';
import { aiPage } from '../guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.complaints.title') };
}

/** The guest's complaints beside the AI's suggestions. The guest's own words and category stay exactly as they were sent. */
export default async function AiComplaintsPage() {
  const { t, off, tabs, mayOpenPackage } = await aiPage('complaints');
  const result = off ? null : await query(posAiComplaintLabels, {});
  const data = result && result.ok ? result : null;
  return (
    <>
      <PageHeader title={t('pos.ai.complaints.title')} description={t('pos.ai.complaints.intro')} />
      <SectionTabs label={t('pos.ai.tabs')} current="complaints" items={tabs} />
      {off ? (
        <AiOff t={t} showPackageLink={mayOpenPackage} />
      ) : (
        <div className="flex flex-col gap-5 px-8 pb-8">
          {result && !result.ok ? (
            <p role="alert" className="text-base text-danger">
              {t(`pos.ai.error.${result.code}`)}
            </p>
          ) : null}
          {data ? (
            <>
              <ComplaintLabeler pending={data.pending} />
              {data.complaints.length === 0 ? (
                <EmptyState title={t('pos.complaints.empty')} />
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.complaints.map((row) => (
                    <li key={row.id} className="flex flex-col gap-2 rounded-lg border border-line px-4 py-3">
                      <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                        <span>
                          {t('pos.ai.complaints.guest')}: {row.category ? t(`pos.complaints.category.${row.category}`) : t('pos.ai.complaints.noCategory')}
                        </span>
                        <span className="ms-auto" dir="ltr">
                          {formatStamp(row.createdAt)}
                        </span>
                      </span>
                      <span className="line-clamp-3 text-base text-text [overflow-wrap:anywhere]" dir="auto">
                        {row.excerpt}
                      </span>
                      {row.labeled ? (
                        <span className="flex flex-col gap-1 border-t border-line pt-2">
                          <span className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-muted">{t('pos.ai.complaints.suggested')}:</span>
                            {row.aiCategory ? <StatusBadge>{t(`pos.complaints.category.${row.aiCategory}`)}</StatusBadge> : null}
                            {row.language ? (
                              <span className="text-muted">
                                {t('pos.ai.complaints.language')}: {t(`pos.ai.language.${row.language}`)}
                              </span>
                            ) : null}
                          </span>
                          {row.aiSummary ? (
                            <span className="text-sm text-text [overflow-wrap:anywhere]" dir="auto">
                              {row.aiSummary}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">{t('pos.ai.complaints.notLabeled')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
