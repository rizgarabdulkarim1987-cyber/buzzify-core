import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber } from '@/lib/pos-format';
import { bpPercent, formatMinor, type Currency, type Notice } from './reports-logic';

/**
 * The building blocks of the report and chain screens (server rendered, no motion). Every figure is text: money from the exact
 * strings the server sends (never summed here), numbers in Latin digits, names isolated so they never reorder a sentence,
 * every notice an icon beside words. A wide table scrolls inside its own labelled region, never the page.
 */

export const Money = ({ minor, currency, testid }: { minor: string; currency: Currency; testid?: string }) => (
  <bdi dir="ltr" className="tabular-nums" data-testid={testid}>
    {formatMinor(minor, currency)}
  </bdi>
);
export const Num = ({ value, testid }: { value: number; testid?: string }) => (
  <bdi dir="ltr" className="tabular-nums" data-testid={testid}>
    {formatNumber(value)}
  </bdi>
);
export const Pct = ({ bp, none }: { bp: number | null; none: string }) =>
  bp === null ? <span className="text-muted">{none}</span> : (
    <bdi dir="ltr" className="tabular-nums">
      {bpPercent(bp)}
    </bdi>
  );
export const Name = ({ children }: { children: ReactNode }) => (
  <bdi dir="auto" className="[overflow-wrap:anywhere]">
    {children}
  </bdi>
);
export const Day = ({ day }: { day: string }) => (
  <bdi dir="ltr" className="tabular-nums">
    {day}
  </bdi>
);

/** A sentence about how to read the figures below it: an icon and words, in a warning or an information tone. */
export function NoticeLine({ notice, t }: { notice: Notice; t: Translate }) {
  const Icon = notice.tone === 'warn' ? TriangleAlert : Info;
  return (
    <p data-testid="report-notice" data-notice={notice.key} role="note" className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm text-text ${notice.tone === 'warn' ? 'border-ink bg-raised font-medium' : 'border-line bg-surface'}`}>
      <Icon aria-hidden className="mt-px size-4 shrink-0" />
      <span className="min-w-0">{t(`pharmacy.reports.notice.${notice.key}`, { count: notice.count === undefined ? '' : formatNumber(notice.count) })}</span>
    </p>
  );
}

/** Something that cannot be shown: the figure is missing, not zero. */
export function Unavailable({ t }: { t: Translate }) {
  return (
    <span data-testid="unavailable" className="inline-flex items-center gap-1.5 text-sm text-muted">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {t('pharmacy.reports.unavailable')}
    </span>
  );
}

export function Section({ title, hint, children, testid }: { title: string; hint?: string; children: ReactNode; testid?: string }) {
  return (
    <section data-testid={testid} aria-label={title} className="flex min-w-0 flex-col gap-2.5">
      <h2 className="text-md font-semibold text-text">{title}</h2>
      {hint && <p className="max-w-[72ch] text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

/** Figures as a definition list: label above, value below, wrapping on a phone. */
export function Figures({ items, testid }: { items: Array<{ label: string; value: ReactNode; strong?: boolean; testid?: string }>; testid?: string }) {
  return (
    <dl data-testid={testid} className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5" data-testid={item.testid}>
          <dt className="text-xs font-medium text-muted">{item.label}</dt>
          <dd className={`min-w-0 break-words ${item.strong ? 'text-lg font-semibold' : 'text-base'} text-text`}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface Col {
  h: string;
  /** A figure column: aligned to the end, tabular. */
  num?: boolean;
}

/**
 * A table in its own scroll region, with a visible caption that names it and says it scrolls sideways when it is wider than the
 * screen. The first cell of each row is the row header.
 */
export function Tbl({ caption, cols, rows, testid, scrollHint }: { caption: string; cols: Col[]; rows: ReactNode[][]; testid?: string; scrollHint: string }) {
  return (
    <div data-testid={testid} className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium text-text">{caption}</p>
      <div role="region" aria-label={`${caption}. ${scrollHint}`} tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-surface">
              {cols.map((c, i) => (
                <th key={i} scope="col" className={`whitespace-nowrap border-b border-line px-3 py-2.5 text-xs font-semibold text-muted ${c.num ? 'text-end' : 'text-start'}`}>
                  {c.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} data-testid="report-row" className="border-b border-line last:border-b-0">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="min-h-11 px-3 py-2.5 text-start font-medium text-text">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className={`px-3 py-2.5 text-text ${cols[i]?.num ? 'whitespace-nowrap text-end' : 'text-start'}`}>
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{scrollHint}</p>
    </div>
  );
}
