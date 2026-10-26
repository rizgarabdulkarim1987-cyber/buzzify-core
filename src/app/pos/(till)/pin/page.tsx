import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { hasOwnPin } from '@/server/pos/device-session';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { OwnPinForm } from '@/app/pos/_ui/OwnPinForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.pin.title') };
}

/** Where a person sets their own quick sign-in PIN. Every till role may; the account password confirms it. */
export default async function PosPinPage() {
  const [{ actor }, locale] = await Promise.all([getPosAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const hasPin = actor ? await hasOwnPin(actor) : false;
  return (
    <>
      <PageHeader title={t('pos.pin.title')} description={t('pos.pin.intro')} />
      <div className="px-8 pb-8">
        <OwnPinForm hasPin={hasPin} />
      </div>
    </>
  );
}
