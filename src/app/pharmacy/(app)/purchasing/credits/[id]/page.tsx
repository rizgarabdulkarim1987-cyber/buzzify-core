import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { OpenInvoiceWire } from '@/app/pharmacy/_ui/AllocationFields';
import { ApplyCreditForm } from '@/app/pharmacy/_ui/ApplyCreditForm';
import { Amount } from '@/app/pharmacy/_ui/money-status';
import { MoneyLocked } from '@/app/pharmacy/_ui/ReasonAction';
import { get } from '@/server/pharmacy/queries/credit-notes';
import { list as payables } from '@/server/pharmacy/queries/payables';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.cr.detail') };
}

/** One credit note: amount, applied and left, where it was applied, and "Apply to invoices" (the money role) while something is left. */
export default async function CreditPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.purchasing.m.cr.detail', { href: '/pharmacy/purchasing/credits', labelKey: 'pharmacy.purchasing.m.cr.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const c = await query(get, { ...access.placeInput, creditNoteId: id });
  const left = c.availableMinor !== undefined ? BigInt(c.availableMinor) : 0n;
  const canApply = g.writable.ok && g.mayMoney && left > 0n;
  const open = canApply ? await query(payables, { ...access.placeInput, supplierId: c.supplierId, currency: c.currency }) : null;
  const invoices: OpenInvoiceWire[] = (open?.items ?? [])
    .filter((i) => i.balanceMinor !== undefined)
    .map((i) => ({ id: i.id, number: i.number, supplierId: i.supplierId, currency: i.currency, dueDate: i.dueDate, balanceMinor: i.balanceMinor! }));
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={<bdi dir="ltr">{c.number}</bdi>} description={<span dir="auto">{c.supplierName}</span>} />
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <section aria-labelledby="cr-head" className="flex min-w-0 flex-col gap-3" data-testid="credit-head">
          <h2 id="cr-head" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.cr.detailHeader')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm text-text sm:max-w-xl">
            <dt className="text-muted">{t('pharmacy.purchasing.po.supplier')}</dt>
            <dd>
              <Link href={`/pharmacy/purchasing/suppliers/${c.supplierId}`} dir="auto" className="underline underline-offset-2">
                {c.supplierName}
              </Link>
            </dd>
            <dt className="text-muted">{t('pharmacy.purchasing.m.cr.noteDate')}</dt>
            <dd>
              <bdi dir="ltr">{phDate(`${c.noteDate}T00:00:00.000Z`, locale)}</bdi>
            </dd>
            {c.amountMinor !== undefined && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.cr.amountShort')}</dt>
                <dd data-testid="credit-amount">
                  <Amount amount={c.amountMinor} currency={c.currency} locale={locale} />
                </dd>
                <dt className="text-muted">{t('pharmacy.purchasing.m.cr.applied')}</dt>
                <dd data-testid="credit-applied">
                  <Amount amount={c.appliedMinor} currency={c.currency} locale={locale} />
                </dd>
                <dt className="font-semibold">{t('pharmacy.purchasing.m.cr.left')}</dt>
                <dd className="font-semibold" data-testid="credit-left">
                  <Amount amount={c.availableMinor} currency={c.currency} locale={locale} />
                </dd>
              </>
            )}
            {c.supplierReturnId && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.m.cr.linkedReturn')}</dt>
                <dd>
                  <Link href={`/pharmacy/purchasing/returns/${c.supplierReturnId}`} className="underline underline-offset-2">
                    {t('pharmacy.purchasing.m.cr.openReturn')}
                  </Link>
                </dd>
              </>
            )}
            {c.note && (
              <>
                <dt className="text-muted">{t('pharmacy.purchasing.po.note')}</dt>
                <dd dir="auto">{c.note}</dd>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="cr-apps" className="flex min-w-0 flex-col gap-3" data-testid="credit-applications">
          <h2 id="cr-apps" className="text-md font-semibold text-text">
            {t('pharmacy.purchasing.m.cr.applications')}
          </h2>
          {c.allocations.length === 0 ? (
            <p className="text-sm text-muted">{t('pharmacy.purchasing.m.cr.noApplications')}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {c.allocations.map((a) => (
                <li key={a.invoiceId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line text-sm text-text">
                  <Link href={`/pharmacy/purchasing/invoices/${a.invoiceId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    <bdi dir="ltr">{a.invoiceNumber}</bdi>
                  </Link>
                  {a.amountMinor !== undefined && <Amount amount={a.amountMinor} currency={c.currency} locale={locale} className="font-medium" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {g.writable.ok && left > 0n && (
          <section aria-labelledby="cr-apply" className="flex min-w-0 flex-col gap-3" data-testid="credit-apply">
            <h2 id="cr-apply" className="text-md font-semibold text-text">
              {t('pharmacy.purchasing.m.cr.applyTitle')}
            </h2>
            {!g.mayMoney ? (
              <MoneyLocked testId="credit-money-locked" text={t('pharmacy.purchasing.m.needsMoneyRole')} />
            ) : (
              <>
                <p className="flex items-start gap-2.5 text-sm text-muted">
                  <Info aria-hidden className="mt-px size-4 shrink-0" />
                  <span className="min-w-0">{t('pharmacy.purchasing.m.cr.onceHint')}</span>
                </p>
                <ApplyCreditForm userId={access.actor.userId} restaurantId={access.placeInput.restaurantId} creditNoteId={c.id} currency={c.currency} availableMinor={left.toString()} invoices={invoices} />
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
