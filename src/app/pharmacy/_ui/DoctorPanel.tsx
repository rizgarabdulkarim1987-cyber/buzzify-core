'use client';

import { Camera, CircleAlert, Hourglass, ImageUp, Pill, Search, Send, Stethoscope, X } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { askDoctor } from '@/app/pharmacy/_actions/doctor';
import type { DoctorResponse } from '@/server/pharmacy/doctor/service';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { DoctorAnswer, type AddMode } from './DoctorAnswer';
import { askInputOf, COMPLAINT_MAX, EMPTY_FORM, MEDICINE_MAX, photoErrorKey, type DoctorForm } from './doctor-logic';
import { DoctorPhotoError, prepareDoctorPhoto } from './doctor-photo';
import { PH_BTN, PH_FIELD, PH_PRIMARY } from './sell-parts';

const LABEL = 'text-sm font-semibold text-ph-text';
const SEG = 'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] px-3 text-sm font-semibold';

function Labelled({ label, children, id }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The AI Doctor's question and answer, one panel for every place it appears (the Sell side panel, the phone's sheet, the full
 * page). Two modes: a customer's complaint (what they say, age, sex, pregnancy, how long) or a medicine (its name, or a photo of
 * the box or strip from the camera or a file). The answer arrives in a polite live region. Nothing typed or photographed is kept
 * in the browser; the photo is shrunk in memory (`prepareDoctorPhoto`) and sent once. No motion.
 */
