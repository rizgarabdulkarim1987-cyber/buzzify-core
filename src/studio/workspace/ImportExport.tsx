'use client';

import { FileDown, FileSpreadsheet, FileUp, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { applyImport, discardImport, exportMenu, parseImport, requestImportUpload } from '@/app/studio/_actions/imports';
import { SHEET_COLUMNS, type ImportPreview } from '@/server/domain/import-sheet';
import type { StudioFailure } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { FormSection } from '@/studio/ui/FormSection';
import { AiMenuImport } from './AiMenuImport';
import { ImportPreviewPanel, type Status } from './ImportPreview';

export interface ImportExportProps {
  menuId: string;
  slug: string;
  currency: string;
  canImport: boolean;
  canExport: boolean;
  /** Whether the person may change what guests see at once (sold out, hidden). */
  canChangeLive: boolean;
}

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
              <ImportPreviewPanel
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
