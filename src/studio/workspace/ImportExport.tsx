'use client';

import { ArrowRight, FileDown, FileSpreadsheet, FileUp, Radio, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { applyImport, discardImport, exportMenu, parseImport, requestImportUpload } from '@/app/studio/_actions/imports';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { SHEET_COLUMNS, type ImportChange, type ImportPreview, type ImportPreviewRow, type SheetError } from '@/server/domain/import-sheet';
import type { StudioFailure } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { FormSection } from '@/studio/ui/FormSection';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';
import { AiMenuImport } from './AiMenuImport';
import { formatMoney } from './content/shared';

export interface ImportExportProps {
  menuId: string;
  slug: string;
  currency: string;
  canImport: boolean;
  canExport: boolean;
  /** Whether the person may change what guests see at once (sold out, hidden). */
  canChangeLive: boolean;
}

type Status = ImportPreviewRow['status'];
const STATUSES: readonly Status[] = ['new', 'changed', 'unchanged', 'invalid'];
const TONES: Record<Status, StatusTone> = { new: 'success', changed: 'ink', unchanged: 'neutral', invalid: 'danger' };

/** Saves bytes the browser holds (the template) as a file. */
function saveFile(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Follows a short-lived download link the server answered with. */
function fetchFile(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/** Sends the file to its signed slot. */
async function send(url: string, headers: Record<string, string>, file: File): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'PUT', headers, body: file });
    return response.ok;
  } catch {
    return false;
  }
}

