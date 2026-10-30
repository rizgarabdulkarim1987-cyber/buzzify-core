import { CircleCheck, FileX2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { phDate, phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { RxAttachmentViewer } from '@/app/pharmacy/_ui/RxAttachmentViewer';
import { Chip, Num } from '@/app/pharmacy/_ui/sell-parts';
import { isolateName as isolate } from '@/app/pharmacy/_ui/isolate-name';
import { get } from '@/server/pharmacy/queries/prescriptions';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { rxGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.rx.detail') };
}

/** One prescription. The bytes of its files are loaded by the viewer, only for a person holding `rx.attachment.view`. */
export default async function PrescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, rxGate('pharmacy.rx.detail', { href: '/pharmacy/prescriptions', labelKey: 'pharmacy.rx.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  let rx;
  try {
    rx = await query(get, { ...access.placeInput, prescriptionId: id.slice(0, 64) });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const row = (label: string, value: ReactNode, testId?: string) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4" data-testid={testId}>
      <dt className="text-sm text-muted sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-base text-text" dir="auto">
        {value}
      </dd>
    </div>
  );
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={<Num>{rx.number}</Num>} description={t('pharmacy.rx.detail')} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8" data-testid="rx-detail">
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        <dl className="flex max-w-3xl flex-col gap-3">
          {row(t('pharmacy.rx.issuedOn'), <bdi dir="ltr">{phDate(`${rx.issuedOn}T12:00:00Z`, locale)}</bdi>)}
          {row(t('pharmacy.rx.prescriber'), rx.prescriberName ? isolate(rx.prescriberName) : '—', 'rx-d-prescriber')}
          {rx.prescriberLicense ? row(t('pharmacy.rx.license'), isolate(rx.prescriberLicense)) : null}
          {row(t('pharmacy.rx.patient'), rx.patientName ? isolate(rx.patientName) : '—', 'rx-d-patient')}
          {rx.patientIdNote ? row(t('pharmacy.rx.idNote'), isolate(rx.patientIdNote)) : null}
          {row(t('pharmacy.rx.recorded'), <bdi dir="ltr">{phDateTime(rx.createdAt, locale)}</bdi>)}
          {row(
            t('pharmacy.rx.sale'),
            rx.saleId ? (
              <Link href={`/pharmacy/sales/${rx.saleId}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md font-medium underline underline-offset-2 hover:bg-hover" data-testid="rx-sale-link">
                <CircleCheck aria-hidden className="size-4" />
                {t('pharmacy.rx.sale.open')}
              </Link>
            ) : (
              <Chip icon={<FileX2 aria-hidden />}>{t('pharmacy.rx.notUsed')}</Chip>
            ),
          )}
        </dl>
        <section aria-labelledby="rx-files" className="flex max-w-3xl flex-col gap-2">
          <h2 id="rx-files" className="text-md font-semibold text-text">
            {t('pharmacy.rx.files')}
          </h2>
          <RxAttachmentViewer files={rx.files} allowed={g.mayViewFiles} restaurantId={access.placeInput.restaurantId} branchId={rx.branchId} />
        </section>
      </div>
    </>
  );
}
