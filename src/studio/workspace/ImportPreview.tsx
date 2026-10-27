'use client';

import { ArrowRight, Radio } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { ImportChange, ImportPreview, ImportPreviewRow, SheetError } from '@/server/domain/import-sheet';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';
import { formatMoney } from './content/shared';

/** The preview of a parsed sheet, shared by the Studio's Import tab and the till's product list: every row, what changes, and apply or discard. */
export type Status = ImportPreviewRow['status'];
const STATUSES: readonly Status[] = ['new', 'changed', 'unchanged', 'invalid'];
const TONES: Record<Status, StatusTone> = { new: 'success', changed: 'ink', unchanged: 'neutral', invalid: 'danger' };

/** A field's value as the preview shows it: money, yes or no, a list, or the text. */
function shownValue(t: Translate, locale: Locale, currency: string, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (field === 'price' && typeof value === 'number') return formatMoney(value, currency, locale);
  if (typeof value === 'boolean') return value ? t('data.value.yes') : t('data.value.no');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

const reasonText = (t: Translate, error: SheetError) => t(`data.reason.${error.reason}`, { value: error.value ?? '' });

export function ImportPreviewPanel({
  job,
  currency,
  canChangeLive,
  filter,
  onFilter,
  onApply,
  onDiscard,
  pending,
}: {
  job: { fileName: string; preview: ImportPreview; hideMissing: boolean };
  currency: string;
  canChangeLive: boolean;
  filter: Status | 'all';
  onFilter: (filter: Status | 'all') => void;
  onApply: () => void;
  onDiscard: () => void;
  pending: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const number = numberFormat(locale);
  const { preview } = job;
  const { summary } = preview;
  const rows = filter === 'all' ? preview.rows : preview.rows.filter((row) => row.status === filter);
  const liveRows = preview.rows.filter((row) => row.changes?.some((change) => change.live));
  const nothing = summary.new + summary.changed + summary.hidden + liveRows.length === 0;
  const fieldLabel = (field: string) => t(`data.field.${field}`);
  const shown = (change: ImportChange, side: 'before' | 'after') => shownValue(t, locale, currency, change.field, change[side]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text">{t('data.preview.title')}</h3>
        <p dir="auto" className="text-sm text-muted">
          {t('data.preview.file', { file: job.fileName, rows: number.format(preview.rows.length) })}
        </p>
      </div>

      <div role="group" aria-label={t('data.preview.filter')} className="inline-flex w-fit flex-wrap rounded-md border border-line p-0.5">
        {(['all', ...STATUSES] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => onFilter(key)}
            className={cx('h-7 rounded-sm px-3 text-sm tabular-nums transition-colors', filter === key ? 'bg-text text-bg' : 'text-muted hover:text-text')}
          >
            {key === 'all' ? t('data.preview.all', { count: number.format(preview.rows.length) }) : t(`data.status.${key}`, { count: number.format(summary[key]) })}
          </button>
        ))}
      </div>

      {summary.invalid > 0 && <Alert tone="danger">{t('data.preview.invalidBlock')}</Alert>}

      <div className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-raised">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('data.preview.caption')}</caption>
          <thead className="sticky top-0 bg-raised">
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="h-9 w-14 px-3 ps-4 text-start font-medium">
                {t('data.preview.row')}
              </th>
              <th scope="col" className="h-9 w-28 px-3 text-start font-medium">
                {t('data.preview.status')}
              </th>
              <th scope="col" className="h-9 px-3 text-start font-medium">
                {t('data.preview.product')}
              </th>
              <th scope="col" className="h-9 px-3 pe-4 text-start font-medium">
                {t('data.preview.details')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-line align-top last:border-b-0">
                <td className="px-3 py-2.5 ps-4 tabular-nums text-muted">{number.format(row.rowNumber)}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={TONES[row.status]}>{t(`data.statusName.${row.status}`)}</StatusBadge>
                </td>
                <td className="px-3 py-2.5">
                  <span dir="auto" className="block font-medium text-text">
                    {row.name || '—'}
                  </span>
                  {row.productSlug && (
                    <span dir="ltr" className="block font-mono text-xs text-muted">
                      {row.productSlug}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 pe-4">
                  {row.errors && (
                    <ul className="flex flex-col gap-0.5 text-danger">
                      {row.errors.map((error, index) => (
                        <li key={index}>
                          <code dir="ltr" className="font-mono text-xs">
                            {error.column}
                          </code>{' '}
                          {reasonText(t, error)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.status === 'changed' && (
                    <ul className="flex flex-col gap-0.5">
                      {row.changes!.map((change) => (
                        <li key={change.field} className="flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-muted">{fieldLabel(change.field)}:</span>
                          <span dir="auto" className="text-muted line-through decoration-line-strong">
                            {shown(change, 'before')}
                          </span>
                          <ArrowRight aria-hidden className="size-3.5 shrink-0 self-center text-muted rtl:-scale-x-100" />
                          <span dir="auto" className="text-text">
                            {shown(change, 'after')}
                          </span>
                          {change.live && <StatusBadge tone="ink">{t('data.preview.live')}</StatusBadge>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.status === 'new' && (
                    <span className="text-muted">
                      {fieldLabel('category')}: {shown(row.changes!.find((change) => change.field === 'category')!, 'after')} ·{' '}
                      {fieldLabel('price')}: {shown(row.changes!.find((change) => change.field === 'price')!, 'after')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview.newCategories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-text">{t('data.preview.newCategories')}</h4>
          <p dir="auto" className="text-sm text-muted">
            {preview.newCategories.map((category) => category.names.en ?? category.names.ar ?? category.names.ckb ?? category.slug).join(' · ')}
          </p>
        </div>
      )}

      {(liveRows.length > 0 || summary.hidden > 0) && (
        <section aria-labelledby="live-title" className="flex flex-col gap-2 rounded-lg border border-line bg-accent-wash px-4 py-3">
          <h4 id="live-title" className="flex items-center gap-2 text-sm font-semibold text-text">
            <Radio aria-hidden className="size-4" />
            {t('data.preview.liveTitle')}
          </h4>
          <p className="text-sm text-text">{canChangeLive ? t('data.preview.liveBody') : t('data.preview.liveNoPermission')}</p>
          <ul className="flex flex-col gap-0.5 text-sm text-text">
            {liveRows.map((row) => (
              <li key={row.rowNumber} dir="auto">
                {row.name}: {row.changes!.find((change) => change.live)!.after ? t('data.preview.backOnSale') : t('data.preview.soldOut')}
              </li>
            ))}
            {summary.hidden > 0 && <li>{t('data.preview.willHide', { count: summary.hidden, formatted: number.format(summary.hidden) })}</li>}
          </ul>
        </section>
      )}

      {preview.missing.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-text">{t('data.preview.missingTitle', { count: preview.missing.length, formatted: number.format(preview.missing.length) })}</h4>
          <p className="text-sm text-muted">{job.hideMissing ? t('data.preview.missingHidden') : t('data.preview.missingKept')}</p>
          <p dir="auto" className="text-sm text-text">
            {preview.missing.map((product) => product.name).join(' · ')}
          </p>
        </div>
      )}

      {nothing && summary.invalid === 0 && <p className="text-sm text-muted">{t('data.preview.nothing')}</p>}

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <Button variant="primary" onClick={onApply} pending={pending} disabled={summary.invalid > 0 || nothing}>
          {t('data.preview.apply')}
        </Button>
        <Button variant="ghost" onClick={onDiscard} disabled={pending}>
          {t('data.preview.discard')}
        </Button>
      </div>
    </div>
  );
}
