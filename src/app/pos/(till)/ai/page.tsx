import type { Metadata } from 'next';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { AskPanel } from '@/app/pos/_ui/ai/AskPanel';
import { AiOff } from '@/app/pos/_ui/ai/view';
import { aiPage } from './guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.title') };
}

/** Ask Buzzify AI: a question in plain words, answered from the restaurant's own reports, with the sources shown. */
export default async function AiAskPage() {
  const { actor, t, state, off, tabs, mayOpenPackage } = await aiPage('ask');
  return (
    <>
      <PageHeader title={t('pos.ai.title')} description={t('pos.ai.intro')} />
      <SectionTabs label={t('pos.ai.tabs')} current="ask" items={tabs} />
      {off ? (
        <AiOff t={t} showPackageLink={mayOpenPackage} />
      ) : (
        <div className="px-8 pb-8">
          <AskPanel used={state.used} limit={state.limit} locale={actor.locale} />
        </div>
      )}
    </>
  );
}
