'use client';

import { CircleAlert, CircleCheck, Hourglass, ShieldAlert } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { createPrescription } from '@/app/pharmacy/_actions/prescriptions';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { todayInStudioZone } from '../ph-date';
import { phMessage } from '../ph-failure';
import { emptyRxDraft, fileProblem, issueBounds, limitIdNote, rxWire, validateRx, type RxDraft, type RxField } from '../prescription-logic';
import { keyFor, outcomeUnknown, type KeyedAttempt } from '../sell-logic';
import { FieldInput, Note, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';

const UPLOAD_URL = '/api/pharmacy/rx-attachments';

/** Sends the scan or photo (the old drawer's upload); a lost connection or an answer that is not the route's JSON is an answer too. */
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
      return body.error ? { ok: false, error: body.error } : { ok: true };
    } catch {
      return { ok: false, error: { code: 'INVALID', message: `The upload was not accepted (HTTP ${response.status}).` } };
    }
  } catch {
    return { ok: false, error: { code: 'INVALID', message: NETWORK_FAILURE } };
  }
}

/**
 * The old prescription drawer, inline in the work panel (no dialog): number, prescriber, licence, patient name (required for a
 * controlled medicine), the identity note (type and at most the last 4 characters), the issue date within the days it may carry,
 * and an optional scan or photo, all judged by the server's own rules before saving. What is typed lives in this component only:
 * it is gone when the flow closes and never reaches the device's storage. Only the saved prescription's id leaves it (`onSaved`),
 * with its number for this session. The same paper sent again after a lost answer sends the same key (recorded once).
 */
export function RxFlow({ level, restaurantId, branchId, frozen, onSaved }: { level: 'RX' | 'RESTRICTED'; restaurantId: string; branchId: string; frozen: boolean; onSaved: (saved: { id: string; number: string }) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const today = todayInStudioZone();
  const bounds = issueBounds(level, today);
  const [draft, setDraft] = useState<RxDraft>(emptyRxDraft);
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const [fileFailed, setFileFailed] = useState(false);
  const attempt = useRef<KeyedAttempt | null>(null);
  const lock = useRef(false);

  const problems = validateRx(draft, level, today);
  const fileIssue = file ? fileProblem({ type: file.type, size: file.size }) : null;
  const text = (field: RxField) => (touched && problems[field] ? t(`pharmacy.rx.problem.${problems[field]}`) : undefined);
  const set = (patch: Partial<RxDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const invalid = Object.keys(problems).length > 0 || fileIssue !== null;
  const stop = (said: string | null, fileBad = false) => {
    setProblem(said);
    setFileFailed(fileBad);
    setBusy(false);
    lock.current = false;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (frozen || busy || lock.current || invalid) return;
    lock.current = true;
    setBusy(true);
    setProblem(null);
    setFileFailed(false);
    let saved = created;
    if (!saved) {
      attempt.current = keyFor(attempt.current, JSON.stringify([draft, branchId]), 'rx');
      const key = attempt.current.key;
      const result = await settle(() => createPrescription(rxWire(draft, key)));
      if (!result.ok) {
        if (!outcomeUnknown(result.error)) attempt.current = null;
        return stop(outcomeUnknown(result.error) ? t('pharmacy.rx.unknown') : phMessage(t, locale, result.error, 'pharmacy.sell'));
      }
      saved = { id: (result.data as { id: string }).id, number: draft.number.trim() };
      setCreated(saved);
    }
    if (file) {
      const sent = await upload(file, { restaurantId, branchId, prescriptionId: saved.id });
      if (!sent.ok) {
        const said = sent.error.message === NETWORK_FAILURE ? t('pharmacy.rx.file.unknown') : phMessage(t, locale, sent.error as Parameters<typeof phMessage>[2], 'pharmacy.sell');
        return stop(said, true);
      }
    }
    stop(null);
    onSaved(saved);
  };

  const off = created !== null || frozen;
  const field = (name: keyof RxDraft, testId: string, max: number, extra: Partial<Parameters<typeof FieldInput>[0]> = {}) => (
    <FieldInput className={PH_FIELD} dir="auto" autoComplete="off" maxLength={max} data-testid={testId} value={draft[name]} disabled={off} onChange={(e) => set({ [name]: name === 'patientIdNote' ? limitIdNote(e.target.value) : e.target.value })} {...extra} />
  );
  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-2.5" data-testid="flow-rx-form" noValidate>
      <p className="text-sm text-ph-muted">{t(level === 'RESTRICTED' ? 'pharmacy.rx.drawer.controlled' : 'pharmacy.rx.drawer.rx')}</p>
      {frozen && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="rx-frozen">
          {t('pharmacy.cashier.frozen')}
        </Note>
      )}
      <Note look="ph" icon={<ShieldAlert aria-hidden />} tone="info" role="status">
        {t('pharmacy.rx.privacy')}
      </Note>
      <Field label={t('pharmacy.rx.number')} error={text('number')}>
        {field('number', 'rx-number', 40)}
      </Field>
      <Field label={t('pharmacy.rx.prescriber')} error={text('prescriberName')}>
        {field('prescriberName', 'rx-prescriber', 120)}
      </Field>
      <Field label={t('pharmacy.rx.license')} optional>
        {field('prescriberLicense', 'rx-license', 40)}
      </Field>
      <Field label={t('pharmacy.rx.patient')} optional={level !== 'RESTRICTED'} error={text('patientName')}>
        {field('patientName', 'rx-patient', 120)}
      </Field>
      <Field label={t('pharmacy.rx.idNote')} hint={t('pharmacy.rx.idNoteHint')} optional error={text('patientIdNote')}>
        {field('patientIdNote', 'rx-idnote', 60)}
      </Field>
      <Field label={t('pharmacy.rx.issuedOn')} hint={t('pharmacy.rx.issuedOnHint', { min: bounds.min, max: bounds.max })} error={text('issuedOn')}>
        {field('issuedOn', 'rx-date', 10, { type: 'date', dir: 'ltr', min: bounds.min, max: bounds.max })}
      </Field>
      <Field label={t('pharmacy.rx.file.label')} hint={t('pharmacy.rx.file.hint')} optional error={fileIssue ? t(`pharmacy.rx.file.problem.${fileIssue}`) : undefined}>
        <FieldInput
          className={`${PH_FIELD} py-2`}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          data-testid="rx-file"
          disabled={frozen}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setFileFailed(false);
          }}
        />
      </Field>
      {created && fileFailed && (
        <Note look="ph" icon={<CircleCheck aria-hidden />} tone="info" role="status">
          {t('pharmacy.rx.savedNote')}
        </Note>
      )}
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="rx-problem">
          {problem}
        </Note>
      )}
      {touched && invalid && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="rx-invalid">
          {t('pharmacy.rx.invalid')}
        </Note>
      )}
      <div className="flex flex-wrap gap-1.5">
        {created && fileFailed && (
          <button type="button" className={PH_BTN} data-testid="rx-skip-file" disabled={busy} onClick={() => onSaved(created)}>
            {t('pharmacy.rx.file.skip')}
          </button>
        )}
        <button type="submit" className={`${PH_PRIMARY} min-h-12 flex-1 text-base`} data-testid="rx-save" disabled={busy || frozen}>
          {busy ? <Hourglass aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
          {busy ? t('pharmacy.rx.saving') : created ? t('pharmacy.rx.retryFile') : t('pharmacy.rx.save')}
        </button>
      </div>
    </form>
  );
}
