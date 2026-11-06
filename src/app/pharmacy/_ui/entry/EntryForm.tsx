'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { ArmedButton } from '../cashier/ArmedButton';
import { formatMinor } from '../sell-logic';
import { Num, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';
import { formatExpiryInput, type EntryForm as EntryFormValues } from './entry-logic';
import { isRequired, labelKey, nextField, packetLadder, stockInPackets, type EntryDraft, type EntryFieldName, type KnownLookup } from './entry-fields';
import type { EntryMessage } from './use-entry';

export interface EntryFormProps {
  kind: 'known' | 'new';
  found: KnownLookup | null;
  form: EntryFormValues;
  setField: (name: keyof EntryFormValues, value: string | boolean) => void;
  suppliers: { id: string; name: string }[];
  draft: EntryDraft;
  msg: EntryMessage | null;
  sending: boolean;
  /** A save's answer was lost: the form keeps the line that was sent (read-only) until it is sent again or dropped. */
  frozen: boolean;
  onDrop: () => void;
  register: (name: EntryFieldName) => (el: HTMLElement | null) => void;
  focus: (name: EntryFieldName) => void;
  onSave: () => void;
}

const NUMERIC: Partial<Record<EntryFieldName, 'numeric' | 'decimal'>> = { qty: 'numeric', expiry: 'numeric', stripsPerPacket: 'numeric', tabletsPerStrip: 'numeric', lowStock: 'numeric', purchasePrice: 'decimal', sellPrice: 'decimal' };
const WIDE: readonly EntryFieldName[] = ['name', 'activeIngredient'];

/**
 * The form card: a known product's summary and six batch fields, or the new product's four required fields with the optional
 * ones under a dashed line on the same screen. Enter walks the fields in order (`enterOrder`) and saves from the last one;
 * the message line beside Save names the field to fix. Values pre-filled from the last purchase or the current price are
 * tinted and say where they came from.
 */
export function EntryForm(props: EntryFormProps) {
  const { kind, found, form, setField, msg, sending, frozen, onDrop, focus, onSave } = props;
  const t = useT();
  const locked = form.sellPriceLocked;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const name = (e.target as HTMLElement).dataset.entryField as EntryFieldName | undefined;
    if (!name) return;
    e.preventDefault();
    const next = nextField(kind, locked, name);
    if (next === 'save') onSave();
    else focus(next);
  }

  const field = (name: EntryFieldName, hint?: string, prefilled = false) => (
    <Field key={name} {...props} name={name} hint={hint} prefilled={prefilled} required={isRequired(kind, name, locked)} />
  );
  const lastPrice = Boolean(found?.lastPurchase?.purchasePriceMinor) && found?.lastPurchase?.purchaseCurrency === 'USD';
  const priceHint = locked ? t('pharmacy.entry.hint.priceLocked') : kind === 'known' && found?.sellPrice ? t('pharmacy.entry.hint.fromCurrentPrice') : undefined;

  return (
    <section data-testid="entry-form" data-kind={kind} aria-label={t('pharmacy.entry.title')} className="flex min-w-0 flex-col gap-3 rounded-ph-2xl border border-ph-line bg-ph-card p-3">
      {found && <Summary found={found} />}
      <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-4" onKeyDown={onKeyDown}>
        {kind === 'known' ? (
          <>
            {field('qty')}
            {field('expiry')}
            {field('purchasePrice', lastPrice ? t('pharmacy.entry.hint.fromLastPurchase') : undefined, lastPrice)}
            {field('sellPrice', priceHint, Boolean(found?.sellPrice))}
            {field('lot')}
            {field('supplierId')}
            {found && packetLadder(found.product) !== '' && (
              <p className="flex min-h-11 items-end pb-1 text-xs text-ph-muted md:col-span-2" dir="auto">
                {t('pharmacy.entry.hint.packet', { packet: found.product.packetLabel, ladder: packetLadder(found.product) })}
              </p>
            )}
          </>
        ) : (
          <>
            {field('name')}
            {field('sellPrice', priceHint)}
            {field('qty')}
            {field('expiry')}
            <p className="col-span-full border-t border-dashed border-ph-line pt-1.5 text-xs text-ph-muted">{t('pharmacy.entry.optional')}</p>
            {field('purchasePrice')}
            {field('stripsPerPacket')}
            {field('tabletsPerStrip')}
            <RxToggle value={form.needsRx} disabled={frozen} onChange={(v) => setField('needsRx', v)} />
            {field('activeIngredient', t('pharmacy.entry.hint.ingredient'))}
            {field('supplierId')}
            {field('lowStock')}
            {field('lot')}
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button type="button" data-testid="entry-save" className={PH_PRIMARY} disabled={sending} onClick={onSave}>
          {sending ? t('pharmacy.entry.saving') : t('pharmacy.entry.save')}
          <small className="text-xs font-medium opacity-80">{t('pharmacy.entry.saveKeys')}</small>
        </button>
        {frozen && <ArmedButton testId="entry-drop" label={t('pharmacy.entry.drop')} armedLabel={t('pharmacy.entry.dropArmed')} onConfirm={onDrop} />}
        <span id="entry-msg" data-testid="entry-msg" role="status" aria-live="polite" className={`min-w-0 flex-1 text-sm font-semibold ${msg?.tone === 'err' ? 'text-ph-red' : 'text-ph-g6'}`}>
          {msg?.text}
        </span>
      </div>
    </section>
  );
}

function Field({ name, hint, prefilled, required, kind, form, setField, suppliers, draft, found, msg, frozen, register }: EntryFormProps & { name: EntryFieldName; hint?: string; prefilled: boolean; required: boolean }) {
  const t = useT();
  const id = `entry-${name}`;
  const invalid = msg?.field === name;
  const locked = name === 'sellPrice' && form.sellPriceLocked;
  const readOnly = locked || frozen;
  const shared = {
    id,
    ref: register(name),
    'data-testid': `entry-field-${name}`,
    'data-entry-field': name,
    'aria-required': required || undefined,
    'aria-invalid': invalid || undefined,
    'aria-describedby': [hint ? `${id}-hint` : '', invalid ? 'entry-msg' : ''].filter(Boolean).join(' ') || undefined,
    className: `${prefilled && !locked ? PH_FIELD.replace('bg-ph-canvas', 'bg-ph-amber-wash') : PH_FIELD} read-only:border-dashed read-only:text-ph-muted`,
  };
  let control: ReactNode;
  if (name === 'supplierId') {
    const known = suppliers.some((s) => s.id === form.supplierId);
    const extraName = draft?.supplierId === form.supplierId ? draft?.supplierName : found?.lastPurchase?.supplierName;
    control = (
      <select {...shared} disabled={frozen} value={form.supplierId} onChange={(e) => setField('supplierId', e.target.value)}>
        <option value="">{t('pharmacy.entry.field.supplierNone')}</option>
        {!known && form.supplierId !== '' && <option value={form.supplierId}>{extraName || form.supplierId}</option>}
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    );
  } else {
    const numeric = NUMERIC[name];
    control = (
      <input
        {...shared}
        type="text"
        autoComplete="off"
        dir={numeric ? 'ltr' : 'auto'}
        inputMode={numeric}
        readOnly={readOnly}
        maxLength={name === 'expiry' ? 5 : name === 'lot' ? 40 : 200}
        placeholder={name === 'expiry' ? 'MM/YY' : undefined}
        value={form[name]}
        onChange={(e) => setField(name, name === 'expiry' ? formatExpiryInput(e.target.value) : e.target.value)}
      />
    );
  }
  const supplierNote = name === 'supplierId' && draft?.supplierId ? t('pharmacy.entry.hint.draftSupplier', { name: draft.supplierName }) : undefined;
  const note = hint ?? supplierNote;
  return (
    <div data-testid="entry-form-field" data-field={name} data-required={String(required)} className={`flex min-w-0 flex-col gap-1 ${WIDE.includes(name) || (kind === 'known' && name === 'supplierId') ? 'col-span-2' : ''}`}>
      <label htmlFor={id} className="text-xs font-medium text-ph-muted">
        {t(labelKey(name, kind))}
        {required && (
          <>
            <span aria-hidden className="text-ph-red">
              {' *'}
            </span>
            <span className="sr-only"> ({t('pharmacy.entry.field.required')})</span>
          </>
        )}
      </label>
      {control}
      {note && (
        <small id={`${id}-hint`} className="text-xs text-ph-muted">
          {note}
        </small>
      )}
    </div>
  );
}

function RxToggle({ value, disabled, onChange }: { value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  const option = (on: boolean, testId: string, label: string) => (
    <button type="button" data-testid={testId} aria-pressed={value === on} disabled={disabled} onClick={() => onChange(on)} className={`${PH_BTN} flex-1 ${value === on ? 'border-ph-g8 bg-ph-g8 text-ph-on-green hover:bg-ph-g9' : ''}`}>
      {label}
    </button>
  );
  return (
    <div role="group" aria-labelledby="entry-rx-label" className="flex min-w-0 flex-col gap-1">
      <span id="entry-rx-label" className="text-xs font-medium text-ph-muted">
        {t('pharmacy.entry.field.needsRx')}
      </span>
      <div className="flex gap-1.5">
        {option(false, 'entry-rx-no', t('pharmacy.entry.field.no'))}
        {option(true, 'entry-rx-yes', t('pharmacy.entry.field.yes'))}
      </div>
    </div>
  );
}

function Summary({ found }: { found: KnownLookup }) {
  const t = useT();
  const stock = stockInPackets(found);
  const last = found.lastPurchase;
  const tile = (label: string, value: ReactNode) => (
    <div className="flex min-w-0 flex-col rounded-ph-xl bg-ph-canvas px-3 py-1.5 text-xs text-ph-muted">
      {label}
      <b className="truncate text-base text-ph-text">{value}</b>
    </div>
  );
  const none = t('pharmacy.entry.summary.none');
  return (
    <div data-testid="entry-summary" className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
      {tile(
        t('pharmacy.entry.summary.stock'),
        <>
          <Num>{stock.packets}</Num> {found.product.packetLabel}
          {stock.rest > 0 && (
            <>
              {' + '}
              <Num>{stock.rest}</Num> {stock.restLabel}
            </>
          )}
        </>,
      )}
      {tile(t('pharmacy.entry.summary.lastPrice'), last?.purchasePriceMinor && last.purchaseCurrency ? <Num>{`${formatMinor(BigInt(last.purchasePriceMinor), last.purchaseCurrency)} ${last.purchaseCurrency}`}</Num> : none)}
      {tile(t('pharmacy.entry.summary.sellPrice'), found.sellPrice ? <Num>{`${formatMinor(BigInt(found.sellPrice.amountMinor), found.sellPrice.currency)} ${found.sellPrice.currency}`}</Num> : none)}
      {tile(t('pharmacy.entry.summary.lastSupplier'), last?.supplierName ? <span dir="auto">{last.supplierName}</span> : none)}
    </div>
  );
}
