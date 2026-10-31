'use client';

import { CircleAlert, CircleCheck, Download, FileSpreadsheet, Hourglass } from 'lucide-react';
import { useRef, useState } from 'react';
import type { StudioFailure } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { phMessage } from './ph-failure';

type Format = 'csv' | 'xlsx';
type State = { kind: 'idle' } | { kind: 'working'; format: Format } | { kind: 'done'; fileName: string } | { kind: 'failed'; message: string };

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-raised px-4 text-base font-medium text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0';

/** The file name the server chose, from the response header (the RFC 5987 form first). */
function fileNameOf(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the plain form
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

/**
 * CSV and Excel buttons for a report. They ask `/pharmacy/reports/export` with the SAME filters the screen was drawn from (the
 * parameters come from the page, built by `exportParams`), so a file never differs from what is shown. The file's bytes and its
 * name come from the server; a refusal is said in words. One request at a time: a second click while the first runs does nothing.
 * Exports stay open while the pharmacy is read-only.
 */
export function ReportExport({ params }: { params: Record<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = useRef(false);

  async function run(format: Format) {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'working', format });
    try {
      const response = await fetch(`/pharmacy/reports/export?${new URLSearchParams({ ...params, format }).toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        let failure: StudioFailure | null = null;
        try {
          failure = ((await response.json()) as { error?: StudioFailure }).error ?? null;
        } catch {
          failure = null;
        }
        setState({ kind: 'failed', message: failure ? phMessage(t, locale, failure, 'pharmacy.reports') : t('pharmacy.reports.export.failed') });
        return;
      }
      const blob = await response.blob();
      const fileName = fileNameOf(response.headers.get('content-disposition')) ?? `pharmacy-report.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      // Not at once: a browser may still be starting the download (Firefox cancels it when the address goes away first).
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setState({ kind: 'done', fileName });
    } catch {
      setState({ kind: 'failed', message: t('pharmacy.reports.export.network') });
    } finally {
      busy.current = false;
    }
  }

  const working = state.kind === 'working';
  return (
    <div data-testid="report-export" role="group" aria-label={t('pharmacy.reports.export.title')} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="export-csv" disabled={working} onClick={() => void run('csv')} className={BUTTON}>
          <Download aria-hidden />
          {t('pharmacy.reports.export.csv')}
        </button>
        <button type="button" data-testid="export-xlsx" disabled={working} onClick={() => void run('xlsx')} className={BUTTON}>
          <FileSpreadsheet aria-hidden />
          {t('pharmacy.reports.export.xlsx')}
        </button>
      </div>
      <p className="text-xs text-muted">{t('pharmacy.reports.export.sameFilters')}</p>
      <div aria-live="polite" className="min-w-0">
        {state.kind === 'working' && (
          <p data-testid="export-working" className="flex items-start gap-2.5 text-sm text-text">
            <Hourglass aria-hidden className="mt-px size-4 shrink-0" />
            {t('pharmacy.reports.export.working')}
          </p>
        )}
        {state.kind === 'done' && (
          <p data-testid="export-done" className="flex items-start gap-2.5 text-sm text-text">
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">
              {t('pharmacy.reports.export.done')} <bdi dir="ltr">{state.fileName}</bdi>
            </span>
          </p>
        )}
      </div>
      {state.kind === 'failed' && (
        <p role="alert" data-testid="export-error" className="flex items-start gap-2.5 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-sm text-text">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
          <span className="min-w-0">{state.message}</span>
        </p>
      )}
    </div>
  );
}
