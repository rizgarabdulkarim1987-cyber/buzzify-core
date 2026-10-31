import { History } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Translate } from '@/lib/i18n';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listActivity } from '@/server/studio/queries/activity';
import type { AuditRow, Named } from '@/server/studio/services/activity';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Pagination } from '@/studio/ui/Pagination';
import { ActivityFilters } from './ActivityFilters';
import { activityInput } from './list-params';

const COLUMNS = ['when', 'who', 'action', 'entity', 'restaurant', 'menu'] as const;

/** A restaurant or menu a row names: a link to it while it exists, and a muted "Deleted" once it does not. */
function Place({ named, href, t }: { named: Named | null; href: string; t: Translate }) {
  if (named === null) return <span className="text-muted">–</span>;
  if (named.name === null) return <span className="text-muted">{t('activity.deleted')}</span>;
  return (
    <Link href={href} dir="auto" className="underline-offset-2 hover:underline">
      {named.name}
    </Link>
  );
}

/** What a row was done to: the kind of thing, and for a person their name. */
function Item({ row, t }: { row: AuditRow; t: Translate }) {
  const kind = t(`activity.entity.${row.entityType}`);
  return (
    <span>
      {kind === `activity.entity.${row.entityType}` ? row.entityType : kind}
      {row.entityName && (
        <>
          {' · '}
          <bdi>{row.entityName}</bdi>
        </>
      )}
    </span>
  );
}

/**
 * The audit log, for Super Admins: who did what, to what, where and when, newest first, 50 to a page. Filters for the
 * person, the restaurant, the menu, the action and the days live in the address (`actor`, `restaurant`, `menu`,
 * `action`, `from`, `to`, `page`), so a filtered log is a link. A row names what happened; what the change held is not
 * shown.
 */
export async function ActivityList({
  searchParams,
  space,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  space: 'food' | 'pharmacy';
}) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const input = { ...activityInput(await searchParams), space };
  const log = await query(listActivity, input);
  const filtered = Boolean(input.actorId || input.restaurantId || input.menuId || input.action || input.from || input.to);

  return (
    <>
      <PageHeader title={t('activity.title')} description={t('activity.description')} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {log.total === 0 && !filtered ? (
          <EmptyState icon={<History aria-hidden />} title={t('activity.emptyTitle')} body={t('activity.emptyBody')} />
        ) : (
          <>
            <ActivityFilters selected={log.selected} space={space} />
            {log.rows.length === 0 ? (
              <p className="border-y border-line py-10 text-center text-base text-muted">{t('common.noResults')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{t('activity.caption')}</caption>
                  <thead>
                    <tr className="border-b border-line">
                      {COLUMNS.map((column) => (
                        <th key={column} scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4 last:pe-4">
                          {t(`activity.col.${column}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.rows.map((row) => {
                      const label = t(`activity.action.${row.action}`);
                      const known = label !== `activity.action.${row.action}`;
                      return (
                        <tr key={row.id} className="border-b border-line align-top transition-colors hover:bg-surface">
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted first:ps-4">
                            <time dateTime={row.occurredAt}>{formatDateTime(row.occurredAt, actor.locale)}</time>
                          </td>
                          <td className="px-3 py-2.5">
                            {row.actor ? (
                              <bdi>{row.actor.name ?? t('activity.deleted')}</bdi>
                            ) : (
                              <span className="text-muted">{t('activity.system')}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-text">
                            {known ? label : <span dir="ltr" className="font-mono text-xs">{row.action}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-muted">
                            <Item row={row} t={t} />
                          </td>
                          <td className="px-3 py-2.5">
                            <Place named={row.restaurant} href={`${space === 'pharmacy' ? '/studio/pharmacy' : '/studio/restaurants'}/${row.restaurant?.id ?? ''}`} t={t} />
                          </td>
                          <td className="px-3 py-2.5 last:pe-4">
                            <Place named={row.menu} href={`/studio/menus/${row.menu?.id ?? ''}`} t={t} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={log.page} pageSize={log.pageSize} total={log.total} />
          </>
        )}
      </div>
    </>
  );
}
