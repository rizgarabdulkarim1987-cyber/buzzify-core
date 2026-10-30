'use client';

import { Ban, Bot, CircleAlert, CircleHelp, Info, Link2, Lock, Sparkles, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AssistantTool } from '@/server/domain/pharmacy/assistant-domain';
import { useT } from '@/studio/i18n';
import { describeAnswer, type AnswerLite } from './assistant-logic';
import { ToolTable, type ProposeArgs, type TableCaps } from './assistant-tables';
import { Day, Name } from './reports-parts';
import { Chip } from './sell-parts';

const NOTICE_ICON = { noAi: Lock, noTool: CircleHelp, budget: TriangleAlert, provider: CircleAlert, ungrounded: TriangleAlert, unavailable: Info } as const;
const BOX = 'flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';

/** Where the table's source screen is, with the filters the question used. No person's data is in any address. */
function linkFor(tool: AssistantTool, answer: AnswerLite, days: number | null): string {
  const query = new URLSearchParams();
  const branch = answer.branches.length === 1 ? answer.branches[0] : undefined;
  switch (tool) {
    case 'batches_expiring':
      if (days) query.set('days', String(days));
      return `/pharmacy/stock/expiry${query.size ? `?${query}` : ''}`;
    case 'stock_below_reorder':
      if (branch) query.set('branch', branch);
      return `/pharmacy/reports/low-stock${query.size ? `?${query}` : ''}`;
    case 'margin_change':
      if (answer.period) {
        query.set('from', answer.period.from);
        query.set('to', answer.period.to);
      }
      if (branch) query.set('branch', branch);
      return `/pharmacy/reports/margin${query.size ? `?${query}` : ''}`;
    case 'slow_movers':
      return '/pharmacy/stock';
    case 'transfer_candidates':
      return '/pharmacy/stock/transfers';
    case 'unpaid_supplier_invoices':
      return '/pharmacy/purchasing/payables';
  }
}

/**
 * One answer: the model's prose only when it was checked against the tables, every degraded state in words with an icon, a refusal as a
 * plain explanation, and always the tables (the source of truth) with the period, the branches, the time the data was read, the
 * fact or estimate label and the link to the matching screen. No raw code is shown. No motion.
 */
export function AssistantResult({
  answer,
  branchName,
  caps,
  days,
  onPropose,
  proposed,
  footer,
}: {
  answer: AnswerLite;
  branchName: (id: string) => string;
  caps: TableCaps;
  days: number | null;
  onPropose: (a: ProposeArgs) => void;
  proposed: Record<string, 'pending' | 'done'>;
  footer?: ReactNode;
}) {
  const t = useT();
  const view = describeAnswer(answer);
  const asOf = answer.dataAsOf.slice(0, 16).replace('T', ' ');
  return (
    <section aria-label={t('pharmacy.assistant.result')} data-testid="assistant-result" data-label={answer.label} className="flex min-w-0 flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="result-facts">
        <Chip icon={answer.label === 'estimate' ? <Sparkles aria-hidden /> : <Info aria-hidden />} testId="result-label">
          {t(answer.label === 'estimate' ? 'pharmacy.assistant.label.estimate' : 'pharmacy.assistant.label.fact')}
        </Chip>
        {answer.period && (
          <span className="text-sm text-muted" data-testid="result-period">
            {t('pharmacy.assistant.period')}: <Day day={answer.period.from} /> – <Day day={answer.period.to} />
          </span>
        )}
        {answer.branches.length > 0 && (
          <span className="text-sm text-muted" data-testid="result-branches">
            {t('pharmacy.assistant.branches')}: {answer.branches.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Name>{branchName(id)}</Name>
              </span>
            ))}
          </span>
        )}
        <span className="text-sm text-muted" data-testid="result-asof">
          {t('pharmacy.assistant.asOf')}: <bdi dir="ltr">{asOf} UTC</bdi>
        </span>
      </div>

      {view.notices.map((n) => {
        const Icon = NOTICE_ICON[n];
        return (
          <p key={n} role="status" data-testid="assistant-notice" data-notice={n} className={BOX}>
            <Icon aria-hidden />
            <span className="min-w-0">{t(`pharmacy.assistant.notice.${n}`)}</span>
          </p>
        );
      })}

      {view.refusal && (
        <p role="status" data-testid="assistant-refusal" data-refusal={view.refusal} className={BOX}>
          {view.refusal === 'insufficientData' || view.refusal === 'productNeeded' ? <CircleHelp aria-hidden /> : <Ban aria-hidden />}
          <span className="min-w-0">{t(`pharmacy.assistant.refusal.${view.refusal}`)}</span>
        </p>
      )}

      {view.forecast && (
        <p data-testid="assistant-forecast" className={BOX}>
          <Sparkles aria-hidden />
          <span className="min-w-0">{t('pharmacy.assistant.forecast', { units: view.forecast.units, from: view.forecast.from, to: view.forecast.to, weeks: view.forecast.weeks })}</span>
        </p>
      )}

      {view.prose && (
        <div data-testid="assistant-prose" className="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Bot aria-hidden className="size-3.5" />
            {t('pharmacy.assistant.prose.label')}
          </p>
          <p className="whitespace-pre-line text-base text-text" dir="auto">
            {view.prose}
          </p>
        </div>
      )}

      {view.showTables ? (
        <div className="flex flex-col gap-4">
          {answer.tables.map((table) => (
            <div key={table.tool} className="flex min-w-0 flex-col gap-2" data-testid={`result-${table.tool}`}>
              <h3 className="text-md font-semibold text-text">{t(`pharmacy.assistant.tool.${table.tool}`)}</h3>
              <ToolTable output={table} branchName={branchName} caps={caps} t={t} onPropose={onPropose} proposed={proposed} />
              <Link href={linkFor(table.tool, answer, days)} data-testid="result-link" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
                <Link2 aria-hidden className="size-4 shrink-0" />
                {t('pharmacy.assistant.open')}
              </Link>
            </div>
          ))}
          <p className="text-xs text-muted">{t('pharmacy.assistant.tablesTruth')}</p>
        </div>
      ) : (
        !view.refusal && !view.forecast && <p className={BOX}>{t('pharmacy.assistant.noTables')}</p>
      )}
      {footer}
    </section>
  );
}
