import { History } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Translate } from '@/lib/i18n';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { restaurantActivity } from '@/server/studio/queries/restaurants';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui/EmptyState';
import { isolated } from '@/studio/ui/isolate';
import { Pagination } from '@/studio/ui/Pagination';
import { loadRestaurant, tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'activity');
}

/** The order a person reads a change's fields in: the profile's own order. The log's JSON does not keep one. */
const FIELD_ORDER = ['name', 'type', 'description', 'address', 'city', 'country', 'phone', 'whatsapp', 'socialLinks', 'workingHours', 'notes', 'status', 'order'];
const rank = (field: string) => (FIELD_ORDER.includes(field) ? FIELD_ORDER.indexOf(field) : FIELD_ORDER.length);

/** A field a change touched, by its name in the person's language (its code when the Studio has no name for it). */
function fieldLabel(t: Translate, field: string): string {
  const key = `restaurants.field.${field}`;
  return t(key) === key ? field : t(key);
}

/**
 * Who did what to this restaurant and when, newest first, and which fields each change touched. What the fields held is
 * not shown, as on the Activity screen. Only people who may see the activity log have this tab.
 */
export default async function RestaurantActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);
  const raw = (await searchParams).page;
  const requested = Number(Array.isArray(raw) ? raw[0] : raw);
  const page = Number.isInteger(requested) && requested >= 1 && requested <= 100_000 ? requested : 1;
  const log = await query(restaurantActivity, { restaurantId: restaurant.id, page });

  return (
    <div className="flex flex-col gap-4 px-8 py-6">
      {log.total === 0 ? (
        <EmptyState icon={<History aria-hidden />} title={t('restaurants.activity.emptyTitle')} body={t('restaurants.activity.emptyBody')} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('restaurants.activity.caption')}</caption>
              <thead>
                <tr className="border-b border-line">
                  {(['when', 'who', 'what', 'details'] as const).map((column) => (
                    <th key={column} scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4 last:pe-4">
                      {t(`restaurants.activity.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.rows.map((row) => {
                  const label = t(`activity.action.${row.action}`);
                  const known = label !== `activity.action.${row.action}`;
                  const details = [...row.fields].sort((a, b) => rank(a) - rank(b)).map((field) => ({ field, line: fieldLabel(t, field) }));
                  return (
                    <tr key={row.id} className="border-b border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted first:ps-4">{formatDateTime(row.occurredAt, actor.locale)}</td>
                      <td className="px-3 py-2.5">
                        {row.actor ? (
                          isolated('{name}', { name: row.actor.name ?? t('activity.deleted') })
                        ) : (
                          <span className="text-muted">{t('restaurants.activity.system')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-text">
                        {known ? label : <span dir="ltr" className="font-mono text-xs">{row.action}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-muted last:pe-4">
                        {details.length > 0 ? (
                          <ul className="flex flex-col gap-0.5">
                            {details.map(({ field, line }) => (
                              <li key={field} className="break-words">
                                {line}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={log.page} pageSize={log.pageSize} total={log.total} />
        </>
      )}
    </div>
  );
}
