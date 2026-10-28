import type { Metadata } from 'next';
import Link from 'next/link';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posKitchenQueue, posKitchenScope } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Alert } from '@/studio/ui/Alert';
import { PageHeader } from '@/studio/ui/PageHeader';
import { KitchenScreen } from '@/app/pos/_ui/KitchenScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.kitchen.title') };
}

export default async function KitchenPage() {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const t = getStudioTranslator(actor.locale);
  const scope = await query(posKitchenScope, {});
  if (!scope.screen) {
    return (
      <>
        <PageHeader title={t('pos.kitchen.title')} />
        <div className="px-4 pb-8 sm:px-8">
          <Alert>{t('pos.kitchen.off')}</Alert>
        </div>
      </>
    );
  }
  const { cards, readAt } = await query(posKitchenQueue, {});
  return (
    <>
      <PageHeader title={t('pos.kitchen.title')} />
      {scope.sectionId === null ? (
        <div className="px-4 pb-3 sm:px-8">
          <Link href="/pos/kitchen/expo" className="inline-flex min-h-12 items-center rounded-md border border-line-strong px-4 text-base font-medium text-text hover:bg-hover">
            {t('pos.expo.link')}
          </Link>
        </div>
      ) : null}
      <KitchenScreen cards={cards} readAt={readAt} canFilter={scope.sectionId === null} />
    </>
  );
}
