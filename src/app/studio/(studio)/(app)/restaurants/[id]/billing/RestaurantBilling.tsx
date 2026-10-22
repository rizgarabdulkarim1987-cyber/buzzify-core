'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cancelSubscription, changePlan, reactivateSubscription, recordPayment, startTrial } from '@/app/studio/_actions/billing';
import type { Locale } from '@/lib/locale';
import { formatMoney, type Currency } from '@/server/domain/billing/money';
import { graceEndsAt } from '@/server/domain/billing/subscriptions';
import {
  baghdadToday,
  canStartTrial,
  CURRENCIES,
  currentSubscription,
  eventsNewestFirst,
  PAYMENT_METHODS,
  paymentRequest,
  PERIODS,
  priceOf,
  SUBSCRIPTION_TONE,
  subscriptionActions,
  type BillingEvent,
  type BillingProduct,
  type Period,
  type RestaurantBillingView,
  type SubscriptionView,
} from '@/studio/billing';
import { useActionForm } from '@/studio/forms';
import { formatDate, formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { formatAmountInput, parseAmountInput } from '@/studio/money-input';
import { useRefuse } from '@/studio/refuse';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Textarea } from '@/studio/ui/Textarea';

type Names = Record<Locale, string>;
type Product = RestaurantBillingView['applications'][number];
type Open = 'trial' | 'payment' | 'plan' | 'cancel' | 'reactivate' | null;

const iso = (value: Date | string) => new Date(value).toISOString();

interface Shared {
  restaurantId: string;
  canEdit: boolean;
  now: Date;
  planName: (code: string) => string;
}

/**
 * A restaurant's Billing tab: per product, its current subscription (its status as of now, plan, price, the end of what
 * is paid for and of the grace after it), what the platform owner can do to it, and its payments and history, newest
 * first. Every payment is money the owner has received and records by hand. Other Super Admins read the same, without
 * the controls.
 */
