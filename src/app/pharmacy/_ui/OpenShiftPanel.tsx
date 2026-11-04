'use client';

import { CircleAlert, DoorOpen, Hourglass, Lock } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { openShift } from '@/app/pharmacy/_actions/shifts';
import { settle } from '@/studio/settle';
import { useLocale, useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { Note, PH_FIELD, FieldInput, FieldSelect } from './sell-parts';
import { keyFor, minorDigits, openedShiftOrClosed, outcomeUnknown, parseMoney, type Currency, type KeyedAttempt } from './sell-logic';
import { useOnline } from './use-online';

export interface OpenShift {
  id: string;
  currency: Currency;
  openingFloatMinor: string;
  openedAt: string;
}

/** The large "Open shift" button: across the card, 56px high. */
const OPEN = 'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-ph-xl bg-ph-g8 px-4 text-base font-semibold text-ph-on-green hover:bg-ph-g9 disabled:cursor-not-allowed disabled:opacity-45';

/**
 * The gate before selling: no open shift, no sale. The cashier names the currency of the shift and the cash in the
 * drawer, and the sale workspace takes over. The key belongs to THAT request (currency and opening cash): a retry after a
 * dropped connection sends the same key, so one shift opens; a changed currency or amount is another request with a new key.
 */
export function OpenShiftPanel({ currencies, defaultCurrency, onOpened }: { currencies: Currency[]; defaultCurrency: Currency; onOpened: (shift: OpenShift) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [float, setFloat] = useState('');
  const attempt = useRef<KeyedAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = float.trim() === '' ? 0n : parseMoney(float, currency);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online || amount === null) return;
    setBusy(true);
    setProblem(null);
    attempt.current = keyFor(attempt.current, `${currency}:${amount.toString()}`, 'shift');
    const clientKey = attempt.current.key;
    const result = await settle(() => openShift({ currency, openingFloatMinor: amount.toString(), clientKey }));
    setBusy(false);
    if (!result.ok) {
      // An unknown outcome keeps the key (a repeat opens one shift); a refusal drops it.
      if (!outcomeUnknown(result.error)) attempt.current = null;
      setProblem(outcomeUnknown(result.error) ? t('pharmacy.sell.offline.shiftUnknown') : phMessage(t, locale, result.error, 'pharmacy.sell'));
      return;
    }
    const data = result.data as OpenShift & { status: 'OPEN' | 'CLOSED' };
    const answer = openedShiftOrClosed(data);
    if (answer.kind === 'closed') {
      // The replay found the shift already closed: its key is spent, the next try is a new request.
      attempt.current = null;
      setProblem(t('pharmacy.sell.shift.closedAgain'));
      return;
    }
    onOpened({ id: data.id, currency: data.currency, openingFloatMinor: data.openingFloatMinor, openedAt: data.openedAt });
  };

  return (
    <section
      aria-labelledby="open-shift-title"
      data-testid="open-shift"
      className="mx-4 my-8 flex min-w-0 flex-col gap-4 rounded-ph-2xl bg-ph-card p-5 text-ph-text sm:mx-auto sm:w-full sm:max-w-[30rem] sm:p-6"
    >
      <span aria-hidden className="grid size-12 place-items-center rounded-ph-xl bg-ph-g1 text-ph-g6">
        <Lock className="size-6" />
      </span>
      <h1 id="open-shift-title" className="text-xl font-bold">
        {t('pharmacy.sell.shift.title')}
      </h1>
      <p className="text-base text-ph-muted">{t('pharmacy.sell.shift.body')}</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {currencies.length > 1 && (
          <Field label={t('pharmacy.sell.shift.currency')}>
            <FieldSelect className={`${PH_FIELD} pe-8`} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} data-testid="shift-currency">
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </FieldSelect>
          </Field>
        )}
        <Field
          label={t('pharmacy.sell.shift.float', { currency })}
          hint={t('pharmacy.sell.shift.floatHint', { digits: minorDigits(currency) })}
          error={amount === null ? t('pharmacy.sell.pay.invalidAmount') : undefined}
        >
          <FieldInput className={PH_FIELD} dir="ltr" inputMode="decimal" autoComplete="off" autoFocus value={float} placeholder="0" data-testid="shift-float" onChange={(event) => setFloat(event.target.value)} />
        </Field>
        {!online && <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert">{t('pharmacy.sell.offline.banner')}</Note>}
        {problem && <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="shift-problem">{problem}</Note>}
        <div>
          <button type="submit" className={OPEN} disabled={busy || !online || amount === null} data-testid="shift-open">
            {busy ? <Hourglass aria-hidden className="size-4" /> : <DoorOpen aria-hidden className="size-4" />}
            {busy ? t('pharmacy.sell.pay.saving') : t('pharmacy.sell.shift.open')}
          </button>
        </div>
      </form>
    </section>
  );
}
