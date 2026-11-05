import type { MatchedItem } from '@/server/pharmacy/doctor/matcher';
import type { DoctorResponse } from '@/server/pharmacy/doctor/service';
import type { CartBridgeItem } from './cart-bridge';

/**
 * The AI Doctor's screen rules, pure (plan Task 8; spec "Answer structure", "Safety framing"):
 *  - `answerSections`: what an answer shows and in what order. Red flags come first (and a must-refer answer's referral right
 *    after them), before any option; the app's own "consult a doctor" line is ALWAYS the last section, whatever the result.
 *    REFER, UNSURE and UNAVAILABLE carry codes only, so they show fixed app lines and never model text.
 *  - `cartItemOf` / `sellAddHref`: one of the matched unit to the Sell cart (the bridge on Sell, `?add=` from Home).
 *  - `askInputOf`: the form as the `ph.doctor.ask` input.
 * The message keys mirror `DOCTOR_MESSAGE_KEYS` and `REFER_GENERIC` of the server domain (tests/pharmacy/ui-doctor.test.ts
 * holds them equal), written out here so the client bundle does not pull the server's screening tables.
 */

export const DISCLAIMER_KEY = 'pharmacy.doctor.disclaimer';
export const REFER_GENERIC_CODE = '__REFER_GENERIC__';
const K = {
  referGeneric: 'pharmacy.doctor.refer.generic',
  unsureRefer: 'pharmacy.doctor.unsure.refer',
  reason: (code: string) => `pharmacy.doctor.reason.${code}`,
  unsure: (hint: string) => `pharmacy.doctor.unsure.${hint}`,
  unavailable: (reason: string) => `pharmacy.doctor.unavailable.${reason}`,
};

/** A line of an answer: the model's text (always drawn as a plain text node) or a fixed app message. */
export type DoctorLine = { kind: 'model'; text: string } | { kind: 'msg'; key: string };

export type SectionId =
  | 'refer' | 'unsure' | 'unavailable'
  | 'redFlags' | 'likelyCauses' | 'askNext' | 'options' | 'tellCustomer' | 'referIf' | 'cautions'
  | 'product' | 'uses' | 'dose' | 'contraindications' | 'interactions' | 'sideEffects' | 'warnings' | 'storage'
  | 'disclaimer';

/** `danger`: red, first; `warn`: amber; `note`: a calm fixed message; `fine`: the disclaimer. */
export type SectionTone = 'danger' | 'warn' | 'plain' | 'note' | 'fine';

export interface DoctorSection {
  id: SectionId;
  tone: SectionTone;
  lines: DoctorLine[];
}

const model = (list: readonly string[]): DoctorLine[] => list.filter((s) => s.trim() !== '').map((text) => ({ kind: 'model', text }));
const msg = (key: string): DoctorLine => ({ kind: 'msg', key });
const DISCLAIMER: DoctorSection = { id: 'disclaimer', tone: 'fine', lines: [msg(DISCLAIMER_KEY)] };

export function answerSections(result: DoctorResponse): DoctorSection[] {
  const out: DoctorSection[] = [];
  const push = (id: SectionId, tone: SectionTone, lines: DoctorLine[]) => {
    if (lines.length > 0) out.push({ id, tone, lines });
  };
  if (result.kind === 'REFER') push('refer', 'danger', result.reasons.map((r) => msg(K.reason(r))));
  else if (result.kind === 'UNSURE') push('unsure', 'note', [msg(K.unsure(result.hint)), msg(K.unsureRefer)]);
  else if (result.kind === 'UNAVAILABLE') push('unavailable', 'note', [msg(K.unavailable(result.reason))]);
  else if (result.mode === 'COMPLAINT') {
    const a = result.answer;
    const referIf: DoctorLine[] = a.referIf.flatMap((line) => (line === REFER_GENERIC_CODE ? [msg(K.referGeneric)] : model([line])));
    push('redFlags', 'danger', model(a.redFlags));
    // A must-refer answer says so before anything that could read as "sell this".
    if (result.mustRefer) push('referIf', 'danger', referIf);
    push('likelyCauses', 'plain', model(a.likelyCauses));
    push('askNext', 'plain', model(a.askNext));
    // The options section holds no lines: the options themselves are drawn from `result.options` (catalog fields only).
    if (result.options.length > 0) out.push({ id: 'options', tone: 'plain', lines: [] });
    push('tellCustomer', 'plain', model(a.tellCustomer));
    if (!result.mustRefer) push('referIf', 'warn', referIf);
    push('cautions', 'warn', model(a.cautions));
  } else {
    const a = result.answer;
    push('product', 'plain', model([a.productName, a.activeIngredient]));
    push('uses', 'plain', model(a.uses));
    if (a.doseAsLabelled.trim() !== '') push('dose', 'plain', [...model([a.doseAsLabelled]), msg('pharmacy.doctor.medicine.checkLeaflet')]);
    push('contraindications', 'warn', model(a.contraindications));
    push('interactions', 'warn', model(a.interactions));
    push('sideEffects', 'plain', model(a.sideEffects));
    push('warnings', 'warn', model(a.warnings));
    push('storage', 'plain', model([a.storage]));
  }
  out.push(DISCLAIMER);
  return out;
}

