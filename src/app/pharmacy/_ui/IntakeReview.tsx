'use client';

import { Columns2, Filter, Info, ListChecks, Lock, PanelTop, Plus, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  acknowledgeIntakeHeader,
  addIntakeRow,
  approveIntakeBatch,
  clearIntakeMatch,
  matchIntakeRow,
  rematchIntake,
  removeIntakeRow,
  reviewIntakeRow,
  scanIntakeBarcode,
  updateIntakeHeader,
  updateIntakeRow,
} from '@/app/pharmacy/_actions/intake';
import { findSuppliers } from '@/app/pharmacy/_actions/purchase-orders';
import { formatNumber } from '@/lib/pos-format';
import { isolate } from './WriteBlocked';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import type { ActionResult, StudioFailure } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Select } from '@/studio/ui/Select';
import { approveSignature, approveBlockers, approveControl, buildHeaderPatch, buildRowPatch, duplicateTarget, editReason, emptyReviewDraft, hasUnsaved, headerAckShown, historyOf, jumpId, nextOpenId, openRowIds, reviewShown, rowKeyFor, unsavedParts, type Blocker, type EditField, type HeaderFormField, type ReviewData, type ReviewDraft, type ReviewRow } from './intake-review-logic';
import { Message } from './intake-review-parts';
import { IntakeApproveBar } from './IntakeApproveBar';
import { IntakeHeaderCard } from './IntakeHeaderCard';
import { IntakeOriginal, type OriginalFocus } from './IntakeOriginal';
import { IntakeRowCard } from './IntakeRowCard';
import { IntakeScan, type ScanOutcome } from './IntakeScan';
import { phMessage } from './ph-failure';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';
import { attemptKeyFor } from './purchasing-logic';

export interface IntakeReviewProps {
  data: ReviewData;
  /** Reads the batch again (after every write); resolves to the fresh data, or null when the read failed. */
  reload: () => Promise<ReviewData | null>;
  /** The server-rendered parts of the page (status chip) are read again after an approval. */
  onApproved: () => void;
  userId: string;
  restaurantId: string;
  branchId: string;
  suppliers: Array<{ id: string; name: string }>;
  mayAi: boolean;
  writable: boolean;
  branchOk: boolean;
}

type Tone = 'error' | 'ok' | 'info';
type Note = { tone: Tone; text: string };

/** After these refusals the screen's copy is out of date: read the batch again so the person sees what changed. */
const RELOAD_ON = new Set(['VERSION_CONFLICT', 'ACK_STALE', 'APPROVAL_STALE', 'NOT_APPROVABLE', 'NOT_OPEN', 'FILES_STILL_PROCESSING', 'DUPLICATE_INVOICE', 'RETRY']);

const WHY = 'review-why';

const WIDE = '(min-width: 1024px)';
const subscribeWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const wideNow = () => window.matchMedia(WIDE).matches;

/**
 * The review of the lines the AI read: the invoice's details, the lines as cards with their flags, the product match and the
 * edits, the original picture beside them (stacked on a phone), and the bar that approves into a DRAFT receipt. Every write
 * names the version the person saw and is followed by a fresh read; the flags and the verdict are the server's. What is typed
 * and not saved yet is kept on this device (with the keys of the attempts) and the page asks before it is left.
 */
