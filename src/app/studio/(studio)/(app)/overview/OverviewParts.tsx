import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { AuditRow, Named } from '@/server/studio/services/activity';
import { formatDateTime, numberFormat } from '@/studio/format';

/** A figure with its label, and below it the parts it is made of, each a link to the list filtered to that part. */
export function Tally({
  title,
  total,
  parts,
  locale,
}: {
  title: string;
  total: number;
  parts: ReadonlyArray<{ label: string; count: number; href: string }>;
  locale: Locale;
}) {
  const number = numberFormat(locale);
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-lg border border-line p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        <p className="text-3xl font-semibold tabular-nums text-text">{number.format(total)}</p>
      </div>
      <ul className="flex flex-col gap-0.5 border-t border-line pt-3">
        {parts.map((part) => (
          <li key={part.label}>
            <Link
              href={part.href}
              className="-mx-1.5 flex h-7 items-center justify-between gap-3 rounded-sm px-1.5 text-sm text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <span>{part.label}</span>
              <span className="tabular-nums text-text">{number.format(part.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A restaurant or menu a log row names: its name, or that it has been deleted since. */
const nameOf = (t: Translate, named: Named | null): string | null => (named === null ? null : (named.name ?? t('activity.deleted')));

export function RecentActivity({
  rows,
  t,
  locale,
  activityHref = '/studio/activity',
}: {
  rows: AuditRow[];
  t: Translate;
  locale: 'en' | 'ar' | 'ckb';
  /** Where the whole log is: the activity page of the space the overview is in. */
  activityHref?: string;
}) {
  return (
    <section aria-labelledby="recent-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="recent-title" className="text-md font-semibold text-text">
          {t('overview.recent.title')}
        </h2>
        <Link href={activityHref} className="text-sm text-muted underline-offset-2 transition-colors hover:text-text hover:underline">
          {t('overview.recent.all')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="border-y border-line py-6 text-base text-muted">{t('overview.recent.empty')}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((row) => {
            const where = [nameOf(t, row.restaurant), nameOf(t, row.menu)].filter((name): name is string => name !== null);
            const label = t(`activity.action.${row.action}`);
            return (
              <li key={row.id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="text-base text-text">{label === `activity.action.${row.action}` ? row.action : label}</span>
                  <span dir="auto" className="truncate text-sm text-muted">
                    {[row.actor ? (row.actor.name ?? t('activity.deleted')) : t('activity.system'), ...where].join(' · ')}
                  </span>
                </div>
                <time dateTime={row.occurredAt} className="shrink-0 whitespace-nowrap text-sm text-muted">
                  {formatDateTime(row.occurredAt, locale)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
