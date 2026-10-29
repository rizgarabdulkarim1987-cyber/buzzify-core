'use client';

import { Ban, CircleAlert, Eye, EyeOff, FileText, Info, Lock, PenLine, ReceiptText, RotateCw, ScanText, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cancelIntakeBatch, intakeBatch, intakeFileUrl, readIntakeFile, retryIntakeFile } from '@/app/pharmacy/_actions/intake';
import { formatNumber } from '@/lib/pos-format';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Textarea } from '@/studio/ui/Textarea';
import type { ReviewData } from './intake-review-logic';
import { IntakeReview } from './IntakeReview';
import { batchStateOf, fileControls, nextToRead, pollPlan, runDecision, type BatchState, type Control, type DisabledReason } from './intake-logic';
import { FileStatus, QualityReasons } from './intake-parts';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { useOnline } from './use-online';

export interface IntakeBatchProps {
  batchId: string;
  initial: BatchState;
  /** The role holds `ai.use`. */
  mayAi: boolean;
  /** The pharmacy is open for writing and the role may buy. */
  writable: boolean;
  /** The branch chosen is this batch's branch. */
  branchOk: boolean;
  /** The batch as the review shows it (lines, header, verdict). */
  initialReview: ReviewData;
  userId: string;
  restaurantId: string;
  branchId: string;
  suppliers: Array<{ id: string; name: string }>;
}

const NOTE = 'flex items-start gap-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';
const MANUAL = '/pharmacy/stock/receive/new';

/**
 * The batch's files: a thumbnail on request (a signed link made when asked), a chip with icon and word, the sentence for a
 * failure, and Read invoice / Try again / Enter manually instead. A role that cannot use the AI sees the controls disabled
 * with the reason written beside them. While any file is being read the batch is refreshed every three seconds (no
 * movement: the word "Reading" and the lines count change). "Read all" goes one file at a time and can be stopped.
 */
