'use client';

import { useRef, useState } from 'react';
import { addEntryLine, finishEntry, lookupEntryProduct, readEntryDraft } from '@/app/pharmacy/_actions/entry';
import type { EntryLineResult } from '@/server/pharmacy/fast-entry';
import type { StudioFailure } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { newKey } from '../receipt-draft';
import { outcomeUnknown } from '../sell-logic';
import { entryRequest, emptyEntryForm, type EntryForm, type EntryLineRequest, type EntryProblem } from './entry-logic';
import { enterOrder, knownForm, labelKey, newForm, refusedField, type EntryDraft, type EntryFieldName, type KnownLookup } from './entry-fields';

/** What the screen is showing under the scan field. */
export type EntryTargetState =
  | { kind: 'idle'; note: 'start' | 'ready' | { name: string; replayed: boolean } }
  | { kind: 'loading' }
  | { kind: 'choose'; candidates: { productId: string; tradeName: string; packLabel: string }[] }
  | { kind: 'known'; found: KnownLookup }
  | { kind: 'new'; barcode: string | null; canCreate: boolean };

export interface EntryMessage {
  tone: 'ok' | 'err';
  text: string;
  /** The field the message is about (marked invalid and focused). */
  field?: EntryFieldName;
}

export type FocusTarget = EntryFieldName | 'scan';
type LookupInput = { q: string } | { productId: string };

const PROBLEM_KEY: Record<EntryProblem, string> = {
  missing: 'pharmacy.entry.msg.missing',
  expiry: 'pharmacy.entry.msg.expiry',
  qty: 'pharmacy.entry.msg.qty',
  number: 'pharmacy.entry.msg.number',
};

/**
 * The entry screen's state and its server calls: look a scan up, fill the form, save one line, finish the entry. Each call
 * is guarded against a second press while it runs (a ref, so two Enters in one tick send once). A save whose answer is lost
 * keeps its request (key and body): the form freezes on the line that was sent, Save resends exactly that body with the
 * same key (the server answers the line it may already have added, never a second one), and only Esc or the armed drop
 * button forgets it, re-reading the entry so the list shows whether it landed. Finish and new scans wait meanwhile. A scan
 * made while a save is on its way is opened once the save is answered.
 */
