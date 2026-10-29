'use client';

import { Camera, CircleAlert, FilePlus2, FolderOpen, Info, RotateCw, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createIntakeBatch } from '@/app/pharmacy/_actions/intake';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import {
  CLIENT_LIMITS,
  batchKeyFor,
  checkClientFile,
  effectiveStatus,
  emptyIntakeDraft,
  itemOf,
  nextUpload,
  outcomeOfUpload,
  setItem,
  uploadSummary,
  type IntakeDraft,
  type UploadAnswer,
  type UploadItem,
} from './intake-logic';
import { QualityReasons, UploadState } from './intake-parts';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

const UPLOAD_URL = '/api/pharmacy/intake/files';

export interface IntakeUploadProps {
  userId: string;
  restaurantId: string;
  branchId: string;
  branchName: string;
  suppliers: { id: string; name: string }[];
}

const FILE_BUTTON =
  's-btn inline-flex min-h-11 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-raised px-4 text-base font-medium text-text hover:bg-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink [&_svg]:size-4 [&_svg]:shrink-0';

/** Sends one file to the upload route and returns its answer in the route's shape; a lost connection is an answer too. */
async function send(file: File, place: { restaurantId: string; branchId: string; batchId: string }): Promise<UploadAnswer> {
  const form = new FormData();
  form.append('restaurantId', place.restaurantId);
  form.append('branchId', place.branchId);
  form.append('batchId', place.batchId);
  form.append('file', file, file.name);
  try {
    const response = await fetch(UPLOAD_URL, { method: 'POST', body: form });
    const body = (await response.json()) as UploadAnswer;
    return body;
  } catch {
    return { error: { code: 'INVALID', message: NETWORK_FAILURE } };
  }
}

/**
 * "New batch": an optional supplier, files chosen from the device (several at once) or a photo taken with the camera,
 * checked in the browser against the server's limits, then sent one at a time with a word for each file's progress. The
 * batch is made first with a key kept in the draft, so a refresh continues the same batch; the list of files is kept on
 * this device too (the bytes are not: a file that had not gone yet shows as "choose it again"). Leaving while a file is
 * on its way asks first. No motion.
 */
