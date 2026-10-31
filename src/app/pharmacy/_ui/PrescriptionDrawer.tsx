'use client';

import { CircleAlert, CircleCheck, FileText, Hourglass, Paperclip, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPrescription } from '@/app/pharmacy/_actions/prescriptions';
import { emptyRxDraft, fileProblem, issueBounds, limitIdNote, rxWire, validateRx, type RxDraft, type RxField } from '@/app/pharmacy/_ui/prescription-logic';
import { todayInStudioZone } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, Note, Num, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { keyFor, outcomeUnknown, type KeyedAttempt } from './sell-logic';

const UPLOAD_URL = '/api/pharmacy/rx-attachments';

export interface PrescriptionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The strictest level among the cart's lines: a controlled drug also needs the patient's name. */
  level: 'RX' | 'RESTRICTED';
  restaurantId: string;
  branchId: string;
  /** Called with the saved prescription's id (and its number, kept in memory only). */
  onSaved: (saved: { id: string; number: string }) => void;
}

/** Sends the scan or photo; a lost connection or an answer that is not the route's JSON is an answer too. */
async function upload(file: File, place: { restaurantId: string; branchId: string; prescriptionId: string }): Promise<{ ok: true } | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } }> {
  const form = new FormData();
  form.append('restaurantId', place.restaurantId);
  form.append('branchId', place.branchId);
  form.append('prescriptionId', place.prescriptionId);
  form.append('file', file, 'prescription');
  try {
    const response = await fetch(UPLOAD_URL, { method: 'POST', body: form });
    try {
      const body = (await response.json()) as { data?: unknown; error?: { code: string; message: string; fields?: Record<string, string> } };
      if (body.error) return { ok: false, error: body.error };
      return { ok: true };
    } catch {
      return { ok: false, error: { code: 'INVALID', message: `The upload was not accepted (HTTP ${response.status}).` } };
    }
  } catch {
    return { ok: false, error: { code: 'INVALID', message: NETWORK_FAILURE } };
  }
}

/**
 * The prescription drawer of the sale screen: number, prescriber, licence, patient name (required for a controlled drug), the
 * identity note (the document type and at most the last 4 characters of its number: the box refuses more), the issue date with
 * the days it may carry shown, and an optional scan or photo. Everything the person types stays in this component's memory: it
 * is not written to the device's storage, and it is gone when the drawer closes. Only the saved prescription's id leaves it.
 */
