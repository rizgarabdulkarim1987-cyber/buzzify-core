import { MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { restaurantFeedback } from '@/server/studio/queries/feedback';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui/EmptyState';
import { loadRestaurant, tabMetadata } from '../load';
import { FeedbackSwitch } from './FeedbackSwitch';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'feedback');
}

/**
 * What guests sent through the menus' complaints and suggestions box, newest first, and each menu's switch. A contact shows
 * only to people who edit content; the switch is theirs too.
 */
export default async function RestaurantFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);
  const { menus, rows } = await query(restaurantFeedback, { restaurantId: restaurant.id });

  return (
    <div className="flex flex-col gap-8 px-8 py-6">
      <section aria-labelledby="feedback-menus" className="flex flex-col gap-3">
        <h2 id="feedback-menus" className="text-base font-medium">
          {t('feedback.menusTitle')}
        </h2>
        <p className="text-sm text-muted">{t('feedback.switchHint')}</p>
        <div className="flex max-w-xl flex-col gap-2">
          {menus.map((menu) => (
            <FeedbackSwitch key={menu.id} menuId={menu.id} name={menu.name} enabled={menu.feedbackEnabled} />
          ))}
        </div>
      </section>
      <section aria-labelledby="feedback-messages" className="flex flex-col gap-3">
        <h2 id="feedback-messages" className="text-base font-medium">
          {t('feedback.messagesTitle')}
        </h2>
        {rows.length === 0 ? (
          <EmptyState icon={<MessageSquare aria-hidden />} title={t('feedback.emptyTitle')} body={t('feedback.emptyBody')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('feedback.caption')}</caption>
              <thead>
                <tr className="border-b border-line text-muted">
                  {(['when', 'kind', 'message', 'table', 'contact'] as const).map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 text-start font-medium">
                      {t(`feedback.col.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(row.createdAt.toISOString(), actor.locale)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{t(`feedback.kind.${row.category ?? 'none'}`)}</td>
                    <td dir="auto" className="max-w-prose whitespace-pre-wrap px-3 py-2">
                      {row.body}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.tableNumber ?? '–'}</td>
                    <td className="px-3 py-2">
                      {row.contactName || row.contactPhone ? (
                        <>
                          <bdi>{row.contactName}</bdi> <bdi dir="ltr">{row.contactPhone}</bdi>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
