import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber, formatStamp } from '@/lib/pos-format';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posComplaint } from '@/server/studio/queries/pos-complaints';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { NoteForm, RemoveContactButton, StatusControl } from '@/app/pos/_ui/stock/ComplaintControls';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.complaints.title') };
}

export default async function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [complaint, access, locale] = await Promise.all([query(posComplaint, { complaintId: id }), getPosAccess(), requestStudioLocale()]);
  const manage = access.actor ? canPos(access.actor.role, 'complaint.manage') : false;
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader
        above={
          <Link href="/pos/complaints" className="inline-flex min-h-12 items-center text-base text-muted underline underline-offset-2">
            {t('pos.stock.back')}
          </Link>
        }
        title={t('pos.complaints.title')}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={complaint.status === 'NEW' ? 'danger' : complaint.status === 'RESOLVED' ? 'success' : 'neutral'}>{t(`pos.complaints.status.${complaint.status}`)}</StatusBadge>
            {complaint.category ? <span>{t(`pos.complaints.category.${complaint.category}`)}</span> : null}
            {complaint.tableNumber !== null ? <span>{t('pos.complaints.table', { n: complaint.tableNumber })}</span> : null}
            {complaint.orderNumber !== null ? <span>{t('pos.complaints.order', { n: complaint.orderNumber })}</span> : null}
            <span dir="ltr">{formatStamp(complaint.createdAt)}</span>
          </span>
        }
      />
      <div className="flex flex-col gap-8 px-8 pb-8">
        <p className="whitespace-pre-wrap text-base text-text [overflow-wrap:anywhere]" dir="auto" data-testid="complaint-body">
          {complaint.body}
        </p>

        {complaint.order ? (
          <section aria-labelledby="complaint-order" className="flex flex-col gap-2">
            <h2 id="complaint-order" className="text-base font-semibold text-text">
              {t('pos.complaints.order', { n: complaint.order.number })}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {complaint.order.lines.map((line, index) => (
                <li key={index} className={`px-4 py-3 text-base text-text ${line.cancelled ? 'line-through opacity-60' : ''}`} dir="auto">
                  {formatNumber(line.quantity)} × {line.name}
                  {line.options.length > 0 ? ` (${line.options.join(', ')})` : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : complaint.orderNumber !== null ? (
          <p className="text-sm text-muted">{t('pos.complaints.orderGone')}</p>
        ) : null}

        {complaint.contact ? (
          <section aria-labelledby="complaint-contact" className="flex flex-col gap-3">
            <h2 id="complaint-contact" className="text-base font-semibold text-text">
              {t('pos.complaints.contact')}
            </h2>
            <p className="text-base text-text" dir="auto">
              {complaint.contact.name}
            </p>
            {complaint.contact.phone ? (
              <a href={`tel:${complaint.contact.phone}`} dir="ltr" className="inline-flex min-h-12 w-fit items-center text-base underline underline-offset-2">
                {complaint.contact.phone}
              </a>
            ) : null}
            {manage ? <RemoveContactButton complaintId={complaint.id} /> : null}
          </section>
        ) : complaint.contactRemoved ? (
          <p className="text-sm text-muted">{t('pos.complaints.contactRemoved')}</p>
        ) : null}

        {manage ? (
          <section aria-labelledby="complaint-status" className="flex flex-col gap-3">
            <h2 id="complaint-status" className="text-base font-semibold text-text">
              {t('pos.complaints.statusTitle')}
            </h2>
            <StatusControl complaintId={complaint.id} status={complaint.status} />
          </section>
        ) : null}

        <section aria-labelledby="complaint-notes" className="flex flex-col gap-3">
          <h2 id="complaint-notes" className="text-base font-semibold text-text">
            {t('pos.complaints.notes')}
          </h2>
          {complaint.notes.length === 0 ? (
            <p className="text-sm text-muted">{t('pos.complaints.notesNone')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {complaint.notes.map((note) => (
                <li key={note.id} className="flex flex-col gap-1 px-4 py-3">
                  <span className="whitespace-pre-wrap text-base text-text [overflow-wrap:anywhere]" dir="auto">
                    {note.body}
                  </span>
                  <span className="text-sm text-muted" dir="auto">
                    {note.userName} · <span dir="ltr">{formatStamp(note.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {manage ? <NoteForm complaintId={complaint.id} /> : null}
        </section>
      </div>
    </>
  );
}
