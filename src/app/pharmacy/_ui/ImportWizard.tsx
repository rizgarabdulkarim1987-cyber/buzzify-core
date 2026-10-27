'use client';

import { CircleAlert, CircleCheck, FileUp, Hourglass, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { applyImport } from '@/app/pharmacy/_actions/catalog';
import type { ProductColumn } from '@/server/domain/pharmacy/import-products';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { formatDate } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { wholeOf } from './product-draft';
import { isolate } from './WriteBlocked';

/** The columns an import reads (`PRODUCT_COLUMNS` of the import rules, which run on the server only). */
const COLUMNS: readonly ProductColumn[] = [
  'tradeName',
  'genericName',
  'activeIngredient',
  'strength',
  'form',
  'manufacturer',
  'category',
  'rxLevel',
  'packLabel',
  'unitsPerPack',
  'barcode',
  'salePrice',
  'currency',
  'minQty',
  'shelfLocation',
];

/** The largest file the server reads; a bigger one is refused here before it is sent. */
const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_URL = '/pharmacy/catalog/import/preview';

interface Issue {
  code: string;
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface Preview {
  batchId: string;
  batchHash: string;
  headers: string[];
  suggestedMapping: Record<string, string | null>;
  mapping: Record<string, string | null>;
  summary: { ok: number; warnings: number; errors: number; duplicates: number; rows: number };
  firstRowsWithIssues: { rowNumber: number; status: 'ok' | 'warning' | 'error' | 'duplicate'; issues: Issue[] }[];
}

interface Applied {
  created: number;
  prices: number;
  skipped: number;
  excluded: number;
  alreadyApplied: boolean;
}

const SEVERITY_ICON: Record<Issue['severity'], ReactNode> = {
  error: <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />,
  warning: <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-text" />,
  info: <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />,
};

/**
 * The catalog import: choose a file (CSV or Excel, at most 5 MB and 10,000 rows) and defaults for empty cells, see how
 * its columns were matched and change them, check the rows with problems in the person's words, then import the ready
 * rows in one go. The file goes to a Route Handler (a Server Action's body is limited to 1 MB); nothing is saved before
 * the last step, and rows with errors are left out of it. No motion.
 */
export function ImportWizard({ canSetPrices }: { canSetPrices: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [rx, setRx] = useState('');
  const [packLabel, setPackLabel] = useState('');
  const [perPack, setPerPack] = useState('');
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const column = (name: string) => t(`pharmacy.import.column.${name}`);

  const choose = (chosen: File | null) => {
    setPreview(null);
    setMapping(null);
    setDuplicateOf(null);
    setProblem(null);
    setApplied(null);
    if (chosen && chosen.size > MAX_BYTES) {
      setFile(null);
      setFileProblem(t('pharmacy.import.tooBig'));
      return;
    }
    setFileProblem(null);
    setFile(chosen);
  };

  const send = async (withMapping: Record<string, string | null> | null) => {
    if (!file) return setFileProblem(t('pharmacy.import.chooseFirst'));
    const perPackNumber = perPack.trim() === '' ? undefined : wholeOf(perPack);
    if (perPackNumber === null || perPackNumber === 0) return setProblem(t('pharmacy.catalog.field.wholeNumber'));
    const form = new FormData();
    form.append('file', file, file.name);
    if (withMapping) form.append('mapping', JSON.stringify(withMapping));
    const defaults = {
      ...(rx ? { rxLevel: rx } : {}),
      ...(packLabel.trim() ? { packLabel: packLabel.trim() } : {}),
      ...(perPackNumber !== undefined ? { unitsPerPack: perPackNumber } : {}),
    };
    if (Object.keys(defaults).length > 0) form.append('defaults', JSON.stringify(defaults));
    if (duplicateOf && overrideReason.trim()) form.append('overrideReason', overrideReason.trim());

    setPending(true);
    setProblem(null);
    let result: ActionResult<Preview>;
    try {
      const response = await fetch(PREVIEW_URL, { method: 'POST', body: form });
      result = (await response.json()) as ActionResult<Preview>;
    } catch {
      setPending(false);
      setProblem(t('pharmacy.import.failed'));
      return;
    }
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'DUPLICATE_IMPORT') {
        setDuplicateOf(result.error.fields.importedAt ?? '');
        setPreview(null);
        return;
      }
      setProblem(describeFailure(t, locale, result.error).message);
      return;
    }
    setDuplicateOf(null);
    setPreview(result.data);
    setMapping(result.data.mapping);
    setAcceptWarnings(false);
  };

  const errorRows = preview?.firstRowsWithIssues.filter((row) => row.status === 'error').map((row) => row.rowNumber) ?? [];
  const unknownErrors = preview ? preview.summary.errors > errorRows.length : false;

  const apply = async () => {
    if (!preview) return;
    setPending(true);
    const result = await settle(() =>
      applyImport({ batchId: preview.batchId, batchHash: preview.batchHash, acceptWarnings, excludeRowNumbers: errorRows }),
    );
    setPending(false);
    if (!result.ok) {
      setProblem(describeFailure(t, locale, result.error).message);
      return;
    }
    setApplied(result.data as Applied);
  };

  // Header notes: a name used twice (the first is read), and several headers matched to one column (the first is read).
  const repeated = preview ? [...new Set(preview.headers.filter((h, i) => preview.headers.indexOf(h) !== i))] : [];
  const byColumn = new Map<string, string[]>();
  for (const [header, target] of Object.entries(mapping ?? {})) {
    if (target) byColumn.set(target, [...(byColumn.get(target) ?? []), header]);
  }
  const doubled = [...byColumn.entries()].filter(([, headers]) => headers.length > 1);
  const mappingChanged = preview !== null && mapping !== null && JSON.stringify(mapping) !== JSON.stringify(preview.mapping);

  if (applied) {
    return (
      <div className="flex flex-col gap-4 py-6">
        <Alert tone="success">
          <p className="font-medium">{applied.alreadyApplied ? t('pharmacy.import.already') : t('pharmacy.import.done', { created: applied.created })}</p>
          {!applied.alreadyApplied && (
            <p>{t('pharmacy.import.doneDetail', { prices: applied.prices, skipped: applied.skipped, excluded: applied.excluded })}</p>
          )}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Link href="/pharmacy/catalog" className={buttonClasses('primary', 'md')}>
            {t('pharmacy.import.toCatalog')}
          </Link>
          <Button onClick={() => choose(null)}>{t('pharmacy.import.another')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <FormSection id="import-upload" title={t('pharmacy.import.step.upload')} intro={t('pharmacy.import.intro')}>
        {!canSetPrices && (
          <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.import.noPrices')}</span>
          </p>
        )}
        <Field label={t('pharmacy.import.file')} hint={t('pharmacy.import.fileHint')} error={fileProblem ?? undefined}>
          <Input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="h-auto py-1.5"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-text">{t('pharmacy.import.defaults')}</legend>
          <p className="text-sm text-muted">{t('pharmacy.import.defaultsIntro')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('pharmacy.import.defaultRx')}>
              <Select
                value={rx}
                onChange={(e) => setRx(e.target.value)}
                options={[
                  { value: '', label: t('pharmacy.import.defaultNone') },
                  ...(['OTC', 'RX', 'RESTRICTED'] as const).map((value) => ({ value, label: t(`pharmacy.catalog.rx.${value}`) })),
                ]}
              />
            </Field>
            <Field label={t('pharmacy.import.defaultPack')} optional>
              <Input dir="auto" maxLength={40} value={packLabel} onChange={(e) => setPackLabel(e.target.value)} />
            </Field>
            <Field label={t('pharmacy.import.defaultPerPack')} optional>
              <Input inputMode="numeric" dir="ltr" value={perPack} onChange={(e) => setPerPack(e.target.value)} />
            </Field>
          </div>
        </fieldset>
        {duplicateOf !== null && (
          <div data-testid="import-duplicate" role="alert" className="flex flex-col gap-3 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
            <p className="flex items-start gap-2.5">
              <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span>{t('pharmacy.import.duplicateFile', { date: duplicateOf ? formatDate(duplicateOf, locale) : '' })}</span>
            </p>
            <Field label={t('pharmacy.import.overrideReason')}>
              <Input dir="auto" maxLength={200} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            </Field>
          </div>
        )}
        {problem && (
          <Alert tone="danger" key={problem}>
            {problem}
          </Alert>
        )}
        <div>
          <Button variant="primary" icon={<FileUp aria-hidden />} pending={pending && !preview} onClick={() => void send(null)}>
            {duplicateOf !== null ? t('pharmacy.import.previewAnyway') : t('pharmacy.import.preview')}
          </Button>
          {pending && (
            <span role="status" className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted">
              <Hourglass aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.import.sending')}
            </span>
          )}
        </div>
      </FormSection>

      {preview && (
        <>
          <FormSection id="import-mapping" title={t('pharmacy.import.step.mapping')}>
            {repeated.map((header) => (
              <Alert key={`repeat-${header}`}>{t('pharmacy.import.repeatedHeader', { header: isolate(header) })}</Alert>
            ))}
            {doubled.map(([target, headers]) => (
              <Alert key={`double-${target}`}>
                {t('pharmacy.import.doubleMapped', { headers: headers.map(isolate).join(', '), column: column(target) })}
              </Alert>
            ))}
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {Object.keys(mapping ?? {}).map((header) => (
                <li key={header} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center">
                  <span className="min-w-0 break-words text-sm text-text" dir="auto">
                    {header}
                  </span>
                  <Select
                    aria-label={`${t('pharmacy.import.mapping.target')}: ${header}`}
                    value={mapping?.[header] ?? ''}
                    onChange={(e) => setMapping({ ...(mapping ?? {}), [header]: e.target.value === '' ? null : e.target.value })}
                    options={[{ value: '', label: t('pharmacy.import.mapping.none') }, ...COLUMNS.map((c) => ({ value: c, label: column(c) }))]}
                  />
                </li>
              ))}
            </ul>
            {mappingChanged && (
              <div>
                <Button pending={pending} onClick={() => void send(mapping)}>
                  {t('pharmacy.import.previewAgain')}
                </Button>
              </div>
            )}
          </FormSection>

          <FormSection id="import-preview" title={t('pharmacy.import.step.preview')} intro={t('pharmacy.import.rowsIntro')}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(['rows', 'ok', 'warnings', 'errors', 'duplicates'] as const).map((key) => (
                <div key={key} className="flex flex-col gap-0.5 rounded-md border border-line px-3 py-2">
                  <dt className="text-xs text-muted">{t(`pharmacy.import.summary.${key}`)}</dt>
                  <dd className="text-md font-semibold text-text tabular-nums">{preview.summary[key]}</dd>
                </div>
              ))}
            </dl>
            {preview.firstRowsWithIssues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-text">
                <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
                {t('pharmacy.import.noIssues')}
              </p>
            ) : (
              <ul aria-label={t('pharmacy.import.rows')} className="flex flex-col divide-y divide-line rounded-md border border-line">
                {preview.firstRowsWithIssues.map((row) => (
                  <li key={row.rowNumber} className="flex flex-col gap-2 px-3 py-2.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                      {t('pharmacy.import.row', { n: row.rowNumber })}
                      <StatusBadge tone={row.status === 'error' ? 'danger' : row.status === 'ok' ? 'success' : 'neutral'}>
                        {t(`pharmacy.import.status.${row.status}`)}
                      </StatusBadge>
                    </p>
                    <ul className="flex flex-col gap-1">
                      {row.issues.map((issue, i) => {
                        const key = `pharmacy.import.issue.${issue.code}`;
                        const words = t(key, { field: column(issue.field) });
                        return (
                          <li key={i} className="flex items-start gap-2 text-sm text-text">
                            {SEVERITY_ICON[issue.severity]}
                            <span className="min-w-0">{words === key ? issue.message : words}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {preview.summary.warnings > 0 && (
              <Checkbox label={t('pharmacy.import.acceptWarnings')} checked={acceptWarnings} onChange={(e) => setAcceptWarnings(e.target.checked)} />
            )}
            {errorRows.length > 0 && !unknownErrors && <p className="text-sm text-text">{t('pharmacy.import.leftOut', { count: errorRows.length })}</p>}
            {unknownErrors && (
              <Alert tone="danger">{t('pharmacy.import.unknownErrors')}</Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" pending={pending} disabled={unknownErrors || mappingChanged} onClick={() => void apply()}>
                {pending ? t('pharmacy.import.applying') : t('pharmacy.import.apply')}
              </Button>
            </div>
          </FormSection>
        </>
      )}
    </div>
  );
}
