'use client';

import { Ban, CircleAlert, CircleCheck, Hourglass, Search, SearchX, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listCustomers } from '@/app/pharmacy/_actions/customers';
import { creditablePerson, creditView, type CustomerLite } from '@/app/pharmacy/_ui/credit-logic';
import { phMessage } from '@/app/pharmacy/_ui/ph-failure';
import { FIELD, FieldInput, Note, Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatMinor, type Currency } from '@/app/pharmacy/_ui/sell-logic';
import { isolate } from '@/app/pharmacy/_ui/WriteBlocked';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';

/** A customer as the picker holds one: the figures (exact strings) and the name. */
export type PickedCustomer = CustomerLite & { name: string };

const money = (minor: string, currency: Currency) => (
  <>
    <Num>{formatMinor(BigInt(minor), currency)}</Num> {currency}
  </>
);

/**
 * Finds a customer by name for a credit sale. Each result says in words what the account holds (balance, limit, room left) and
 * why a customer cannot be chosen (another currency, archived): never a colour alone. The list scrolls inside its own box.
 */
export function CustomerPicker({ saleCurrency, picked, onPick }: { saleCurrency: Currency; picked: PickedCustomer | null; onPick: (customer: PickedCustomer | null) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickedCustomer[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void settle(() => listCustomers({ search: q.trim(), active: true })).then((result) => {
        if (mine !== seq.current) return;
        if (!result.ok) {
          setProblem(phMessage(t, locale, result.error, 'pharmacy.credit'));
          setItems([]);
          return;
        }
        setProblem(null);
        setItems((result.data as { items: PickedCustomer[] }).items);
      });
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sentences follow the language; the search follows the text
  }, [q]);

  return (
    <div className="flex flex-col gap-2" data-testid="customer-picker">
      {picked ? (
        <div className="flex flex-col gap-1 rounded-md border border-ink bg-raised px-3 py-2.5 text-sm" data-testid="customer-picked">
          <p className="flex items-center gap-2 font-semibold text-text">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
            <span className="min-w-0 break-words" dir="auto">
              {isolate(picked.name)}
            </span>
          </p>
          <CustomerFigures customer={picked} />
          <button type="button" className="inline-flex min-h-11 w-fit items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover" data-testid="customer-change" onClick={() => onPick(null)}>
            {t('pharmacy.credit.pick.change')}
          </button>
        </div>
      ) : (
        <>
          <Field label={t('pharmacy.credit.pick.label')} hint={t('pharmacy.credit.pick.hint')}>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <FieldInput type="search" dir="auto" autoComplete="off" data-testid="customer-search" className={`${FIELD} ps-10`} value={q} onChange={(event) => setQ(event.target.value)} />
            </div>
          </Field>
          {items === null && (
            <Note icon={<Hourglass aria-hidden />} role="status">
              {t('pharmacy.credit.pick.loading')}
            </Note>
          )}
          {problem && (
            <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="customer-problem">
              {problem}
            </Note>
          )}
          {items?.length === 0 && !problem && (
            <p className="flex items-center gap-2.5 py-2 text-sm text-text" data-testid="customer-none">
              <SearchX aria-hidden className="size-4 shrink-0 text-muted" />
              {t('pharmacy.credit.pick.none')}
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" aria-label={t('pharmacy.credit.pick.results')} data-testid="customer-results">
              {items.map((c) => {
                const why = creditablePerson(c, saleCurrency);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-testid="customer-option"
                      disabled={why !== null}
                      onClick={() => onPick(c)}
                      className="flex min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-md border border-line-strong bg-raised px-3 py-2 text-start text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2 font-semibold text-text">
                        <UserRound aria-hidden className="size-4 shrink-0" />
                        <span className="min-w-0 break-words" dir="auto">
                          {isolate(c.name)}
                        </span>
                      </span>
                      {why ? (
                        <span className="flex items-center gap-2 text-danger">
                          <Ban aria-hidden className="size-4 shrink-0" />
                          {t(`pharmacy.credit.pick.${why}`, { currency: c.currency })}
                        </span>
                      ) : (
                        <CustomerFigures customer={c} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Balance, limit and room left, as text, in the customer's own currency. */
export function CustomerFigures({ customer }: { customer: CustomerLite }) {
  const t = useT();
  const view = creditView(customer, 0n);
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted" data-testid="customer-figures">
      <span>
        {t('pharmacy.credit.balance')}: {money(String(view.balance), customer.currency)}
      </span>
      <span>
        {t('pharmacy.credit.limit')}: {money(String(view.limit), customer.currency)}
      </span>
      <span className="font-medium text-text">
        {t('pharmacy.credit.remaining')}: {money(String(view.remaining), customer.currency)}
      </span>
    </span>
  );
}
