import type { Metadata } from 'next';
import { formatStamp } from '@/lib/pos-format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { UsageMeter } from '@/app/pos/_ui/ai/view';
import { aiPage } from '../guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.package.title') };
}

/**
 * The owner's view of the package. It exists in both states: while the package is off it says only that Buzzify arranges
 * it by hand; while on it shows the use of the month and what leaves the restaurant.
 */
export default async function AiPackagePage() {
  const { t, state, tabs } = await aiPage('package');
  return (
    <>
      <PageHeader title={t('pos.ai.package.title')} description={t('pos.ai.package.intro')} />
      {tabs.length > 1 ? <SectionTabs label={t('pos.ai.tabs')} current="package" items={tabs} /> : null}
      <div className="flex max-w-2xl flex-col gap-6 px-8 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-muted">{t('pos.ai.package.status')}</span>
          <StatusBadge tone={state.enabled ? 'success' : 'neutral'}>{state.enabled ? t('pos.ai.package.on') : t('pos.ai.package.off')}</StatusBadge>
        </div>
        {state.enabled ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted">{t('pos.ai.package.used')}</span>
              <UsageMeter t={t} used={state.used} limit={state.limit} />
            </div>
            {state.syncedAt ? (
              <p className="text-sm text-muted">
                {t('pos.ai.package.updated')}: <span dir="ltr">{formatStamp(state.syncedAt)}</span>
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-text">{t('pos.ai.package.dataTitle')}</h2>
              <p className="text-base text-muted">{t('pos.ai.package.data')}</p>
            </div>
          </>
        ) : (
          <p className="text-base text-muted">{t('pos.ai.package.offBody')}</p>
        )}
      </div>
    </>
  );
}
