import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { canPos, posLanding, type PosPermission } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.home.title') };
}

const LINKS: ReadonlyArray<{ href: string; key: 'settings' | 'staff' | 'catalog'; permission: PosPermission }> = [
  { href: '/pos/settings', key: 'settings', permission: 'settings.manage' },
  { href: '/pos/staff', key: 'staff', permission: 'staff.manage' },
  { href: '/pos/catalog', key: 'catalog', permission: 'catalog.manage' },
];

/** The till's landing: the kitchen goes to its screen, everyone else sees the restaurant and what their role may open. */
export default async function PosHomePage() {
  const { actor } = await getPosAccess();
  // The layout has already refused anyone without a till; this keeps the type honest.
  if (!actor) return null;
  if (posLanding(actor.role) === 'kitchen') redirect('/pos/kitchen');

  const t = getStudioTranslator(actor.locale);
  const restaurant = await getPrisma().restaurant.findUnique({ where: { id: actor.restaurantId }, select: { name: true } });
  return (
    <>
      <PageHeader
        title={t('pos.home.title')}
        description={t('pos.home.intro', { restaurant: restaurant?.name ?? '', role: t(`pos.role.${actor.role}`) })}
      />
      <ul className="grid gap-4 px-8 pb-8 sm:grid-cols-2 xl:grid-cols-3">
        {LINKS.filter((link) => canPos(actor.role, link.permission)).map((link) => (
          <li key={link.key}>
            <Link href={link.href} className="flex h-full flex-col gap-1 rounded-lg border border-line p-5 hover:bg-surface-2">
              <span className="text-base font-medium text-text">{t(`pos.home.${link.key}`)}</span>
              <span className="text-sm text-muted">{t(`pos.home.${link.key}Hint`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