export function IntakeUpload({ userId, restaurantId, branchId, branchName, suppliers }: IntakeUploadProps) {
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [firstKey] = useState(() => newClientKey('intake'));
  const [start] = useState<IntakeDraft>(() => emptyIntakeDraft(firstKey));
  const draft = useDraft<IntakeDraft>(draftKey(userId, `intake@${restaurantId}:${branchId}`, 'new'), start);
  const value = draft.value;
  const files = useRef(new Map<string, File>());
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  // Which files are still held in this page's memory (the bytes are in `files`; this mirror is what the page draws from).
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const syncHeld = () => setHeld(new Set(files.current.keys()));
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const commit = (patch: Partial<IntakeDraft> | ((current: IntakeDraft) => Partial<IntakeDraft>)) => {
    const current = latest.current;
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    latest.current = next;
    draft.set(next);
  };

  const summary = uploadSummary(value.items);
  useLeaveGuard(busy, t('pharmacy.intake.up.leaveConfirm'));

  const hasFile = (key: string) => held.has(key);
  const settledCount = value.items.filter((i) => i.status !== 'invalid').length;

  const add = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    let taken = settledCount;
    const made: UploadItem[] = [];
    for (const file of Array.from(picked)) {
      const problemOf = checkClientFile(file, taken);
      counter.current += 1;
      const key = newClientKey(`f${counter.current}`);
      if (!problemOf) {
        files.current.set(key, file);
        taken += 1;
      }
      made.push(itemOf(key, file, problemOf));
    }
    setProblem(null);
    commit((c) => ({ items: [...c.items, ...made] }));
    syncHeld();
  };

  const remove = (key: string) => {
    files.current.delete(key);
    commit((c) => ({ items: c.items.filter((i) => i.key !== key) }));
    syncHeld();
  };

  const retry = (key: string) => {
    commit((c) => ({ items: setItem(c.items, key, { status: 'queued', message: undefined, phCode: undefined, retryable: undefined }) }));
    void run();
  };

  /** Makes the batch (once) and then sends the queued files one after the other. */
  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(null);
    try {
      let batchId = latest.current.batchId;
      if (!batchId) {
        setStarting(true);
        const attempt = batchKeyFor(latest.current);
        commit(attempt);
        const made = await settle(() => createIntakeBatch({ clientKey: attempt.clientKey, ...(latest.current.supplierId ? { supplierId: latest.current.supplierId } : {}) }));
        setStarting(false);
        if (!made.ok) {
          if (made.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') commit({ clientKey: newClientKey('intake'), keySig: '' });
          setProblem(phMessage(t, locale, made.error, 'pharmacy.intake'));
          return;
        }
        batchId = (made.data as { id: string }).id;
        commit({ batchId });
      }
      for (;;) {
        const next = nextUpload(latest.current.items, (key) => files.current.has(key));
        if (!next) break;
        commit((c) => ({ items: setItem(c.items, next.key, { status: 'uploading' }) }));
        const answer = await send(files.current.get(next.key)!, { restaurantId, branchId, batchId });
        const outcome = outcomeOfUpload(answer);
        if (outcome.status === 'failed') {
          commit((c) => ({ items: setItem(c.items, next.key, { status: 'failed', message: outcome.message, phCode: outcome.phCode, retryable: outcome.retryable }) }));
        } else {
          files.current.delete(next.key);
          syncHeld();
          commit((c) => ({ items: setItem(c.items, next.key, { status: outcome.status, fileId: 'fileId' in outcome ? outcome.fileId : undefined, reasons: 'reasons' in outcome ? outcome.reasons : undefined }) }));
        }
      }
    } finally {
      running.current = false;
      setBusy(false);
      setStarting(false);
    }
  }

  const failureText = (item: UploadItem) =>
    phMessage(t, locale, { code: 'INVALID', message: item.message ?? NETWORK_FAILURE, ...(item.phCode ? { fields: { phCode: item.phCode } } : {}) }, 'pharmacy.intake');

  const queued = value.items.filter((i) => i.status === 'queued' && hasFile(i.key)).length;
  const finished = value.batchId !== null && summary.waiting === 0 && !busy && value.items.length > 0;
  const canStart = online && !busy && queued > 0;
  const supplierOptions = [{ value: '', label: t('pharmacy.intake.up.supplierNone') }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 pb-8 sm:px-8" data-testid="intake-upload">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.intake.up.forBranch', { branch: isolate(branchName) })}
        </span>
        <UnsavedBadge dirty={draft.dirty && !finished} saved={finished} />
      </div>
      <OfflineNotice />
      {draft.restored && value.batchId && (
        <div role="status" data-testid="intake-resumed" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-start gap-2.5">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            {t('pharmacy.intake.up.resumed')}
          </span>
          <Button size="lg" className="min-h-11" onClick={() => draft.clear(start)}>
            {t('pharmacy.catalog.draft.discard')}
          </Button>
        </div>
      )}
      {problem && (
        <div role="alert" data-testid="intake-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{problem}</span>
        </div>
      )}

      <section aria-labelledby="up-supplier" className="flex min-w-0 flex-col gap-2">
        <h2 id="up-supplier" className="text-md font-semibold text-text">
          {t('pharmacy.intake.up.supplier')}
        </h2>
        <Field label={t('pharmacy.intake.up.supplierLabel')} hint={value.batchId ? t('pharmacy.intake.up.supplierLocked') : t('pharmacy.intake.up.supplierHint')}>
          <Select
            className="max-w-md [&_select]:min-h-11"
            data-testid="intake-supplier"
            value={value.supplierId}
            disabled={value.batchId !== null || busy}
            onChange={(e) => {
              const found = suppliers.find((s) => s.id === e.target.value);
              commit({ supplierId: e.target.value, supplierName: found?.name ?? '' });
            }}
            options={supplierOptions}
          />
        </Field>
      </section>

      <section aria-labelledby="up-files" className="flex min-w-0 flex-col gap-3">
        <h2 id="up-files" className="text-md font-semibold text-text">
          {t('pharmacy.intake.up.files')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.intake.up.limits', { size: formatNumber(CLIENT_LIMITS.maxBytes / (1024 * 1024)), count: formatNumber(CLIENT_LIMITS.maxFiles) })}</p>
        <div className="flex flex-wrap gap-2">
          <label className={FILE_BUTTON}>
            <FilePlus2 aria-hidden />
            {t('pharmacy.intake.up.choose')}
            <input
              ref={pickRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              data-testid="intake-pick"
              className="sr-only"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <label className={FILE_BUTTON}>
            <Camera aria-hidden />
            {t('pharmacy.intake.up.takePhoto')}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="intake-camera"
              className="sr-only"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {value.items.length === 0 ? (
          <p data-testid="intake-no-files" className="flex items-start gap-2.5 text-sm text-muted">
            <Info aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.intake.up.none')}</span>
          </p>
        ) : (
          <ul aria-label={t('pharmacy.intake.up.files')} className="flex flex-col border-t border-line">
            {value.items.map((item) => {
              const state = effectiveStatus(item, hasFile(item.key));
              return (
                <li key={item.key} data-testid="up-item" data-state={state} className="flex min-w-0 flex-col gap-2 border-b border-line py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                      {item.name}
                    </span>
                    <bdi dir="ltr" className="text-sm text-muted tabular-nums">
                      {(item.size / (1024 * 1024)).toFixed(1)} MB
                    </bdi>
                    <UploadState status={state} t={t} />
                  </div>
                  {state === 'invalid' && item.problem && <p className="text-sm text-danger">{t(`pharmacy.intake.up.problem.${item.problem}`, { size: formatNumber(CLIENT_LIMITS.maxBytes / (1024 * 1024)), count: formatNumber(CLIENT_LIMITS.maxFiles) })}</p>}
                  {state === 'lost' && <p className="text-sm text-text">{t('pharmacy.intake.up.lostBody')}</p>}
                  {state === 'rejected' && <QualityReasons reasons={item.reasons} t={t} />}
                  {state === 'duplicate' && <p className="text-sm text-text">{t('pharmacy.intake.up.duplicateBody')}</p>}
                  {state === 'failed' && <p className="text-sm text-danger">{failureText(item)}</p>}
                  <div className="flex flex-wrap gap-2">
                    {state === 'failed' && item.retryable && (
                      <Button size="lg" className="min-h-11" icon={<RotateCw aria-hidden />} disabled={!online || busy} onClick={() => retry(item.key)}>
                        {t('pharmacy.intake.up.retry')}
                      </Button>
                    )}
                    {(state === 'queued' || state === 'invalid' || state === 'failed' || state === 'lost') && (
                      <Button size="lg" className="min-h-11" icon={<Trash2 aria-hidden />} disabled={state === 'queued' && busy && item.status === 'uploading'} onClick={() => remove(item.key)}>
                        {t('pharmacy.intake.up.remove')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" className="min-h-11" icon={<Upload aria-hidden />} data-testid="intake-start" disabled={!canStart} onClick={() => void run()}>
            {value.batchId ? t('pharmacy.intake.up.sendMore') : t('pharmacy.intake.up.start')}
          </Button>
          {busy && (
            <p role="status" data-testid="intake-sending" className="text-sm text-text">
              {starting ? t('pharmacy.intake.up.making') : t('pharmacy.intake.up.sending')}
            </p>
          )}
        </div>
        {!online && queued > 0 && <p className="text-sm text-muted">{t('pharmacy.intake.up.offlineKeep')}</p>}
      </section>

      {value.items.length > 0 && (
        <section aria-labelledby="up-summary" data-testid="intake-summary" className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-4">
          <h2 id="up-summary" className="text-sm font-medium text-muted">
            {t('pharmacy.intake.up.summary')}
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
            {(
              [
                ['stored', summary.stored],
                ['rejected', summary.rejected],
                ['duplicate', summary.duplicate],
                ['failed', summary.failed],
                ['waiting', summary.waiting],
              ] as const
            ).map(([name, n]) => (
              <div key={name} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted">{t(`pharmacy.intake.up.sum.${name}`)}</dt>
                <dd className="font-medium text-text tabular-nums">
                  <bdi dir="ltr">{formatNumber(n)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
          {finished && value.batchId && (
            <div className="pt-1">
              <Link
                href={`/pharmacy/purchasing/intake/${value.batchId}`}
                data-testid="intake-open-batch"
                className="s-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-base font-medium text-on-ink hover:bg-ink-hover [&_svg]:size-4"
                onClick={() => draft.clear(start)}
              >
                <FolderOpen aria-hidden />
                {t('pharmacy.intake.up.open')}
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