export function useEntry({ canChangePrice, initialDraft, suppliers, focus }: { canChangePrice: boolean; initialDraft: EntryDraft; suppliers: { id: string; name: string }[]; focus: (to: FocusTarget) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [target, setTarget] = useState<EntryTargetState>({ kind: 'idle', note: 'start' });
  const [form, setForm] = useState<EntryForm>(() => emptyEntryForm(!canChangePrice));
  const [scan, setScan] = useState('');
  const [msg, setMsg] = useState<EntryMessage | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(initialDraft);
  const [sending, setSending] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState<{ number: string | null; lines: number } | null>(null);
  const busy = useRef({ lookup: false, save: false, finish: false });
  const pending = useRef<EntryLineRequest | null>(null);
  const queued = useRef<LookupInput | null>(null);
  const seq = useRef(0);

  const failureText = (error: StudioFailure) => describeFailure(t, locale, error).message;
  const kind = target.kind === 'known' ? 'known' : 'new';
  const locked = form.sellPriceLocked;
  const formShown = target.kind === 'known' || (target.kind === 'new' && target.canCreate);

  async function refreshDraft() {
    try {
      const res = await readEntryDraft({});
      if (res.ok) setDraft(res.data.draft);
    } catch {
      // Still no answer: the list stays as it is until the next save or a reload.
    }
  }

  /** Forget a save whose answer was lost, and re-read the entry to show whether it landed. */
  function dropPending() {
    if (pending.current === null) return;
    pending.current = null;
    setFrozen(false);
    void refreshDraft();
  }

  function clear(note: 'start' | 'ready' | { name: string; replayed: boolean } = 'ready') {
    seq.current += 1;
    dropPending();
    setTarget({ kind: 'idle', note });
    setForm(emptyEntryForm(!canChangePrice));
    setMsg(null);
    setScan('');
    focus('scan');
  }

  async function lookup(input: LookupInput) {
    if (pending.current !== null && !busy.current.save) {
      // A line whose answer was lost waits: it is sent again or dropped first, never left behind by a new scan.
      setMsg({ tone: 'err', text: t('pharmacy.entry.msg.pendingFirst') });
      return;
    }
    if (busy.current.save) {
      queued.current = input;
      return;
    }
    if (busy.current.lookup) return;
    busy.current.lookup = true;
    const mine = (seq.current += 1);
    setTarget({ kind: 'loading' });
    setMsg(null);
    let res: Awaited<ReturnType<typeof lookupEntryProduct>> | null = null;
    try {
      res = await lookupEntryProduct(input);
    } catch {
      res = null;
    }
    busy.current.lookup = false;
    if (mine !== seq.current) return;
    if (!res || !res.ok) {
      setTarget({ kind: 'idle', note: 'ready' });
      setMsg({ tone: 'err', text: res ? failureText(res.error) : t('pharmacy.entry.msg.lookupLost') });
      focus('scan');
      return;
    }
    const found = res.data;
    const lockedNow = !found.canChangePrice;
    if (found.kind === 'known') {
      setForm(knownForm(found, lockedNow, draft));
      setTarget({ kind: 'known', found });
      focus('qty');
    } else if (found.kind === 'new') {
      setForm(newForm(found.barcode, 'q' in input ? input.q : '', lockedNow, draft));
      setTarget({ kind: 'new', barcode: found.barcode, canCreate: found.canCreateProduct });
      focus(found.canCreateProduct ? 'name' : 'scan');
    } else {
      setTarget({ kind: 'choose', candidates: found.candidates });
    }
  }

  function onSaved(data: EntryLineResult, supplierId: string | null) {
    setDraft((prev) => {
      const same = prev !== null && prev.receiptId === data.receiptId;
      const lines = [data.line, ...(same ? prev.lines.filter((l) => l.lineNo !== data.line.lineNo) : [])];
      const supplier = same ? prev.supplierId : supplierId;
      return {
        receiptId: data.receiptId,
        version: data.version,
        supplierId: supplier,
        supplierName: same ? prev.supplierName : (suppliers.find((s) => s.id === supplier)?.name ?? ''),
        createdAt: same ? prev.createdAt : new Date().toISOString(),
        lineCount: data.lineCount,
        lines,
      };
    });
    clear({ name: data.line.productName, replayed: data.replayed });
  }

  async function save() {
    if (busy.current.save || busy.current.finish || !formShown) return;
    let request = pending.current;
    if (!request) {
      const entryTarget = target.kind === 'known' ? ({ kind: 'known', productId: target.found.product.id } as const) : ({ kind: 'new', barcode: target.kind === 'new' ? target.barcode : null } as const);
      const built = entryRequest(form, entryTarget, newKey(), new Date());
      if (!built.ok) {
        const field = built.field as EntryFieldName;
        setMsg({ tone: 'err', text: t(PROBLEM_KEY[built.problem], { field: t(labelKey(field, kind)) }), field });
        focus(field);
        return;
      }
      request = built.request;
    }
    pending.current = request;
    busy.current.save = true;
    setSending(true);
    let res: Awaited<ReturnType<typeof addEntryLine>> | null = null;
    try {
      res = await addEntryLine(request);
    } catch {
      res = null;
    }
    busy.current.save = false;
    setSending(false);
    const next = queued.current;
    queued.current = null;
    if (!res || (!res.ok && outcomeUnknown(res.error))) {
      // No answer, or an unexpected one (the cashier's rule): the request stays, frozen: Save resends it byte for byte with the
      // same key; the list is re-read to show whether it landed.
      setFrozen(true);
      setMsg({ tone: 'err', text: t('pharmacy.entry.msg.lost') });
      void refreshDraft();
      return;
    }
    pending.current = null;
    setFrozen(false);
    if (!res.ok) {
      const named = refusedField(res.error.fields, enterOrder(kind, locked));
      if (res.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') {
        setMsg({ tone: 'err', text: t('pharmacy.entry.msg.keyMismatch') });
      } else if (named) {
        const message = failureText({ ...res.error, message: named.message });
        setMsg({ tone: 'err', text: t('pharmacy.entry.msg.field', { field: t(labelKey(named.field, kind)), message }), field: named.field });
        focus(named.field);
      } else {
        setMsg({ tone: 'err', text: failureText(res.error) });
      }
      if (res.error.code === 'CONFLICT' || res.error.code === 'NOT_FOUND') void refreshDraft();
      return;
    }
    onSaved(res.data, request.supplierId);
    if (next) {
      // The scan made while this save was on its way.
      if ('q' in next) setScan(next.q);
      void lookup(next);
    }
  }

  async function finish() {
    if (busy.current.finish || busy.current.save || pending.current !== null || !draft || draft.lines.length === 0) return;
    busy.current.finish = true;
    setFinishing(true);
    setMsg(null);
    let res: Awaited<ReturnType<typeof finishEntry>> | null = null;
    try {
      // The receipt id makes a repeat answer the receipt it already posted.
      res = await finishEntry({ receiptId: draft.receiptId });
    } catch {
      res = null;
    }
    busy.current.finish = false;
    setFinishing(false);
    if (!res) {
      setMsg({ tone: 'err', text: t('pharmacy.entry.finishLost') });
      return;
    }
    if (!res.ok) {
      setMsg({ tone: 'err', text: failureText(res.error) });
      void refreshDraft();
      return;
    }
    setFinished({ number: res.data.number, lines: res.data.lines });
  }

  function again() {
    setFinished(null);
    setDraft(null);
    clear('start');
  }

  function setField(name: keyof EntryForm, value: string | boolean) {
    if (pending.current !== null) return;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (msg?.field === name) setMsg(null);
  }

  return { target, form, setField, scan, setScan, msg, draft, sending, frozen, finishing, finished, formShown, lookup, clear, save, finish, again };
}
