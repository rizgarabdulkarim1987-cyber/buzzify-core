'use client';

import { CircleAlert, CircleCheck, Equal, EyeOff, Info, Minus, Plus, Save, SkipForward, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { approveCount, cancelCount, recordCounts, submitCount } from '@/app/pharmacy/_actions/counts';
import type { Translate } from '@/lib/i18n';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import type { CountDetail, CountLineView } from '@/server/pharmacy/counts';
import type { StudioFailure } from '@/server/studio/framework/result';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import { countedIn, digitsOf, entriesOf, summarise, unsavedEntries, type CountEntries } from './count-draft';
import { phMessage } from './ph-failure';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';

export interface CountWorkspaceProps {
  userId: string;
  restaurantId: string;
  count: CountDetail;
  /** May enter, save, submit and cancel here: stock.count, an open pharmacy and this count's branch chosen. */
  canCount: boolean;
  /** May approve here: stock.adjust, an open pharmacy and this count's branch chosen. */
  canApprove: boolean;
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))}`;
const Notice = ({ tone, testid, children }: { tone: 'info' | 'error' | 'ok'; testid?: string; children: ReactNode }) => (
  <p
    role={tone === 'error' ? 'alert' : 'status'}
    data-testid={testid}
    className={`flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0 ${
      tone === 'error' ? 'bg-danger-wash text-danger' : tone === 'ok' ? 'bg-success-wash text-success' : 'border border-line bg-surface text-text'
    }`}
  >
    {tone === 'error' ? <CircleAlert aria-hidden /> : tone === 'ok' ? <CircleCheck aria-hidden /> : <Info aria-hidden />}
    <span className="min-w-0">{children}</span>
  </p>
);

/** One difference as icon, sign and number (and a word), never a colour alone. */
export function DifferenceChip({ line, t }: { line: CountLineView; t: Translate }) {
  if (line.countedQty === null) return <span className="text-sm text-muted">{t('pharmacy.counts.diff.skipped')}</span>;
  const d = line.difference ?? 0;
  const base = 'inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';
  if (d === 0)
    return (
      <span data-diff="match" className={`${base} border-line-strong bg-surface text-text`}>
        <Equal aria-hidden />
        {t('pharmacy.counts.diff.match')}
      </span>
    );
  return (
    <span data-diff={d > 0 ? 'surplus' : 'shortage'} className={`${base} ${d > 0 ? 'border-transparent bg-info-wash text-text' : 'border-transparent bg-danger-wash text-danger'}`}>
      {d > 0 ? <Plus aria-hidden /> : <Minus aria-hidden />}
      <bdi dir="ltr" className="tabular-nums">
        {t(d > 0 ? 'pharmacy.counts.diff.surplus' : 'pharmacy.counts.diff.shortage', { n: formatNumber(Math.abs(d)) })}
      </bdi>
    </span>
  );
}

function LineIdentity({ line, t }: { line: CountLineView; t: Translate }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span dir="auto" className="min-w-0 break-words text-base font-semibold text-text">
        {line.productName}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted">{t('pharmacy.counts.col.lot')}</span>
          <bdi dir="ltr" data-testid="count-lot" className="font-medium text-text">
            {line.lot}
          </bdi>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted">{t('pharmacy.counts.col.expiry')}</span>
          <bdi dir="ltr" className="font-medium tabular-nums text-text">
            {ltr(formatExpiry({ expiryDate: line.expiryDate, expiryPrecision: line.expiryPrecision }))}
          </bdi>
        </span>
      </span>
      {line.quarantine > 0 && (
        <span data-testid="count-quarantine" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <Info aria-hidden />
          {t('pharmacy.counts.line.quarantine', { n: formatNumber(line.quarantine) })}
        </span>
      )}
      {line.reserved > 0 && (
        <span data-testid="count-reserved" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <Info aria-hidden />
          {t('pharmacy.counts.line.reserved', { n: formatNumber(line.reserved) })}
        </span>
      )}
      {!line.sellableHome && (
        <span data-testid="count-not-sellable" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <CircleAlert aria-hidden />
          {t('pharmacy.counts.line.notSellable')}
        </span>
      )}
    </div>
  );
}

const SheetLine = memo(function SheetLine({
  line,
  value,
  editable,
  label,
  expectedLabel,
  onChange,
  t,
}: {
  line: CountLineView;
  value: string;
  editable: boolean;
  label: string;
  expectedLabel: string;
  onChange: (lineId: string, value: string) => void;
  t: Translate;
}) {
  return (
    <li data-testid="count-line" data-line={line.lineId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 py-2.5">
      <LineIdentity line={line} t={t} />
      <div className="flex items-center gap-3">
        {line.expectedQty !== undefined && (
          <span className="flex items-baseline gap-1.5 text-sm">
            <span className="text-muted">{expectedLabel}</span>
            <bdi dir="ltr" data-testid="count-expected" className="font-medium tabular-nums text-text">
              {formatNumber(line.expectedQty)}
            </bdi>
          </span>
        )}
        {editable ? (
          <Input
            data-count-input
            aria-label={label}
            className="min-h-11 w-28 text-end tabular-nums"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            value={value}
            onChange={(event) => onChange(line.lineId, digitsOf(event.target.value))}
          />
        ) : (
          <bdi dir="ltr" className="min-w-12 text-end text-base font-semibold tabular-nums text-text">
            {line.countedQty === null ? '' : formatNumber(line.countedQty)}
          </bdi>
        )}
      </div>
    </li>
  );
});

/**
 * One count. While OPEN it is the counting sheet: a number per line (base units), Enter or the arrow keys move between
 * lines, what is typed is kept on this device and saved to the server with "Save counts"; "Submit count" saves first and
 * asks about the lines not counted. A blind count shows no expected quantity (the server sends none). Once SUBMITTED it is
 * the review: expected, counted and difference per line, and for a holder of stock.adjust the approval with a reason. The
 * server's refusals (stale count, someone else counting, a second person needed, not enough stock) are shown in words with
 * what to do next. No motion.
 */
export function CountWorkspace({ userId, restaurantId, count, canCount, canApprove }: CountWorkspaceProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const listRef = useRef<HTMLUListElement>(null);
  const open = count.status === 'OPEN';

  const server = useMemo(() => entriesOf(count.lines), [count.lines]);
  const draft = useDraft<CountEntries>(draftKey(userId, `count@${restaurantId}:${count.branchId}`, count.id), server);
  const entries = open && canCount ? draft.value : server;
  const unsaved = useMemo(() => (open && canCount ? unsavedEntries(count.lines, draft.value) : []), [open, canCount, count.lines, draft.value]);
  useLeaveGuard(unsaved.length > 0, t('pharmacy.catalog.leaveConfirm'));

  const valueRef = useRef(draft.value);
  useEffect(() => {
    valueRef.current = draft.value;
  }, [draft.value]);
  const { set: setDraft } = draft;
  const setLine = useCallback((lineId: string, value: string) => setDraft({ ...valueRef.current, [lineId]: value }), [setDraft]);

  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'submit' | 'cancel' | 'approve'>(null);
  const [panel, setPanel] = useState<null | 'submit' | 'cancel'>(null);
  const [skip, setSkip] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lineOf = useCallback(
    (lineId: string) => {
      const line = count.lines.find((l) => l.lineId === lineId);
      return line ? { product: line.productName, lot: line.lot } : undefined;
    },
    [count.lines],
  );
  const fail = (error: StudioFailure) => {
    const message = phMessage(t, locale, error, 'pharmacy.counts', lineOf);
    const fields: Record<string, string> = {};
    if (error.fields?.reason) fields.reason = message;
    setProblem({ message, fields });
  };

  const counted = countedIn(count.lines, entries);
  const total = count.lines.length;
  const uncounted = total - counted;
  const summary = summarise(count.lines);
  const shown = count.lines.filter((l) => (open ? !onlyOpen || (entries[l.lineId] ?? '') === '' : !onlyDiffs || (l.difference ?? 0) !== 0));

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const key = event.key;
    if (key !== 'Enter' && key !== 'ArrowDown' && key !== 'ArrowUp') return;
    const target = event.target as HTMLElement;
    if (!target.matches('[data-count-input]')) return;
    event.preventDefault();
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>('[data-count-input]') ?? [])];
    const next = inputs[inputs.indexOf(target as HTMLInputElement) + (key === 'ArrowUp' ? -1 : 1)];
    next?.focus();
    next?.select();
  };

  const save = async (): Promise<boolean> => {
    if (unsaved.length === 0) return true;
    const result = await settle(() => recordCounts({ countId: count.id, lines: unsaved }));
    if (!result.ok) {
      fail(result.error);
      return false;
    }
    draft.clear(draft.value);
    setSaved(true);
    return true;
  };

  const doSave = async () => {
    if (busy || !online) return;
    setBusy('save');
    setProblem(null);
    setDone(null);
    const n = unsaved.length;
    if (await save()) {
      setDone(n === 0 ? t('pharmacy.counts.sheet.nothingToSave') : t('pharmacy.counts.sheet.saved', { count: n }));
      router.refresh();
    }
    setBusy(null);
  };

  const doSubmit = async () => {
    if (busy || !online) return;
    setBusy('submit');
    setProblem(null);
    if (await save()) {
      const result = await settle(() => submitCount({ countId: count.id, skipUncounted: skip }));
      if (!result.ok) fail(result.error);
      else {
        draft.clear(draft.value);
        setPanel(null);
        setDone(t('pharmacy.counts.submitted.done'));
        router.refresh();
      }
    }
    setBusy(null);
  };

  const doCancel = async () => {
    if (busy || !online) return;
    setBusy('cancel');
    setProblem(null);
    const result = await settle(() => cancelCount({ countId: count.id }));
    if (!result.ok) fail(result.error);
    else {
      draft.clear(server);
      setPanel(null);
      setDone(t('pharmacy.counts.cancelled.done'));
      router.refresh();
    }
    setBusy(null);
  };

  const doApprove = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    setBusy('approve');
    setProblem(null);
    const result = await settle(() => approveCount({ countId: count.id, reason, expectedVersion: count.version }));
    if (!result.ok) fail(result.error);
    else {
      const data = result.data as { movements: number; netDifference: number };
      setDone(t('pharmacy.counts.approved.done', { moves: formatNumber(data.movements), net: data.netDifference === 0 ? '0' : signed(data.netDifference) }));
      router.refresh();
    }
    setBusy(null);
  };

  const hasDiffs = summary.diffs > 0;
  const lineLabel = (l: CountLineView) => t('pharmacy.counts.sheet.qty', { product: l.productName, lot: l.lot });
  const expectedLabel = t('pharmacy.counts.col.expected');

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!online && (
        <p data-testid="count-offline" role="status" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <WifiOff aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.counts.offline')}</span>
        </p>
      )}

      {open && count.blind && (
        <Notice tone="info" testid="count-blind-notice">
          <EyeOff aria-hidden className="me-1.5 inline size-4 align-text-bottom" />
          {t('pharmacy.counts.sheet.blind')}
        </Notice>
      )}
      {open && canCount && draft.restored && unsaved.length > 0 && <Notice tone="info" testid="count-restored">{t('pharmacy.counts.sheet.restored')}</Notice>}
      {count.status === 'CANCELLED' && <Notice tone="info" testid="count-cancelled-view">{t('pharmacy.counts.cancelledView')}</Notice>}
      {count.status === 'APPROVED' && (
        <Notice tone="ok" testid="count-approved-view">
          {count.reason ? t('pharmacy.counts.approved.by', { time: ltr(count.approvedAt ? formatDateTime(count.approvedAt, locale) : ''), reason: count.reason }) : t('pharmacy.counts.approved.noReason', { time: ltr(count.approvedAt ? formatDateTime(count.approvedAt, locale) : '') })}
        </Notice>
      )}

      {/* Progress and the sheet's tools */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {open ? (
          <>
            <p data-testid="count-progress" className="text-sm font-medium text-text">
              {t('pharmacy.counts.sheet.progress', { counted: formatNumber(counted), total: formatNumber(total) })}
            </p>
            {canCount && <UnsavedBadge dirty={unsaved.length > 0} saved={saved && unsaved.length === 0} />}
          </>
        ) : (
          count.status !== 'CANCELLED' && (
            <p data-testid="count-summary" className="text-sm font-medium text-text">
              {t('pharmacy.counts.review.summary', { counted: formatNumber(summary.counted), diffs: formatNumber(summary.diffs), net: summary.net === 0 ? '0' : signed(summary.net) })}
            </p>
          )
        )}
        <label className="inline-flex min-h-11 items-center gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={open ? onlyOpen : onlyDiffs}
            onChange={(event) => (open ? setOnlyOpen(event.target.checked) : setOnlyDiffs(event.target.checked))}
          />
          {t(open ? 'pharmacy.counts.sheet.onlyUncounted' : 'pharmacy.counts.review.onlyDiffs')}
        </label>
      </div>

      {open && canCount && <p className="text-sm text-muted">{t('pharmacy.counts.sheet.hint')}</p>}
      {open && uncounted === 0 && total > 0 && <Notice tone="ok">{t('pharmacy.counts.sheet.allCounted')}</Notice>}
      {count.status === 'SUBMITTED' && !hasDiffs && <Notice tone="info">{t('pharmacy.counts.review.noneDiffer')}</Notice>}

      <ul ref={listRef} aria-label={t(open ? 'pharmacy.counts.title' : 'pharmacy.counts.review.title')} onKeyDown={move} className="flex flex-col border-t border-line">
        {open
          ? shown.map((line) => (
              <SheetLine key={line.lineId} line={line} value={entries[line.lineId] ?? ''} editable={canCount} label={lineLabel(line)} expectedLabel={expectedLabel} onChange={setLine} t={t} />
            ))
          : shown.map((line) => (
              <li key={line.lineId} data-testid="count-line" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-1 py-2.5">
                <LineIdentity line={line} t={t} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-muted">{t('pharmacy.counts.col.expected')}</span>
                    <bdi dir="ltr" data-testid="count-expected" className="font-medium tabular-nums text-text">
                      {line.expectedQty === undefined ? '' : formatNumber(line.expectedAtCount ?? line.expectedQty)}
                    </bdi>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-muted">{t('pharmacy.counts.col.counted')}</span>
                    <bdi dir="ltr" data-testid="count-counted" className="font-medium tabular-nums text-text">
                      {line.countedQty === null ? '' : formatNumber(line.countedQty)}
                    </bdi>
                  </span>
                  <DifferenceChip line={line} t={t} />
                </div>
              </li>
            ))}
      </ul>

      {problem && <Notice tone="error" testid="count-error">{problem.message}</Notice>}
      {done && <Notice tone="ok" testid="count-done">{done}</Notice>}

      {/* OPEN: save, submit, cancel */}
      {open && canCount && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" className="min-h-11" icon={<Save aria-hidden />} disabled={busy !== null || !online} onClick={() => void doSave()}>
              {t('pharmacy.counts.sheet.save')}
            </Button>
            <Button variant="primary" size="lg" className="min-h-11" disabled={busy !== null} onClick={() => setPanel(panel === 'submit' ? null : 'submit')}>
              {t('pharmacy.counts.submit.open')}
            </Button>
            <Button variant="ghost" size="lg" className="min-h-11" disabled={busy !== null} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
              {t('pharmacy.counts.cancel.open')}
            </Button>
          </div>
          {panel === 'submit' && (
            <section data-testid="count-submit-panel" aria-labelledby="count-submit-title" className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-3 sm:p-4">
              <h2 id="count-submit-title" className="text-md font-semibold text-text">
                {t('pharmacy.counts.submit.title')}
              </h2>
              <p className="text-sm text-text">{t('pharmacy.counts.submit.body')}</p>
              {uncounted > 0 && (
                <>
                  <Notice tone="info">{t('pharmacy.counts.submit.uncounted', { count: uncounted })}</Notice>
                  <label className="inline-flex min-h-11 items-start gap-2.5 py-2 text-sm text-text">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={skip} onChange={(event) => setSkip(event.target.checked)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        <SkipForward aria-hidden className="size-4 shrink-0" />
                        {t('pharmacy.counts.submit.skip')}
                      </span>
                      <span className="text-muted">{t('pharmacy.counts.submit.skipHelp')}</span>
                    </span>
                  </label>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="lg" className="min-h-11" disabled={busy !== null || !online || (uncounted > 0 && !skip)} onClick={() => void doSubmit()}>
                  {t('pharmacy.counts.submit.yes')}
                </Button>
                <Button size="lg" className="min-h-11" onClick={() => setPanel(null)}>
                  {t('pharmacy.counts.submit.back')}
                </Button>
              </div>
            </section>
          )}
          {panel === 'cancel' && (
            <section data-testid="count-cancel-panel" aria-labelledby="count-cancel-title" className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-3 sm:p-4">
              <h2 id="count-cancel-title" className="text-md font-semibold text-text">
                {t('pharmacy.counts.cancel.title')}
              </h2>
              <p className="text-sm text-text">{t('pharmacy.counts.cancel.body')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="lg" className="min-h-11" disabled={busy !== null || !online} onClick={() => void doCancel()}>
                  {t('pharmacy.counts.cancel.yes')}
                </Button>
                <Button size="lg" className="min-h-11" onClick={() => setPanel(null)}>
                  {t('pharmacy.counts.cancel.back')}
                </Button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* SUBMITTED: approve or cancel */}
      {count.status === 'SUBMITTED' && (
        <div className="flex flex-col gap-3">
          {canApprove ? (
            <form data-testid="count-approve" onSubmit={(event) => void doApprove(event)} className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-3 sm:p-4">
              <h2 className="text-md font-semibold text-text">{t('pharmacy.counts.approve.title')}</h2>
              <p className="text-sm text-text">{t('pharmacy.counts.approve.body')}</p>
              <p className="flex items-start gap-2.5 text-sm text-muted">
                <Info aria-hidden className="mt-px size-4 shrink-0" />
                <span className="min-w-0">{t('pharmacy.counts.approve.self')}</span>
              </p>
              <Field label={t('pharmacy.counts.approve.reason')} hint={t('pharmacy.counts.approve.reasonHint')} {...(problem?.fields.reason ? { error: problem.fields.reason } : {})}>
                <Textarea dir="auto" rows={2} maxLength={300} required={hasDiffs} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="lg" className="min-h-11" disabled={busy !== null || !online}>
                  {t('pharmacy.counts.approve.yes')}
                </Button>
              </div>
            </form>
          ) : (
            <Notice tone="info" testid="count-cannot-approve">
              {t('pharmacy.counts.approve.cannot')}
            </Notice>
          )}
          {canCount && (
            <div className="flex flex-col gap-3">
              <div>
                <Button variant="ghost" size="lg" className="min-h-11" disabled={busy !== null} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
                  {t('pharmacy.counts.cancel.open')}
                </Button>
              </div>
              {panel === 'cancel' && (
                <section data-testid="count-cancel-panel" aria-labelledby="count-cancel-title" className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-3 sm:p-4">
                  <h2 id="count-cancel-title" className="text-md font-semibold text-text">
                    {t('pharmacy.counts.cancel.title')}
                  </h2>
                  <p className="text-sm text-text">{t('pharmacy.counts.cancel.body')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" size="lg" className="min-h-11" disabled={busy !== null || !online} onClick={() => void doCancel()}>
                      {t('pharmacy.counts.cancel.yes')}
                    </Button>
                    <Button size="lg" className="min-h-11" onClick={() => setPanel(null)}>
                      {t('pharmacy.counts.cancel.back')}
                    </Button>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
