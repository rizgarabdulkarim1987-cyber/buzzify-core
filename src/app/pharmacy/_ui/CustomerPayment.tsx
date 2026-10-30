'use client';

import { Banknote, CircleAlert, CircleCheck, CreditCard, Hourglass, Info, Landmark, Undo2, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { recordCustomerPayment, reverseCustomerPayment } from '@/app/pharmacy/_actions/customers';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, Note, Num, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { formatMinor, keyFor, outcomeUnknown, parseMoney, type Currency, type KeyedAttempt } from './sell-logic';

type Method = 'CASH' | 'CARD' | 'TRANSFER';
const METHODS: { method: Method; icon: ReactNode }[] = [
  { method: 'CASH', icon: <Banknote aria-hidden /> },
  { method: 'CARD', icon: <CreditCard aria-hidden /> },
  { method: 'TRANSFER', icon: <Landmark aria-hidden /> },
];

/**
 * "Record a payment" for one customer. Cash goes into the drawer, so the dialog says in words that it needs the person's own open
 * shift (the server refuses without one and the refusal is shown in words). The amount is read from text into minor units; a payment
 * above what the customer owes is refused before it is sent. One key per attempt: a retry after a lost answer sends the same key and
 * is recorded once.
 */
export function RecordPayment({ customerId, currency, owedMinor, branchChosen }: { customerId: string; currency: Currency; owedMinor: string; branchChosen: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('CASH');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const attempt = useRef<KeyedAttempt | null>(null);
  const lock = useRef(false);

  const owed = BigInt(owedMinor);
  const minor = amount.trim() === '' ? null : parseMoney(amount, currency);
  const amountProblem = minor === null ? 'amount' : minor <= 0n ? 'amount' : minor > owed ? 'over' : null;
  const reset = () => {
    setMethod('CASH');
    setAmount('');
    setProblem(null);
    attempt.current = null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || lock.current || amountProblem || minor === null) return;
    lock.current = true;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, JSON.stringify([customerId, method, minor.toString()]), 'cpay');
    const key = attempt.current.key;
    const result = await settle(() => recordCustomerPayment({ clientKey: key, customerId, method, amountMinor: minor.toString() }));
    setBusy(false);
    lock.current = false;
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(outcomeUnknown(result.error) ? t('pharmacy.credit.payment.unknown') : phMessage(t, locale, result.error, 'pharmacy.credit'));
      return;
    }
    attempt.current = null;
    setOpen(false);
    reset();
    setDone(true);
    router.refresh();
  };

  const FORM = 'customer-payment-form';
  return (
    <>
      <div className="flex flex-col items-start gap-2">
        <button type="button" className={TOUCH_PRIMARY} data-testid="payment-open" disabled={owed <= 0n || !branchChosen} onClick={() => { setDone(false); setOpen(true); }}>
          <Wallet aria-hidden className="size-4" />
          {t('pharmacy.credit.payment.open')}
        </button>
        {owed <= 0n && (
          <p className="flex items-center gap-2 text-sm text-muted" data-testid="payment-nothing-owed">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.credit.payment.nothingOwed')}
          </p>
        )}
        {owed > 0n && !branchChosen && (
          <p className="flex items-center gap-2 text-sm text-muted" data-testid="payment-pick-branch">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.credit.payment.pickBranch')}
          </p>
        )}
        {done && (
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="payment-done">
            {t('pharmacy.credit.payment.done')}
          </Note>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
        width="md"
        title={t('pharmacy.credit.payment.title')}
        description={
          <span data-testid="payment-owed">
            {t('pharmacy.credit.payment.owed')}: <strong className="text-text"><Num>{formatMinor(owed, currency)}</Num> {currency}</strong>
          </span>
        }
        footer={
          <>
            <button type="button" className={TOUCH_BTN} disabled={busy} onClick={() => { setOpen(false); reset(); }}>
              {t('pharmacy.sell.pay.cancel')}
            </button>
            <button type="submit" form={FORM} className={TOUCH_PRIMARY} data-testid="payment-confirm" disabled={busy || amountProblem !== null}>
              {busy ? <Hourglass aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
              {busy ? t('pharmacy.credit.payment.saving') : t('pharmacy.credit.payment.confirm')}
            </button>
          </>
        }
      >
        <form id={FORM} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-text">{t('pharmacy.sell.pay.method')}</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(({ method: m, icon }) => (
                <label
                  key={m}
                  className={`flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-center text-sm font-medium [&_svg]:size-4 ${
                    method === m ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised text-text hover:bg-hover'
                  } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}
                >
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" data-testid={`cpay-${m}`} />
                  {icon}
                  {t(`pharmacy.credit.method.${m}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {method === 'CASH' && (
            <Note icon={<Info aria-hidden />} tone="info" role="status" testId="payment-cash-note">
              {t('pharmacy.credit.payment.cashNote')}
            </Note>
          )}
          <Field label={t('pharmacy.credit.payment.amount', { currency })} error={amount.trim() !== '' && amountProblem ? t(`pharmacy.credit.payment.problem.${amountProblem}`) : undefined}>
            <FieldInput className={FIELD} dir="ltr" inputMode="decimal" autoComplete="off" autoFocus data-testid="payment-amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {problem && (
            <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="payment-problem">
              {problem}
            </Note>
          )}
        </form>
      </Dialog>
    </>
  );
}

/** "Correct this payment": once per payment; asks first and says what it does. */
export function CorrectPayment({ paymentId }: { paymentId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const attempt = useRef<KeyedAttempt | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, paymentId, 'crev');
    const key = attempt.current.key;
    const result = await settle(() => reverseCustomerPayment({ clientKey: key, paymentId }));
    setBusy(false);
    if (!result.ok) {
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(outcomeUnknown(result.error) ? t('pharmacy.credit.payment.unknown') : phMessage(t, locale, result.error, 'pharmacy.credit'));
      return;
    }
    setAsking(false);
    router.refresh();
  };

  if (!asking) {
    return (
      <button type="button" className={TOUCH_BTN} data-testid="payment-correct" onClick={() => setAsking(true)}>
        <Undo2 aria-hidden className="size-4" />
        {t('pharmacy.credit.correct.open')}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="payment-correct-ask">
      <Note icon={<Undo2 aria-hidden />} tone="danger" role="alert">
        {t('pharmacy.credit.correct.ask')}
      </Note>
      {problem && (
        <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="correct-problem">
          {problem}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={TOUCH_BTN} disabled={busy} onClick={() => setAsking(false)}>
          {t('pharmacy.credit.correct.keep')}
        </button>
        <button type="button" className={TOUCH_PRIMARY} data-testid="payment-correct-confirm" disabled={busy} onClick={() => void run()}>
          <Undo2 aria-hidden className="size-4" />
          {busy ? t('pharmacy.credit.payment.saving') : t('pharmacy.credit.correct.confirm')}
        </button>
      </div>
    </div>
  );
}
