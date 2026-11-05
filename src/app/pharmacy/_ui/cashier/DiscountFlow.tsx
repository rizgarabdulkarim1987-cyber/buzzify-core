'use client';

import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { buildCartRequest, type CartLine, type CartState, type Currency, type DiscountDraft, type Estimate } from '../sell-logic';
import { FieldInput, Note, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';
import { discountReasonNeeded } from './flows-logic';

/** One discount: the value and whether it is a percent or an amount (the old screen's editor, as pressed buttons). */
function DiscountFields({ label, value, currency, testId, onChange }: { label: string; value: DiscountDraft | null; currency: Currency; testId: string; onChange: (discount: DiscountDraft | null) => void }) {
  const t = useT();
  const draft = value ?? { kind: 'percent' as const, value: '' };
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <Field label={label} className="min-w-0 flex-1 basis-32">
        <FieldInput className={PH_FIELD} dir="ltr" inputMode="decimal" autoComplete="off" data-testid={`${testId}-value`} value={draft.value} onChange={(event) => onChange(event.target.value === '' ? null : { ...draft, value: event.target.value })} />
      </Field>
      <div role="group" aria-label={t('pharmacy.sell.discount.kind')} className="flex gap-1">
        {(['percent', 'amount'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            data-testid={`${testId}-kind-${kind}`}
            onClick={() => onChange({ ...draft, kind })}
            className={`${PH_BTN} ${draft.kind === kind ? 'border-ph-g8 bg-ph-g8 text-ph-on-green hover:bg-ph-g8' : ''}`}
          >
            {kind === 'percent' ? '%' : currency}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The receipt discount (F9), inline: a percent or an amount on the whole receipt and, when a line is selected, on that line, with
 * the one reason the old screen sent with every discount. Changes apply to the receipt as they are typed (as on the old screen);
 * "Apply" goes back. Above the pharmacy's limit the sale asks for a reason, so the panel says so before paying.
 */
export function DiscountFlow({
  cart,
  estimate,
  currency,
  maxPercent,
  line,
  onInvoice,
  onLine,
  onReason,
  onApply,
}: {
  cart: CartState;
  estimate: Estimate;
  currency: Currency;
  maxPercent: number;
  /** The selected line, when one is: it may get its own discount. */
  line: CartLine | null;
  onInvoice: (discount: DiscountDraft | null) => void;
  onLine: (key: string, discount: DiscountDraft | null) => void;
  onReason: (reason: string) => void;
  onApply: () => void;
}) {
  const t = useT();
  const any = cart.invoiceDiscount !== null || cart.lines.some((l) => l.discount !== null);
  const needed = discountReasonNeeded(cart, estimate, maxPercent);
  const unreadable = buildCartRequest(cart, currency, '') === null;
  return (
    <div className="flex flex-col gap-2.5" data-testid="flow-discount">
      <DiscountFields label={t('pharmacy.cashier.discount.value')} value={cart.invoiceDiscount} currency={currency} testId="disc" onChange={onInvoice} />
      {line && <DiscountFields label={t('pharmacy.cashier.discount.line', { name: line.name })} value={line.discount} currency={currency} testId="disc-line" onChange={(d) => onLine(line.key, d)} />}
      {any && (
        <Field label={t('pharmacy.sell.discount.reason')} hint={t('pharmacy.sell.discount.reasonHint', { percent: maxPercent })} optional={!needed}>
          <FieldInput className={PH_FIELD} dir="auto" autoComplete="off" maxLength={300} aria-invalid={needed || undefined} data-testid="disc-reason" value={cart.discountReason} onChange={(event) => onReason(event.target.value)} />
        </Field>
      )}
      {needed && (
        <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="status" testId="disc-reason-needed">
          {t('pharmacy.cashier.discount.reasonNeeded', { percent: maxPercent })}
        </Note>
      )}
      {unreadable && (
        <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="status" testId="disc-invalid">
          {t('pharmacy.sell.blocked.invalid')}
        </Note>
      )}
      <button type="button" className={`${PH_PRIMARY} min-h-12 w-full text-base`} data-testid="disc-apply" onClick={onApply}>
        <CircleCheck aria-hidden className="size-4" />
        {t('pharmacy.cashier.discount.apply')}
      </button>
    </div>
  );
}
