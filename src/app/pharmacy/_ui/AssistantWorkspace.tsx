'use client';

import { CircleAlert, Hourglass, Lock, Package, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type ComponentProps } from 'react';
import { askAssistant, createProposal } from '@/app/pharmacy/_actions/assistant';
import { stockBalances } from '@/app/pharmacy/_actions/stock';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';
import type { SearchResult } from '@/server/pharmacy/search';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field, useFieldProps } from '@/studio/ui/Field';
import { AssistantResult } from './AssistantResult';
import { questionState, STARTERS, type AnswerLite, type Starter } from './assistant-logic';
import type { ProposeArgs } from './assistant-tables';
import { OfflineNotice } from './OfflineNotice';
import { phDate } from './ph-date';
import { phMessage } from './ph-failure';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { isolate, type Writable } from './WriteBlocked';

export interface AssistantWorkspaceProps {
  branches: Array<{ id: string; name: string }>;
  caps: { ai: boolean; transfer: boolean; purchase: boolean };
  /** Whether proposals may be made now (the `ai.use` key, an open pharmacy). Asking is allowed whatever this says. */
  writable: Writable;
  /** Whether the role may run the forecast (reports). */
  forecast: boolean;
}

function AssistantTextarea(props: ComponentProps<'textarea'>) {
  const field = useFieldProps();
  return <textarea {...field} {...props} />;
}

const DAYS = [30, 60, 90, 180] as const;
type Batch = { batchId: string; lot: string; expiryDate: string };

/**
 * The assistant: a question box, filters limited to the person's own branches, a product (for a forecast, and to pick a batch for the
 * transfer question) and six starter questions that run their tool directly, with no model. Nothing typed here is kept: no storage, no
 * address. The answer is the tables first; prose appears only when the server checked it against them.
 */
