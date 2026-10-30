import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posExpo, posKitchenScope } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Alert } from '@/studio/ui/Alert';
import { PageHeader } from '@/studio/ui/PageHeader';
import { ExpoScreen } from '@/app/pos/_ui/ExpoScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.expo.title') };
}

/** The pass. A kitchen member tied to one section has the kitchen screen instead, so this page is not theirs. */
export default async function ExpoPage() {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const t = getStudioTranslator(actor.locale);
  const scope = await query(posKitchenScope, {});
  if (scope.sectionId !== null || !scope.screen) {
    return (
      <>
        <PageHeader title={t('pos.expo.title')} />
        <div className="px-4 pb-8 sm:px-8">
          <Alert>{t(scope.sectionId !== null ? 'pos.expo.notForSection' : 'pos.kitchen.off')}</Alert>
        </div>
      </>
    );
  }
  const { orders, readAt } = await query(posExpo, {});
  return (
    <>
      <PageHeader title={t('pos.expo.title')} />
      <ExpoScreen orders={orders} readAt={readAt} />
    </>
  );
}
