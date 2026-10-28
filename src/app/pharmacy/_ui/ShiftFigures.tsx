import { Banknote, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import type { ShiftTotals, ShiftView } from '@/server/pharmacy/shifts-reads';
import { Money, Row, FIGURES, ShiftStatus } from './money-parts';
import { Note, Num } from './sell-parts';
import { formatUtc, personLabel, shiftCashRows } from './shifts-logic';
import { closePlan } from './shifts-logic';

/**
 * The figures of one shift, open (live) or closed (as stored): the cash identity line by line ending in the expected
 * cash, the sales by method, the returns, and for a closed shift the count and variance. Plain markup shared by the page
 * (server) and the live card (client); the numbers are the server's.
 */
export function ShiftFigures({ shift, totals, t, names = {} }: { shift: ShiftView; totals: ShiftTotals; t: Translate; /** Names by user id (`ph.people.names`); an id with no name shows its short form. */ names?: Record<string, string> }) {
  const cur = shift.currency;
  const rows = shiftCashRows(totals);
  const closed = shift.status === 'CLOSED';
  const variance = closed && shift.varianceMinor !== null ? BigInt(shift.varianceMinor) : null;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="shift-figures">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-text sm:max-w-[34rem]">
        <dt className="text-muted">{t('pharmacy.shifts.status')}</dt>
        <dd>
          <ShiftStatus status={shift.status} t={t} />
        </dd>
        <dt className="text-muted">{t('pharmacy.shifts.openedAt')}</dt>
        <dd><Num>{formatUtc(shift.openedAt)}</Num></dd>
        {shift.closedAt && (
          <>
            <dt className="text-muted">{t('pharmacy.shifts.closedAt')}</dt>
            <dd><Num>{formatUtc(shift.closedAt)}</Num></dd>
          </>
        )}
        <dt className="text-muted">{t('pharmacy.shifts.cashier')}</dt>
        <dd><span dir="auto" className="break-words [overflow-wrap:anywhere]">{personLabel(names, shift.userId)}</span></dd>
        {closed && (
          <>
            <dt className="text-muted">{t('pharmacy.shifts.closedBy')}</dt>
            <dd data-testid="closed-by">{shift.approvedById ? <span dir="auto" className="break-words [overflow-wrap:anywhere]">{personLabel(names, shift.approvedById)}</span> : t('pharmacy.shifts.closedByOwner')}</dd>
          </>
        )}
      </dl>

      <section aria-labelledby={`cash-${shift.id}`} className="flex flex-col gap-2">
        <h2 id={`cash-${shift.id}`} className="flex items-center gap-2 text-md font-semibold text-text">
          <Banknote aria-hidden className="size-4 shrink-0 text-muted" />
          {t('pharmacy.shifts.cash')}
        </h2>
        <dl className={`${FIGURES} sm:max-w-[34rem]`} data-testid="cash-rows">
          {rows.map((r) => (
            <Row key={r.key} label={t(`pharmacy.shifts.cash.${r.key}`)} testId={`cash-${r.key}`}>
              <span aria-hidden>{r.sign === '+' ? '+ ' : '− '}</span>
              <span className="sr-only">{r.sign === '+' ? t('pharmacy.shifts.plus') : t('pharmacy.shifts.minus')} </span>
              <Money minor={r.minor} currency={cur} />
            </Row>
          ))}
          <Row label={t('pharmacy.shifts.expected')} strong testId="cash-expected">
            <Money minor={shift.expectedMinor ?? totals.expectedMinor} currency={cur} />
          </Row>
          {closed && shift.countedMinor !== null && (
            <Row label={t('pharmacy.shifts.counted')} testId="cash-counted">
              <Money minor={shift.countedMinor} currency={cur} />
            </Row>
          )}
        </dl>
        {variance !== null && <VarianceNote variance={variance} currency={cur} reason={shift.closeReason} t={t} />}
      </section>

      <section aria-labelledby={`sales-${shift.id}`} className="flex flex-col gap-2">
        <h2 id={`sales-${shift.id}`} className="text-md font-semibold text-text">
          {t('pharmacy.shifts.sales')}
        </h2>
        <dl className={`${FIGURES} sm:max-w-[34rem]`}>
          <Row label={t('pharmacy.shifts.salesCount')} testId="sales-count">
            <Num>{totals.salesCount}</Num>
          </Row>
          <Row label={t('pharmacy.shifts.salesTotal')} testId="sales-total">
            <Money minor={totals.salesTotalMinor} currency={cur} />
          </Row>
          {totals.discountMinor !== '0' && (
            <Row label={t('pharmacy.shifts.discounts')}>
              <Money minor={totals.discountMinor} currency={cur} />
            </Row>
          )}
          {totals.payments.map((p) => (
            <Row key={p.method} label={t('pharmacy.shifts.byMethod', { method: t(`pharmacy.method.${p.method}`), count: p.count })} testId={`method-${p.method}`}>
              <Money minor={p.amountMinor} currency={cur} />
            </Row>
          ))}
        </dl>
      </section>

      <section aria-labelledby={`returns-${shift.id}`} className="flex flex-col gap-2">
        <h2 id={`returns-${shift.id}`} className="text-md font-semibold text-text">
          {t('pharmacy.shifts.returns')}
        </h2>
        <dl className={`${FIGURES} sm:max-w-[34rem]`}>
          <Row label={t('pharmacy.shifts.returnsCount')} testId="returns-count">
            <Num>{totals.returns.count}</Num>
          </Row>
          <Row label={t('pharmacy.shifts.returnsRefund')} testId="returns-refund">
            <Money minor={totals.returns.refundMinor} currency={cur} />
          </Row>
          {totals.returns.byMethod.map((p) => (
            <Row key={p.method} label={t('pharmacy.shifts.byMethod', { method: t(`pharmacy.method.${p.method}`), count: p.count })}>
              <Money minor={p.amountMinor} currency={cur} />
            </Row>
          ))}
        </dl>
        {totals.heldCount > 0 && (
          <Note icon={<CircleAlert aria-hidden />} role="status">
            {t('pharmacy.shifts.heldCarts', { n: totals.heldCount })}
          </Note>
        )}
      </section>
    </div>
  );
}

/** The result of a count, in words and an icon: matches, over or short (with the reason given). */
export function VarianceNote({ variance, currency, reason, t }: { variance: bigint; currency: 'IQD' | 'USD'; reason: string; t: Translate }) {
  const plan = closePlan(0n, variance, false)!;
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-[34rem]">
      <Note icon={plan.kind === 'match' ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />} tone={plan.kind === 'match' ? 'success' : 'danger'} role="status" testId="variance">
        <span>
          {t(`pharmacy.shifts.variance.${plan.kind}`)}
          {plan.kind !== 'match' && (
            <>
              {': '}
              <Money minor={variance} currency={currency} signed />
            </>
          )}
        </span>
      </Note>
      {reason.trim() !== '' && (
        <p className="text-sm text-text">
          <span className="text-muted">{t('pharmacy.shifts.reason')}: </span>
          <span dir="auto" className="break-words [overflow-wrap:anywhere]" data-testid="close-reason">
            {reason}
          </span>
        </p>
      )}
    </div>
  );
}
