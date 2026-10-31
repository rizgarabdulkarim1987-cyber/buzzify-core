'use client';

import { CircleAlert, CircleCheck, FileText, Lock, Printer, Save, Tag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { setPrintSettings } from '@/app/pharmacy/_actions/print';
import {
  DEFAULT_WORKSTATION,
  LABEL_SIZES,
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
  PAPERS,
  settingsOfWorkstation,
  workstationName,
  workstationSettings,
  type PrintSettings,
  type WorkstationSettings,
} from '@/server/domain/pharmacy/print-settings';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { LabelView } from './LabelView';
import { labelCss, pageCss } from './print-logic';
import { phDate } from './ph-date';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { useWorkstation } from './use-workstation';
import type { Writable } from './WriteBlocked';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Draft = { paper: WorkstationSettings['paper']; labelSize: WorkstationSettings['labelSize']; showPrice: boolean; margins: Record<(typeof SIDES)[number], string> };

const draftOf = (s: WorkstationSettings): Draft => ({ paper: s.paper, labelSize: s.labelSize, showPrice: s.showPrice, margins: { top: String(s.marginMm.top), right: String(s.marginMm.right), bottom: String(s.marginMm.bottom), left: String(s.marginMm.left) } });

/** The draft as the settings shape, or null while a margin is not a whole number from 0 to 40. */
function settingsOf(draft: Draft): WorkstationSettings | null {
  const n = (text: string) => (/^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
  const parsed = workstationSettings.safeParse({ paper: draft.paper, labelSize: draft.labelSize, showPrice: draft.showPrice, marginMm: { top: n(draft.margins.top), right: n(draft.margins.right), bottom: n(draft.margins.bottom), left: n(draft.margins.left) } });
  return parsed.success ? parsed.data : null;
}

/**
 * This workstation's printing settings: the paper and margins of an A4 sheet, the default label size and whether labels show the price, with a
 * test page and a test label to check them on the real printer. The workstation's name is kept on this device; the settings are the owner's to
 * save (a manager reads them), and a read-only pharmacy shows them without a save control. Browser print only.
 */
export function PrintSettingsForm({ print, version: startVersion, editable, writable }: { print: PrintSettings; version: number; editable: boolean; writable: Writable }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [workstation, setWorkstation] = useWorkstation();
  const [nameText, setNameText] = useState<string | null>(null);
  const name = nameText ?? workstation ?? '';
  const known = Object.keys(print.workstations);
  const stored = settingsOfWorkstation(print, name);
  const [edits, setEdits] = useState<{ for: string; draft: Draft } | null>(null);
  const draft = edits && edits.for === name ? edits.draft : draftOf(stored);
  const [version, setVersion] = useState(startVersion);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [what, setWhat] = useState<'a4' | 'label' | null>(null);
  const [printFailed, setPrintFailed] = useState(false);

  const current = settingsOf(draft);
  const nameOk = workstationName.safeParse(name).success;
  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setEdits({ for: name, draft: { ...draft, ...patch } });
  };

  const save = async () => {
    if (busy || !current || !nameOk || !editable || !writable.ok) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() => setPrintSettings({ workstation: name.trim(), settings: current, version }));
    setBusy(false);
    if (!result.ok) {
      setProblem(phMessage(t, locale, result.error, 'pharmacy.print'));
      return;
    }
    setVersion((result.data as { version: number }).version);
    setWorkstation(name.trim());
    setSaved(true);
    router.refresh();
  };

  const testPrint = (which: 'a4' | 'label') => {
    setPrintFailed(false);
    flushSync(() => setWhat(which));
    try {
      window.print();
    } catch {
      setPrintFailed(true);
    }
  };

  const shown = current ?? DEFAULT_WORKSTATION;
  // A role that only reads is told so by the owner-only note; the lock sentence here is for a lapsed pharmacy and support.
  const blockedText = writable.ok || writable.reason === 'role' ? null : writable.reason === 'readOnly' ? t('pharmacy.print.blocked.readOnly', { date: phDate(writable.until, locale) }) : t(`pharmacy.print.blocked.${writable.reason}`);
  const labelText = { noBarcode: t('pharmacy.print.labels.noBarcode'), tooNarrow: t('pharmacy.print.labels.tooNarrow'), lot: t('pharmacy.print.labels.lot'), expiry: t('pharmacy.print.labels.expiry') };

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="print-settings">
      {what === 'a4' && <style>{pageCss(shown)}</style>}
      {what === 'label' && <style>{labelCss(shown.labelSize)}</style>}
      <div className="flex min-w-0 flex-col gap-5 print:hidden">
        {blockedText && (
          <p data-testid="print-settings-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <Lock aria-hidden className="text-muted" />
            <span className="min-w-0">{blockedText}</span>
          </p>
        )}
        {!editable && !blockedText && (
          <p data-testid="print-settings-readonly" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <Lock aria-hidden className="text-muted" />
            <span className="min-w-0">{t('pharmacy.print.settings.ownerOnly')}</span>
          </p>
        )}

        <Field label={t('pharmacy.print.settings.workstation')} hint={t('pharmacy.print.settings.workstationHint')} {...(!nameOk && name !== '' ? { error: t('pharmacy.print.settings.workstationBad') } : {})}>
          <FieldInput className={FIELD} value={name} onChange={(event) => { setNameText(event.target.value); setSaved(false); }} list="print-workstations" autoComplete="off" data-testid="ws-name" />
        </Field>
        <datalist id="print-workstations">
          {known.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        {workstation === null && <p className="text-sm text-muted">{t('pharmacy.print.workstationNone')}: {t('pharmacy.print.settings.defaultsShown')}</p>}

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2" disabled={!editable || !writable.ok}>
          <legend className="mb-1 text-md font-semibold text-text">{t('pharmacy.print.settings.a4')}</legend>
          <Field label={t('pharmacy.print.settings.paper')}>
            <FieldSelect className={`${FIELD} pe-8`} value={draft.paper} onChange={(event) => change({ paper: event.target.value as Draft['paper'] })} data-testid="ws-paper">
              {PAPERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
            {SIDES.map((side) => {
              const bad = !/^\d{1,2}$/.test(draft.margins[side].trim()) || Number(draft.margins[side]) > MARGIN_MAX_MM;
              return (
                <Field key={side} label={t(`pharmacy.print.settings.margin.${side}`)} {...(bad ? { error: t('pharmacy.print.settings.marginBad', { min: MARGIN_MIN_MM, max: MARGIN_MAX_MM }) } : {})}>
                  <FieldInput inputMode="numeric" dir="ltr" className={FIELD} value={draft.margins[side]} onChange={(event) => change({ margins: { ...draft.margins, [side]: event.target.value } })} data-testid={`ws-margin-${side}`} />
                </Field>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2" disabled={!editable || !writable.ok}>
          <legend className="mb-1 text-md font-semibold text-text">{t('pharmacy.print.settings.labels')}</legend>
          <Field label={t('pharmacy.print.labels.size')}>
            <FieldSelect className={`${FIELD} pe-8`} value={draft.labelSize} onChange={(event) => change({ labelSize: event.target.value as Draft['labelSize'] })} data-testid="ws-label-size">
              {LABEL_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`pharmacy.print.size.${s}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text">
            <input type="checkbox" className="size-5" checked={draft.showPrice} onChange={(event) => change({ showPrice: event.target.checked })} data-testid="ws-show-price" />
            {t('pharmacy.print.labels.showPrice')}
          </label>
        </fieldset>

        {problem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="print-settings-problem">
            {problem}
          </Note>
        )}
        {saved && (
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="print-settings-saved">
            {t('pharmacy.settings.saved')}
          </Note>
        )}
        <div className="flex flex-wrap gap-2">
          {editable && writable.ok && (
            <button type="button" className={TOUCH_PRIMARY} onClick={() => void save()} disabled={busy || !current || !nameOk} data-testid="ws-save">
              <Save aria-hidden className="size-4" />
              {t(busy ? 'pharmacy.settings.saving' : 'pharmacy.settings.save')}
            </button>
          )}
          <button type="button" className={TOUCH_BTN} onClick={() => testPrint('a4')} disabled={!current} data-testid="test-a4">
            <FileText aria-hidden className="size-4" />
            {t('pharmacy.print.test.a4')}
          </button>
          <button type="button" className={TOUCH_BTN} onClick={() => testPrint('label')} disabled={!current} data-testid="test-label">
            <Tag aria-hidden className="size-4" />
            {t('pharmacy.print.test.label')}
          </button>
        </div>
        {printFailed && (
          <Note icon={<Printer aria-hidden />} tone="danger" role="alert" testId="test-print-failed">
            {t('pharmacy.sell.receipt.printFailed')}
          </Note>
        )}
        <p className="text-xs text-muted">{t('pharmacy.print.browserOnly')}</p>
      </div>

      {/* What the printer receives for a test: hidden on screen. */}
      {what === 'a4' && (
        <div className="hidden print:block" data-testid="test-a4-sheet" aria-hidden="true">
          <div className="border-2 border-black p-4 text-black">
            <p className="text-lg font-bold">{t('pharmacy.print.test.a4Title')}</p>
            <p>{t('pharmacy.print.test.a4Body', { paper: shown.paper, top: shown.marginMm.top, right: shown.marginMm.right, bottom: shown.marginMm.bottom, left: shown.marginMm.left })}</p>
            <p className="mt-4">{t('pharmacy.print.test.ruler')}</p>
            <div className="mt-1 h-3 w-[100mm] border-x-2 border-b-2 border-black" />
          </div>
        </div>
      )}
      {what === 'label' && (
        <div className="hidden print:block" dir="ltr" data-testid="test-label-sheet" aria-hidden="true">
          <LabelView item={{ key: 't', productId: 't', name: t('pharmacy.print.test.labelName'), strength: '500 mg', form: '', barcode: '123456789012', lot: 'TEST-1', expiry: '2030-12-31', price: null, qty: 1 }} size={shown.labelSize} showPrice={false} labels={labelText} />
        </div>
      )}
    </div>
  );
}