export function IntakeBatch({ batchId, initial, mayAi, writable, branchOk, initialReview, userId, restaurantId, branchId, suppliers }: IntakeBatchProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [data, setData] = useState<BatchState>(initial);
  const [review, setReview] = useState<ReviewData>(initialReview);
  const freshReview = useRef<ReviewData>(initialReview);
  const [failures, setFailures] = useState(0);
  const [reading, setReading] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<'idle' | 'running' | 'stopping'>('idle');
  const [runNote, setRunNote] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, { url: string } | 'error' | 'loading'>>({});
  const [panel, setPanel] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const stop = useRef(false);
  /** Files being read right now: a second press on the same file while its answer is awaited does nothing. */
  const inflight = useRef(new Set<string>());
  /** Pictures whose link was already asked for again after a failed load (once each, so a dead link does not loop). */
  const refetched = useRef(new Set<string>());
  const open = data.status === 'OPEN';
  const busy = reading.size > 0 || runState !== 'idle';

  const refresh = async (): Promise<BatchState | null> => {
    const result = await settle(() => intakeBatch({ batchId }));
    if (!result.ok) {
      setFailures((n) => n + 1);
      return null;
    }
    const raw = result.data as unknown as ReviewData;
    const next = batchStateOf(result.data as Parameters<typeof batchStateOf>[0]);
    freshReview.current = raw;
    setReview(raw);
    setFailures(0);
    setData(next);
    return next;
  };

  // While a file is being read the batch is looked at again every three seconds, and no longer when none is.
  useEffect(() => {
    const plan = pollPlan(data.files, failures);
    if (!plan.poll || !online) return;
    const id = setTimeout(() => void refresh(), plan.delayMs);
    return () => clearTimeout(id);
    // `refresh` only closes over the batch id; the plan is made again after every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, failures, online]);

  const ctx = { batchOpen: open, mayAi, writable, online, busy, branchOk };
  const reasonText = (r: DisabledReason) => t(`pharmacy.intake.reason.${r}`);

  /** Reads one file; says whether a "Read all" run goes on, stops for a reason every file would meet, or stops offline. */
  const readOne = async (fileId: string, again: boolean): Promise<{ stop: 'continue' | 'sameReason' | 'network'; fresh: BatchState | null }> => {
    if (inflight.current.has(fileId)) return { stop: 'continue', fresh: null };
    inflight.current.add(fileId);
    setReading((s) => new Set(s).add(fileId));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== fileId)));
    const result = await settle(() => (again ? retryIntakeFile({ fileId }) : readIntakeFile({ fileId })));
    let halt: 'continue' | 'sameReason' | 'network';
    if (!result.ok) {
      // This file's own sentence stays on the file; the run goes on unless every other file would meet the same thing.
      setErrors((e) => ({ ...e, [fileId]: phMessage(t, locale, result.error, 'pharmacy.intake') }));
      halt = runDecision({ error: result.error });
    } else {
      halt = runDecision({ failureCode: (result.data as { failureCode: string | null }).failureCode });
    }
    const next = await refresh();
    inflight.current.delete(fileId);
    setReading((s) => {
      const n = new Set(s);
      n.delete(fileId);
      return n;
    });
    if (next && next.status !== 'OPEN') halt = 'sameReason';
    return { stop: halt, fresh: next };
  };

  const readAll = async () => {
    stop.current = false;
    setRunState('running');
    setRunNote(null);
    const tried = new Set<string>();
    let files = data.files;
    for (;;) {
      if (stop.current) break;
      const id = nextToRead(files, tried);
      if (!id) break;
      tried.add(id);
      const { stop: halt, fresh } = await readOne(id, false);
      if (halt !== 'continue') {
        setRunNote(t(halt === 'network' ? 'pharmacy.intake.run.network' : 'pharmacy.intake.run.halted'));
        break;
      }
      if (!fresh) {
        setRunNote(t('pharmacy.intake.run.network'));
        break;
      }
      files = fresh.files;
    }
    setRunState('idle');
    if (stop.current) setRunNote(t('pharmacy.intake.run.stopped'));
  };

  const showPicture = async (fileId: string) => {
    setUrls((u) => ({ ...u, [fileId]: 'loading' }));
    const result = await settle(() => intakeFileUrl({ fileId }));
    setUrls((u) => ({ ...u, [fileId]: result.ok ? { url: (result.data as { url: string }).url } : 'error' }));
  };

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    const result = await settle(() => cancelIntakeBatch({ batchId, ...(reason.trim() ? { reason: reason.trim() } : {}) }));
    setCancelling(false);
    if (!result.ok) {
      setCancelError(phMessage(t, locale, result.error, 'pharmacy.intake'));
      // Someone else already closed it: show the batch as it is now.
      if (result.error.fields?.phCode === 'BATCH_NOT_OPEN') {
        await refresh();
        router.refresh();
      }
      return;
    }
    setPanel(false);
    await refresh();
    router.refresh();
  };

  const control = (c: Control, label: string, icon: ReactNode, onClick: () => void, testId: string, id: string) =>
    c.shown ? (
      <div className="flex min-w-0 flex-col gap-1">
        <Button size="lg" className="min-h-11" icon={icon} data-testid={testId} disabled={c.disabled !== false} aria-describedby={c.disabled ? `${id}-why` : undefined} onClick={onClick}>
          {label}
        </Button>
        {c.disabled && (
          <p id={`${id}-why`} data-testid={`${testId}-why`} className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
            <Lock aria-hidden />
            <span className="min-w-0">{reasonText(c.disabled)}</span>
          </p>
        )}
      </div>
    ) : null;

  const readable = data.files.filter((f) => f.status === 'UPLOADED').length;
  const readAllControl = fileControls('UPLOADED', ctx).read;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="intake-batch">
      <OfflineNotice />
      {!mayAi && (
        <p data-testid="intake-noai-note" className={NOTE}>
          <Lock aria-hidden className="text-muted" />
          <span className="min-w-0">{t('pharmacy.intake.noAi')}</span>
        </p>
      )}
      {open && failures >= 5 && (
        <div role="alert" data-testid="intake-poll-stopped" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.intake.poll.stopped')}</span>
          </span>
          <Button size="lg" className="min-h-11" onClick={() => void refresh()}>
            {t('pharmacy.purchasing.reload')}
          </Button>
        </div>
      )}
      {data.status === 'APPROVED' && data.receiptId && (
        <div data-testid="intake-approved" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-start gap-2.5">
            <ReceiptText aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.intake.approvedNote')}</span>
          </span>
          <Link href={`/pharmacy/stock/receive/${data.receiptId}`} data-testid="intake-receipt-link" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.intake.receiptLink')}
          </Link>
        </div>
      )}
      {data.status === 'CANCELLED' && (
        <p data-testid="intake-cancelled" className={NOTE}>
          <Ban aria-hidden className="text-muted" />
          <span className="min-w-0">{t('pharmacy.intake.cancelledNote')}</span>
        </p>
      )}

      <section aria-labelledby="intake-files-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="intake-files-title" className="text-md font-semibold text-text">
            {t('pharmacy.intake.files')}
          </h2>
          {open && (
            <div className="flex flex-wrap items-start gap-2">
              {runState === 'idle' ? (
                control(readAllControl.shown && readable > 0 ? readAllControl : { shown: false, disabled: false }, t('pharmacy.intake.readAll'), <ScanText aria-hidden />, () => void readAll(), 'intake-read-all', 'read-all')
              ) : (
                <Button size="lg" className="min-h-11" icon={<Square aria-hidden />} data-testid="intake-stop" disabled={runState === 'stopping'} onClick={() => {
                  stop.current = true;
                  setRunState('stopping');
                }}>
                  {runState === 'stopping' ? t('pharmacy.intake.run.stopping') : t('pharmacy.intake.run.stop')}
                </Button>
              )}
              <Link href={MANUAL} data-testid="intake-manual" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                <PenLine aria-hidden />
                {t('pharmacy.intake.manual')}
              </Link>
            </div>
          )}
        </div>
        {runState !== 'idle' && (
          <p role="status" data-testid="intake-running" className={NOTE}>
            <Info aria-hidden className="text-muted" />
            <span className="min-w-0">{t('pharmacy.intake.run.running')}</span>
          </p>
        )}
        {runNote && runState === 'idle' && (
          <p role="status" data-testid="intake-run-note" className={NOTE}>
            <Info aria-hidden className="text-muted" />
            <span className="min-w-0">{runNote}</span>
          </p>
        )}
        {data.files.length === 0 ? (
          <p data-testid="intake-nofiles" className={NOTE}>
            <Info aria-hidden className="text-muted" />
            <span className="min-w-0">{t('pharmacy.intake.noFiles')}</span>
          </p>
        ) : (
          <ul aria-label={t('pharmacy.intake.files')} className="flex flex-col border-t border-line">
            {data.files.map((f, index) => {
              const c = fileControls(f.status, ctx, f.stale);
              const isReading = (f.status === 'EXTRACTING' && !f.stale) || reading.has(f.id);
              const picture = urls[f.id];
              const canShow = f.status !== 'PURGED' && f.status !== 'REJECTED_QUALITY';
              return (
                <li key={f.id} data-testid="intake-file" data-state={f.status} data-stale={f.stale ? 'true' : undefined} className="flex min-w-0 flex-col gap-2 border-b border-line py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base font-medium text-text">{t('pharmacy.intake.fileN', { n: formatNumber(index + 1) })}</span>
                    {isReading && f.status !== 'EXTRACTING' ? (
                      <FileStatus status="EXTRACTING" t={t} />
                    ) : (
                      <FileStatus status={f.status} t={t} />
                    )}
                    <span className="text-sm text-muted">
                      {f.mediaType === 'application/pdf' ? t('pharmacy.intake.pages', { count: formatNumber(f.pages) }) : t('pharmacy.intake.image')}
                      {' · '}
                      <bdi dir="ltr" className="tabular-nums">
                        {(f.bytes / (1024 * 1024)).toFixed(1)} MB
                      </bdi>
                    </span>
                    {f.status === 'EXTRACTED' && (
                      <span className="text-sm text-text">
                        {t('pharmacy.intake.lines')}:{' '}
                        <bdi dir="ltr" className="tabular-nums" data-testid="file-lines">
                          {formatNumber(data.rowsByFile[f.id] ?? 0)}
                        </bdi>
                      </span>
                    )}
                  </div>
                  {isReading && (
                    <p role="status" data-testid="file-reading" className={NOTE}>
                      <Info aria-hidden className="text-muted" />
                      <span className="min-w-0">{t('pharmacy.intake.reading')}</span>
                    </p>
                  )}
                  {f.status === 'EXTRACTING' && f.stale && !reading.has(f.id) && (
                    <p data-testid="file-stale" className="flex items-start gap-2 text-sm text-danger">
                      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0">{t('pharmacy.intake.stale')}</span>
                    </p>
                  )}
                  {f.status === 'REJECTED_QUALITY' && <QualityReasons reasons={f.failureCode} t={t} />}
                  {f.status === 'FAILED' && (
                    <p data-testid="file-failure" data-code={f.failureCode ?? ''} className="text-sm text-danger">
                      {f.failureCode && t(`pharmacy.intake.fail.${f.failureCode}`) !== `pharmacy.intake.fail.${f.failureCode}` ? t(`pharmacy.intake.fail.${f.failureCode}`) : t('pharmacy.intake.fail.unknown')}
                    </p>
                  )}
                  {f.status === 'PURGED' && <p className="text-sm text-muted">{t('pharmacy.intake.purged')}</p>}
                  {errors[f.id] && (
                    <p role="alert" data-testid="file-error" className="flex items-start gap-2 text-sm text-danger">
                      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0">{errors[f.id]}</span>
                    </p>
                  )}
                  {picture && picture !== 'loading' && picture !== 'error' && (
                    <div data-testid="file-picture">
                      {f.mediaType.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private file: not an optimisable asset
                        <img src={picture.url} alt={t('pharmacy.intake.pictureAlt', { n: formatNumber(index + 1) })} className="max-h-72 w-auto max-w-full rounded-md border border-line object-contain" onError={() => {
                            if (refetched.current.has(f.id)) return;
                            refetched.current.add(f.id);
                            void showPicture(f.id);
                          }} />
                      ) : (
                        <a href={picture.url} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                          <FileText aria-hidden />
                          {t('pharmacy.intake.openPdf')}
                        </a>
                      )}
                    </div>
                  )}
                  {picture === 'error' && (
                    <p role="alert" className="text-sm text-danger">
                      {t('pharmacy.intake.pictureFailed')}
                    </p>
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    {canShow && (
                      <Button
                        size="lg"
                        className="min-h-11"
                        icon={picture && picture !== 'loading' && picture !== 'error' ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                        data-testid="file-show"
                        disabled={picture === 'loading' || !online}
                        onClick={() => (picture && picture !== 'loading' && picture !== 'error' ? setUrls((u) => Object.fromEntries(Object.entries(u).filter(([id]) => id !== f.id))) : void showPicture(f.id))}
                      >
                        {picture && picture !== 'loading' && picture !== 'error' ? t('pharmacy.intake.hidePicture') : t('pharmacy.intake.showPicture')}
                      </Button>
                    )}
                    {control(c.read, t('pharmacy.intake.read'), <ScanText aria-hidden />, () => void readOne(f.id, false), 'file-read', `read-${f.id}`)}
                    {control(c.retry, t('pharmacy.intake.retry'), <RotateCw aria-hidden />, () => void readOne(f.id, true), 'file-retry', `retry-${f.id}`)}
                    {c.manual && (
                      <Link href={MANUAL} data-testid="file-manual" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                        <PenLine aria-hidden />
                        {t('pharmacy.intake.manual')}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <IntakeReview
        data={review}
        reload={async () => ((await refresh()) ? freshReview.current : null)}
        onApproved={() => router.refresh()}
        userId={userId}
        restaurantId={restaurantId}
        branchId={branchId}
        suppliers={suppliers}
        mayAi={mayAi}
        writable={writable}
        branchOk={branchOk}
      />

      {open && (
        <section aria-labelledby="intake-cancel-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="intake-cancel-title" className="text-md font-semibold text-text">
            {t('pharmacy.intake.cancel.title')}
          </h2>
          {!panel ? (
            <div className="flex min-w-0 flex-col gap-1">
              <Button size="lg" className="min-h-11 w-fit" icon={<Ban aria-hidden />} data-testid="intake-cancel" disabled={!writable || !branchOk || !online || busy} aria-describedby={!writable || !branchOk ? 'cancel-why' : undefined} onClick={() => setPanel(true)}>
                {t('pharmacy.intake.cancel.open')}
              </Button>
              {(!writable || !branchOk) && (
                <p id="cancel-why" data-testid="intake-cancel-why" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
                  <Lock aria-hidden />
                  <span className="min-w-0">{reasonText(!writable ? 'readOnly' : 'branch')}</span>
                </p>
              )}
            </div>
          ) : (
            <form
              role="region"
              aria-label={t('pharmacy.intake.cancel.title')}
              data-testid="intake-cancel-form"
              className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (online && !cancelling) void cancel();
              }}
            >
              <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.intake.cancel.body')}</p>
              <Field label={t('pharmacy.intake.cancel.reason')} hint={t('pharmacy.intake.cancel.reasonHint')}>
                <Textarea className="min-h-20" dir="auto" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              {cancelError && (
                <p role="alert" data-testid="intake-cancel-error" className="flex items-start gap-2 text-sm text-danger">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{cancelError}</span>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" size="lg" className="min-h-11" data-testid="intake-cancel-yes" disabled={!online || cancelling}>
                  {t('pharmacy.intake.cancel.yes')}
                </Button>
                <Button size="lg" className="min-h-11" disabled={cancelling} onClick={() => setPanel(false)}>
                  {t('pharmacy.receive.confirm.back')}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
