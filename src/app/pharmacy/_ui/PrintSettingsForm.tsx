'use client';

import { CircleAlert, CircleCheck, FileText, Lock, Printer, Receipt, Save, Tag, Unlock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { setPrintSettings } from '@/app/pharmacy/_actions/print';
import { bridgeAlive } from '@/app/pos/_ui/print/print-client';
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
import { draftOfPrinter, listBridgePrinters, openThermalDrawer, printerOfDraft, printThermalTest, type BridgePrinter, type PrinterDraft } from './thermal-print';
import { phDate } from './ph-date';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, FieldSelect, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { useWorkstation } from './use-workstation';
import type { Writable } from './WriteBlocked';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Draft = { paper: WorkstationSettings['paper']; labelSize: WorkstationSettings['labelSize']; showPrice: boolean; printer: PrinterDraft; margins: Record<(typeof SIDES)[number], string> };

const draftOf = (s: WorkstationSettings): Draft => ({ paper: s.paper, labelSize: s.labelSize, showPrice: s.showPrice, printer: draftOfPrinter(s.receiptPrinter), margins: { top: String(s.marginMm.top), right: String(s.marginMm.right), bottom: String(s.marginMm.bottom), left: String(s.marginMm.left) } });

/** The draft as the settings shape, or null while a margin is not a whole number from 0 to 40. */
function settingsOf(draft: Draft): WorkstationSettings | null {
  const n = (text: string) => (/^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
  const printer = printerOfDraft(draft.printer);
  if (!printer.ok) return null;
  const parsed = workstationSettings.safeParse({ paper: draft.paper, labelSize: draft.labelSize, showPrice: draft.showPrice, ...(printer.value ? { receiptPrinter: printer.value } : {}), marginMm: { top: n(draft.margins.top), right: n(draft.margins.right), bottom: n(draft.margins.bottom), left: n(draft.margins.left) } });
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
  const [bridge, setBridge] = useState<'unknown' | 'up' | 'down'>('unknown');
  const [found, setFound] = useState<BridgePrinter[]>([]);
  const [pickedUnshared, setPickedUnshared] = useState<string | null>(null);
  const [thermalNote, setThermalNote] = useState<'idle' | 'printing' | 'ok' | 'bridge' | 'printer' | 'drawer'>('idle');

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

  const checkBridge = () => {
    setBridge('unknown');
    void bridgeAlive().then((up) => {
      setBridge(up ? 'up' : 'down');
      if (up) void listBridgePrinters().then(setFound);
      else setFound([]);
    });
  };
  useEffect(() => {
    let cancelled = false;
    void bridgeAlive().then((up) => {
      if (cancelled) return;
      setBridge(up ? 'up' : 'down');
      if (up) {
        void listBridgePrinters().then((list) => {
          if (!cancelled) setFound(list);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const printerNow = printerOfDraft(draft.printer);
  const thermalSettings: WorkstationSettings | null = current && printerNow.ok && printerNow.value ? { ...current, receiptPrinter: printerNow.value } : null;
  const thermalBad = draft.printer.address.trim() !== '' && !printerNow.ok;
  const runThermal = async (what: 'test' | 'drawer') => {
    if (!thermalSettings) return;
    setThermalNote('printing');
    const result = what === 'test' ? await printThermalTest(thermalSettings) : await openThermalDrawer(thermalSettings);
    setThermalNote(result.ok ? (what === 'drawer' ? 'drawer' : 'ok') : result.reason === 'printer' ? 'printer' : 'bridge');
  };
  const chosen = found.find((p) => p.shared && p.shareName === draft.printer.address.trim());
  const pickFound = (name: string) => {
    const printer = found.find((p) => p.name === name);
    if (!printer) return;
    setPickedUnshared(printer.shared ? null : printer.name);
    changePrinter({ transport: 'FILE', address: printer.shared ? printer.shareName : '' });
  };
  const changePrinter = (patch: Partial<PrinterDraft>) => change({ printer: { ...draft.printer, ...patch } });
  const thermalDone = thermalNote === 'ok' || thermalNote === 'drawer';

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

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2" disabled={!editable || !writable.ok} data-testid="thermal-settings">
          <legend className="mb-1 text-md font-semibold text-text">{t('pharmacy.print.thermal.title')}</legend>
          <p className="text-sm text-muted sm:col-span-2">{t('pharmacy.print.thermal.intro')}</p>
          <Field label={t('pharmacy.print.thermal.connection')}>
            <FieldSelect className={`${FIELD} pe-8`} value={draft.printer.transport} onChange={(event) => changePrinter({ transport: event.target.value as PrinterDraft['transport'], address: '' })} data-testid="thermal-transport">
              <option value="NETWORK">{t('pharmacy.print.thermal.network')}</option>
              <option value="FILE">{t('pharmacy.print.thermal.shared')}</option>
            </FieldSelect>
          </Field>
          {found.length > 0 && (
            <Field label={t('pharmacy.print.thermal.found')} className="sm:col-span-2" {...(pickedUnshared ? { error: t('pharmacy.print.thermal.notShared') } : {})}>
              <FieldSelect className={`${FIELD} pe-8`} value={pickedUnshared ?? chosen?.name ?? ''} onChange={(event) => pickFound(event.target.value)} data-testid="thermal-found">
                <option value="" disabled>
                  {t('pharmacy.print.thermal.pick')}
                </option>
                {found.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </FieldSelect>
            </Field>
          )}
          <Field label={t('pharmacy.print.thermal.address')} hint={t(draft.printer.transport === 'NETWORK' ? 'pharmacy.print.thermal.addressNetwork' : 'pharmacy.print.thermal.addressShared')} {...(thermalBad ? { error: t('pharmacy.print.thermal.addressBad') } : {})}>
            <FieldInput dir="ltr" className={FIELD} value={draft.printer.address} onChange={(event) => changePrinter({ address: event.target.value })} autoComplete="off" placeholder={draft.printer.transport === 'NETWORK' ? '192.168.1.50:9100' : 'XP80'} data-testid="thermal-address" />
          </Field>
          <Field label={t('pharmacy.print.thermal.paper')}>
            <FieldSelect className={`${FIELD} pe-8`} value={draft.printer.paperWidth} onChange={(event) => changePrinter({ paperWidth: event.target.value as PrinterDraft['paperWidth'] })} data-testid="thermal-paper">
              <option value="80">{'\u206880 mm\u2069'}</option>
              <option value="58">{'\u206858 mm\u2069'}</option>
            </FieldSelect>
          </Field>
          <Field label={t('pharmacy.print.thermal.drawer')}>
            <FieldSelect className={`${FIELD} pe-8`} value={draft.printer.drawerPin} onChange={(event) => changePrinter({ drawerPin: event.target.value as PrinterDraft['drawerPin'] })} data-testid="thermal-drawer-pin">
              <option value="none">{t('pharmacy.print.thermal.drawerNone')}</option>
              <option value="2">{t('pharmacy.print.thermal.drawerPin2')}</option>
              <option value="5">{t('pharmacy.print.thermal.drawerPin5')}</option>
            </FieldSelect>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input type="checkbox" className="size-5" checked={draft.printer.cut} onChange={(event) => changePrinter({ cut: event.target.checked })} data-testid="thermal-cut" />
            {t('pharmacy.print.thermal.cut')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-text sm:col-span-2">
            <input type="checkbox" className="size-5" checked={draft.printer.drawerOnCash} disabled={draft.printer.drawerPin === 'none'} onChange={(event) => changePrinter({ drawerOnCash: event.target.checked })} data-testid="thermal-drawer-cash" />
            {t('pharmacy.print.thermal.drawerOnCash')}
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2" data-testid="thermal-actions">
          <button type="button" className={TOUCH_BTN} onClick={() => void runThermal('test')} disabled={!thermalSettings || thermalNote === 'printing'} data-testid="thermal-test">
            <Receipt aria-hidden className="size-4" />
            {t('pharmacy.print.thermal.test')}
          </button>
          <button type="button" className={TOUCH_BTN} onClick={() => void runThermal('drawer')} disabled={!thermalSettings || draft.printer.drawerPin === 'none' || thermalNote === 'printing'} data-testid="thermal-open-drawer">
            <Unlock aria-hidden className="size-4" />
            {t('pharmacy.print.thermal.openDrawer')}
          </button>
          <button type="button" className={TOUCH_BTN} onClick={checkBridge} data-testid="thermal-check">
            {t('pharmacy.print.thermal.check')}
          </button>
        </div>
        {bridge !== 'unknown' && (
          <Note icon={bridge === 'up' ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />} tone={bridge === 'up' ? 'success' : 'danger'} role="status" testId={`thermal-bridge-${bridge}`}>
            {t(bridge === 'up' ? 'pharmacy.print.thermal.bridgeUp' : 'pharmacy.print.thermal.bridgeDown')}
          </Note>
        )}
        {thermalNote !== 'idle' && (
          <Note
            icon={thermalDone ? <CircleCheck aria-hidden /> : thermalNote === 'printing' ? <Printer aria-hidden /> : <CircleAlert aria-hidden />}
            tone={thermalDone ? 'success' : thermalNote === 'printing' ? 'plain' : 'danger'}
            role="status"
            testId={`thermal-result-${thermalNote}`}
          >
            {t(thermalNote === 'printing' ? 'pharmacy.print.thermal.printing' : thermalNote === 'ok' ? 'pharmacy.print.thermal.printed' : thermalNote === 'drawer' ? 'pharmacy.print.thermal.drawerSent' : thermalNote === 'printer' ? 'pharmacy.print.thermal.failedPrinter' : 'pharmacy.print.thermal.failedBridge')}
          </Note>
        )}

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
