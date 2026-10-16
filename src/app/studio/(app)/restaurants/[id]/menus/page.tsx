import { UtensilsCrossed } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { restaurantMenus } from '@/server/studio/queries/restaurants';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui/EmptyState';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';
import { loadRestaurant, tabMetadata } from '../load';

const TONES: Record<string, StatusTone> = { PUBLISHED: 'success', SUSPENDED: 'danger', DRAFT: 'neutral', ARCHIVED: 'neutral' };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'menus');
}

/** The restaurant's menus, each linking to its workspace. Creating and publishing happen in the menu screens. */
export default async function RestaurantMenusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);
  const menus = await query(restaurantMenus, { restaurantId: restaurant.id });

  return (
    <div className="px-8 py-6">
      {menus.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed aria-hidden />} title={t('restaurants.menus.emptyTitle')} body={t('restaurants.menus.emptyBody')} />
      ) : (
        <div className="max-w-4xl overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('restaurants.menus.caption')}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4">
                  {t('restaurants.menus.name')}
                </th>
                <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted">
                  {t('restaurants.menus.address')}
                </th>
                <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted">
                  {t('restaurants.menus.status')}
                </th>
                <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted last:pe-4">
                  {t('restaurants.menus.updated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {menus.map((menu) => (
                <tr key={menu.id} className="border-b border-line transition-colors duration-150 hover:bg-surface">
                  <td className="h-10 px-3 first:ps-4">
                    <Link href={`/studio/menus/${menu.id}`} className="font-medium text-text underline-offset-2 hover:underline">
                      {menu.name}
                    </Link>
                  </td>
                  <td className="h-10 px-3">
                    <span dir="ltr" className="inline-block font-mono text-xs text-muted">
                      /{menu.slug}
                    </span>
                  </td>
                  <td className="h-10 px-3">
                    <StatusBadge tone={TONES[menu.status] ?? 'neutral'}>{t(`status.${menu.status.toLowerCase()}`)}</StatusBadge>
                  </td>
                  <td className="h-10 whitespace-nowrap px-3 text-muted last:pe-4">{formatDate(menu.updatedAt, actor.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
