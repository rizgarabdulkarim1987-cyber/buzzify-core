import type { Metadata } from 'next';
import Link from 'next/link';
import { formatStamp } from '@/lib/pos-format';
import { COMPLAINT_STATUSES, type ComplaintStatusKey } from '@/server/domain/pos/complaint-rules';
import { query } from '@/server/studio/framework/invoke';
import { posComplaints } from '@/server/studio/queries/pos-complaints';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { SectionTabs } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.complaints.title') };
}

/** Complaints from guests, newest first. The list never shows a name or a phone; those are on the detail page. */
export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string; before?: string }> }) {
  const [{ status, before }, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const filter = COMPLAINT_STATUSES.find((s) => s === status);
  const rows = await query(posComplaints, { ...(filter ? { status: filter } : {}), ...(before ? { before } : {}) });
  const tone = (s: ComplaintStatusKey) => (s === 'NEW' ? 'danger' : s === 'RESOLVED' ? 'success' : 'neutral');
  return (
    <>
      <PageHeader title={t('pos.complaints.title')} description={t('pos.complaints.intro')} />
      <SectionTabs
        label={t('pos.complaints.filters')}
        current={filter ?? 'all'}
        items={[{ key: 'all', href: '/pos/complaints', label: t('pos.complaints.all') }, ...COMPLAINT_STATUSES.map((s) => ({ key: s, href: `/pos/complaints?status=${s}`, label: t(`pos.complaints.status.${s}`) }))]}
      />
      <div className="flex flex-col gap-4 px-8 pb-8">
        {rows.length === 0 ? (
          <EmptyState title={t('pos.complaints.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/pos/complaints/${row.id}`} className="flex min-h-12 flex-col gap-2 rounded-lg border border-line px-4 py-3 hover:bg-hover">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={tone(row.status)}>{t(`pos.complaints.status.${row.status}`)}</StatusBadge>
                    {row.category ? <span className="text-sm text-muted">{t(`pos.complaints.category.${row.category}`)}</span> : null}
                    {row.tableNumber !== null ? <span className="text-sm text-muted">{t('pos.complaints.table', { n: row.tableNumber })}</span> : null}
                    {row.orderNumber !== null ? <span className="text-sm text-muted">{t('pos.complaints.order', { n: row.orderNumber })}</span> : null}
                    {row.hasContact ? <span className="text-sm text-muted">{t('pos.complaints.contactLeft')}</span> : null}
                    <span className="ms-auto text-sm text-muted" dir="ltr">
                      {formatStamp(row.createdAt)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-base text-text [overflow-wrap:anywhere]" dir="auto">
                    {row.excerpt}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length === 50 ? (
          <Link href={`/pos/complaints?${filter ? `status=${filter}&` : ''}before=${rows[rows.length - 1]!.createdAt.toISOString()}`} className="inline-flex min-h-12 items-center text-base underline underline-offset-2">
            {t('pos.complaints.older')}
          </Link>
        ) : null}
      </div>
    </>
  );
}
