import type { Metadata } from 'next';
import { getPrisma } from '@/server/data/prisma';
import { getPosAccess } from '@/server/pos/actor';
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
  const row = actor
    ? await getPrisma().posStaff.findFirst({ where: { restaurantId: actor.restaurantId, userId: actor.userId, deactivatedAt: null }, select: { pinHash: true } })
    : null;
  return (
    <>
      <PageHeader title={t('pos.pin.title')} description={t('pos.pin.intro')} />
      <div className="px-8 pb-8">
        <OwnPinForm hasPin={row?.pinHash != null} />
      </div>
    </>
  );
}
