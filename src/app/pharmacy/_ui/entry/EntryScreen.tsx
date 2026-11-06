'use client';

import { CircleCheck, List, ScanBarcode, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/studio/i18n';
import { Num, PH_BTN, PH_PRIMARY } from '../sell-parts';
import type { EntryDraft, EntryFieldName } from './entry-fields';
import { EntryForm } from './EntryForm';
import { EntrySide } from './EntrySide';
import { EntryStatus } from './EntryStatus';
import { ProductHistory } from './ProductHistory';
import { useEntry, type FocusTarget } from './use-entry';

export interface EntryScreenProps {
  /** The branch the entry goes into (the server takes it from the place; it keys the screen). */
  branchId: string;
  /** `price.change`: the selling price is editable; read-only (and never sent) otherwise. */
  canChangePrice: boolean;
  /** `cost.view`: the purchase price column of the history. */
  canSeeCost: boolean;
  /** Live suppliers for the supplier field. */
  suppliers: { id: string; name: string }[];
  /** The person's open entry in this branch (`ph.stock.entry.draft`): the "entered now" list after a reload. */
  initialDraft: EntryDraft;
}

/**
 * Fast product entry (docs/pharmacy/prototypes/product-entry-2026-11-05.html): one large scan field, a status line that says
 * whether the product is known or new, the form (`EntryForm`), the product's history under it (`ProductHistory`) and the
 * "entered now" list with Finish beside it (`EntrySide`). Enter in the scan field looks the code or name up; Enter walks the
 * form and saves from its last field; F2 saves from anywhere; Esc clears. After a save the scan field is empty and focused.
 * A key is prevented only when it acted. No dialog and no motion; everything is on this one screen.
 */
export function EntryScreen({ canChangePrice, canSeeCost, suppliers, initialDraft }: EntryScreenProps) {
  const t = useT();
  const scanRef = useRef<HTMLInputElement>(null);
  const fields = useRef(new Map<string, HTMLElement>());
  const [focusReq, setFocusReq] = useState<{ to: FocusTarget; n: number }>({ to: 'scan', n: 0 });
  const focus = useCallback((to: FocusTarget) => setFocusReq((prev) => ({ to, n: prev.n + 1 })), []);
  useEffect(() => {
    const el = focusReq.to === 'scan' ? scanRef.current : fields.current.get(focusReq.to);
    el?.focus();
  }, [focusReq]);
  const register = useCallback(
    (name: EntryFieldName) => (el: HTMLElement | null) => {
      if (el) fields.current.set(name, el);
      else fields.current.delete(name);
    },
    [],
  );

  const entry = useEntry({ canChangePrice, initialDraft, suppliers, focus });
  const { target, scan, msg, finished } = entry;

  // F2 and Esc from anywhere on the screen (Enter is handled by the field it is pressed in).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (finished || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'F2' && entry.formShown) {
        e.preventDefault();
        void entry.save();
      } else if (e.key === 'Escape' && (target.kind !== 'idle' || scan !== '' || msg !== null)) {
        e.preventDefault();
        entry.clear();
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const count = entry.draft?.lines.length ?? 0;
  const header = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="text-[26px] font-bold leading-8 tracking-tight text-ph-text">{t('pharmacy.entry.title')}</h1>
      <span data-testid="entry-count" className="rounded-full bg-ph-g1 px-3 py-1 text-sm font-semibold text-ph-g8">
        {t('pharmacy.entry.count', { count })}
      </span>
      <span className="flex-1" />
      <Link href="/pharmacy/stock" data-testid="entry-stock-list" className={PH_BTN}>
        <List aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.entry.stockList')}
      </Link>
    </div>
  );

  if (finished) {
    return (
      <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-6">
        {header}
        <section data-testid="entry-finished" role="status" className="flex min-w-0 flex-col items-start gap-3 rounded-ph-2xl border border-ph-line bg-ph-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ph-g8">
            <CircleCheck aria-hidden className="size-5 shrink-0" />
            {t('pharmacy.entry.done.title')}
          </h2>
          <p className="text-sm text-ph-text">
            {t('pharmacy.entry.done.body', { count: finished.lines, number: finished.number ?? '-' })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/pharmacy/stock" data-testid="entry-back" className={PH_BTN}>
              {t('pharmacy.entry.done.stock')}
            </Link>
            <button type="button" data-testid="entry-again" className={PH_PRIMARY} onClick={entry.again}>
              {t('pharmacy.entry.done.again')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const formKind = target.kind === 'known' ? 'known' : 'new';
  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-6">
      {header}
      <section className="flex min-w-0 flex-col gap-2.5 rounded-ph-2xl border border-ph-line bg-ph-card p-3">
        <div className="flex min-w-0 gap-2">
          <label className="relative flex min-w-0 flex-1">
            <span className="sr-only">{t('pharmacy.entry.scan.label')}</span>
            <ScanBarcode aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-ph-muted" />
            <input
              ref={scanRef}
              data-testid="entry-scan"
              type="text"
              dir="auto"
              autoComplete="off"
              autoFocus
              enterKeyHint="search"
              value={scan}
              placeholder={t('pharmacy.entry.scan.hint')}
              onChange={(e) => entry.setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing || scan.trim() === '') return;
                e.preventDefault();
                void entry.lookup({ q: scan.trim() });
              }}
              className="min-h-14 w-full min-w-0 rounded-ph-xl border-2 border-ph-g6 bg-ph-card ps-12 pe-4 text-xl text-ph-text placeholder:text-base placeholder:text-ph-muted focus:border-ph-g8"
            />
          </label>
          <button type="button" data-testid="entry-clear" className={`${PH_BTN} min-h-14 shrink-0`} onClick={() => entry.clear()}>
            <X aria-hidden className="size-4 shrink-0" />
            <span className="max-sm:sr-only">{t('pharmacy.entry.clear')}</span>
            <small className="text-xs font-medium text-ph-muted">
              <Num>Esc</Num>
            </small>
          </button>
        </div>
        <EntryStatus target={target} onPick={(productId) => void entry.lookup({ productId })} />
        {!entry.formShown && msg && (
          <p data-testid="entry-msg" role="status" className={`text-sm font-semibold ${msg.tone === 'err' ? 'text-ph-red' : 'text-ph-g6'}`}>
            {msg.text}
          </p>
        )}
      </section>

      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {entry.formShown && (
            <>
              <EntryForm
                kind={formKind}
                found={target.kind === 'known' ? target.found : null}
                form={entry.form}
                setField={entry.setField}
                suppliers={suppliers}
                draft={entry.draft}
                msg={msg}
                sending={entry.sending}
                register={register}
                focus={focus}
                onSave={() => void entry.save()}
              />
              <ProductHistory productId={target.kind === 'known' ? target.found.product.id : null} canSeeCost={canSeeCost} />
            </>
          )}
        </div>
        <EntrySide draft={entry.draft} busy={entry.sending} finishing={entry.finishing} onFinish={() => void entry.finish()} />
      </div>
    </div>
  );
}
