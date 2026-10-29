'use client';

import { CircleCheck, Lock, Pencil, Save, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { formatAmount, headerFieldSource, headerFormOf, type EditBlock, type HeaderField, type HeaderFormField, type ReviewData } from './intake-review-logic';
import { Message, NotRead, SourceTag } from './intake-review-parts';
import { isolate } from './WriteBlocked';

export interface IntakeHeaderCardProps {
  data: ReviewData;
  suppliers: Array<{ id: string; name: string }>;
  /** Why editing is not possible now, or false. */
  block: false | EditBlock;
  /** The unsaved header form, or null when the card is showing the values. */
  form: Partial<Record<HeaderFormField, string>> | null;
  onOpen: () => void;
  onChange: (field: HeaderFormField, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onAcknowledge: (reason: string) => void;
  busy: boolean;
  message: { tone: 'error' | 'ok' | 'info'; text: string } | null;
  ackMessage: { tone: 'error' | 'ok' | 'info'; text: string } | null;
}

const MONEY: readonly HeaderField[] = ['total', 'discount', 'tax'];
const SHOWN: readonly HeaderField[] = ['invoiceNumber', 'invoiceDate', 'currency', 'total', 'discount', 'tax'];

/**
 * The invoice's header: supplier, number, date, currency, total, discount, tax, each with where it came from ("read from
 * invoice", "edited by you", "conflict between files: choose"), the lines against the total in words and figures, and the
 * acknowledgement of a difference (a reason is required; the server compares the exact difference and currency it was shown).
 * Amounts are text with their currency, never floating point. A value that was not read says "Not read".
 */
export function IntakeHeaderCard(props: IntakeHeaderCardProps) {
  const { data, suppliers, block, form, onOpen, onChange, onSave, onDiscard, onAcknowledge, busy, message, ackMessage } = props;
  const t = useT();
  const [reason, setReason] = useState('');
  const current = headerFormOf(data);
  const editing = form !== null;
  const value = (field: HeaderFormField) => form?.[field] ?? current[field];
  const currency = (editing ? (value('currency') as 'IQD' | 'USD' | '') : (data.header.values.currency ?? '')) || null;
  const arithmetic = data.header.arithmetic;
  const lockedWhy = block ? t(`pharmacy.intake.reason.${block}`) : null;

  const show = (field: HeaderField): ReactNode => {
    const v = data.header.values[field];
    if (v === null || v === undefined || v === '') return <NotRead t={t} />;
    if (MONEY.includes(field)) {
      return (
        <bdi dir="ltr" className="tabular-nums">
          {formatAmount(v as number, data.header.values.currency)} {data.header.values.currency ?? ''}
        </bdi>
      );
    }
    return <bdi dir="auto">{String(v)}</bdi>;
  };

  const inputFor = (field: HeaderField): ReactNode => {
    if (field === 'currency') {
      return (
        <Select
          size="lg"
          className="min-h-11"
          data-testid="header-currency"
          value={value('currency')}
          onChange={(e) => onChange('currency', e.target.value)}
          options={[
            { value: '', label: t('pharmacy.intake.rv.header.currencyNone') },
            { value: 'IQD', label: 'IQD' },
            { value: 'USD', label: 'USD' },
          ]}
        />
      );
    }
    const money = MONEY.includes(field);
    return (
      <Input
        size="lg"
        className="min-h-11"
        dir={money ? 'ltr' : 'auto'}
        inputMode={money ? 'decimal' : 'text'}
        autoComplete="off"
        data-testid={`header-${field}`}
        disabled={money && currency === null}
        value={value(field)}
        onChange={(e) => onChange(field, e.target.value)}
      />
    );
  };

  return (
    <section id="intake-header" aria-labelledby="intake-header-title" data-testid="intake-header" className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="intake-header-title" className="text-md font-semibold text-text">
          {t('pharmacy.intake.rv.header.title')}
        </h3>
        {!editing && data.batch.status === 'OPEN' && (
          <div className="flex min-w-0 flex-col gap-1">
            <Button size="lg" className="min-h-11" icon={<Pencil aria-hidden />} data-testid="header-edit" disabled={block !== false || busy} aria-describedby={block ? 'header-why' : undefined} onClick={onOpen}>
              {t('pharmacy.intake.rv.header.edit')}
            </Button>
            {lockedWhy && (
              <p id="header-why" data-testid="header-why" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
                <Lock aria-hidden />
                <span className="min-w-0">{lockedWhy}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {!editing ? (
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid="header-values">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.intake.supplier')}</dt>
            <dd data-testid="header-supplier-value" dir="auto" className="min-w-0 break-words text-text [overflow-wrap:anywhere]">
              {data.batch.supplierName ?? <span className="italic text-muted">{t('pharmacy.intake.rv.header.supplierNone')}</span>}
            </dd>
          </div>
          {SHOWN.map((field) => (
            <div key={field} className="flex min-w-0 flex-col gap-0.5" data-testid={`header-field-${field}`}>
              <dt className="text-muted">{t(`pharmacy.intake.rv.header.${field}`).replace(/ \(.*\)$/, '')}</dt>
              <dd className="min-w-0 break-words text-text [overflow-wrap:anywhere]">{show(field)}</dd>
              <dd>
                <SourceTag source={headerFieldSource(data.header, field)} t={t} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <form
          aria-label={t('pharmacy.intake.rv.header.title')}
          data-testid="header-form"
          className="grid gap-x-6 gap-y-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onSave();
          }}
        >
          <Field label={t('pharmacy.intake.rv.header.supplier')}>
            <Select
              size="lg"
              className="min-h-11"
              data-testid="header-supplier"
              value={value('supplierId')}
              onChange={(e) => onChange('supplierId', e.target.value)}
              options={[{ value: '', label: t('pharmacy.intake.rv.header.supplierNone') }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </Field>
          {SHOWN.map((field) => {
            const source = headerFieldSource(data.header, field);
            return (
              <Field
                key={field}
                label={t(`pharmacy.intake.rv.header.${field}`)}
                hint={source === 'conflict' ? t('pharmacy.intake.rv.conflictHint') : field === 'invoiceDate' ? t('pharmacy.intake.rv.header.dateHint') : undefined}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  {inputFor(field)}
                  <SourceTag source={source} t={t} />
                </div>
              </Field>
            );
          })}
          <p className="text-sm text-muted sm:col-span-2">{t('pharmacy.intake.rv.header.noteMoney')}</p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="header-save" disabled={busy || block !== false}>
              {busy ? t('pharmacy.intake.rv.saving') : t('pharmacy.intake.rv.header.save')}
            </Button>
            <Button size="lg" className="min-h-11" icon={<Undo2 aria-hidden />} data-testid="header-discard" disabled={busy} onClick={onDiscard}>
              {t('pharmacy.intake.rv.header.discard')}
            </Button>
          </div>
        </form>
      )}
      {message && <Message tone={message.tone} testId="header-message">{message.text}</Message>}

      <div className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" data-testid="header-arithmetic">
        <h4 className="text-sm font-semibold text-text">{t('pharmacy.intake.rv.arith.title')}</h4>
        {!arithmetic || arithmetic.status === 'UNKNOWN' ? (
          <Message tone="info" testId="arith-unknown">{t('pharmacy.intake.rv.arith.unknown')}</Message>
        ) : arithmetic.status === 'OK' ? (
          <Message tone="ok" testId="arith-ok">{t('pharmacy.intake.rv.arith.ok')}</Message>
        ) : (
          <>
            <Message tone="error" testId="arith-mismatch">
              {t('pharmacy.intake.rv.arith.mismatch', {
                expected: formatAmount(arithmetic.expected ?? '0', data.header.values.currency) ?? '',
                actual: formatAmount(arithmetic.actual ?? '0', data.header.values.currency) ?? '',
                difference: formatAmount(arithmetic.difference ?? '0', data.header.values.currency) ?? '',
                currency: data.header.values.currency ?? '',
              })}
            </Message>
            {data.header.acknowledged ? (
              <p data-testid="arith-accepted" className="flex items-start gap-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
                <CircleCheck aria-hidden className="text-success" />
                <span className="min-w-0 break-words" dir="auto">
                  {t('pharmacy.intake.rv.arith.accepted', { reason: isolate(data.header.acknowledged.reason) })}
                </span>
              </p>
            ) : data.batch.status === 'OPEN' ? (
              <form
                className="flex max-w-xl flex-col gap-2"
                data-testid="arith-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy && block === false && reason.trim() !== '') {
                    onAcknowledge(reason.trim());
                    setReason('');
                  }
                }}
              >
                <Field label={t('pharmacy.intake.rv.arith.reason')} hint={t('pharmacy.intake.rv.arith.reasonHint')}>
                  <Textarea className="min-h-20" dir="auto" maxLength={500} data-testid="arith-reason" disabled={block !== false} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex flex-col gap-1">
                  <Button type="submit" size="lg" className="min-h-11 w-fit" data-testid="arith-accept" disabled={busy || block !== false || reason.trim() === ''}>
                    {t('pharmacy.intake.rv.arith.accept')}
                  </Button>
                  {lockedWhy && <p className="text-sm text-muted">{lockedWhy}</p>}
                </div>
              </form>
            ) : null}
          </>
        )}
        {arithmetic && arithmetic.status !== 'UNKNOWN' && arithmetic.assumed && arithmetic.assumed.length > 0 && <p className="text-sm text-muted">{t('pharmacy.intake.rv.arith.assumed')}</p>}
        {ackMessage && <Message tone={ackMessage.tone} testId="arith-message">{ackMessage.text}</Message>}
      </div>
    </section>
  );
}
