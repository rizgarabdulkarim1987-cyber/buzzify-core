'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addPosExpense, closePosShift, openPosShift } from '@/app/studio/_actions/pos';
import { formatNumber, formatStamp } from '@/lib/pos-format';
import { countKind } from '@/lib/pos-view';
import type { ShiftSummary } from '@/server/pos/shifts';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const FLOATS = [0, 25_000, 50_000, 100_000] as const;
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 9);

/** Starting a shift: the cash already in the drawer, by a tap or typed. */
export function OpenShiftForm() {
  const t = useT();
  const money = useMoney();
  const { call, pending } = usePosCall();
  const [amount, setAmount] = useState('0');
  return (
    <div className="flex max-w-xl flex-col gap-4 px-4 pb-8 sm:px-8">
      <p className="text-base text-muted">{t('pos.shift.noneOpen')}</p>
      <div className="flex flex-wrap gap-2">
        {FLOATS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={amount === String(value)}
            onClick={() => setAmount(String(value))}
            className={cx('min-h-12 rounded-md border px-4 text-base font-medium', amount === String(value) ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised hover:bg-hover')}
          >
            {money(value)}
          </button>
        ))}
      </div>
      <Field label={t('pos.shift.openingFloat')}>
        <Input size="lg" inputMode="numeric" dir="ltr" value={amount} onChange={(event) => setAmount(digits(event.target.value))} />
      </Field>
      <Button variant="primary" size="lg" className="min-h-12" disabled={pending || amount === ''} pending={pending} onClick={() => void call(() => openPosShift({ openingFloat: Number(amount) }))}>
        {t('pos.shift.open')}
      </Button>
    </div>
  );
}

/** A shift: while open its live totals, the expense dialog and the count-and-close dialog; once closed, the slip. */
export function ShiftPanel({ summary, canClose }: { summary: ShiftSummary; canClose: boolean }) {
  const t = useT();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [dialog, setDialog] = useState<'none' | 'expense' | 'close'>('none');
  const [counted, setCounted] = useState('');
  const { shift } = summary;
  const open = shift.closedAt === null;
  const difference = open ? (counted === '' ? null : Number(counted) - summary.expectedCash) : shift.difference;

  return (
    <div className="flex max-w-xl flex-col gap-4 px-4 pb-8 sm:px-8 print:max-w-none print:p-0">
      <p className="text-base text-muted">
        {summary.cashierName} · {t('pos.shift.openedAt')} {formatStamp(shift.openedAt)}
        {shift.closedAt ? ` · ${t('pos.shift.closedAt')} ${formatStamp(shift.closedAt)}` : ''}
      </p>
      <dl className="flex flex-col gap-2 rounded-lg border border-line p-4 text-base">
        <Row label={t('pos.shift.openingFloat')} value={money(shift.openingFloat)} />
        <Row label={t('pos.shift.cashSales', { n: formatNumber(summary.salesCount) })} value={money(summary.cashSales)} />
        <Row label={t('pos.shift.expenses')} value={`− ${money(summary.expensesTotal)}`} />
        <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold">
          <dt>{t('pos.shift.expected')}</dt>
          <dd>{money(summary.expectedCash)}</dd>
        </div>
        {!open && shift.countedCash !== null ? <Row label={t('pos.shift.counted')} value={money(shift.countedCash)} /> : null}
        {!open && difference !== null ? <Verdict difference={difference} /> : null}
      </dl>

      {summary.expenses.length > 0 ? (
        <section aria-label={t('pos.shift.expenses')}>
          <ul className="flex flex-col divide-y divide-line text-base">
            {summary.expenses.map((expense) => (
              <li key={expense.id} className="flex justify-between gap-3 py-2">
                <span>{expense.reason}</span>
                <span>{money(expense.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shift.note ? <p className="text-base text-muted">{shift.note}</p> : null}

      {open ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="secondary" size="lg" className="min-h-12 flex-1" disabled={pending} onClick={() => setDialog('expense')}>
            {t('pos.shift.addExpense')}
          </Button>
          {canClose ? (
            <Button variant="primary" size="lg" className="min-h-12 flex-1" disabled={pending} onClick={() => setDialog('close')}>
              {t('pos.shift.countAndClose')}
            </Button>
          ) : null}
        </div>
      ) : (
        <Button variant="primary" size="lg" className="min-h-12 print:hidden" onClick={() => window.print()}>
          {t('pos.receipt.print')}
        </Button>
      )}

      <ConfirmDialog
        open={dialog === 'expense'}
        onOpenChange={(next) => !next && setDialog('none')}
        title={t('pos.shift.addExpense')}
        confirmLabel={t('common.save')}
        tone="primary"
        onConfirm={async (form) => {
          const amount = digits(String(form.get('amount') ?? ''));
          const reason = String(form.get('reason') ?? '').trim();
          const result = await call(() => addPosExpense({ shiftId: shift.id, amount: Number(amount), reason }), { quiet: true });
          if (result.ok) return true;
          return { fields: result.error.fields ?? {}, message: result.error.fields ? undefined : t('pos.shift.refused') };
        }}
      >
        {(errors) => (
          <>
            <Field label={t('pos.shift.expenseAmount')} error={errors.amount}>
              <Input name="amount" autoFocus size="lg" inputMode="numeric" dir="ltr" />
            </Field>
            <Field label={t('pos.order.reason')} error={errors.reason}>
              <Input name="reason" size="lg" maxLength={200} />
            </Field>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'close'}
        onOpenChange={(next) => !next && setDialog('none')}
        title={t('pos.shift.countAndClose')}
        body={summary.openOrdersCount > 0 ? t('pos.shift.openOrders', { n: formatNumber(summary.openOrdersCount) }) : t('pos.shift.countHint', { amount: money(summary.expectedCash) })}
        confirmLabel={t('pos.shift.close')}
        tone="primary"
        onConfirm={async (form) => {
          const countedCash = Number(digits(String(form.get('counted') ?? '')));
          const note = String(form.get('note') ?? '').trim();
          const result = await call(() => closePosShift({ shiftId: shift.id, countedCash, note }), { quiet: true });
          if (result.ok) {
            router.push(`/pos/shift/${shift.id}`);
            return true;
          }
          return { fields: result.error.fields ?? {}, message: result.error.fields ? undefined : t('pos.shift.refused') };
        }}
      >
        {(errors) => (
          <>
            <Field label={t('pos.shift.counted')} error={errors.countedCash}>
              <Input name="counted" autoFocus size="lg" inputMode="numeric" dir="ltr" value={counted} onChange={(event) => setCounted(digits(event.target.value))} />
            </Field>
            {difference !== null ? (
              <dl aria-live="polite">
                <Verdict difference={difference} />
              </dl>
            ) : null}
            <Field label={t('pos.shift.note')} optional>
              <Input name="note" size="lg" maxLength={300} />
            </Field>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** What a count says against the expected cash: exact, over, or short, in words and not only colour. */
function Verdict({ difference }: { difference: number }) {
  const t = useT();
  const money = useMoney();
  const kind = countKind(difference);
  return (
    <div className={cx('flex justify-between gap-3 text-base font-semibold', kind === 'exact' ? 'text-success' : 'text-danger')}>
      <dt>{t(`pos.shift.${kind}`)}</dt>
      <dd>{kind === 'exact' ? '' : money(Math.abs(difference))}</dd>
    </div>
  );
}