export function PrescriptionDrawer({ open, onOpenChange, level, restaurantId, branchId, onSaved }: PrescriptionDrawerProps) {
  const t = useT();
  const { locale } = useLocale();
  const form = useId();
  const today = todayInStudioZone();
  const bounds = issueBounds(level, today);
  const [draft, setDraft] = useState<RxDraft>(emptyRxDraft);
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const [fileFailed, setFileFailed] = useState(false);
  const [opened, setOpened] = useState(false);
  const attempt = useRef<KeyedAttempt | null>(null);
  const lock = useRef(false);

  if (open && !opened) {
    setOpened(true);
    setDraft(emptyRxDraft());
    setFile(null);
    setTouched(false);
    setProblem(null);
    setCreated(null);
    setFileFailed(false);
  }
  if (!open && opened) {
    setOpened(false);
    // The patient's words do not outlive the drawer.
    setDraft(emptyRxDraft());
    setFile(null);
  }

  // A new paper gets a new attempt key.
  useEffect(() => {
    if (open) attempt.current = null;
  }, [open]);

  const problems = validateRx(draft, level, today);
  const fileIssue = file ? fileProblem({ type: file.type, size: file.size }) : null;
  const text = (field: RxField) => (touched && problems[field] ? t(`pharmacy.rx.problem.${problems[field]}`) : undefined);
  const set = (patch: Partial<RxDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const invalid = Object.keys(problems).length > 0 || fileIssue !== null;

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (busy || lock.current || invalid) return;
    lock.current = true;
    setBusy(true);
    setProblem(null);
    setFileFailed(false);
    let saved = created;
    if (!saved) {
      // The same paper sent again after a dropped connection sends the same key, so the server records it once.
      attempt.current = keyFor(attempt.current, JSON.stringify([draft, branchId]), 'rx');
      const key = attempt.current.key;
      const result = await settle(() => createPrescription(rxWire(draft, key)));
      if (!result.ok) {
        if (!outcomeUnknown(result.error)) attempt.current = null;
        setProblem(outcomeUnknown(result.error) ? t('pharmacy.rx.unknown') : phMessage(t, locale, result.error, 'pharmacy.sell'));
        setBusy(false);
        lock.current = false;
        return;
      }
      saved = { id: (result.data as { id: string }).id, number: draft.number.trim() };
      setCreated(saved);
    }
    if (file) {
      const sent = await upload(file, { restaurantId, branchId, prescriptionId: saved.id });
      if (!sent.ok) {
        setProblem(
          sent.error.message === NETWORK_FAILURE
            ? t('pharmacy.rx.file.unknown')
            : phMessage(t, locale, { code: sent.error.code, message: sent.error.message, fields: sent.error.fields } as Parameters<typeof phMessage>[2], 'pharmacy.sell'),
        );
        setFileFailed(true);
        setBusy(false);
        lock.current = false;
        return;
      }
    }
    setBusy(false);
    lock.current = false;
    onSaved(saved);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      width="md"
      title={t('pharmacy.rx.drawer.title')}
      description={t(level === 'RESTRICTED' ? 'pharmacy.rx.drawer.controlled' : 'pharmacy.rx.drawer.rx')}
      footer={
        <>
          <button type="button" className={TOUCH_BTN} disabled={busy} onClick={() => onOpenChange(false)}>
            {t('pharmacy.sell.pay.cancel')}
          </button>
          {created && fileFailed && (
            <button
              type="button"
              className={TOUCH_BTN}
              data-testid="rx-skip-file"
              disabled={busy}
              onClick={() => {
                onSaved(created);
                onOpenChange(false);
              }}
            >
              {t('pharmacy.rx.file.skip')}
            </button>
          )}
          <button type="submit" form={form} className={TOUCH_PRIMARY} data-testid="rx-save" disabled={busy}>
            {busy ? <Hourglass aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
            {busy ? t('pharmacy.rx.saving') : created ? t('pharmacy.rx.retryFile') : t('pharmacy.rx.save')}
          </button>
        </>
      }
    >
      <form id={form} onSubmit={(event) => void save(event)} className="flex flex-col gap-3" data-testid="rx-drawer" noValidate>
        <Note icon={<ShieldAlert aria-hidden />} tone="info" role="status">
          {t('pharmacy.rx.privacy')}
        </Note>
        <Field label={t('pharmacy.rx.number')} error={text('number')}>
          <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={40} data-testid="rx-number" value={draft.number} disabled={created !== null} onChange={(e) => set({ number: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.rx.prescriber')} error={text('prescriberName')}>
          <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={120} data-testid="rx-prescriber" value={draft.prescriberName} disabled={created !== null} onChange={(e) => set({ prescriberName: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.rx.license')} optional>
          <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={40} data-testid="rx-license" value={draft.prescriberLicense} disabled={created !== null} onChange={(e) => set({ prescriberLicense: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.rx.patient')} optional={level !== 'RESTRICTED'} error={text('patientName')}>
          <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={120} data-testid="rx-patient" value={draft.patientName} disabled={created !== null} onChange={(e) => set({ patientName: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.rx.idNote')} hint={t('pharmacy.rx.idNoteHint')} optional error={text('patientIdNote')}>
          <FieldInput
            className={FIELD}
            dir="auto"
            autoComplete="off"
            maxLength={60}
            data-testid="rx-idnote"
            value={draft.patientIdNote}
            disabled={created !== null}
            onChange={(e) => set({ patientIdNote: limitIdNote(e.target.value) })}
          />
        </Field>
        <Field label={t('pharmacy.rx.issuedOn')} hint={t('pharmacy.rx.issuedOnHint', { min: bounds.min, max: bounds.max })} error={text('issuedOn')}>
          <FieldInput className={FIELD} type="date" dir="ltr" min={bounds.min} max={bounds.max} data-testid="rx-date" value={draft.issuedOn} disabled={created !== null} onChange={(e) => set({ issuedOn: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.rx.file.label')} hint={t('pharmacy.rx.file.hint')} optional error={fileIssue ? t(`pharmacy.rx.file.problem.${fileIssue}`) : undefined}>
          <FieldInput
            className={`${FIELD} py-2`}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            data-testid="rx-file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFileFailed(false);
            }}
          />
        </Field>
        {file && !fileIssue && (
          <p className="flex items-center gap-2 text-sm text-text" data-testid="rx-file-chosen">
            {file.type === 'application/pdf' ? <FileText aria-hidden className="size-4 shrink-0" /> : <Paperclip aria-hidden className="size-4 shrink-0" />}
            {t('pharmacy.rx.file.chosen', { kind: t(file.type === 'application/pdf' ? 'pharmacy.rx.file.kind.pdf' : 'pharmacy.rx.file.kind.image') })} · <Num>{(file.size / 1024 / 1024).toFixed(2)}</Num> MB
          </p>
        )}
        {created && !fileFailed && (
          <Note icon={<CircleCheck aria-hidden />} tone="success" role="status">
            {t('pharmacy.rx.savedNote')}
          </Note>
        )}
        {problem && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="rx-problem">
            {problem}
          </Note>
        )}
        {touched && invalid && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="rx-invalid">
            {t('pharmacy.rx.invalid')}
          </Note>
        )}
      </form>
    </Dialog>
  );
}
