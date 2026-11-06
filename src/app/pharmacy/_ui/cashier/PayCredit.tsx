'use client';

import { CircleAlert, Hourglass, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getCustomer } from '@/app/pharmacy/_actions/customers';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { creditPreview, creditView } from '../credit-logic';
import type { PickedCustomer } from '../CustomerPicker';
import { phMessage } from '../ph-failure';
import { formatMinor, parseMoney, type Currency, type PayDraft, type SaleAttempt } from '../sell-logic';
import { FieldInput, Note, Num, PH_FIELD } from '../sell-parts';
import { isolate } from '../WriteBlocked';
import { padMoney } from './cashier-logic';
import { MethodButtons } from './PayCash';
import { creditDraftOf, creditInputOf } from './sale-flow-logic';
import { ConfirmBar, FlowNotes, usePadSink, type FlowCommon, type PadSlot } from './WorkParts';

/**
 * The credit flow (F3), inline: the receipt's customer is required (picked in the side column); what is paid now (cash by default,
 * or card / transfer) is typed, and the rest goes on the customer's account. The limit is checked here with the old screen's rules
 * (`creditPreview`: landing exactly on the limit is allowed) before anything is sent; the server stays the authority. A customer kept
 * on the receipt (after a reload, or a credit sale in flight) is read again so the figures are current. A sale in flight is locked
 * as it was sent: Confirm sends it again with the same keys (Retry), and only Discard lets it go.
 */
export function PayCredit({
  currency,
  totalMinor,
  attempt,
  customer,
  customerId,
  onCustomer,
  onSubmit,
  padSlot,
  ...common
}: FlowCommon & {
  padSlot?: PadSlot;
  currency: Currency;
  totalMinor: bigint;
  attempt: SaleAttempt | null;
  customer: PickedCustomer | null;
  /** The customer kept on the receipt (or on the sale in flight), read when `customer` is not in memory. */
  customerId: string | null;
  onCustomer: (customer: PickedCustomer) => void;
  onSubmit: (draft: PayDraft, amountMinor: bigint, onAccount: { minor: bigint; customerName: string }) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [input, setInput] = useState(() => creditInputOf(attempt, currency));
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // The side keypad types what is paid now, and its check key confirms (as Enter in the field does).
  usePadSink(padSlot, {
    key: (key) => void (!common.pending && setInput((i) => ({ ...i, now: padMoney(i.now, key) }))),
    enter: () => form.current?.requestSubmit(),
  });
  const wanted = customer ? null : customerId;
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void settle(() => getCustomer({ customerId: wanted })).then((result) => {
      if (cancelled) return;
      if (result.ok) onCustomer(result.data as PickedCustomer);
      else setLoadProblem(phMessage(t, locale, result.error, 'pharmacy.credit'));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per customer id
  }, [wanted]);

  const draft = customer ? creditDraftOf(input, customer.id, totalMinor, currency) : null;
  const preview = draft && customer ? creditPreview(draft, totalMinor, currency, customer) : null;
  const locked = common.pending;
  const stuck = locked && !common.busy;
  const canSend = stuck ? !common.offline && !common.elsewhere : !common.busy && !common.offline && common.blocked === null && preview?.ok === true && preview.creditMinor !== null;
  const change = (next: typeof input) => {
    if (!locked) setInput(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    if (stuck) common.onRetry();
    else if (draft && customer) onSubmit(draft, preview!.amountMinor, { minor: preview!.creditMinor!, customerName: customer.name });
  };
  const view = customer ? creditView(customer, 0n) : null;
  const onAccount = draft?.credit ? parseMoney(draft.credit.amount, currency) : null;
  const personProblem = preview?.problem === 'currency' || preview?.problem === 'archived' ? preview.problem : null;
  const money = (minor: bigint) => (
    <>
      <Num>{formatMinor(minor, currency)}</Num> {currency}
    </>
  );

  return (
    <form ref={form} className="flex flex-col gap-2.5" onSubmit={submit} data-testid="flow-credit">
      {!customer && !wanted && (
        <Note look="ph" icon={<UserRound aria-hidden />} tone="danger" role="status" testId="flow-need-customer">
          {t('pharmacy.cashier.credit.needCustomer')}
        </Note>
      )}
      {!customer && wanted && !loadProblem && (
        <Note look="ph" icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.credit.pick.loading')}
        </Note>
      )}
      {loadProblem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert">
          {loadProblem}
        </Note>
      )}
      {customer && view && (
        <>
          <p className="flex flex-col gap-0.5 text-sm text-ph-muted" data-testid="flow-credit-room">
            <span className="font-semibold text-ph-text" dir="auto">
              {isolate(customer.name)}
            </span>
            <span>
              {t('pharmacy.cashier.flow.due')}: <b className="text-ph-text">{money(totalMinor)}</b> · {t('pharmacy.cashier.credit.limit')} {money(view.limit)} · {t('pharmacy.cashier.credit.balance')} {money(view.balance)} ·{' '}
              {t('pharmacy.cashier.credit.room')} {money(view.remaining)}
            </span>
          </p>
          <Field label={t('pharmacy.cashier.credit.now')} error={draft === null ? t('pharmacy.sell.pay.invalidAmount') : undefined}>
            <FieldInput
              className={`${PH_FIELD} min-h-12 text-lg font-bold tabular-nums`}
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              data-testid="flow-now"
              readOnly={locked}
              value={input.now}
              placeholder="0"
              onChange={(event) => change({ ...input, now: event.target.value })}
            />
          </Field>
          <MethodButtons method={input.method} disabled={locked} onMethod={(method) => change({ ...input, method })} />
          {input.method !== 'CASH' && (
            <Field label={t('pharmacy.sell.pay.reference')} optional>
              <FieldInput className={PH_FIELD} dir="auto" autoComplete="off" maxLength={200} readOnly={locked} value={input.reference} onChange={(event) => change({ ...input, reference: event.target.value })} />
            </Field>
          )}
          {draft && onAccount !== null && (
            <p
              data-testid="flow-debt"
              role="status"
              className={`flex items-baseline justify-between gap-3 rounded-ph-xl px-3 py-2.5 text-md font-bold ${preview?.problem === 'overLimit' ? 'bg-ph-red-wash text-ph-red' : 'bg-ph-g1 text-ph-g6'}`}
            >
              <span>
                {t('pharmacy.cashier.credit.debt')}
                {preview?.problem === 'overLimit' ? ` (${t('pharmacy.cashier.credit.overLimit')})` : ''}
              </span>
              <span>{money(onAccount)}</span>
            </p>
          )}
          {preview?.problem === 'amount' && (
            <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="flow-credit-nothing">
              {t('pharmacy.cashier.credit.nothing')}
            </Note>
          )}
          {personProblem && (
            <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert">
              {t(`pharmacy.credit.pay.problem.${personProblem}`)}
            </Note>
          )}
        </>
      )}
      <FlowNotes {...common} />
      <ConfirmBar {...common} disabled={!canSend} label={t(stuck ? 'pharmacy.cashier.flow.retry' : 'pharmacy.cashier.flow.confirm')} />
    </form>
  );
}
