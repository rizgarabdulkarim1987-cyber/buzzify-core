'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setApplication, setPrices } from '@/app/studio/_actions/billing';
import { direction, LOCALE_NAMES, LOCALES, type Locale } from '@/lib/locale';
import { formatMoney, type Currency } from '@/server/domain/billing/money';
import { CURRENCIES, PERIODS, priceCell, priceDraft, pricesToSend, type BillingProduct, type PriceDraft } from '@/studio/billing';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { formatAmountInput, parseAmountInput } from '@/studio/money-input';
import { settle } from '@/studio/settle';
import { Alert, FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';

type Names = Record<Locale, string>;

/**
 * Settings → Billing: each product restaurants subscribe to (the Menu, the Cashier), its name in the Studio's three
 * languages, whether it is offered, and what each of its plans costs per currency and period. The Cashier has no plans
 * yet. Read-only for every Super Admin but the platform owner, as Settings → Plans is.
 */
export function BillingSettings({
  products,
  planNames,
  canEdit,
}: {
  products: BillingProduct[];
  /** The Menu's plans by code, named as in Settings → Plans. */
  planNames: Record<string, Names>;
  canEdit: boolean;
}) {
  const t = useT();
  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold text-text">{t('billingSettings.title')}</h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('billingSettings.intro')}</p>
      </div>
      {!canEdit && <Alert>{t('billingSettings.readOnly')}</Alert>}
      {products.map((product) => (
        <ProductSection key={product.id} product={product} planNames={planNames} canEdit={canEdit} />
      ))}
    </div>
  );
}