export function RestaurantBilling({
  view,
  products,
  planNames,
}: {
  view: RestaurantBillingView;
  /** Settings → Billing: the plans' prices, for the price a trial or a plan change will renew at. */
  products: BillingProduct[];
  planNames: Record<string, Names>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const shared: Shared = {
    restaurantId: view.restaurant.id,
    canEdit: view.canEdit,
    now: new Date(view.now),
    planName: (code) => planNames[code]?.[locale] || code,
  };

  return (
    <section aria-labelledby="billing-title" className="flex max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 id="billing-title" className="text-md font-semibold text-text">
          {t('billing.title')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('billing.intro')}</p>
      </div>
      {!view.canEdit && <Alert>{t('billing.readOnly')}</Alert>}
      {view.applications.map((product) => (
        <ProductBilling
          key={product.id}
          product={product}
          prices={products.find((candidate) => candidate.id === product.id)}
          subscriptions={view.subscriptions.filter((sub) => sub.applicationId === product.id)}
          payments={view.payments}
          restaurantStatus={view.restaurant.status}
          shared={shared}
        />
      ))}
    </section>
  );
}

function ProductBilling({
  product,
  prices,
  subscriptions,
  payments,
  restaurantStatus,
  shared,
}: {
  product: Product;
  prices: BillingProduct | undefined;
  subscriptions: SubscriptionView[];
  payments: RestaurantBillingView['payments'];
  restaurantStatus: string;
  shared: Shared;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [open, setOpen] = useState<Open>(null);
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  const name = (product.name as Names)[locale] || product.id;
  const current = currentSubscription(subscriptions, product.id);
  const actions = current ? subscriptionActions(current, shared.now, product.planCodes.length) : null;
  const trial = canStartTrial(product, current, restaurantStatus);
  const own = new Set(subscriptions.map((sub) => sub.id));
  const productPayments = payments.filter((payment) => own.has(payment.subscriptionId));
  const events = eventsNewestFirst(subscriptions);
  const title = current ? `${name} · ${shared.planName(current.planCode)}` : name;
  const money = (minor: number, currency: Currency) => formatMoney(minor, currency, locale);

  return (
    <section aria-labelledby={`billing-${product.id}`} className="flex flex-col gap-5 border-t border-line pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id={`billing-${product.id}`} className="text-md font-semibold text-text">
            {name}
          </h3>
          {current ? (
            <StatusBadge tone={SUBSCRIPTION_TONE[current.status]}>{t(`billing.status.${current.status}`)}</StatusBadge>
          ) : (
            <StatusBadge>{t('billing.status.NONE')}</StatusBadge>
          )}
          {product.status !== 'ACTIVE' && <span className="text-sm text-muted">{t('billing.productOff')}</span>}
        </div>
        {shared.canEdit && (
          <div className="flex flex-wrap gap-2">
            {trial && (
              <Button variant="primary" onClick={() => setOpen('trial')}>
                {t('billing.startTrial')}
              </Button>
            )}
            {actions?.pay && (
              <Button variant={trial ? 'secondary' : 'primary'} onClick={() => setOpen('payment')}>
                {t('billing.recordPayment')}
              </Button>
            )}
            {actions?.changePlan && <Button onClick={() => setOpen('plan')}>{t('billing.changePlan')}</Button>}
            {actions?.reactivate && <Button onClick={() => setOpen('reactivate')}>{t('billing.reactivate')}</Button>}
            {actions?.cancel && (
              <Button variant="ghost" onClick={() => setOpen('cancel')}>
                {t('billing.cancel')}
              </Button>
            )}
          </div>
        )}
      </div>

      {product.planCodes.length === 0 && <p className="max-w-[72ch] text-sm text-muted">{t('billingSettings.noPlans')}</p>}
      {shared.canEdit && product.planCodes.length > 0 && !trial && !current && (
        <p className="max-w-[72ch] text-sm text-muted">{t(product.status !== 'ACTIVE' ? 'billing.trialProductOff' : 'billing.trialRestaurantInactive')}</p>
      )}

      {current ? (
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('billing.plan')}>{shared.planName(current.planCode)}</Fact>
          <Fact label={t('billing.price')}>
            {t('billing.pricePer', { price: money(current.priceMinor, current.currency), period: t(`billing.periodShort.${current.period}`) })}
          </Fact>
          {/* Never paid for (no anchor day yet): its period is the trial. */}
          <Fact label={current.anchorDay === null && current.trialEndsAt ? t('billing.trialEnds') : t('billing.paidUntil')}>
            <time dateTime={iso(current.currentPeriodEnd)}>{formatDate(iso(current.currentPeriodEnd), locale)}</time>
          </Fact>
          {(current.status === 'ACTIVE' || current.status === 'GRACE') && (
            <Fact label={t('billing.graceEnds')}>
              <time dateTime={graceEndsAt(current).toISOString()}>{formatDate(graceEndsAt(current).toISOString(), locale)}</time>
            </Fact>
          )}
          {current.status === 'CANCELLED' && current.cancelledAt && (
            <Fact label={t('billing.cancelledOn')}>
              <time dateTime={iso(current.cancelledAt)}>{formatDate(iso(current.cancelledAt), locale)}</time>
            </Fact>
          )}
        </dl>
      ) : (
        product.planCodes.length > 0 && <p className="text-sm text-muted">{t('billing.none')}</p>
      )}

      <PaymentsTable payments={productPayments} money={money} />
      <HistoryTable events={events} planName={shared.planName} />

      {open === 'trial' && <StartTrialDialog product={product} prices={prices} shared={shared} onClose={() => setOpen(null)} />}
      {open === 'payment' && current && <RecordPaymentDialog subscription={current} title={title} shared={shared} onClose={() => setOpen(null)} />}
      {open === 'plan' && current && (
        <ChangePlanDialog subscription={current} product={product} prices={prices} title={title} shared={shared} onClose={() => setOpen(null)} />
      )}
      {current && (
        <>
          <ConfirmDialog
            open={open === 'cancel'}
            onOpenChange={close}
            title={t('billing.cancelTitle')}
            body={t('billing.cancelBody', { name: title, date: formatDate(iso(current.currentPeriodEnd), locale) })}
            confirmLabel={t('billing.cancel')}
            onConfirm={async (data) => {
              const result = await settle(() =>
                cancelSubscription({ restaurantId: shared.restaurantId, subscriptionId: current.id, reason: String(data.get('reason') ?? '') }),
              );
              if (!result.ok) return refuse(result, ['reason']);
              toast.success(t('billing.cancelled'));
              router.refresh();
              return true;
            }}
          >
            {(errors) => (
              <Field label={t('billing.field.reason')} optional error={errors.reason}>
                <Textarea name="reason" rows={3} maxLength={500} />
              </Field>
            )}
          </ConfirmDialog>
          <ConfirmDialog
            open={open === 'reactivate'}
            onOpenChange={close}
            tone="primary"
            title={t('billing.reactivateTitle')}
            body={t('billing.reactivateBody', { name: title, date: formatDate(iso(current.currentPeriodEnd), locale) })}
            confirmLabel={t('billing.reactivate')}
            onConfirm={async () => {
              const result = await settle(() => reactivateSubscription({ restaurantId: shared.restaurantId, subscriptionId: current.id }));
              if (!result.ok) return refuse(result);
              toast.success(t('billing.reactivated'));
              router.refresh();
              return true;
            }}
          />
        </>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

const headerCell = 'h-9 px-3 text-start text-xs font-medium text-muted first:ps-4 last:pe-4';
const bodyCell = 'h-10 px-3 first:ps-4 last:pe-4';

function PaymentsTable({ payments, money }: { payments: RestaurantBillingView['payments']; money: (minor: number, currency: Currency) => string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-text">{t('billing.payments')}</h4>
      {payments.length === 0 ? (
        <p className="text-sm text-muted">{t('billing.noPayments')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('billing.payments')}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={headerCell}>
                  {t('billing.column.paidAt')}
                </th>
                <th scope="col" className={`${headerCell} text-end`}>
                  {t('billing.column.amount')}
                </th>
                <th scope="col" className={headerCell}>
                  {t('billing.column.method')}
                </th>
                <th scope="col" className={headerCell}>
                  {t('billing.column.covers')}
                </th>
                <th scope="col" className={headerCell}>
                  {t('billing.column.recordedBy')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-line align-top">
                  <td className={bodyCell}>
                    <time dateTime={iso(payment.paidAt)}>{formatDate(iso(payment.paidAt), locale)}</time>
                  </td>
                  <td className={`${bodyCell} text-end tabular-nums`}>
                    <span dir="ltr">{money(payment.amountMinor, payment.currency)}</span>
                  </td>
                  <td className={bodyCell}>
                    {t(`billing.method.${payment.method}`)}
                    {payment.reference && <span className="block text-xs text-muted">{payment.reference}</span>}
                    {payment.note && <span className="block whitespace-pre-line text-xs text-muted">{payment.note}</span>}
                  </td>
                  <td className={bodyCell}>
                    {t('billing.coversRange', { from: formatDate(iso(payment.coversFrom), locale), to: formatDate(iso(payment.coversTo), locale) })}
                  </td>
                  <td className={`${bodyCell} text-muted`}>{payment.recordedByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What an event adds to its name: the plans of a plan change, the reason of a cancellation. */
function eventDetail(event: BillingEvent & { planCode: string }, planName: (code: string) => string): string | null {
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (event.type === 'PLAN_CHANGED' && typeof data.fromPlanCode === 'string' && typeof data.toPlanCode === 'string') {
    return `${planName(data.fromPlanCode)} → ${planName(data.toPlanCode)}`;
  }
  if (event.type === 'STARTED_TRIAL') return planName(event.planCode);
  if (event.type === 'CANCELLED' && typeof data.reason === 'string' && data.reason) return data.reason;
  return null;
}

function HistoryTable({ events, planName }: { events: Array<BillingEvent & { planCode: string }>; planName: (code: string) => string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-text">{t('billing.history')}</h4>
      {events.length === 0 ? (
        <p className="text-sm text-muted">{t('billing.noHistory')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('billing.history')}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={headerCell}>
                  {t('billing.column.when')}
                </th>
                <th scope="col" className={headerCell}>
                  {t('billing.column.event')}
                </th>
                <th scope="col" className={headerCell}>
                  {t('billing.column.by')}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const detail = eventDetail(event, planName);
                return (
                  <tr key={event.id} className="border-b border-line align-top">
                    <td className={`${bodyCell} whitespace-nowrap`}>
                      <time dateTime={iso(event.occurredAt)}>{formatDateTime(iso(event.occurredAt), locale)}</time>
                    </td>
                    <td className={bodyCell}>
                      {t(`billing.event.${event.type}`)}
                      {detail && <span className="block whitespace-pre-line text-xs text-muted">{detail}</span>}
                    </td>
                    <td className={`${bodyCell} text-muted`}>{event.actorName ?? t('billing.bySystem')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Dialogs ------------------------------------------------------------------------------------------------------------

const TRIAL_FIELDS = ['planCode', 'currency', 'period', 'trialDays'] as const;

/** A free trial of the product on one of its plans; the price it will renew at is fixed now, from Settings → Billing. */
function StartTrialDialog({ product, prices, shared, onClose }: { product: Product; prices: BillingProduct | undefined; shared: Shared; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  const [planCode, setPlanCode] = useState(product.planCodes[0] ?? '');
  const [currency, setCurrency] = useState<Currency>('IQD');
  const [period, setPeriod] = useState<Period>('MONTHLY');
  const price = priceOf(prices, planCode, currency, period);
  const form = useActionForm(
    (values) =>
      settle(() =>
        startTrial({
          restaurantId: shared.restaurantId,
          applicationId: product.id,
          planCode: values.planCode ?? '',
          currency: values.currency,
          period: values.period,
          trialDays: Number(values.trialDays),
        }),
      ),
    {
      keep: ['trialDays'],
      validate: (values) => {
        const days = Number(values.trialDays);
        return Number.isInteger(days) && days >= 1 && days <= 60 ? null : { trialDays: t('error.text.billingTrialDaysRange') };
      },
      onSuccess: () => {
        toast.success(t('billing.trialStarted'));
        router.refresh();
        onClose();
      },
    },
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('billing.startTrial')}
      description={t('billing.trialIntro', { product: (product.name as Names)[locale] || product.id })}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" pending={form.pending}>
            {t('billing.startTrial')}
          </Button>
        </>
      }
    >
      <form id={formId} {...form.props} className="flex flex-col gap-4">
        <FormError form={form} fields={TRIAL_FIELDS} />
        <Field label={t('billing.field.plan')} error={form.fieldError('planCode')}>
          <Select
            name="planCode"
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
            options={product.planCodes.map((code) => ({ value: code, label: shared.planName(code) }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('billing.field.currency')} error={form.fieldError('currency')}>
            <Select
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              options={CURRENCIES.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label={t('billing.field.period')} error={form.fieldError('period')}>
            <Select
              name="period"
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
              options={PERIODS.map((value) => ({ value, label: t(`billing.period.${value}`) }))}
            />
          </Field>
          <Field label={t('billing.field.trialDays')} error={form.fieldError('trialDays')}>
            <Input name="trialDays" type="number" inputMode="numeric" dir="ltr" className="rtl:text-right" min={1} max={60} step={1} defaultValue={form.value('trialDays') ?? '14'} />
          </Field>
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {price === null
            ? t('billing.noPrice')
            : t('billing.renewsAt', { price: formatMoney(price, currency, locale), period: t(`billing.periodShort.${period}`) })}
        </p>
      </form>
    </Dialog>
  );
}

const PAYMENT_FIELDS = ['amountMinor', 'paidAt', 'method', 'reference', 'note'] as const;
const KEPT_PAYMENT_FIELDS = ['paidAt', 'method', 'reference', 'note'] as const;

/**
 * Money the platform owner has received, recorded by hand. Mounted each time the dialog opens, so the idempotency key is
 * made once per opening, and every resend of it (a retry after a lost answer, a double click) carries the same key: the
 * server then records the payment once.
 */
function RecordPaymentDialog({ subscription, title, shared, onClose }: { subscription: SubscriptionView; title: string; shared: Shared; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [today] = useState(() => baghdadToday());
  const { currency } = subscription;
  const form = useActionForm(
    (values) => {
      const request = paymentRequest(values, subscription, shared.restaurantId, idempotencyKey);
      // The client check has passed by now; the server says the same thing again if not.
      return settle(() => recordPayment(request.ok ? request.input : { ...values, idempotencyKey }));
    },
    {
      keep: KEPT_PAYMENT_FIELDS,
      validate: (values) => {
        const request = paymentRequest(values, subscription, shared.restaurantId, idempotencyKey);
        return request.ok ? null : Object.fromEntries(Object.entries(request.errors).map(([field, key]) => [field, t(key)]));
      },
      onSuccess: () => {
        toast.success(t('billing.paymentRecorded'));
        router.refresh();
        onClose();
      },
    },
  );
  const kept = (name: (typeof KEPT_PAYMENT_FIELDS)[number], fallback: string) => form.value(name) ?? fallback;
  // Controlled, so the hint can say what will be recorded ("25.000" is IQD 25,000), and a refused send keeps it as typed.
  const [amount, setAmount] = useState(() => formatAmountInput(subscription.priceMinor, currency));
  const parsed = parseAmountInput(amount, currency);
  const amountHint = parsed.ok
    ? t('billing.amountReads', { amount: formatMoney(parsed.minor, currency, locale) })
    : t(currency === 'IQD' ? 'billing.amountHintIqd' : 'billing.amountHintUsd');

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !form.pending && onClose()}
      title={t('billing.recordPayment')}
      description={title}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" pending={form.pending}>
            {t('billing.recordPayment')}
          </Button>
        </>
      }
    >
      <form id={formId} {...form.props} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('billing.byHand')}</p>
        <FormError form={form} fields={PAYMENT_FIELDS} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.field.amount', { currency })} hint={<span aria-live="polite">{amountHint}</span>} error={form.fieldError('amountMinor')}>
            <Input
              name="amountMinor"
              inputMode="decimal"
              dir="ltr"
              className="rtl:text-right"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('billing.field.paidAt')} error={form.fieldError('paidAt')}>
            <Input name="paidAt" type="date" dir="ltr" className="rtl:text-right" defaultValue={kept('paidAt', today)} max={today} />
          </Field>
        </div>
        <Field label={t('billing.field.method')} hint={t('billing.methodHint')} error={form.fieldError('method')}>
          <Select name="method" defaultValue={kept('method', 'CASH')} options={PAYMENT_METHODS.map((method) => ({ value: method, label: t(`billing.method.${method}`) }))} />
        </Field>
        <Field label={t('billing.field.reference')} optional error={form.fieldError('reference')}>
          <Input name="reference" maxLength={120} autoComplete="off" defaultValue={kept('reference', '')} />
        </Field>
        <Field label={t('billing.field.note')} optional error={form.fieldError('note')}>
          <Textarea name="note" rows={2} maxLength={1000} defaultValue={kept('note', '')} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Moves the subscription to another plan of its product; the price follows the new plan unless it is kept. */
function ChangePlanDialog({
  subscription,
  product,
  prices,
  title,
  shared,
  onClose,
}: {
  subscription: SubscriptionView;
  product: Product;
  prices: BillingProduct | undefined;
  title: string;
  shared: Shared;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  const others = product.planCodes.filter((code) => code !== subscription.planCode);
  const [planCode, setPlanCode] = useState(others[0] ?? '');
  const [keepPrice, setKeepPrice] = useState(false);
  const newPrice = priceOf(prices, planCode, subscription.currency, subscription.period);
  const price = keepPrice ? subscription.priceMinor : newPrice;
  const form = useActionForm(
    (values) => settle(() => changePlan({ restaurantId: shared.restaurantId, subscriptionId: subscription.id, planCode: values.planCode ?? '', keepPrice })),
    {
      onSuccess: () => {
        toast.success(t('billing.planChanged'));
        router.refresh();
        onClose();
      },
    },
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !form.pending && onClose()}
      title={t('billing.changePlan')}
      description={title}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" pending={form.pending}>
            {t('billing.changePlan')}
          </Button>
        </>
      }
    >
      <form id={formId} {...form.props} className="flex flex-col gap-4">
        <FormError form={form} fields={['planCode']} />
        <Field label={t('billing.field.plan')} error={form.fieldError('planCode')}>
          <Select name="planCode" value={planCode} onChange={(event) => setPlanCode(event.target.value)} options={others.map((code) => ({ value: code, label: shared.planName(code) }))} />
        </Field>
        <Checkbox
          label={t('billing.keepPrice', { price: formatMoney(subscription.priceMinor, subscription.currency, locale) })}
          checked={keepPrice}
          onChange={(event) => setKeepPrice(event.target.checked)}
        />
        <p className="text-sm text-muted" aria-live="polite">
          {price === null
            ? t('billing.noPrice')
            : t('billing.renewsAt', { price: formatMoney(price, subscription.currency, locale), period: t(`billing.periodShort.${subscription.period}`) })}
        </p>
      </form>
    </Dialog>
  );
}
