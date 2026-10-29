'use client';

import { ClipboardCheck, Eye, Pencil, ScanBarcode, Save, Trash2, Undo2, UserCheck, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import {
  EDIT_FIELDS,
  MONEY_FIELDS,
  NOTE_FLAGS,
  formatAmount,
  jumpId,
  matchChipOf,
  mathFigures,
  missingFields,
  orderedFlags,
  rowFieldSource,
  rowFormOf,
  type Currency,
  type EditBlock,
  type EditField,
  type FlagCode,
  type ReviewRow,
} from './intake-review-logic';
import { FlagChip, Message, MatchState, NotRead, SourceTag } from './intake-review-parts';
import { IntakeProductDialog } from './IntakeProductDialog';
import { isolate } from './WriteBlocked';

export interface IntakeRowCardProps {
  row: ReviewRow;
  currency: Currency | null;
  /** Why editing is not possible now, or false. The reason itself is written once, above the lines. */
  block: false | EditBlock;
  /** The line is waiting for a save in this form (typed values only). */
  form: Partial<Record<EditField, string>> | undefined;
  editing: boolean;
  onEdit: () => void;
  onChange: (field: EditField, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRemove: () => void;
  onReview: (note: string) => void;
  onScan: (text: string) => void;
  onChoose: (productId: string, unitId: string) => Promise<string | null>;
  onClearMatch: () => void;
  onShow: () => void;
  /** A write is running somewhere on the screen. */
  busy: boolean;
  /** This line is the one being written. */
  saving: boolean;
  message: { tone: 'error' | 'ok' | 'info'; text: string } | null;
  /** The id of the single sentence that says why editing is disabled. */
  whyId: string;
}

const CELL = 'flex min-w-0 flex-col gap-0.5';

/**
 * One invoice line, as a card at every width (a table of this many columns would scroll sideways on a phone and sit
 * cramped beside the original). It shows what was read ("Not read" where nothing was), where a value came from when a person
 * or a barcode changed it, the product matched with its state in words and icon, each flag with a plain sentence, and what can
 * be done: edit the fields, scan a barcode, choose the product, mark it reviewed with a note, remove it. Every write names the
 * version of the line the person saw. No motion.
 */
export function IntakeRowCard(props: IntakeRowCardProps) {
  const { row, currency, block, form, editing, busy, saving, message, whyId } = props;
  const t = useT();
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [scan, setScan] = useState('');
  const [picking, setPicking] = useState(false);
  const locked = block !== false || busy;
  /** A batch that is approved or cancelled shows its lines as they ended; the controls are not there to be disabled. */
  const closed = block === 'closed';
  const describedBy = block ? whyId : undefined;
  const line = row.line;
  const current = rowFormOf(row, currency);
  const value = (field: EditField) => form?.[field] ?? current[field];
  const flags = orderedFlags(row.flags);
  const open = row.openFlags;
  const noteable = open.some((f) => (NOTE_FLAGS as readonly string[]).includes(f));
  const blockedByValue = open.some((f) => f === 'MISSING' || f === 'AMBIGUOUS_MATCH');

  const heading = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <h4 className="text-base font-semibold text-text">{t('pharmacy.intake.rv.line', { n: formatNumber(row.lineNo) })}</h4>
      <span className="text-sm text-muted">{t('pharmacy.intake.rv.onPage', { page: formatNumber(row.page) })}</span>
      {!row.removed && <MatchState kind={matchChipOf(row)} t={t} />}
      {row.reviewed && !row.removed && (
        <span data-testid="reviewed-chip" className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-transparent bg-success-wash px-1.5 py-0.5 text-xs font-medium text-success [&_svg]:size-3.5">
          <ClipboardCheck aria-hidden />
          {t('pharmacy.intake.rv.status.reviewed')}
        </span>
      )}
      {row.manual && (
        <span className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text [&_svg]:size-3.5">
          <UserCheck aria-hidden />
          {t('pharmacy.intake.rv.status.manual')}
        </span>
      )}
      {row.removed && (
        <span data-testid="removed-chip" className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text [&_svg]:size-3.5">
          <Trash2 aria-hidden />
          {t('pharmacy.intake.rv.status.removed')}
        </span>
      )}
    </div>
  );

  if (row.removed) {
    return (
      <li id={jumpId(row.id)} tabIndex={-1} data-testid="review-row" data-row-id={row.id} data-removed="true" className="flex min-w-0 flex-col gap-2 border-b border-line py-3 opacity-80">
        {heading}
        <p className="text-sm text-muted">{t('pharmacy.intake.rv.removedNote')}</p>
      </li>
    );
  }

  const sentence = (flag: FlagCode): string => {
    if (flag === 'MISSING') return t('pharmacy.intake.rv.flag.MISSING', { fields: missingFields(row).map((f) => t(`pharmacy.intake.rv.missing.${f}`)).join(', ') });
    if (flag === 'MATH_MISMATCH') {
      const figures = mathFigures(row, currency);
      return t('pharmacy.intake.rv.flag.MATH_MISMATCH', { expected: figures?.expected ?? '', actual: figures?.actual ?? '', difference: figures?.difference ?? '', currency: currency ?? '' });
    }
    if (flag === 'MODEL_UNCLEAR') return t('pharmacy.intake.rv.flag.MODEL_UNCLEAR', { note: isolate(line.unclear.join(' · ')) });
    return t(`pharmacy.intake.rv.flag.${flag}`);
  };

  const show = (field: EditField): ReactNode => {
    if (field === 'quantity' || field === 'bonus') {
      const n = field === 'quantity' ? line.quantity : line.bonus;
      return n === null ? <NotRead t={t} /> : <bdi dir="ltr" className="tabular-nums">{formatNumber(n)}</bdi>;
    }
    if (MONEY_FIELDS.includes(field)) {
      const m = field === 'unitCost' ? line.unitCost : line.lineTotal;
      return m === null ? <NotRead t={t} /> : <bdi dir="ltr" className="tabular-nums">{formatAmount(m, currency)} {currency ?? ''}</bdi>;
    }
    const text = (line[field as 'name'] ?? '') as string;
    return text.trim() === '' ? <NotRead t={t} /> : <bdi dir="auto">{text}</bdi>;
  };

  const cell = (field: EditField, extra?: ReactNode, wide = false) => {
    const source = rowFieldSource(row, field);
    return (
      <div key={field} className={wide ? `${CELL} col-span-2 sm:col-span-3` : CELL} data-testid={`cell-${field}`}>
        <dt className="text-sm text-muted">{t(`pharmacy.intake.rv.field.${field}`)}</dt>
        <dd className="min-w-0 break-words text-base text-text [overflow-wrap:anywhere]">{show(field)}</dd>
        {source !== 'read' && (
          <dd>
            <SourceTag source={source} t={t} />
          </dd>
        )}
        {extra}
      </div>
    );
  };

  const hintFor = (field: EditField) => (field === 'expiry' ? t('pharmacy.intake.rv.expiryHint') : field === 'unitCost' ? t('pharmacy.intake.rv.costNote') : MONEY_FIELDS.includes(field) && currency === null ? t('pharmacy.intake.rv.moneyNeedsCurrency') : undefined);

  const product = row.match;
  const productText = product ? [product.name, product.strength, product.form].filter((p) => p.trim() !== '').join(' · ') : null;

  return (
    <li id={jumpId(row.id)} tabIndex={-1} data-testid="review-row" data-row-id={row.id} data-version={row.version} data-open-flags={open.join(',')} className="flex min-w-0 flex-col gap-3 border-b border-line py-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {heading}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="min-h-11" icon={<Eye aria-hidden />} data-testid="row-show-original" onClick={props.onShow}>
            {t('pharmacy.intake.rv.showOnOriginal')}
          </Button>
          {!editing && !closed && (
            <Button size="lg" className="min-h-11" icon={<Pencil aria-hidden />} data-testid="row-edit" disabled={locked} aria-describedby={describedBy} onClick={props.onEdit}>
              {t('pharmacy.intake.rv.edit')}
            </Button>
          )}
          {!closed && (
            <Button size="lg" className="min-h-11" icon={<Trash2 aria-hidden />} data-testid="row-remove" disabled={locked} aria-describedby={describedBy} onClick={props.onRemove}>
              {t('pharmacy.intake.rv.remove')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1" data-testid="cell-product">
        <span className="text-sm text-muted">{t('pharmacy.intake.rv.field.product')}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]" data-testid="matched-product">
            {productText ? (
              <>
                {productText}
                {product?.unitLabel && <span className="font-normal text-muted"> · {product.unitLabel}</span>}
              </>
            ) : (
              <span className="italic text-muted">{t('pharmacy.intake.rv.match.none')}</span>
            )}
          </span>
          {!closed && (
            <Button size="lg" className="min-h-11" data-testid="row-choose" disabled={locked} aria-describedby={describedBy} onClick={() => setPicking(true)}>
              {product ? t('pharmacy.intake.rv.match.change') : t('pharmacy.intake.rv.match.choose')}
            </Button>
          )}
          {product && row.matchState === 'CHOSEN' && !closed && (
            <Button size="lg" className="min-h-11" icon={<X aria-hidden />} data-testid="row-clear-match" disabled={locked} aria-describedby={describedBy} onClick={props.onClearMatch}>
              {t('pharmacy.intake.rv.match.clear')}
            </Button>
          )}
        </div>
      </div>
      {picking && <IntakeProductDialog open onOpenChange={setPicking} row={row} onChoose={props.onChoose} />}

      {!editing ? (
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3" data-testid="row-values">
          {cell('name', undefined, true)}
          {cell('strength')}
          {cell('form')}
          {cell('pack')}
          {cell('quantity')}
          {cell('bonus')}
          {cell('unitCost', <dd className="text-xs text-muted">{t('pharmacy.intake.rv.costNote')}</dd>)}
          {cell('lineTotal')}
          {cell('lot')}
          {cell('expiry', <dd className="text-xs text-muted">{t('pharmacy.intake.rv.expiryHint')}</dd>)}
          {cell('barcodeText', undefined, true)}
        </dl>
      ) : (
        <form
          aria-label={t('pharmacy.intake.rv.line', { n: formatNumber(row.lineNo) })}
          data-testid="row-form"
          className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!locked) props.onSave();
          }}
        >
          {EDIT_FIELDS.map((field) => (
            <Field key={field} label={t(`pharmacy.intake.rv.field.${field}`)} hint={hintFor(field)}>
              <Input
                size="lg"
                className="min-h-11"
                dir={field === 'name' || field === 'strength' || field === 'form' || field === 'pack' ? 'auto' : 'ltr'}
                inputMode={field === 'quantity' || field === 'bonus' ? 'numeric' : MONEY_FIELDS.includes(field) ? 'decimal' : 'text'}
                autoComplete="off"
                data-testid={`edit-${field}`}
                disabled={MONEY_FIELDS.includes(field) && currency === null}
                value={value(field)}
                onChange={(e) => props.onChange(field, e.target.value)}
              />
            </Field>
          ))}
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-3">
            <Button type="submit" variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="row-save" disabled={locked}>
              {saving ? t('pharmacy.intake.rv.saving') : t('pharmacy.intake.rv.save')}
            </Button>
            <Button size="lg" className="min-h-11" icon={<Undo2 aria-hidden />} data-testid="row-discard" disabled={busy} onClick={props.onDiscard}>
              {t('pharmacy.intake.rv.discard')}
            </Button>
          </div>
        </form>
      )}

      {!closed && (
      <div
        className="flex min-w-0 max-w-xl flex-col gap-1"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!locked && scan.trim() !== '') {
            props.onScan(scan.trim());
            setScan('');
          }
        }}
      >
        <Field label={t('pharmacy.intake.rv.scan.label')} hint={t('pharmacy.intake.rv.scan.hint')}>
          <div className="relative">
            <ScanBarcode aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              size="lg"
              className="min-h-11 ps-8"
              dir="ltr"
              autoComplete="off"
              enterKeyHint="done"
              data-testid="row-scan"
              disabled={locked}
              aria-describedby={describedBy}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
            />
          </div>
        </Field>
      </div>
      )}

      <div className="flex min-w-0 flex-col gap-2" data-testid="row-flags">
        {flags.length === 0 ? (
          <Message tone="ok" testId="row-clean">{t('pharmacy.intake.rv.noFlags')}</Message>
        ) : (
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li key={flag} className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                <FlagChip flag={flag} checked={!open.includes(flag)} t={t} />
                <span data-testid={`flag-text-${flag}`} className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                  {sentence(flag)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {row.reviewed && row.note && (
          <p data-testid="row-note" dir="auto" className="text-sm text-text">
            {t('pharmacy.intake.rv.review.done', { note: isolate(row.note) })}
          </p>
        )}
        {blockedByValue && <p className="text-sm text-muted">{t('pharmacy.intake.rv.review.needsValue')}</p>}
        {noteable && !reviewing && !closed && (
          <Button size="lg" className="min-h-11 w-fit" icon={<ClipboardCheck aria-hidden />} data-testid="row-review-open" disabled={locked} aria-describedby={describedBy} onClick={() => setReviewing(true)}>
            {t('pharmacy.intake.rv.review.open')}
          </Button>
        )}
        {reviewing && (
          <form
            data-testid="row-review-form"
            aria-label={t('pharmacy.intake.rv.review.open')}
            className="flex max-w-xl flex-col gap-2 rounded-md border border-line-strong bg-raised p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked && note.trim() !== '') {
                props.onReview(note.trim());
                setReviewing(false);
                setNote('');
              }
            }}
          >
            <Field label={t('pharmacy.intake.rv.review.note')} hint={t('pharmacy.intake.rv.review.hint')}>
              <Textarea className="min-h-20" dir="auto" maxLength={500} data-testid="row-review-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="lg" className="min-h-11" data-testid="row-review-save" disabled={locked || note.trim() === ''}>
                {t('pharmacy.intake.rv.review.save')}
              </Button>
              <Button size="lg" className="min-h-11" onClick={() => setReviewing(false)}>
                {t('pharmacy.intake.rv.review.cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
      {message && <Message tone={message.tone} testId="row-message">{message.text}</Message>}
    </li>
  );
}
