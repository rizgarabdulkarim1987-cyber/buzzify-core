import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackLink, Forbidden, PickBranch } from '@/app/pharmacy/_ui/PageGate';
import { Money, SaleStatus } from '@/app/pharmacy/_ui/money-parts';
import { ReturnWorkspace } from '@/app/pharmacy/_ui/ReturnWorkspace';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { Note, Num } from '@/app/pharmacy/_ui/sell-parts';
import { returnable } from '@/server/pharmacy/queries/returns';
import { current } from '@/server/pharmacy/queries/shifts';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.returns.new') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Returning part of a sale (`/pharmacy/returns/new?sale=ID`). Only a holder of `return.approve` returns; a cashier is
 * told so in words (the server refuses them anyway). The window, a missing open shift and a sale with nothing left are
 * said before the form, not after it.
 */
export default async function NewReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const saleId = one(raw.sale)?.slice(0, 64);
  const header = (
    <PageHeader
      className="max-sm:px-4"
      title={t('pharmacy.returns.new')}
      description={t('pharmacy.returns.newIntro')}
      above={<BackLink href={saleId ? `/pharmacy/sales/${encodeURIComponent(saleId)}` : '/pharmacy/returns'}>{t(saleId ? 'pharmacy.returns.backToSale' : 'pharmacy.returns.back')}</BackLink>}
    />
  );
  if (actor.role === null) {
    return (
      <>
        {header}
        <Forbidden t={t} scope="returns" support />
      </>
    );
  }
  if (!roleMay(actor, 'return.approve')) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <Note icon={<Lock aria-hidden />} testId="return-hidden">
            {t('pharmacy.returns.roleCannot')}
          </Note>
        </div>
      </>
    );
  }
  const write = access.writable('return.approve');
  if (!write.ok) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <WriteBlocked writable={write} />
        </div>
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        {header}
        <PickBranch t={t} scope="returns" />
      </>
    );
  }
  if (!saleId) {
    return (
      <>
        {header}
        <div className="px-4 pb-10 sm:px-8">
          <Note icon={<Lock aria-hidden />} testId="return-pick-sale">
            <span>
              {t('pharmacy.returns.pickSale')}{' '}
              <Link href="/pharmacy/sales" className="font-medium underline underline-offset-2">
                {t('pharmacy.nav.sales')}
              </Link>
            </span>
          </Note>
        </div>
      </>
    );
  }
  let data;
  try {
    data = await query(returnable, { ...placeInput, saleId });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  // The refund is posted into the approver's own open shift, in the sale's currency.
  let shiftOk = false;
  try {
    const now = await query(current, placeInput);
    shiftOk = now !== null && now.shift.currency === data.currency;
  } catch {
    shiftOk = false;
  }
  const blocked = !data.window.withinWindow && !data.window.mayOverride;

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="return-page">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text">
          <Num>{data.number ?? ''}</Num>
          <SaleStatus status={data.status} t={t} />
          <span>
            {t('pharmacy.sales.total')}: <Money minor={data.totalMinor} currency={data.currency} />
          </span>
          <span>
            {t('pharmacy.returns.alreadyRefunded')}: <Money minor={data.refundedMinor} currency={data.currency} />
          </span>
        </p>
        {blocked ? (
          <Note icon={<Lock aria-hidden />} tone="danger" role="status" testId="return-window">
            {t('pharmacy.returns.fail.RETURN_WINDOW_PASSED', { days: data.window.days })}
          </Note>
        ) : !data.returnable ? (
          <Note icon={<Lock aria-hidden />} role="status" testId="nothing-to-return">
            {t('pharmacy.returns.fail.NOTHING_TO_RETURN')}
          </Note>
        ) : (
          <ReturnWorkspace data={data} shiftOk={shiftOk} />
        )}
      </div>
    </>
  );
}
