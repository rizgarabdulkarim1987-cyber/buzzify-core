'use client';

import { Archive, ArchiveRestore, CircleAlert, CircleCheck, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { archiveCustomer, createCustomer, updateCustomer } from '@/app/pharmacy/_actions/customers';
import type { CustomerView } from '@/server/pharmacy/customers-reads';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { CURRENCIES, parseMoney, plainMinor, type Currency } from './sell-logic';
import { useOnline } from './use-online';

/**
 * The customer form (new and edit). Customer details are personal: they stay in this form's memory only and are never written to the
 * device's storage. The phone and the note exist only for `customer.manage` (the page does not draw this form for anyone else). The
 * currency is chosen once, when the customer is made: the account is in it for good. A save sends the version it started from; a
 * stale one shows the server's refusal in words. Archiving asks first and keeps the account's history.
 */
export function CustomerForm({ customer, writable, defaultCurrency }: { customer: CustomerView | null; writable: boolean; defaultCurrency: Currency }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [currency, setCurrency] = useState<Currency>(customer?.currency ?? defaultCurrency);
  const [limit, setLimit] = useState(customer ? plainMinor(BigInt(customer.creditLimitMinor), customer.currency) : '');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const lock = useRef(false);

  const limitMinor = limit.trim() === '' ? 0n : parseMoney(limit, currency);
  const problems = { name: name.trim() === '' ? 'name' : null, limit: limitMinor === null ? 'limit' : null };
  const invalid = problems.name !== null || problems.limit !== null;
  const can = writable && online && !busy;

  const save = async () => {
    setTouched(true);
    if (invalid || !can || lock.current || limitMinor === null) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    const body = { name, phone, note, creditLimitMinor: limitMinor.toString() };
    const result = await settle<{ id: string; version?: number }>(() => (customer ? updateCustomer({ ...body, customerId: customer.id, expectedVersion: customer.version }) : createCustomer({ ...body, currency })));
    setBusy(false);
    lock.current = false;
    if (!result.ok) {
      setMessage({ tone: 'danger', text: phMessage(t, locale, result.error, 'pharmacy.credit') });
      return;
    }
    if (customer) {
      setMessage({ tone: 'success', text: t('pharmacy.customers.saved') });
      router.refresh();
    } else router.replace(`/pharmacy/customers/${result.data.id}`);
  };

  const archive = async (archived: boolean) => {
    if (!customer || !can) return;
    setBusy(true);
    const result = await settle(() => archiveCustomer({ customerId: customer.id, archived }));
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: phMessage(t, locale, result.error, 'pharmacy.credit') });
      return;
    }
    setMessage({ tone: 'success', text: t(archived ? 'pharmacy.customers.archivedDone' : 'pharmacy.customers.restoredDone') });
    router.refresh();
  };

  return (
    <form
      className="flex min-w-0 max-w-2xl flex-col gap-4"
      data-testid="customer-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <OfflineNotice />
      <Note icon={<CircleAlert aria-hidden />} tone="info" role="status">
        {t('pharmacy.customers.privacy')}
      </Note>
      <Field label={t('pharmacy.customers.name')} error={touched && problems.name ? t('pharmacy.customers.problem.name') : undefined}>
        <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={120} data-testid="customer-name" value={name} disabled={!writable} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('pharmacy.customers.phone')} optional>
        <FieldInput className={FIELD} dir="ltr" inputMode="tel" autoComplete="off" maxLength={40} data-testid="customer-phone" value={phone} disabled={!writable} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={t('pharmacy.customers.currency')} hint={customer ? t('pharmacy.customers.currencyFixed') : t('pharmacy.customers.currencyOnce')}>
        <FieldSelect className={`${FIELD} pe-8`} data-testid="customer-currency" value={currency} disabled={!writable || customer !== null} onChange={(e) => setCurrency(e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t('pharmacy.customers.limit', { currency })} hint={t('pharmacy.customers.limitHint')} error={touched && problems.limit ? t('pharmacy.customers.problem.limit') : undefined}>
        <FieldInput className={FIELD} dir="ltr" inputMode="decimal" autoComplete="off" data-testid="customer-limit" value={limit} disabled={!writable} onChange={(e) => setLimit(e.target.value)} />
      </Field>
      <Field label={t('pharmacy.customers.note')} optional>
        <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={500} data-testid="customer-note" value={note} disabled={!writable} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {message && (
        <Note icon={message.tone === 'danger' ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />} tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'} testId="customer-message">
          {message.text}
        </Note>
      )}
      {writable && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={TOUCH_PRIMARY} data-testid="customer-save" disabled={!can}>
            <Save aria-hidden className="size-4" />
            {busy ? t('pharmacy.customers.saving') : t('pharmacy.customers.save')}
          </button>
          {customer && !asking && (
            <button type="button" className={TOUCH_BTN} data-testid="customer-archive" disabled={!can} onClick={() => (customer.active ? setAsking(true) : void archive(false))}>
              {customer.active ? <Archive aria-hidden className="size-4" /> : <ArchiveRestore aria-hidden className="size-4" />}
              {t(customer.active ? 'pharmacy.customers.archive' : 'pharmacy.customers.restore')}
            </button>
          )}
        </div>
      )}
      {asking && customer && (
        <div className="flex flex-col gap-2" data-testid="customer-archive-ask">
          <Note icon={<Archive aria-hidden />} tone="danger" role="alert">
            {t('pharmacy.customers.archiveAsk')}
          </Note>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={TOUCH_BTN} onClick={() => setAsking(false)}>
              {t('pharmacy.customers.archiveKeep')}
            </button>
            <button type="button" className={TOUCH_PRIMARY} data-testid="customer-archive-confirm" disabled={!can} onClick={() => void archive(true)}>
              <Archive aria-hidden className="size-4" />
              {t('pharmacy.customers.archive')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
