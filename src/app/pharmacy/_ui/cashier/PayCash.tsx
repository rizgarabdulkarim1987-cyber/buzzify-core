'use client';

import { Banknote, CreditCard, Landmark } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { cashShortcuts, formatMinor, paymentPreview, plainMinor, type Currency, type PayDraft, type PayMethod, type SaleAttempt } from '../sell-logic';
import { FieldInput, Num, PH_BTN, PH_FIELD } from '../sell-parts';
import { cashDraftOf } from './sale-flow-logic';
import { ConfirmBar, FlowNotes, type FlowCommon } from './WorkParts';

export const METHODS: { method: PayMethod; icon: ReactNode }[] = [
  { method: 'CASH', icon: <Banknote aria-hidden /> },
  { method: 'CARD_MANUAL', icon: <CreditCard aria-hidden /> },
  { method: 'TRANSFER_MANUAL', icon: <Landmark aria-hidden /> },
];

/** The three manual methods as pressed buttons (never a dropdown). */
export function MethodButtons({ method, onMethod, disabled = false }: { method: PayMethod; onMethod: (method: PayMethod) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('pharmacy.sell.pay.method')}>
      {METHODS.map(({ method: m, icon }) => (
        <button
          key={m}
          type="button"
          aria-pressed={method === m}
          data-testid={`pay-method-${m}`}
          disabled={disabled}
          onClick={() => onMethod(m)}
          className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-ph-xl border px-2 text-sm font-semibold [&_svg]:size-4 ${method === m ? 'border-ph-g8 bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas'}`}
        >
          {icon}
          {t(`pharmacy.sell.pay.method.${m}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * The cash flow (F2), inline: the amount received with round-number shortcuts and the change due (or what is short), or a card or
 * transfer recorded by hand for exactly the total, as the old payment dialog took it. An empty amount is the exact total, so
 * Enter alone completes a no-change sale. A sale in flight comes back filled in as it was sent and locked: while its outcome is
 * not known Confirm sends it again with the same keys (Retry), and only Discard lets it go and the fields change again.
 */
export function PayCash({ currency, totalMinor, attempt, onSubmit, ...common }: FlowCommon & { currency: Currency; totalMinor: bigint; attempt: SaleAttempt | null; onSubmit: (draft: PayDraft, amountMinor: bigint) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<PayDraft>(() => cashDraftOf(attempt, currency));
  const preview = paymentPreview(draft, totalMinor, currency);
  const cash = draft.method === 'CASH';
  const typed = draft.tendered.trim() === '' ? totalMinor : preview.amountMinor;
  const short = cash && typed !== null && typed < totalMinor ? totalMinor - typed : null;
  const locked = common.pending;
  const stuck = locked && !common.busy;
  const canSend = stuck ? !common.offline && !common.elsewhere : !common.busy && !common.offline && common.blocked === null && preview.ok && preview.amountMinor !== null;
  const change = (next: PayDraft) => {
    if (!locked) setDraft(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    if (stuck) common.onRetry();
    else onSubmit(draft, preview.amountMinor!);
  };
  const fieldError = preview.amountMinor === null ? t('pharmacy.sell.pay.invalidAmount') : !preview.ok && !cash ? t('pharmacy.sell.pay.exactOnly') : undefined;
  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit} data-testid="flow-cash">
      <p className="text-sm text-ph-muted" data-testid="flow-due">
        {t('pharmacy.cashier.flow.due')}:{' '}
        <b className="text-ph-text">
          <Num>{formatMinor(totalMinor, currency)}</Num> {currency}
        </b>{' '}
        · {t('pharmacy.sell.estimate')}
      </p>
      <MethodButtons method={draft.method} disabled={locked} onMethod={(method) => change({ ...draft, method, tendered: '' })} />
      <Field label={t(cash ? 'pharmacy.cashier.flow.received' : 'pharmacy.sell.pay.amount')} hint={draft.tendered.trim() === '' ? t('pharmacy.sell.pay.exactHint') : undefined} error={fieldError}>
        <FieldInput
          className={`${PH_FIELD} min-h-12 text-lg font-bold tabular-nums`}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          data-testid="flow-tendered"
          readOnly={locked}
          value={draft.tendered}
          placeholder={plainMinor(totalMinor, currency)}
          onChange={(event) => change({ ...draft, tendered: event.target.value })}
        />
      </Field>
      {cash ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('pharmacy.sell.pay.quick')}>
            {cashShortcuts(totalMinor, currency).map((amount) => (
              <button key={amount.toString()} type="button" className={PH_BTN} data-testid="flow-quick" disabled={locked} onClick={() => change({ ...draft, tendered: plainMinor(amount, currency) })}>
                <Num>{formatMinor(amount, currency)}</Num>
              </button>
            ))}
          </div>
          <p
            data-testid="flow-change"
            role="status"
            className={`flex items-baseline justify-between gap-3 rounded-ph-xl px-3 py-2.5 text-md font-bold ${short === null ? 'bg-ph-g1 text-ph-g6' : 'bg-ph-red-wash text-ph-red'}`}
          >
            <span>{t(short === null ? 'pharmacy.cashier.flow.change' : 'pharmacy.cashier.flow.short')}</span>
            <span>
              <Num>{formatMinor(short ?? preview.changeMinor, currency)}</Num> {currency}
            </span>
          </p>
        </>
      ) : (
        <Field label={t('pharmacy.sell.pay.reference')} optional>
          <FieldInput className={PH_FIELD} dir="auto" autoComplete="off" maxLength={200} data-testid="flow-reference" readOnly={locked} value={draft.reference} onChange={(event) => change({ ...draft, reference: event.target.value })} />
        </Field>
      )}
      <FlowNotes {...common} />
      <ConfirmBar {...common} disabled={!canSend} label={t(stuck ? 'pharmacy.cashier.flow.retry' : 'pharmacy.cashier.flow.confirmSale')} />
    </form>
  );
}
