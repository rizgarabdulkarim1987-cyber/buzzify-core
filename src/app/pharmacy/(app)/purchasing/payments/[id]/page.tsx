import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Amount, PaymentChip } from '@/app/pharmacy/_ui/money-status';
import { MoneyLocked, ReasonAction } from '@/app/pharmacy/_ui/ReasonAction';
import { get } from '@/server/pharmacy/queries/supplier-payments';
import { query } from '@/server/studio/framework/invoke';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.pay.detail') };
}

/** One payment: supplier, method, amount, date, reference, the invoices it went to, and Reverse (with a reason and a confirmation) for the money role. */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.m.pay.detail', { href: '/pharmacy/purchasing/payments', labelKey: 'pharmacy.purchasing.m.pay.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const p = await query(get, { ...access.placeInput, paymentId: id });
  const canReverse = !p.isReversal && !p.reversed;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.amountMinor !== undefined ? <Amount amount={p.amountMinor} currency={p.currency} locale={locale} /> : t('pharmacy.purchasing.m.pay.detail')}
            <PaymentChip reversed={p.reversed} isReversal={p.isReversal} t={t} />
          </span>
        }
        description={<span dir="auto">{p.supplierName}</span>}
      />
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.purchasing.m.pay.booksOnly')}</span>
        </p>
        <section aria-labelledby="pay-head" className="flex min-w-0 flex-col gap-3" data-testid="payment-head">
          <h2 id="pay-head" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.inv.header')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm text-text sm:max-w-xl">
            <dt className="text-muted">{t('pharmacy.purchasing.po.supplier')}</dt>
            <dd>
              <Link href={`/pharmacy/purchasing/suppliers/${p.supplierId}`} dir="auto" className="underline underline-offset-2">
                {p.supplierName}
              </Link>
            </dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.pay.method')}</dt>
            <dd>{t(`pharmacy.purchasing.m.pay.method.${p.method}`)}</dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.pay.paidOn')}</dt>
            <dd>
              <bdi dir="ltr">{formatDate(`${p.paidOn}T00:00:00.000Z`, locale)}</bdi>
            </dd>
            <dt className="text-muted">{t(p.isReversal ? 'pharmacy.purchasing.m.reason' : 'pharmacy.purchasing.m.pay.reference')}</dt>
            <dd dir="auto">{p.reference || '—'}</dd>
            {p.reversedById && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.pay.reversedBy')}</dt>
                <dd>
                  <Link href={`/pharmacy/purchasing/payments/${p.reversedById}`} className="underline underline-offset-2">
                    {t('pharmacy.purchasing.m.pay.openReversal')}
                  </Link>
                </dd>
              </>
            )}
            {p.reversesId && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.pay.reverses')}</dt>
                <dd>
                  <Link href={`/pharmacy/purchasing/payments/${p.reversesId}`} className="underline underline-offset-2">
                    {t('pharmacy.purchasing.m.pay.openOriginal')}
                  </Link>
                </dd>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="pay-alloc" className="flex min-w-0 flex-col gap-3" data-testid="payment-allocations">
          <h2 id="pay-alloc" className="text-md font-semibold text-text">
            {t(p.isReversal ? 'pharmacy.purchasing.m.pay.takenOff' : 'pharmacy.purchasing.m.pay.wentTo')}
          </h2>
          {p.allocations.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.m.pay.noAllocations')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {p.allocations.map((a) => (
                <li key={a.invoiceId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line text-sm text-text">
                  <Link href={`/pharmacy/purchasing/invoices/${a.invoiceId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    <bdi dir="ltr">{a.invoiceNumber}</bdi>
                  </Link>
                  {a.amountMinor !== undefined && <Amount amount={a.amountMinor} currency={p.currency} locale={locale} className="font-medium" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canReverse && g.writable.ok && (
          <section aria-labelledby="pay-actions" className="flex min-w-0 flex-col gap-3" data-testid="payment-actions">
            <h2 id="pay-actions" className="text-md font-semibold text-text">
              {t('pharmacy.purchasing.m.inv.actions')}
            </h2>
            {g.mayMoney ? <ReasonAction kind="reverse" targetId={p.id} userId={access.actor.userId} restaurantId={access.placeInput.restaurantId} /> : <MoneyLocked testId="payment-money-locked" text={t('pharmacy.purchasing.m.needsMoneyRole')} />}
          </section>
        )}
      </div>
    </>
  );
}
