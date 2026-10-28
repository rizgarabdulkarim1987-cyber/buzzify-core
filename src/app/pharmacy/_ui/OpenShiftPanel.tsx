'use client';

import { CircleAlert, DoorOpen, Hourglass, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { openShift } from '@/app/pharmacy/_actions/shifts';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { useLocale, useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { FIELD, Note, TOUCH_PRIMARY, FieldInput, FieldSelect } from './sell-parts';
import { minorDigits, newClientKey, parseMoney, type Currency } from './sell-logic';
import { useOnline } from './use-online';

export interface OpenShift {
  id: string;
  currency: Currency;
  openingFloatMinor: string;
  openedAt: string;
}

/**
 * The gate before selling: no open shift, no sale. The cashier names the currency of the shift and the cash in the
 * drawer, and the sale workspace takes over. The key is made once and kept until the shift is open, so a retry after a
 * dropped connection opens one shift.
 */
export function OpenShiftPanel({ currencies, defaultCurrency, onOpened }: { currencies: Currency[]; defaultCurrency: Currency; onOpened: (shift: OpenShift) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [float, setFloat] = useState('');
  const [key] = useState(() => newClientKey('shift'));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = float.trim() === '' ? 0n : parseMoney(float, currency);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online || amount === null) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() => openShift({ currency, openingFloatMinor: amount.toString(), clientKey: key }));
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error.message === NETWORK_FAILURE ? t('pharmacy.sell.offline.notSent') : phMessage(t, locale, result.error, 'pharmacy.sell'));
      return;
    }
    const data = result.data as OpenShift;
    onOpened({ id: data.id, currency: data.currency, openingFloatMinor: data.openingFloatMinor, openedAt: data.openedAt });
  };

  return (
    <section aria-labelledby="open-shift-title" data-testid="open-shift" className="mx-auto flex w-full max-w-[34rem] flex-col gap-4 px-4 py-8 sm:px-8">
      <h1 id="open-shift-title" className="flex items-center gap-2 text-xl font-semibold text-text">
        <Lock aria-hidden className="size-5 shrink-0 text-muted" />
        {t('pharmacy.sell.shift.title')}
      </h1>
      <p className="text-base text-muted">{t('pharmacy.sell.shift.body')}</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {currencies.length > 1 && (
          <Field label={t('pharmacy.sell.shift.currency')}>
            <FieldSelect className={`${FIELD} pe-8`} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} data-testid="shift-currency">
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
          <FieldInput className={FIELD} dir="ltr" inputMode="decimal" autoComplete="off" autoFocus value={float} placeholder="0" data-testid="shift-float" onChange={(event) => setFloat(event.target.value)} />
        </Field>
        {!online && <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert">{t('pharmacy.sell.offline.banner')}</Note>}
        {problem && <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="shift-problem">{problem}</Note>}
        <div>
          <button type="submit" className={TOUCH_PRIMARY} disabled={busy || !online || amount === null} data-testid="shift-open">
            {busy ? <Hourglass aria-hidden className="size-4" /> : <DoorOpen aria-hidden className="size-4" />}
            {busy ? t('pharmacy.sell.pay.saving') : t('pharmacy.sell.shift.open')}
          </button>
        </div>
      </form>
    </section>
  );
}