function ProductSection({ product, planNames, canEdit }: { product: BillingProduct; planNames: Record<string, Names>; canEdit: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const storedNames = product.name as Names;
  const [names, setNames] = useState<Names>(storedNames);
  const [offered, setOffered] = useState(product.status === 'ACTIVE');
  const [savingProduct, startSavingProduct] = useTransition();
  const [productFailure, setProductFailure] = useState<DescribedFailure | null>(null);
  const [productAttempt, setProductAttempt] = useState(0);

  const initialPrices = priceDraft(product, formatAmountInput);
  const [prices, setPricesDraft] = useState<PriceDraft>(initialPrices);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [savingPrices, startSavingPrices] = useTransition();
  const [pricesFailure, setPricesFailure] = useState<DescribedFailure | null>(null);
  const [pricesAttempt, setPricesAttempt] = useState(0);

  const name = storedNames[locale] || product.id;
  const productDirty = JSON.stringify(names) !== JSON.stringify(storedNames) || offered !== (product.status === 'ACTIVE');
  const dirtyPlans = product.plans.filter((plan) => JSON.stringify(prices[plan.code]) !== JSON.stringify(initialPrices[plan.code]));
  const planName = (code: string) => planNames[code]?.[locale] || code;
  const headerCell = 'h-9 px-3 text-start text-xs font-medium text-muted';

  const saveProduct = () =>
    startSavingProduct(async () => {
      setProductAttempt((count) => count + 1);
      const result = await settle(() => setApplication({ applicationId: product.id, name: names, status: offered ? 'ACTIVE' : 'DISABLED' }));
      if (!result.ok) return setProductFailure(describeFailure(t, locale, result.error));
      setProductFailure(null);
      toast.success(t('billingSettings.productSaved', { product: names[locale] }));
      router.refresh();
    });

  const savePrices = () =>
    startSavingPrices(async () => {
      setPricesAttempt((count) => count + 1);
      const checked = dirtyPlans.map((plan) => ({ plan, sent: pricesToSend(prices[plan.code] ?? {}) }));
      const errors = Object.fromEntries(checked.flatMap(({ plan, sent }) => (sent.ok ? [] : Object.entries(sent.errors).map(([cell, key]) => [`${plan.code}:${cell}`, t(key)]))));
      setCellErrors(errors);
      if (Object.keys(errors).length > 0) return setPricesFailure(null);
      // One plan at a time: a refusal stops there, and the plans saved before it stay saved.
      for (const { plan, sent } of checked) {
        if (!sent.ok) continue;
        const result = await settle(() => setPrices({ applicationId: product.id, planCode: plan.code, prices: sent.prices }));
        if (!result.ok) {
          setPricesFailure(describeFailure(t, locale, result.error));
          router.refresh();
          return;
        }
      }
      setPricesFailure(null);
      toast.success(t('billingSettings.pricesSaved', { product: name }));
      router.refresh();
    });

  return (
    <section aria-labelledby={`product-${product.id}`} className="flex flex-col gap-5 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={`product-${product.id}`} className="text-md font-semibold text-text">
          {name}
        </h3>
        <StatusBadge tone={product.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(product.status === 'ACTIVE' ? 'status.on' : 'status.off')}</StatusBadge>
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-text">{t('billingSettings.names')}</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {LOCALES.map((language) => (
            <label key={language} className="flex flex-col gap-1.5">
              <span lang={language} className="text-sm text-muted">
                {LOCALE_NAMES[language]}
              </span>
              <Input
                value={names[language]}
                maxLength={80}
                dir={direction(language)}
                lang={language}
                readOnly={!canEdit || savingProduct}
                aria-label={t('billingSettings.nameLabel', { product: name, language: LOCALE_NAMES[language] })}
                onChange={(event) => {
                  setNames((current) => ({ ...current, [language]: event.target.value }));
                  setProductFailure(null);
                }}
              />
            </label>
          ))}
        </div>
        <label className="flex w-fit items-center gap-3 text-sm text-text">
          <Switch
            checked={offered}
            disabled={!canEdit || savingProduct}
            onCheckedChange={(on) => {
              setOffered(on);
              setProductFailure(null);
            }}
            aria-label={t('billingSettings.offeredLabel', { product: name })}
          />
          {t('billingSettings.offered')}
        </label>
        {productFailure && <FailureAlert attempt={productAttempt} message={productFailure.message} fieldMessage={Object.values(productFailure.fields)[0]} />}
        {canEdit && (
          <div>
            <Button disabled={!productDirty} pending={savingProduct} onClick={saveProduct}>
              {savingProduct ? t('common.saving') : t('billingSettings.saveProduct', { product: name })}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-text">{t('billingSettings.prices')}</h4>
        {product.plans.length === 0 ? (
          <p className="max-w-[72ch] text-sm text-muted">{t('billingSettings.noPlans')}</p>
        ) : (
          <>
            <p className="max-w-[72ch] text-sm text-muted">{t('billingSettings.pricesHint')}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t('billingSettings.pricesCaption', { product: name })}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className={`${headerCell} ps-4`}>
                      {t('billingSettings.plan')}
                    </th>
                    {CURRENCIES.flatMap((currency) =>
                      PERIODS.map((period) => (
                        <th key={priceCell(currency, period)} scope="col" className={`${headerCell} w-36`}>
                          {t('billingSettings.priceColumn', { currency, period: t(`billing.period.${period}`) })}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {product.plans.map((plan) => (
                    <tr key={plan.code} className="border-b border-line align-top">
                      <th scope="row" className="h-12 px-3 pt-3.5 text-start font-normal text-text first:ps-4">
                        {planName(plan.code)}
                      </th>
                      {CURRENCIES.flatMap((currency) =>
                        PERIODS.map((period) => {
                          const cell = priceCell(currency, period);
                          const error = cellErrors[`${plan.code}:${cell}`];
                          const errorId = `price-${product.id}-${plan.code}-${cell}`;
                          return (
                            <td key={cell} className="px-3 py-2">
                              <Input
                                value={prices[plan.code]?.[cell] ?? ''}
                                inputMode="decimal"
                                dir="ltr"
                                className="rtl:text-right"
                                readOnly={!canEdit || savingPrices}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={errorId}
                                aria-label={t('billingSettings.priceLabel', { plan: planName(plan.code), currency, period: t(`billing.period.${period}`) })}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setPricesDraft((current) => ({ ...current, [plan.code]: { ...current[plan.code], [cell]: value } }));
                                  setCellErrors((current) => {
                                    const next = { ...current };
                                    delete next[`${plan.code}:${cell}`];
                                    return next;
                                  });
                                  setPricesFailure(null);
                                }}
                              />
                              {error ? (
                                <p id={errorId} className="mt-1 text-xs text-danger">
                                  {error}
                                </p>
                              ) : (
                                <Readback text={prices[plan.code]?.[cell] ?? ''} currency={currency} id={errorId} />
                              )}
                            </td>
                          );
                        }),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pricesFailure && <FailureAlert attempt={pricesAttempt} message={pricesFailure.message} fieldMessage={Object.values(pricesFailure.fields)[0]} />}
            {Object.keys(cellErrors).length > 0 && <FailureAlert attempt={pricesAttempt} message={null} fieldMessage={Object.values(cellErrors)[0]} />}
            {canEdit && (
              <div>
                <Button variant="primary" disabled={dirtyPlans.length === 0} pending={savingPrices} onClick={savePrices}>
                  {savingPrices ? t('common.saving') : t('billingSettings.savePrices', { product: name })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * What a typed price will be saved as, when it is written another way than the field will show it after the save:
 * "25.000" in IQD reads back as IQD 25,000, so a person sees the thousands were understood.
 */
function Readback({ text, currency, id }: { text: string; currency: Currency; id: string }) {
  const t = useT();
  const { locale } = useLocale();
  const parsed = parseAmountInput(text, currency);
  if (!parsed.ok || text.trim() === formatAmountInput(parsed.minor, currency)) return null;
  return (
    <p id={id} className="mt-1 text-xs text-muted">
      {t('billing.amountReads', { amount: formatMoney(parsed.minor, currency, locale) })}
    </p>
  );
}
