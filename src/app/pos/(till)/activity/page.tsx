import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber, formatStamp, ltr } from '@/lib/pos-format';
import { ACTIVITY_TYPES, type ActivityRow, type ActivityType } from '@/server/pos/activity';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posActivity } from '@/server/studio/queries/pos-activity';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { moneyLabel } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.activity.title') };
}

type Translate = ReturnType<typeof getStudioTranslator>;

/** What a row adds to its action: the discount given and why, the amount refunded, the cash that was missing or over. */
function detailOf(t: Translate, row: ActivityRow): string {
  const discount = row.changes.discount?.after as { kind?: string; value?: number; reason?: string } | null | undefined;
  if (row.type === 'discount' && discount && typeof discount.value === 'number') {
    const given = String(discount.kind ?? '').toLowerCase().startsWith('percent') ? ltr(`${formatNumber(discount.value)}%`) : moneyLabel(t, discount.value);
    return discount.reason ? `${given} · ${t(`pos.discount.reason.${discount.reason}` as 'pos.discount.reason.OTHER')}` : given;
  }
  const amount = row.changes.amount?.after;
  if (row.type === 'refund' && typeof amount === 'number') return moneyLabel(t, amount);
  const difference = row.changes.difference?.after;
  if (row.type === 'difference' && typeof difference === 'number') return moneyLabel(t, difference);
  return '';
}

/** Discounts, cancels, refunds, cash differences and PIN failures, newest first: where an owner looks for what went wrong. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; user?: string; before?: string }> }) {
  const { actor } = await getPosAccess();
  if (!actor) return null;
  const { type: askedType, user, before } = await searchParams;
  const type = ACTIVITY_TYPES.find((candidate) => candidate === askedType);
  const beforeAt = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : undefined;
  const data = await query(posActivity, { type, userId: user || undefined, before: beforeAt });
  const t = getStudioTranslator(actor.locale);
  const typeLabel = (value: ActivityType) => t(`pos.activity.type.${value}`);
  const nextHref = data.next ? `/pos/activity?${new URLSearchParams({ ...(type ? { type } : {}), ...(user ? { user } : {}), before: data.next.toISOString() })}` : null;

  return (
    <>
      <PageHeader title={t('pos.activity.title')} description={t('pos.activity.description')} />
      <div className="flex flex-col gap-6 px-8 pb-8">
        <form method="get" action="/pos/activity" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('pos.activity.filterType')}
            <select name="type" defaultValue={type ?? ''} className="min-h-12 rounded-md border border-line bg-surface px-3 text-base text-text">
              <option value="">{t('pos.activity.all')}</option>
              {ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {typeLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('pos.activity.filterStaff')}
            <select name="user" defaultValue={user ?? ''} className="min-h-12 rounded-md border border-line bg-surface px-3 text-base text-text">
              <option value="">{t('pos.activity.everyone')}</option>
              {data.staff.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center rounded-md bg-ink px-5 text-base font-medium text-on-ink">
            {t('pos.activity.show')}
          </button>
        </form>

        {data.rows.length === 0 ? (
          <p className="text-base text-muted">{t('pos.activity.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-160 text-start text-base">
              <thead className="text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.activity.colWhen')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.activity.colType')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.activity.colWho')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.activity.colWhat')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2" dir="ltr">{formatStamp(row.occurredAt)}</td>
                    <td className="px-4 py-2">{typeLabel(row.type)}</td>
                    <td className="px-4 py-2" dir="auto">{row.actorName ?? t('pos.activity.unknown')}</td>
                    <td className="px-4 py-2">
                      <span className="block">{t(`activity.action.${row.action}` as 'activity.action.pos.order.cancel')}</span>
                      <span className="block text-sm text-muted">{detailOf(t, row)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextHref ? (
          <Link href={nextHref} className="inline-flex min-h-12 items-center self-start rounded-md border border-line px-4 text-base font-medium text-text hover:bg-hover">
            {t('pos.activity.older')}
          </Link>
        ) : null}
      </div>
    </>
  );
}