export function IntakeReview({ data, reload, onApproved, userId, restaurantId, branchId, suppliers, mayAi, writable, branchOk }: IntakeReviewProps) {
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [start] = useState(emptyReviewDraft);
  const draft = useDraft<ReviewDraft>(draftKey(userId, `intake-review@${restaurantId}:${branchId}`, data.batch.id), start);
  const latest = useRef(draft.value);
  useEffect(() => {
    latest.current = draft.value;
  }, [draft.value]);
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  // A wide screen starts with the original beside the lines; a narrow one with the toggle. The person's own choice wins.
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => false);
  const [originalPref, setOriginalPref] = useState<boolean | null>(null);
  const originalOpen = originalPref ?? wide;
  const [focus, setFocus] = useState<OriginalFocus | null>(null);
  const [removing, setRemoving] = useState<ReviewRow | null>(null);
  const [addTo, setAddTo] = useState('');
  const [link, setLink] = useState<{ href: string; label: string } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [onlyOpenPref, setOnlyOpenPref] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const lastFocused = useRef<string | null>(null);
  const approving = useRef(false);

  const open = data.batch.status === 'OPEN';
  // Only drafts that still have somewhere to go count: a form for a line that was removed, or any form of a closed batch, is dropped.
  const liveForms = open ? Object.fromEntries(Object.entries(draft.value.forms).filter(([id]) => data.rows.some((r) => r.id === id && !r.removed))) : {};
  const liveDraft: ReviewDraft = { ...draft.value, forms: liveForms, header: open ? draft.value.header : null };
  const unsaved = hasUnsaved(liveDraft);
  const busy = saving !== null || scanning;
  const ctx = { open, mayAi, writable, branchOk, online };
  const block = editReason(ctx);
  const approveBlock = approveControl(data, { ...ctx, unsaved, writing: busy });
  const blockers = approveBlockers(data);
  const currency = data.header.values.currency;
  const parts = unsavedParts(liveDraft, data.rows);
  const unsavedText = [...(parts.lines.length > 0 ? [t('pharmacy.intake.rv.unsavedWhere.lines', { lines: parts.lines.map((n) => formatNumber(n)).join(', ') })] : []), ...(parts.header ? [t('pharmacy.intake.rv.unsavedWhere.header')] : [])].join(' · ');
  const openIds = openRowIds(data.rows, liveForms);
  const onlyOpen = open && (onlyOpenPref ?? openIds.length > 0);
  const shownRows = onlyOpen ? data.rows.filter((r) => openIds.includes(r.id)) : data.rows;
  const extracted = data.files.filter((f) => f.status === 'EXTRACTED');
  const target = addTo !== '' && extracted.some((f) => f.id === addTo) ? addTo : (extracted[0]?.id ?? '');

  useLeaveGuard(unsaved || busy, t('pharmacy.intake.rv.leave'));


  // A line just added is brought into view and opened for typing.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !data.rows.some((r) => r.id === id)) return;
    pendingFocus.current = null;
    setEditing((s) => new Set(s).add(id));
    document.getElementById(jumpId(id))?.scrollIntoView({ block: 'center' });
  }, [data.rows]);

  /** Changes the draft now (the ref is current at once) and keeps it on the device. */
  const commit = (update: (current: ReviewDraft) => ReviewDraft) => {
    const next = update(latest.current);
    latest.current = next;
    if (hasUnsaved(next)) draft.set(next);
    else draft.clear(next);
  };
  const setNote = (scope: string, note: Note | null) =>
    setNotes((n) => {
      const rest = Object.fromEntries(Object.entries(n).filter(([k]) => k !== scope));
      return note ? { ...rest, [scope]: note } : rest;
    });

  /** One write: the words of a refusal under the part that asked, a fresh read after either answer. */
  async function write<T>(scope: string, call: () => Promise<ActionResult<T>>): Promise<{ ok: true; data: T; fresh: ReviewData | null } | { ok: false; failure: StudioFailure }> {
    setSaving(scope);
    setNote(scope, null);
    const result = await settle(call);
    if (!result.ok) {
      setNote(scope, { tone: 'error', text: phMessage(t, locale, result.error, 'pharmacy.intake') });
      if (RELOAD_ON.has(result.error.fields?.phCode ?? '')) await reload();
      setSaving(null);
      return { ok: false, failure: result.error };
    }
    const fresh = await reload();
    setSaving(null);
    return { ok: true, data: result.data, fresh };
  }

  const dropRow = (id: string) => {
    commit((c) => {
      const without = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));
      return { ...c, forms: without(c.forms), keys: without(c.keys) };
    });
    setEditing((s) => new Set([...s].filter((x) => x !== id)));
  };

  // Lines ---------------------------------------------------------------------------------------------------------------

  const saveRow = async (row: ReviewRow) => {
    const { patch } = buildRowPatch(row, latest.current.forms[row.id] ?? {}, currency);
    if (Object.keys(patch).length === 0) {
      dropRow(row.id);
      setNote(row.id, { tone: 'info', text: t('pharmacy.intake.rv.nothingToSave') });
      return;
    }
    const key = rowKeyFor(latest.current.keys[row.id], row.id, row.version, patch);
    commit((c) => ({ ...c, keys: { ...c.keys, [row.id]: key } }));
    const done = await write(row.id, () => updateIntakeRow({ rowId: row.id, version: row.version, patch, clientKey: key.clientKey }));
    if (done.ok) dropRow(row.id);
  };

  /** One scan for the whole batch: the server finds the line; the screen brings it into view and says what happened. */
  const scanBatch = async (code: string): Promise<ScanOutcome> => {
    setScanning(true);
    const result = await settle(() => scanIntakeBarcode({ batchId: data.batch.id, barcode: code, clientKey: newClientKey('iscan') }));
    if (!result.ok) {
      setScanning(false);
      const fields = result.error.fields ?? {};
      if (fields.phCode === 'NO_LINE_FOR_BARCODE') return { tone: 'info', text: t('pharmacy.intake.rv.scanAll.none', { name: isolate(String(fields.productName ?? '')) }), noLine: { productName: String(fields.productName ?? ''), code } };
      if (RELOAD_ON.has(fields.phCode ?? '')) await reload();
      return { tone: 'error', text: phMessage(t, locale, result.error, 'pharmacy.intake') };
    }
    const r = result.data as { rowId: string; lineNo: number; productName: string; how: 'open' | 'same'; filled: string[] };
    await reload();
    setScanning(false);
    // A line the filter hides is shown, so the person can see where the scan went.
    if (!openIds.includes(r.rowId)) setOnlyOpenPref(false);
    lastFocused.current = r.rowId;
    window.setTimeout(() => document.getElementById(jumpId(r.rowId))?.scrollIntoView({ block: 'center' }), 0);
    const base = t(r.how === 'open' ? 'pharmacy.intake.rv.scanAll.matched' : 'pharmacy.intake.rv.scanAll.same', { n: formatNumber(r.lineNo), name: isolate(r.productName) });
    const fields = r.filled.map((f) => t(`pharmacy.intake.rv.field.${f}`)).join(', ');
    return { tone: 'ok', text: fields ? `${base} ${t('pharmacy.intake.rv.scanAll.filled', { fields })}` : base };
  };

  /** No line fits the scanned product: add one for it (named after the product, holding the code), then scan again so it takes the product. */
  const addLineFor = async (productName: string, code: string) => {
    if (target === '') return;
    const added = await write('toolbar', () => addIntakeRow({ fileId: target }));
    if (!added.ok) return;
    const id = (added.data as { rowId: string }).rowId;
    const fresh = await reload();
    const row = fresh?.rows.find((r) => r.id === id);
    if (!row) return;
    const named = await write('toolbar', () => updateIntakeRow({ rowId: id, version: row.version, patch: { name: productName, barcodeText: code }, clientKey: newClientKey('irow') }));
    if (named.ok) await scanBatch(code);
    pendingFocus.current = id;
  };

  const reviewRow = async (row: ReviewRow, note: string, mismatchReason: string | null): Promise<boolean> => {
    const done = await write(row.id, () => reviewIntakeRow({ rowId: row.id, version: row.version, shown: reviewShown(row), note, ...(mismatchReason !== null ? { mismatchReason } : {}) }));
    return done.ok;
  };

  /** Lines to look at next: from the line last touched, round to the first. */
  const nextOpen = () => {
    const id = nextOpenId(data.rows, lastFocused.current, liveForms);
    if (!id) return;
    lastFocused.current = id;
    const el = document.getElementById(jumpId(id));
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  /** The supplier picker's search: the suppliers whose name has this text (the server limits the list; this asks it again). */
  const findSupplier = async (q: string): Promise<Array<{ id: string; name: string }> | null> => {
    const found = await settle(() => findSuppliers({ search: q, active: true }));
    return found.ok ? (found.data as { items: Array<{ id: string; name: string }> }).items.map((x) => ({ id: x.id, name: x.name })) : null;
  };

  const chooseProduct = async (row: ReviewRow, productId: string, unitId: string): Promise<string | null> => {
    const done = await write(row.id, () => matchIntakeRow({ rowId: row.id, version: row.version, productId, unitId }));
    return done.ok ? null : phMessage(t, locale, done.failure, 'pharmacy.intake');
  };

  const addLine = async () => {
    if (target === '') return;
    const done = await write('toolbar', () => addIntakeRow({ fileId: target }));
    if (done.ok) pendingFocus.current = (done.data as { rowId: string }).rowId;
  };

  const showOriginal = (row: ReviewRow) => {
    setFocus({ fileId: row.fileId, page: row.page, lineNo: row.lineNo });
    setOriginalPref(true);
    // On a narrow screen the original sits above the lines: bring it into view.
    window.setTimeout(() => document.getElementById('intake-original-pane')?.scrollIntoView({ block: 'start' }), 0);
  };

  // Header ---------------------------------------------------------------------------------------------------------------

  const saveHeader = async () => {
    const form = latest.current.header ?? {};
    const patch = buildHeaderPatch(data, form);
    if (Object.keys(patch).length === 0) {
      commit((c) => ({ ...c, header: null }));
      setNote('header', { tone: 'info', text: t('pharmacy.intake.rv.nothingToSave') });
      return;
    }
    const done = await write('header', () => updateIntakeHeader({ batchId: data.batch.id, version: data.batch.version, patch }));
    if (done.ok) commit((c) => ({ ...c, header: null }));
  };

  const acknowledge = async (reason: string): Promise<boolean> => {
    const shown = headerAckShown(data);
    if (!shown) return false;
    const done = await write('ack', () => acknowledgeIntakeHeader({ batchId: data.batch.id, version: data.batch.version, shown, reason }));
    return done.ok;
  };

  // Approval -------------------------------------------------------------------------------------------------------------

  const approve = async () => {
    // Typed work not saved, or a write still running: nothing is approved on a screen that is ahead of the server. A second press while the first is answered does nothing.
    if (approving.current || hasUnsaved({ ...latest.current, forms: Object.fromEntries(Object.entries(latest.current.forms).filter(([id]) => id in liveForms)) }) || busy) return;
    approving.current = true;
    setLink(null);
    const sig = approveSignature(data.batch.version, data.verdictToken);
    const key = attemptKeyFor(latest.current.approve ?? { clientKey: '', keySig: undefined }, sig, 'iappr', newClientKey);
    commit((c) => ({ ...c, approve: key }));
    const done = await write('approve', () => approveIntakeBatch({ batchId: data.batch.id, clientKey: key.clientKey, expectedVersion: data.batch.version, verdictToken: data.verdictToken }));
    approving.current = false;
    if (done.ok) {
      commit((c) => ({ ...c, approve: null }));
      onApproved();
      return;
    }
    const dup = duplicateTarget(done.failure.fields);
    if (dup) setLink(dup.kind === 'invoice' ? { href: `/pharmacy/purchasing/invoices/${dup.id}`, label: t('pharmacy.intake.rv.dup.invoice') } : { href: `/pharmacy/purchasing/intake/${dup.id}`, label: t('pharmacy.intake.rv.dup.batch') });
  };

  const jump = (b: Blocker) => {
    const id = b.kind === 'flag' ? jumpId(b.rowId) : 'intake-header';
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const rematch = async () => {
    const done = await write('toolbar', () => rematchIntake({ batchId: data.batch.id }));
    if (done.ok) setNote('toolbar', { tone: 'ok', text: t('pharmacy.intake.rv.rematched') });
  };

  const history = historyOf(data.rows);
  const lockedWhy = block ? t(`pharmacy.intake.reason.${block}`) : null;

  const rows = (
    <ul aria-label={t('pharmacy.intake.rv.pane.table')} data-testid="review-rows" className="flex min-w-0 flex-col border-t border-line">
      {shownRows.map((row) => (
        <IntakeRowCard
          key={row.id}
          row={row}
          currency={currency}
          block={block}
          form={draft.value.forms[row.id]}
          editing={editing.has(row.id) || row.id in draft.value.forms}
          onEdit={() => setEditing((s) => new Set(s).add(row.id))}
          onChange={(field: EditField, value) => commit((c) => ({ ...c, forms: { ...c.forms, [row.id]: { ...c.forms[row.id], [field]: value } } }))}
          onSave={() => void saveRow(row)}
          onDiscard={() => {
            dropRow(row.id);
            setNote(row.id, null);
          }}
          onRemove={() => setRemoving(row)}
          onReview={(note, mismatchReason) => reviewRow(row, note, mismatchReason)}
          onChoose={(productId, unitId) => chooseProduct(row, productId, unitId)}
          onClearMatch={() => void write(row.id, () => clearIntakeMatch({ rowId: row.id, version: row.version }))}
          onShow={() => showOriginal(row)}
          busy={busy}
          saving={saving === row.id}
          message={notes[row.id] ?? null}
          whyId={WHY}
        />
      ))}
    </ul>
  );

  return (
    <section aria-labelledby="intake-review-title" data-testid="intake-review" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="intake-review-title" className="text-md font-semibold text-text">
            {t('pharmacy.intake.review.title')}
          </h2>
          <UnsavedBadge dirty={unsaved} saved={false} />
        </div>
        <Button size="lg" className="min-h-11" icon={originalOpen ? <PanelTop aria-hidden /> : <Columns2 aria-hidden />} data-testid="original-toggle" aria-expanded={originalOpen} onClick={() => setOriginalPref(!originalOpen)}>
          {originalOpen ? t('pharmacy.intake.rv.original.hide') : t('pharmacy.intake.rv.original.show')}
        </Button>
      </div>
      {!online && unsaved && (
        <p role="status" data-testid="review-offline" className="flex items-start gap-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
          <WifiOff aria-hidden className="text-muted" />
          <span className="min-w-0">{t('pharmacy.intake.rv.offlineKeep')}</span>
        </p>
      )}
      {draft.restored && unsaved && (
        <p role="status" data-testid="review-restored" className="flex items-start gap-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
          <Info aria-hidden className="text-muted" />
          <span className="min-w-0">{t('pharmacy.intake.rv.restored')}</span>
        </p>
      )}
      {lockedWhy && open && (
        <p id={WHY} data-testid="review-why" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <Lock aria-hidden />
          <span className="min-w-0">{lockedWhy}</span>
        </p>
      )}

      <div className={originalOpen ? 'grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start' : 'flex min-w-0 flex-col gap-4'}>
        {originalOpen && (
          <div id="intake-original-pane" className="min-w-0 lg:sticky lg:top-4">
            <IntakeOriginal files={data.files} focus={focus} online={online} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          <IntakeHeaderCard
            data={data}
            suppliers={suppliers}
            findSupplier={findSupplier}
            block={block}
            form={draft.value.header}
            onOpen={() => commit((c) => ({ ...c, header: {} }))}
            onChange={(field: HeaderFormField, value) => commit((c) => ({ ...c, header: { ...(c.header ?? {}), [field]: value } }))}
            onSave={() => void saveHeader()}
            onDiscard={() => {
              commit((c) => ({ ...c, header: null }));
              setNote('header', null);
            }}
            onAcknowledge={acknowledge}
            busy={saving === 'header' || saving === 'ack'}
            message={notes.header ?? null}
            ackMessage={notes.ack ?? null}
          />

          {open && (
            <div className="flex min-w-0 flex-wrap items-end gap-3" data-testid="review-toolbar">
              {extracted.length > 1 && (
                <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
                  {t('pharmacy.intake.rv.addTo')}
                  <Select
                    size="lg"
                    className="min-h-11"
                    data-testid="add-line-file"
                    value={target}
                    onChange={(e) => setAddTo(e.target.value)}
                    options={extracted.map((f) => ({ value: f.id, label: t('pharmacy.intake.fileN', { n: formatNumber(data.files.findIndex((x) => x.id === f.id) + 1) }) }))}
                  />
                </label>
              )}
              <Button size="lg" className="min-h-11" icon={<Plus aria-hidden />} data-testid="add-line" disabled={block !== false || busy || target === ''} aria-describedby={block ? WHY : undefined} onClick={() => void addLine()}>
                {t('pharmacy.intake.rv.addLine')}
              </Button>
              <Button size="lg" className="min-h-11" icon={<RefreshCw aria-hidden />} data-testid="rematch" disabled={block !== false || busy || data.rows.length === 0} aria-describedby={block ? WHY : undefined} onClick={() => void rematch()}>
                {t('pharmacy.intake.rv.rematch')}
              </Button>
            </div>
          )}
          {open && (
            <IntakeScan
              onScan={scanBatch}
              onAddLine={(name, code) => void addLineFor(name, code)}
              blocked={block ? t(`pharmacy.intake.reason.${block}`) : null}
            />
          )}
          {open && data.rows.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-3" data-testid="review-filter">
              <Button
                size="lg"
                className="min-h-11"
                icon={<Filter aria-hidden />}
                data-testid="filter-open"
                aria-pressed={onlyOpen}
                onClick={() => setOnlyOpenPref(!onlyOpen)}
              >
                {onlyOpen ? t('pharmacy.intake.rv.filter.all') : t('pharmacy.intake.rv.filter.only', { count: formatNumber(openIds.length) })}
              </Button>
              <Button size="lg" className="min-h-11" icon={<ListChecks aria-hidden />} data-testid="next-open" disabled={openIds.length === 0} onClick={nextOpen}>
                {openIds.length === 0 ? t('pharmacy.intake.rv.next.none') : t('pharmacy.intake.rv.next')}
              </Button>
              <span data-testid="filter-count" className="text-sm text-muted">
                {t('pharmacy.intake.rv.filter.showing', { shown: formatNumber(shownRows.length), total: formatNumber(data.rows.length) })}
              </span>
            </div>
          )}
          {notes.toolbar && <Message tone={notes.toolbar.tone} testId="toolbar-message">{notes.toolbar.text}</Message>}

          {data.rows.length === 0 ? (
            <div data-testid="review-empty" className="flex min-w-0 flex-col gap-1">
              <Message tone="info">
                <strong className="font-semibold">{t('pharmacy.intake.rv.empty')}</strong> {t('pharmacy.intake.rv.emptyBody')}
              </Message>
            </div>
          ) : (
            rows
          )}

          {!open && data.rows.length > 0 && (
            <div data-testid="review-history" className="flex min-w-0 flex-col gap-1 border-t border-line pt-3">
              <h3 className="text-sm font-semibold text-text">{t('pharmacy.intake.rv.history.title')}</h3>
              <p className="text-sm text-text">
                {t('pharmacy.intake.rv.history.counts', { lines: formatNumber(history.lines), edited: formatNumber(history.edited), removed: formatNumber(history.removed), added: formatNumber(history.added), reviewed: formatNumber(history.reviewed) })}
              </p>
            </div>
          )}

          {open && (
            <IntakeApproveBar
              data={data}
              blockers={blockers}
              block={approveBlock}
              busy={saving === 'approve'}
              unsavedText={unsavedText}
              onConfirm={approve}
              onJump={jump}
              message={notes.approve ?? null}
              link={link}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t('pharmacy.intake.rv.remove.title')}
        body={t('pharmacy.intake.rv.remove.body')}
        confirmLabel={t('pharmacy.intake.rv.remove.yes')}
        onConfirm={async () => {
          const row = removing;
          if (!row) return true;
          const done = await write(row.id, () => removeIntakeRow({ rowId: row.id, version: row.version }));
          if (done.ok) {
            dropRow(row.id);
            setRemoving(null);
            return true;
          }
          return { message: phMessage(t, locale, done.failure, 'pharmacy.intake') };
        }}
      />
    </section>
  );
}