export function DoctorPanel({ branchId, addMode, header = true }: { branchId: string; addMode: AddMode; header?: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const id = useId();
  const [form, setForm] = useState<DoctorForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [result, setResult] = useState<DoctorResponse | null>(null);
  const set = (patch: Partial<DoctorForm>) => setForm((f) => ({ ...f, ...patch }));

  const pickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoProblem(null);
    try {
      set({ photo: await prepareDoctorPhoto(file) });
    } catch (error) {
      set({ photo: null });
      setPhotoProblem(t(photoErrorKey(error instanceof DoctorPhotoError ? error.code : 'DECODE')));
    }
  };

  const ask = async () => {
    if (busy) return;
    const built = askInputOf(form, branchId, t('pharmacy.doctor.complaint.duration'));
    if (!built.ok) {
      setProblem(t(`pharmacy.doctor.problem.${built.problem}`));
      return;
    }
    setBusy(true);
    setProblem(null);
    setResult(null);
    const answer = await settle(() => askDoctor(built.input));
    setBusy(false);
    if (!answer.ok) {
      setProblem(answer.error.message === NETWORK_FAILURE ? t('pharmacy.doctor.offline') : describeFailure(t, locale, answer.error).message);
      return;
    }
    setResult(answer.data as DoctorResponse);
  };

  const complaint = form.mode === 'COMPLAINT';
  return (
    <section data-testid="doctor-panel" aria-labelledby={header ? `${id}-title` : undefined} aria-label={header ? undefined : t('pharmacy.doctor.title')} className="flex min-w-0 flex-col overflow-hidden rounded-[22px] bg-ph-card">
      <div className="flex flex-col gap-3 bg-ph-g9 p-4 text-ph-on-green">
        {header ? (
          <div className="flex flex-col">
            <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold">
              <Stethoscope aria-hidden className="size-5 shrink-0" />
              {t('pharmacy.doctor.title')}
            </h2>
            <p className="text-xs text-ph-on-green-muted">{t('pharmacy.doctor.tagline')}</p>
          </div>
        ) : null}
        <div role="group" aria-label={t('pharmacy.doctor.mode.label')} className="flex gap-1 rounded-ph-xl bg-ph-g8 p-1">
          {(['COMPLAINT', 'MEDICINE'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`doctor-mode-${mode}`}
              aria-pressed={form.mode === mode}
              onClick={() => {
                set({ mode });
                setProblem(null);
              }}
              className={`${SEG} ${form.mode === mode ? 'bg-ph-card text-ph-g8' : 'text-ph-on-green hover:bg-ph-g9'}`}
            >
              {mode === 'COMPLAINT' ? <Stethoscope aria-hidden className="size-4" /> : <Pill aria-hidden className="size-4" />}
              {t(`pharmacy.doctor.mode.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      <form
        className="flex flex-col gap-3 p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        {complaint ? (
          <>
            <Labelled id={`${id}-text`} label={t('pharmacy.doctor.complaint.text')}>
              <textarea
                id={`${id}-text`}
                data-testid="doctor-complaint"
                rows={3}
                maxLength={COMPLAINT_MAX}
                value={form.text}
                onChange={(e) => set({ text: e.target.value })}
                placeholder={t('pharmacy.doctor.complaint.placeholder')}
                autoComplete="off"
                dir="auto"
                className={`${PH_FIELD} py-2`}
              />
            </Labelled>
            <div className="grid grid-cols-2 gap-2.5">
              <Labelled id={`${id}-age`} label={t('pharmacy.doctor.complaint.age')}>
                <input id={`${id}-age`} data-testid="doctor-age" inputMode="numeric" dir="ltr" autoComplete="off" value={form.age} onChange={(e) => set({ age: e.target.value })} className={PH_FIELD} />
              </Labelled>
              <Labelled id={`${id}-sex`} label={t('pharmacy.doctor.complaint.sex')}>
                <select id={`${id}-sex`} data-testid="doctor-sex" value={form.sex} onChange={(e) => set({ sex: e.target.value as DoctorForm['sex'], pregnant: e.target.value === 'F' ? form.pregnant : false })} className={`${PH_FIELD} pe-8`}>
                  <option value="">{t('pharmacy.doctor.complaint.sexUnknown')}</option>
                  <option value="F">{t('pharmacy.doctor.complaint.sexF')}</option>
                  <option value="M">{t('pharmacy.doctor.complaint.sexM')}</option>
                </select>
              </Labelled>
              <div className="col-span-2">
                <Labelled id={`${id}-duration`} label={t('pharmacy.doctor.complaint.duration')}>
                  <input id={`${id}-duration`} data-testid="doctor-duration" autoComplete="off" dir="auto" maxLength={60} value={form.duration} onChange={(e) => set({ duration: e.target.value })} placeholder={t('pharmacy.doctor.complaint.durationHint')} className={PH_FIELD} />
                </Labelled>
              </div>
              {form.sex === 'F' ? (
                <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-ph-xl border border-ph-line px-3 text-sm font-semibold">
                  <input type="checkbox" data-testid="doctor-pregnant" checked={form.pregnant} onChange={(e) => set({ pregnant: e.target.checked })} className="size-5 accent-ph-g8" />
                  {t('pharmacy.doctor.complaint.pregnant')}
                </label>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Labelled id={`${id}-medicine`} label={t('pharmacy.doctor.medicine.name')}>
              <input
                id={`${id}-medicine`}
                data-testid="doctor-medicine"
                type="search"
                maxLength={MEDICINE_MAX}
                autoComplete="off"
                dir="auto"
                disabled={form.photo !== null}
                value={form.medicine}
                onChange={(e) => set({ medicine: e.target.value })}
                className={PH_FIELD}
              />
            </Labelled>
            <p className="text-xs text-ph-muted">{t('pharmacy.doctor.medicine.or')}</p>
            {form.photo ? (
              <p data-testid="doctor-photo-ready" className="flex min-h-11 items-center gap-2 rounded-ph-xl bg-ph-g1 ps-3 text-sm font-semibold text-ph-g9">
                <ImageUp aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">{t('pharmacy.doctor.photo.ready')}</span>
                <button type="button" data-testid="doctor-photo-remove" onClick={() => set({ photo: null })} aria-label={t('pharmacy.doctor.photo.remove')} className="grid size-11 shrink-0 place-items-center rounded-ph-xl hover:bg-ph-card">
                  <X aria-hidden className="size-4" />
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <label className={`${PH_BTN} cursor-pointer focus-within:outline-2 focus-within:outline-ph-accent`}>
                  <Camera aria-hidden className="size-4" />
                  {t('pharmacy.doctor.photo.camera')}
                  <input type="file" accept="image/*" capture="environment" data-testid="doctor-photo" onChange={(e) => void pickPhoto(e)} className="sr-only" />
                </label>
                <label className={`${PH_BTN} cursor-pointer focus-within:outline-2 focus-within:outline-ph-accent`}>
                  <ImageUp aria-hidden className="size-4" />
                  {t('pharmacy.doctor.photo.file')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" data-testid="doctor-photo-file" onChange={(e) => void pickPhoto(e)} className="sr-only" />
                </label>
              </div>
            )}
            {photoProblem ? (
              <p data-testid="doctor-photo-problem" role="alert" className="rounded-ph-xl bg-ph-amber-wash px-3 py-2 text-sm text-ph-amber-ink">
                {photoProblem}
              </p>
            ) : null}
          </>
        )}
        <button type="submit" data-testid="doctor-ask" disabled={busy} className={`${PH_PRIMARY} min-h-12 w-full`}>
          {busy ? <Hourglass aria-hidden className="size-4" /> : complaint ? <Send aria-hidden className="size-4 rtl:-scale-x-100" /> : <Search aria-hidden className="size-4" />}
          {t(busy ? 'pharmacy.doctor.asking' : 'pharmacy.doctor.ask')}
        </button>
      </form>

      <div data-testid="doctor-live" aria-live="polite" className="flex flex-col gap-3 px-4 pb-4 empty:hidden">
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-ph-muted">
            <Hourglass aria-hidden className="size-4" />
            {t('pharmacy.doctor.asking')}
          </p>
        ) : null}
        {problem ? (
          <p data-testid="doctor-problem" className="flex items-start gap-2 rounded-ph-xl bg-ph-amber-wash px-3 py-2 text-sm text-ph-amber-ink [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <CircleAlert aria-hidden />
            {problem}
          </p>
        ) : null}
        {result ? <DoctorAnswer result={result} addMode={addMode} /> : null}
      </div>
    </section>
  );
}

/**
 * The phone's Doctor on Sell: a floating button that opens the panel in a bottom sheet. The sheet is a modal `<dialog>` (focus
 * stays inside, Escape closes it), its content drawn only while open, and the focus goes back to the button when it closes.
 */
export function DoctorSheet({ branchId }: { branchId: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const fab = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closed = () => {
    setOpen(false);
    fab.current?.focus();
  };
  return (
    <>
      <button
        ref={fab}
        type="button"
        data-testid="doctor-fab"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        className="inline-flex min-h-12 items-center gap-2 rounded-full bg-ph-g6 px-5 text-base font-bold text-ph-on-green shadow-[0_10px_22px_-10px_rgba(11,59,48,0.75)] hover:bg-ph-g8"
      >
        <Stethoscope aria-hidden className="size-5" />
        {t('pharmacy.doctor.fab')}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-sheet`}
        onClose={closed}
        className="inset-x-0 top-auto bottom-0 m-0 h-[88dvh] max-h-none w-full max-w-none rounded-t-[28px] border-0 bg-ph-canvas p-0 text-ph-text backdrop:bg-ph-g9/50 lg:hidden print:hidden"
      >
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-ph-line bg-ph-card px-4 py-2 rounded-t-[28px]">
              <h2 id={`${id}-sheet`} className="flex min-w-0 flex-1 items-center gap-2 break-words text-lg font-bold">
                <Stethoscope aria-hidden className="size-5 shrink-0 text-ph-g6" />
                {t('pharmacy.doctor.title')}
              </h2>
              <button
                type="button"
                data-testid="doctor-sheet-close"
                onClick={() => dialog.current?.close()}
                aria-label={t('pharmacy.doctor.close')}
                className="grid size-11 shrink-0 place-items-center rounded-ph-xl hover:bg-ph-g1"
              >
                <X aria-hidden size={22} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <DoctorPanel branchId={branchId} addMode="bridge" header={false} />
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
