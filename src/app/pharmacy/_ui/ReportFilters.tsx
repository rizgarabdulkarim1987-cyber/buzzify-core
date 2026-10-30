'use client';

import { CircleAlert, Clock, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useT } from '@/studio/i18n';
import { filtersKey, isLongRange, PRESETS, type Preset } from './reports-logic';

/**
 * The filter bar of a report or of the chain page. A plain GET form: the address carries the filters (shareable, and it works
 * before the page's scripts have loaded), a preset is a link, a bad value is said under its field. The only script is the
 * "may take a few seconds" hint, which follows the dates as they are typed. No motion.
 */
export interface FilterField {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}

const CONTROL = 'min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-raised px-3 text-base text-text aria-[invalid=true]:border-danger';

type Props = {
  action: string;
  dated: boolean;
  from: string;
  to: string;
  fields: FilterField[];
  presetHrefs: Record<Preset, string>;
  problems: Record<string, string>;
  branchNote?: string;
};

/** Keyed by what the address says, so a preset or a new address (a soft navigation) starts the form again from the new values instead of keeping the typed ones. */
export function ReportFilters(props: Props) {
  return <FiltersForm key={filtersKey(props)} {...props} />;
}

function FiltersForm({
  action,
  dated,
  from,
  to,
  fields,
  presetHrefs,
  problems,
  branchNote,
}: {
  action: string;
  dated: boolean;
  from: string;
  to: string;
  fields: FilterField[];
  presetHrefs: Record<Preset, string>;
  /** Messages by field name (`from`, `to`, `branch`, `currency`, `group`, `status`). */
  problems: Record<string, string>;
  /** Said under the branch choice when the person's place already narrows the report. */
  branchNote?: string;
}) {
  const t = useT();
  const id = useId();
  const [range, setRange] = useState({ from, to });
  const long = dated && isLongRange(range.from, range.to);
  const err = (name: string) => problems[name];
  const describe = (name: string) => (err(name) ? `${id}-${name}-err` : undefined);
  return (
    <form method="get" action={action} data-testid="report-filters" aria-label={t('pharmacy.reports.filter.title')} className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3 sm:p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-text">
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.reports.filter.title')}
      </p>
      {dated && (
        <>
          <nav aria-label={t('pharmacy.reports.filter.presets')} className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Link key={p} href={presetHrefs[p]} data-testid={`preset-${p}`} className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-text hover:bg-hover">
                {t(`pharmacy.reports.preset.${p}`)}
              </Link>
            ))}
          </nav>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['from', 'to'] as const).map((name) => (
              <div key={name} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${id}-${name}`} className="text-sm font-medium text-text">
                  {t(`pharmacy.reports.filter.${name}`)}
                </label>
                <input
                  id={`${id}-${name}`}
                  name={name}
                  type="date"
                  required
                  value={range[name]}
                  onChange={(event) => setRange((r) => ({ ...r, [name]: event.target.value }))}
                  aria-invalid={err(name) ? true : undefined}
                  aria-describedby={describe(name)}
                  data-testid={`filter-${name}`}
                  className={CONTROL}
                />
                {err(name) && (
                  <p id={`${id}-${name}-err`} data-testid={`filter-error-${name}`} className="flex items-start gap-1.5 text-sm text-danger">
                    <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                    <span className="min-w-0">{err(name)}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">{t('pharmacy.reports.filter.rangeNote')}</p>
          {long && (
            <p role="status" data-testid="long-range-hint" className="flex items-start gap-2.5 rounded-md border border-line bg-raised px-3 py-2.5 text-sm text-text">
              <Clock aria-hidden className="mt-px size-4 shrink-0" />
              <span className="min-w-0">{t('pharmacy.reports.filter.longRange')}</span>
            </p>
          )}
        </>
      )}
      {fields.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <div key={f.name} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-${f.name}`} className="text-sm font-medium text-text">
                {f.label}
              </label>
              <select id={`${id}-${f.name}`} name={f.name} defaultValue={f.value} aria-invalid={err(f.name) ? true : undefined} aria-describedby={describe(f.name)} data-testid={`filter-${f.name}`} className={CONTROL}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {err(f.name) && (
                <p id={`${id}-${f.name}-err`} data-testid={`filter-error-${f.name}`} className="flex items-start gap-1.5 text-sm text-danger">
                  <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                  <span className="min-w-0">{err(f.name)}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {branchNote && <p data-testid="branch-note" className="text-sm text-muted">{branchNote}</p>}
      <div>
        <button type="submit" data-testid="filter-apply" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-base font-medium text-on-ink hover:bg-ink-hover">
          {t('pharmacy.reports.filter.apply')}
        </button>
      </div>
    </form>
  );
}