export function AssistantWorkspace({ branches, caps, writable, forecast }: AssistantWorkspaceProps) {
  const t = useT();
  const { locale } = useLocale();
  const boxRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState('');
  const [branchId, setBranchId] = useState('');
  const [days, setDays] = useState<(typeof DAYS)[number]>(90);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ value: AnswerLite; days: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Record<string, 'pending' | 'done'>>({});
  const [made, setMade] = useState<string[]>([]);
  const [proposeProblem, setProposeProblem] = useState<string | null>(null);

  const names = new Map(branches.map((b) => [b.id, b.name]));
  const branchName = (id: string) => names.get(id) ?? t('pharmacy.assistant.otherBranch');
  const q = questionState(question);
  const periodSet = from !== '' || to !== '';
  const periodBad = periodSet && (from === '' || to === '' || from > to);

  const pickProduct = async (found: SearchResult): Promise<string | null> => {
    setProduct({ id: found.productId, name: found.label });
    setBatchId('');
    setBatches([]);
    const result = await settle(() => stockBalances({ productId: found.productId, pageSize: 1 }));
    if (result.ok) {
      const row = (result.data as { items: ProductBalance[] }).items[0];
      setBatches((row?.batches ?? []).filter((b) => b.status === 'ACTIVE').map((b) => ({ batchId: b.batchId, lot: b.lot, expiryDate: b.expiryDate })));
    }
    return null;
  };

  const run = async (text: string, extra: { batch?: boolean; direct?: boolean } = {}) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setProposeProblem(null);
    const result = await settle(() =>
      askAssistant({
        question: text,
        ...(branchId ? { branchId } : {}),
        days,
        ...(periodSet && !periodBad ? { period: { from, to } } : {}),
        ...(product ? { productId: product.id } : {}),
        ...(extra.batch && batchId ? { batchId } : {}),
        ...(extra.direct ? { direct: true } : {}),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setAnswer(null);
      setProblem(phMessage(t, locale, result.error, 'pharmacy.assistant'));
      return;
    }
    setProposed({});
    setMade([]);
    setAnswer({ value: result.data as AnswerLite, days });
  };

  const propose = async (args: ProposeArgs) => {
    setProposed((p) => ({ ...p, [args.rowKey]: 'pending' }));
    setProposeProblem(null);
    const result = await settle(() => createProposal({ proposal: args.proposal, branchId: args.branchId }));
    if (!result.ok) {
      setProposed((p) => {
        const rest = { ...p };
        delete rest[args.rowKey];
        return rest;
      });
      setProposeProblem(phMessage(t, locale, result.error, 'pharmacy.assistant'));
      return;
    }
    setProposed((p) => ({ ...p, [args.rowKey]: 'done' }));
    setMade((m) => [...m, (result.data as { id: string }).id]);
  };

  const starterDisabled = (s: Starter) => busy || (s.needs === 'batch' && !batchId);
  const blockedText =
    writable.ok || !caps.ai
      ? null
      : writable.reason === 'readOnly'
        ? t('pharmacy.assistant.blocked.readOnly', { date: phDate(writable.until, locale) })
        : t(`pharmacy.assistant.blocked.${writable.reason}`);

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="assistant">
      <OfflineNotice />
      {blockedText && (
        <p data-testid="assistant-write-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
          <Lock aria-hidden className="text-muted" />
          <span className="min-w-0">{blockedText}</span>
        </p>
      )}
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.assistant.privacy')}</p>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!q.empty && !q.tooLong) void run(question.trim(), { batch: true });
        }}
      >
        <Field label={t('pharmacy.assistant.question')} hint={t('pharmacy.assistant.questionHint')} {...(q.tooLong ? { error: t('pharmacy.assistant.tooLong') } : {})}>
          <AssistantTextarea
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            data-testid="assistant-question"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} py-2`}
          />
        </Field>
        <p className={`text-sm tabular-nums ${q.tooLong ? 'font-medium text-danger' : 'text-muted'}`} data-testid="assistant-counter" aria-live="polite">
          {t('pharmacy.assistant.counter', { used: q.length, max: 1000 })}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('pharmacy.assistant.branch')}>
            <FieldSelect className={`${FIELD} pe-8`} value={branchId} onChange={(event) => setBranchId(event.target.value)} data-testid="assistant-branch">
              <option value="">{t('pharmacy.assistant.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {isolate(b.name)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t('pharmacy.assistant.days')}>
            <FieldSelect className={`${FIELD} pe-8`} value={String(days)} onChange={(event) => setDays(Number(event.target.value) as (typeof DAYS)[number])} data-testid="assistant-days">
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t('pharmacy.assistant.daysOption', { n: d })}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t('pharmacy.assistant.from')} {...(periodBad ? { error: t('pharmacy.assistant.periodBad') } : {})}>
            <FieldInput type="date" dir="ltr" className={FIELD} value={from} onChange={(event) => setFrom(event.target.value)} data-testid="assistant-from" />
          </Field>
          <Field label={t('pharmacy.assistant.to')}>
            <FieldInput type="date" dir="ltr" className={FIELD} value={to} onChange={(event) => setTo(event.target.value)} data-testid="assistant-to" />
          </Field>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="assistant-product">
          <p className="text-sm font-medium text-text">{t('pharmacy.assistant.product')}</p>
          <p className="text-sm text-muted">{t('pharmacy.assistant.productHint')}</p>
          {product ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm text-text" data-testid="assistant-product-chosen">
                <Package aria-hidden className="size-4 shrink-0 text-muted" />
                <bdi dir="auto">{product.name}</bdi>
              </span>
              <button
                type="button"
                className={TOUCH_BTN}
                onClick={() => {
                  setProduct(null);
                  setBatches([]);
                  setBatchId('');
                }}
              >
                <X aria-hidden className="size-4" />
                {t('pharmacy.assistant.productClear')}
              </button>
              <Field label={t('pharmacy.assistant.batch')}>
                <FieldSelect className={`${FIELD} pe-8`} value={batchId} onChange={(event) => setBatchId(event.target.value)} data-testid="assistant-batch">
                  <option value="">{t('pharmacy.assistant.batchNone')}</option>
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {isolate(b.lot)} · {b.expiryDate}
                    </option>
                  ))}
                </FieldSelect>
              </Field>
            </div>
          ) : (
            <ReceiptProductPicker boxRef={boxRef} onPick={pickProduct} />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className={TOUCH_PRIMARY} disabled={busy || q.empty || q.tooLong} data-testid="assistant-ask">
            {busy ? <Hourglass aria-hidden className="size-4" /> : <Send aria-hidden className="size-4 rtl:-scale-x-100" />}
            {t(busy ? 'pharmacy.assistant.asking' : 'pharmacy.assistant.ask')}
          </button>
        </div>
      </form>

      <section aria-label={t('pharmacy.assistant.starters')} className="flex flex-col gap-2">
        <h2 className="text-md font-semibold text-text">{t('pharmacy.assistant.starters')}</h2>
        <ul className="flex flex-wrap gap-2" data-testid="assistant-starters">
          {STARTERS.map((s) => (
            <li key={s.tool}>
              <button type="button" className={TOUCH_BTN} disabled={starterDisabled(s)} data-testid={`starter-${s.tool}`} onClick={() => void run(s.question, { batch: true, direct: true })}>
                {t(`pharmacy.assistant.starter.${s.tool}`)}
              </button>
            </li>
          ))}
          {forecast && (
            <li>
              <button type="button" className={TOUCH_BTN} disabled={busy || !product} data-testid="starter-forecast" onClick={() => void run('Forecast the demand for next week', { direct: true })}>
                {t('pharmacy.assistant.starter.forecast')}
              </button>
            </li>
          )}
        </ul>
        {STARTERS.some((s) => s.needs === 'batch' && !batchId) && <p className="text-sm text-muted">{t('pharmacy.assistant.starterNeeds')}</p>}
      </section>

      {problem && (
        <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="assistant-problem">
          {problem}
        </Note>
      )}
      {busy && !answer && (
        <Note icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.assistant.asking')}
        </Note>
      )}
      {answer && (
        <AssistantResult
          answer={answer.value}
          branchName={branchName}
          caps={{ ...caps, writable: writable.ok }}
          days={answer.days}
          onPropose={(args) => void propose(args)}
          proposed={proposed}
          footer={
            <>
              {!writable.ok && caps.ai && <p className="text-xs text-muted">{t('pharmacy.assistant.proposalsOff')}</p>}
              {proposeProblem && (
                <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="propose-problem">
                  {proposeProblem}
                </Note>
              )}
              {made.length > 0 && (
                <div className="flex flex-col gap-1.5" data-testid="proposals-made">
                  <p className="text-sm text-text">{t('pharmacy.assistant.propose.saved', { n: made.length })}</p>
                  <Link href={`/pharmacy/assistant/proposals/${made[made.length - 1]}`} data-testid="proposal-review-link" className={`${TOUCH_BTN} w-fit`}>
                    {t('pharmacy.assistant.propose.review')}
                  </Link>
                </div>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