/** A field's value as the preview shows it: money, yes or no, a list, or the text. */
function shownValue(t: Translate, locale: Locale, currency: string, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (field === 'price' && typeof value === 'number') return formatMoney(value, currency, locale);
  if (typeof value === 'boolean') return value ? t('data.value.yes') : t('data.value.no');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

const reasonText = (t: Translate, error: SheetError) => t(`data.reason.${error.reason}`, { value: error.value ?? '' });

/**
 * The Import and export tab (spec 13): the draft out as CSV or Excel in the format an import reads, an empty template,
 * and a sheet in: sent, read into a preview of every row (new, changed field by field, unchanged, invalid with the
 * reason), what guests would see change at once and the products the sheet leaves out, then applied to the draft or
 * discarded.
 */
export function ImportExport({ menuId, slug, currency, canImport, canExport, canChangeLive }: ImportExportProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const number = numberFormat(locale);
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hideMissing, setHideMissing] = useState(false);
  const [stage, setStage] = useState<'idle' | 'sending' | 'reading'>('idle');
  const [failure, setFailure] = useState<StudioFailure | null>(null);
  const [job, setJob] = useState<{ id: string; fileName: string; preview: ImportPreview; hideMissing: boolean } | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [aiSkipped, setAiSkipped] = useState(0);
  const [aiCurrency, setAiCurrency] = useState<{ source: string; menu: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, startExporting] = useTransition();
  const [applying, startApplying] = useTransition();

  const download = (format: 'csv' | 'xlsx') =>
    startExporting(async () => {
      const result = await exportMenu({ menuId, format });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      fetchFile(result.data.url);
    });

  const read = async () => {
    if (!file) return;
    setFailure(null);
    setStage('sending');
    try {
      const slot = await requestImportUpload({ menuId, fileName: file.name, bytes: file.size });
      if (!slot.ok) return setFailure(slot.error);
      if (!(await send(slot.data.url, slot.data.headers, file))) return setFailure({ code: 'INVALID', message: t('data.import.sendFailed') });
      setStage('reading');
      const parsed = await parseImport({ menuId, uploadKey: slot.data.uploadKey, fileName: file.name, hideMissing });
      if (!parsed.ok) return setFailure(parsed.error);
      setJob({ id: parsed.data.importJobId, fileName: file.name, preview: parsed.data.preview, hideMissing });
      setFilter(parsed.data.preview.summary.invalid > 0 ? 'invalid' : 'all');
    } finally {
      setStage('idle');
    }
  };

  const reset = () => {
    setJob(null);
    setAiSkipped(0);
    setAiCurrency(null);
    setFile(null);
    setFailure(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const apply = () =>
    startApplying(async () => {
      if (!job) return;
      const result = await applyImport({ menuId, importJobId: job.id });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      const { summary, liveSkipped } = result.data;
      toast.success(t('data.applied', { created: number.format(summary.new), changed: number.format(summary.changed) }));
      if (liveSkipped > 0) toast.warning(t('data.appliedSkipped', { count: liveSkipped, formatted: number.format(liveSkipped) }));
      reset();
      router.refresh();
    });

  const discard = () =>
    startApplying(async () => {
      if (!job) return;
      const result = await discardImport({ menuId, importJobId: job.id });
      if (!result.ok) toast.error(describeFailure(t, locale, result.error).message);
      else toast.success(t('data.discarded'));
      reset();
    });

  const described = failure ? describeFailure(t, locale, failure) : null;
  const columnProblems = failure
    ? (['unknownColumns', 'missingColumns', 'duplicateColumns'] as const).flatMap((key) => (failure.fields?.[key] ? [t(`data.columns.${key}`, { columns: failure.fields[key]! })] : []))
    : [];

  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-2">
      {canExport && (
        <FormSection id="export-title" title={t('data.export.title')} intro={t('data.export.intro')}>
          <div className="flex flex-wrap gap-2">
            <Button icon={<FileDown aria-hidden />} onClick={() => download('csv')} disabled={exporting}>
              {t('data.export.csv')}
            </Button>
            <Button icon={<FileSpreadsheet aria-hidden />} onClick={() => download('xlsx')} disabled={exporting}>
              {t('data.export.xlsx')}
            </Button>
            <Button variant="ghost" onClick={() => saveFile(`${slug}-template.csv`, `﻿${SHEET_COLUMNS.join(',')}\r\n`, 'text/csv')}>
              {t('data.export.template')}
            </Button>
          </div>
          <p className="text-sm text-muted">{t('data.columns.body', { currency })}</p>
          <code dir="ltr" className="block rounded-md bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-text">
            {SHEET_COLUMNS.join(', ')}
          </code>
        </FormSection>
      )}

      {canImport && !job && (
        <FormSection id="ai-import-title" title={t('ai.menu.title')}>
          <AiMenuImport
            endpoint={`/api/studio/menus/${menuId}/ai-import`}
            onRead={(reading) => {
              setAiSkipped(reading.skipped);
              setAiCurrency(reading.currencyMismatch);
              setJob({ id: reading.importJobId, fileName: 'AI', preview: reading.preview, hideMissing: false });
              setFilter(reading.preview.summary.invalid > 0 ? 'invalid' : 'all');
            }}
          />
        </FormSection>
      )}

      {canImport && (
        <FormSection id="import-title" title={t('data.import.title')} intro={t('data.import.intro')}>
          {!job ? (
            <>
              <label
                htmlFor={inputId}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = event.dataTransfer.files[0];
                  if (dropped) setFile(dropped);
                }}
                className={cx(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
                  dragging ? 'border-ink bg-surface' : 'border-line-strong hover:bg-surface',
                )}
              >
                <Upload aria-hidden className="size-5 text-muted" />
                <span className="text-base font-medium text-text">{file ? file.name : t('data.import.choose')}</span>
                <span className="text-sm text-muted">{file ? t('data.import.size', { size: number.format(Math.ceil(file.size / 1024)) }) : t('data.import.drop')}</span>
              </label>
              <input
                id={inputId}
                ref={fileInput}
                type="file"
                aria-label={t('data.import.choose')}
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <Checkbox label={t('data.import.hideMissing')} checked={hideMissing} onChange={(event) => setHideMissing(event.target.checked)} />
              <p className="-mt-2 ps-6 text-sm text-muted">{t('data.import.hideMissingHint')}</p>
              {described && (
                <Alert tone="danger">
                  <span className="flex flex-col gap-1">
                    <span>{described.message}</span>
                    {columnProblems.map((line) => (
                      <span key={line} dir="auto">
                        {line}
                      </span>
                    ))}
                  </span>
                </Alert>
              )}
              <div className="flex items-center gap-3">
                <Button variant="primary" icon={<FileUp aria-hidden />} onClick={read} disabled={!file} pending={stage !== 'idle'}>
                  {t('data.import.read')}
                </Button>
                {stage !== 'idle' && (
                  <span role="status" className="text-sm text-muted">
                    {t(stage === 'sending' ? 'data.import.sending' : 'data.import.reading')}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {aiSkipped > 0 && <Alert tone="neutral">{t('ai.menu.skipped', { count: aiSkipped })}</Alert>}
              {aiCurrency && <Alert tone="danger">{t('ai.menu.currencyMismatch', aiCurrency)}</Alert>}
              <Preview
                job={job}
                currency={currency}
                canChangeLive={canChangeLive}
                filter={filter}
                onFilter={setFilter}
                onApply={apply}
                onDiscard={discard}
                pending={applying}
              />
            </>
          )}
        </FormSection>
      )}
    </div>
  );
}

function Preview({
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