// The cart -----------------------------------------------------------------------------------------------------------------

/** One of the matched unit. The Sell screen's quantity is in the unit it is handed (`dispatch add { unitId, qty }`), not in base units. */
export const cartItemOf = (item: Pick<MatchedItem, 'unitId'>): CartBridgeItem => ({ unitId: item.unitId, qty: 1 });

/** The Sell screen with that unit added (`parseSellAdd` reads it back). */
export const sellAddHref = (item: Pick<MatchedItem, 'unitId'>): string => `/pharmacy/sell?add=${encodeURIComponent(item.unitId)}:1`;

// The question -------------------------------------------------------------------------------------------------------------

export interface DoctorForm {
  mode: 'COMPLAINT' | 'MEDICINE';
  text: string;
  age: string;
  sex: '' | 'F' | 'M';
  pregnant: boolean;
  duration: string;
  medicine: string;
  photo: { mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string } | null;
}

export const EMPTY_FORM: DoctorForm = { mode: 'COMPLAINT', text: '', age: '', sex: '', pregnant: false, duration: '', medicine: '', photo: null };

export type AskInput =
  | { mode: 'COMPLAINT'; text: string; ageYears?: number; sex?: 'F' | 'M'; pregnant?: boolean; branchId: string }
  | { mode: 'MEDICINE_NAME'; text: string; branchId: string }
  | { mode: 'MEDICINE_PHOTO'; imageBase64: string; mime: string; branchId: string };

export const COMPLAINT_MAX = 1000;
export const MEDICINE_MAX = 200;

/** The form as the action's input. The duration is part of the complaint's text (the red-flag screen reads "more than 3 days" there). */
export function askInputOf(form: DoctorForm, branchId: string, durationLabel: string): { ok: true; input: AskInput } | { ok: false; problem: 'empty' | 'age' | 'long' } {
  if (form.mode === 'MEDICINE') {
    if (form.photo) return { ok: true, input: { mode: 'MEDICINE_PHOTO', mime: form.photo.mime, imageBase64: form.photo.base64, branchId } };
    const text = form.medicine.trim();
    if (text === '') return { ok: false, problem: 'empty' };
    if (text.length > MEDICINE_MAX) return { ok: false, problem: 'long' };
    return { ok: true, input: { mode: 'MEDICINE_NAME', text, branchId } };
  }
  const said = form.text.trim();
  if (said === '') return { ok: false, problem: 'empty' };
  const duration = form.duration.trim();
  const text = duration ? `${said}\n${durationLabel}: ${duration}` : said;
  if (text.length > COMPLAINT_MAX) return { ok: false, problem: 'long' };
  const ageText = form.age.trim();
  let ageYears: number | undefined;
  if (ageText !== '') {
    if (!/^\d{1,3}$/.test(ageText) || Number(ageText) > 130) return { ok: false, problem: 'age' };
    ageYears = Number(ageText);
  }
  return {
    ok: true,
    input: {
      mode: 'COMPLAINT',
      text,
      ...(ageYears !== undefined ? { ageYears } : {}),
      ...(form.sex ? { sex: form.sex } : {}),
      ...(form.sex === 'F' && form.pregnant ? { pregnant: true } : {}),
      branchId,
    },
  };
}

/** The message of a photo the browser could not prepare (`DoctorPhotoError` codes). */
export const photoErrorKey = (code: 'TYPE' | 'SIZE' | 'DECODE'): string => `pharmacy.doctor.photo.error.${code}`;

// History ------------------------------------------------------------------------------------------------------------------

export interface DoctorHistoryItem {
  id: string;
  mode: 'COMPLAINT' | 'MEDICINE_NAME' | 'MEDICINE_PHOTO';
  questionText: string | null;
  outcome: 'ANSWERED' | 'REFUSED' | 'FAILED';
  createdAt: Date | string;
  mine: boolean;
}
