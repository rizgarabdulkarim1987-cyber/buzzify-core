'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { applyBulkPrices, previewBulkPrices } from '@/app/studio/_actions/prices';
import { parsePriceInput } from '@/lib/money-input';
import type { BulkOperation } from '@/server/domain/bulk-prices';
import type { BulkPreview } from '@/server/studio/services/prices';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { formatMoney, parseDeltaInput, parsePercentInput, PRICE_PROBLEM_KEYS } from './content/shared';

type Kind = BulkOperation['kind'];

export interface BulkPriceDialogProps {
  menuId: string;
  currency: string;
  selection: { productIds?: string[]; categoryId?: string };
  /** What the change covers, in a phrase: "3 selected products", "Coffee", "Every product". */
  scopeLabel: string;
  onClose: () => void;
  onApplied: () => void;
}

/**
 * A bulk price change (spec 13.4): an operation, a preview of every old and new price (problems marked), then Apply.
 * Apply is offered only for the preview on screen; the server applies it only to the draft that was previewed.
 */
export function BulkPriceDialog({ menuId, currency, selection, scopeLabel, onClose, onApplied }: BulkPriceDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('percent');
  const [amount, setAmount] = useState('');
  const [includeVariants, setIncludeVariants] = useState(true);
  const [preview, setPreview] = useState<{ result: BulkPreview; operation: BulkOperation; key: string } | null>(null);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, startPending] = useTransition();
  const key = JSON.stringify([kind, amount, includeVariants]);

  /** The operation as typed, or the field message that says why it cannot be read. */
  const operation = (): { ok: true; value: BulkOperation } | { ok: false; message: string } => {
    if (kind === 'percent') {
      const parsed = parsePercentInput(amount);
      return parsed.ok ? { ok: true, value: { kind, basisPoints: parsed.basisPoints } } : { ok: false, message: t('prices.bulk.percentInvalid') };
    }
    const parsed = kind === 'add' ? parseDeltaInput(amount, currency) : parsePriceInput(amount, currency);
    if (!parsed.ok) return { ok: false, message: t(PRICE_PROBLEM_KEYS[parsed.reason]) };
    return { ok: true, value: { kind, amount: parsed.minor } };
  };

  const showPreview = () =>
    startPending(async () => {
      const op = operation();
      if (!op.ok) return setProblem({ field: 'amount', message: op.message });
      const result = await previewBulkPrices({ menuId, selection, operation: op.value, includeVariants });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setProblem({ message: described.message });
      }
      setProblem(null);
      setPreview({ result: result.data, operation: op.value, key });
    });

  const current = preview && preview.key === key ? preview : null;
  const blocked = current ? current.result.rows.some((row) => row.problem) : true;
  const changes = current ? current.result.rows.filter((row) => row.newPrice !== row.oldPrice).length : 0;

  const apply = () =>
    startPending(async () => {
      if (!current) return;
      const result = await applyBulkPrices({ menuId, selection, operation: current.operation, includeVariants, expectedDraftHash: current.result.draftHash });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setProblem({ message: result.error.code === 'CONFLICT' ? t('prices.bulk.stale') : described.message });
        setPreview(null);
        return;
      }
      toast.success(t('prices.bulk.applied', { count: numberFormat(locale).format(result.data.changed) }));
      onApplied();
      router.refresh();
      onClose();
    });

  const amountLabel = kind === 'percent' ? t('prices.bulk.percent') : kind === 'add' ? t('prices.bulk.amount') : t('prices.bulk.setTo');
  const amountHint = kind === 'percent' ? t('prices.bulk.percentHint') : kind === 'add' ? t('prices.bulk.amountHint', { currency }) : currency;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('prices.bulk.title')}
      description={t('prices.bulk.scope', { scope: scopeLabel })}
      width="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={showPreview} pending={pending && !current}>
            {t('prices.bulk.preview')}
          </Button>
          <Button variant="primary" onClick={apply} disabled={blocked || changes === 0} pending={pending && current !== null}>
            {t('prices.bulk.apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {problem && !problem.field && <Alert tone="danger">{problem.message}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('prices.bulk.operation')}>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as Kind)}
              options={[
                { value: 'percent', label: t('prices.bulk.kind.percent') },
                { value: 'add', label: t('prices.bulk.kind.add') },
                { value: 'set', label: t('prices.bulk.kind.set') },
              ]}
            />
          </Field>
          <Field label={amountLabel} hint={amountHint} error={problem?.field === 'amount' ? problem.message : undefined}>
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" className="tabular-nums" />
          </Field>
        </div>
        <Checkbox
          label={t('prices.bulk.includeSizes')}
          checked={includeVariants}
          onChange={(event) => setIncludeVariants(event.target.checked)}
        />

        {current && (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-muted">
              {blocked
                ? t('prices.bulk.blocked')
                : t('prices.bulk.summary', { count: numberFormat(locale).format(changes), step: formatMoney(current.result.step, currency, locale) })}
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t('prices.bulk.previewCaption')}</caption>
                <thead className="sticky top-0 bg-raised">
                  <tr className="border-b border-line">
                    <th scope="col" className="h-8 px-3 text-start text-xs font-medium text-muted">
                      {t('prices.item')}
                    </th>
                    <th scope="col" className="h-8 px-3 text-end text-xs font-medium text-muted">
                      {t('prices.bulk.old')}
                    </th>
                    <th scope="col" className="h-8 px-3 text-end text-xs font-medium text-muted">
                      {t('prices.bulk.new')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.result.rows.map((row) => (
                    <tr key={`${row.productId}:${row.variantId ?? ''}`} className={cx('border-b border-line last:border-b-0', row.problem && 'bg-danger-wash')}>
                      <td className="px-3 py-1.5">
                        {row.variantName === null ? <span className="text-text">{row.name}</span> : <span className="ps-4 text-muted">{row.variantName}</span>}
                      </td>
                      <td dir="ltr" className="px-3 py-1.5 text-end tabular-nums text-muted">
                        {formatMoney(row.oldPrice, currency, locale)}
                      </td>
                      <td dir="ltr" className={cx('px-3 py-1.5 text-end tabular-nums', row.problem ? 'text-danger' : row.newPrice !== row.oldPrice ? 'font-medium text-text' : 'text-muted')}>
                        {formatMoney(row.newPrice, currency, locale)}
                        {row.problem && <span className="sr-only"> · {t('prices.bulk.notPositive')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
