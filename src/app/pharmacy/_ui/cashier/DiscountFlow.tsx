'use client';

import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { buildCartRequest, type CartLine, type CartState, type Currency, type DiscountDraft, type Estimate } from '../sell-logic';
import { FieldInput, Note, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';
import { padMoney } from './cashier-logic';
import { discountReasonNeeded } from './flows-logic';
import { usePadSink, type PadSlot } from './WorkParts';

type Kind = DiscountDraft['kind'];

/**
 * One discount: the value and whether it is a percent or an amount (the old screen's editor, as pressed buttons). Switching the
 * kind clears what was typed: "10" meant 10% and must not become an amount of 10 (or the other way round) without being retyped.
 * With nothing typed the kind is kept here (`kind`), so the next value is typed in it.
 */
function DiscountFields({ label, value, kind: emptyKind, onKind, onFocus, currency, testId, onChange }: { label: string; value: DiscountDraft | null; kind: Kind; onKind: (kind: Kind) => void; onFocus: () => void; currency: Currency; testId: string; onChange: (discount: DiscountDraft | null) => void }) {
  const t = useT();
  const draft = value ?? { kind: emptyKind, value: '' };
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <Field label={label} className="min-w-0 flex-1 basis-32">
        <FieldInput className={PH_FIELD} dir="ltr" inputMode="decimal" autoComplete="off" data-testid={`${testId}-value`} onFocus={onFocus} value={draft.value} onChange={(event) => onChange(event.target.value === '' ? null : { ...draft, value: event.target.value })} />
      </Field>
      <div role="group" aria-label={t('pharmacy.sell.discount.kind')} className="flex gap-1">
        {(['percent', 'amount'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            data-testid={`${testId}-kind-${kind}`}
            onClick={() => {
              if (kind === draft.kind) return;
              onKind(kind);
              if (value !== null) onChange(null);
            }}
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
  padSlot,
}: {
  /** The side keypad types here (the receipt discount, or the line's once its field had focus); its check key applies. */
  padSlot?: PadSlot;
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
  // The kind chosen while a field is empty, per field ('invoice' or the line's key).
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  const kindOf = (id: string, value: DiscountDraft | null): Kind => value?.kind ?? kinds[id] ?? 'percent';
  const setKind = (id: string) => (kind: Kind) => setKinds((all) => ({ ...all, [id]: kind }));
  // The keypad types into the field that last had focus: the receipt discount unless the line's field was chosen.
  const [target, setTarget] = useState<'invoice' | 'line'>('invoice');
  const padLine = target === 'line' && line !== null ? line : null;
  usePadSink(padSlot, {
    key: (key) => {
      const value = padLine ? padLine.discount : cart.invoiceDiscount;
      const typed = padMoney(value?.value ?? '', key);
      const next = typed === '' ? null : { kind: kindOf(padLine ? padLine.key : 'invoice', value), value: typed };
      if (padLine) onLine(padLine.key, next);
      else onInvoice(next);
    },
    enter: onApply,
  });
  return (
    <div className="flex flex-col gap-2.5" data-testid="flow-discount">
      <DiscountFields label={t('pharmacy.cashier.discount.value')} value={cart.invoiceDiscount} kind={kindOf('invoice', cart.invoiceDiscount)} onKind={setKind('invoice')} onFocus={() => setTarget('invoice')} currency={currency} testId="disc" onChange={onInvoice} />
      {line && <DiscountFields label={t('pharmacy.cashier.discount.line', { name: line.name })} value={line.discount} kind={kindOf(line.key, line.discount)} onKind={setKind(line.key)} onFocus={() => setTarget('line')} currency={currency} testId="disc-line" onChange={(d) => onLine(line.key, d)} />}
      <p className="text-xs text-ph-muted" data-testid="disc-pad-target">
        {t(padLine ? 'pharmacy.cashier.discount.padLine' : 'pharmacy.cashier.discount.padInvoice')}
      </p>
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
