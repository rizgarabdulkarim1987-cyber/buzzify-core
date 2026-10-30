import { checkIssuedOn, checkPatientIdNote, PATIENT_ID_LAST_CHARS, validityDays, windowStart, type RxLevel } from '@/server/domain/pharmacy/prescriptions';

/**
 * The prescription form and the controlled-drug rules of the sale screen, pure (no DOM, no clock: the caller passes the
 * Baghdad day). The rules are the server's own functions (`checkIssuedOn`, `checkPatientIdNote`, the 5 MB file cap), so the form
 * never accepts what the sale would refuse; the server stays the authority. Patient fields live in the form's memory only: they
 * are never written to the device's storage (the cart draft keeps the prescription's id after it was saved, nothing else).
 */

export type RxField = 'number' | 'prescriberName' | 'patientName' | 'patientIdNote' | 'issuedOn';
export type RxProblem = 'required' | 'future' | 'expired' | 'malformed' | 'idTooLong' | 'idShape';

export interface RxDraft {
  number: string;
  prescriberName: string;
  prescriberLicense: string;
  patientName: string;
  patientIdNote: string;
  issuedOn: string;
}

export const emptyRxDraft = (): RxDraft => ({ number: '', prescriberName: '', prescriberLicense: '', patientName: '', patientIdNote: '', issuedOn: '' });

/** The file cap the server enforces (`RX_FILE_MAX_BYTES`): duplicated as a number so the browser bundle needs no server module. */
export const RX_FILE_MAX = 5 * 1024 * 1024;
export const RX_FILE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** The oldest and the newest day a prescription for a drug of this level may carry today (inclusive). */
export function issueBounds(level: RxLevel, today: string): { min: string; max: string } {
  return { min: windowStart(today, validityDays(level) ?? 180), max: today };
}

/**
 * Cuts the number part of an identity note to its last 4 characters as it is typed: `ID card: 123456` becomes `ID card: 1234`.
 * The type of the document (words) is left alone; so is a note with no number yet.
 */
export function limitIdNote(text: string): string {
  const match = /^(.*[:-]\s*)([^:-]*)$/su.exec(text);
  if (!match) return text;
  const tail = (match[2] ?? '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, PATIENT_ID_LAST_CHARS);
  return `${match[1]}${tail}`;
}

/** Field by field: what is wrong with the draft for a sale of this level (empty = ready to save). */
export function validateRx(draft: RxDraft, level: RxLevel, today: string): Partial<Record<RxField, RxProblem>> {
  const out: Partial<Record<RxField, RxProblem>> = {};
  if (draft.number.trim() === '') out.number = 'required';
  if (draft.prescriberName.trim() === '') out.prescriberName = 'required';
  if (level === 'RESTRICTED' && draft.patientName.trim() === '') out.patientName = 'required';
  if (draft.patientIdNote.trim() !== '') {
    const note = checkPatientIdNote(draft.patientIdNote);
    if (!note.ok) out.patientIdNote = note.reason === 'TOO_LONG' ? 'idTooLong' : 'idShape';
  }
  if (draft.issuedOn.trim() === '') out.issuedOn = 'required';
  else {
    const dated = checkIssuedOn(draft.issuedOn.trim(), today, level);
    if (!dated.ok) out.issuedOn = dated.reason === 'FUTURE' ? 'future' : dated.reason === 'EXPIRED' ? 'expired' : 'malformed';
  }
  return out;
}

export type FileProblem = 'type' | 'tooLarge' | 'empty';

/** An upload judged before it leaves the browser (the server reads the real type from the bytes and judges again). */
export function fileProblem(file: { type: string; size: number }): FileProblem | null {
  if (file.size <= 0) return 'empty';
  if (file.size > RX_FILE_MAX) return 'tooLarge';
  if (!RX_FILE_TYPES.includes(file.type)) return 'type';
  return null;
}

/** The request of `ph.rx.create`: trimmed, with no empty optional field. */
export function rxWire(draft: RxDraft, clientKey: string) {
  const opt = (value: string) => (value.trim() === '' ? {} : { value: value.trim() });
  return {
    clientKey,
    number: draft.number.trim(),
    prescriberName: draft.prescriberName.trim(),
    ...(opt(draft.prescriberLicense).value !== undefined ? { prescriberLicense: draft.prescriberLicense.trim() } : {}),
    ...(opt(draft.patientName).value !== undefined ? { patientName: draft.patientName.trim() } : {}),
    ...(opt(draft.patientIdNote).value !== undefined ? { patientIdNote: draft.patientIdNote.trim().replace(/\s+/g, ' ') } : {}),
    issuedOn: draft.issuedOn.trim(),
  };
}

// The cart -------------------------------------------------------------------------------------------------------------

export interface RxLine {
  productId: string;
  name: string;
  rxLevel: RxLevel;
  qty: number;
  /** Base units in one unit of the line's unit. */
  unitBaseQty: number;
}

/** The strictest level among the lines (null: nothing needs a prescription). */
export function rxLevelOfLines(lines: readonly Pick<RxLine, 'rxLevel'>[]): 'RX' | 'RESTRICTED' | null {
  if (lines.some((l) => l.rxLevel === 'RESTRICTED')) return 'RESTRICTED';
  if (lines.some((l) => l.rxLevel === 'RX')) return 'RX';
  return null;
}

export interface ControlledLimit {
  productId: string;
  name: string;
  baseQty: number;
  max: number;
  over: boolean;
}

/** Each controlled product's total in base units (all its lines together) against the most one sale may carry (0 = no limit). */
export function controlledLimits(lines: readonly RxLine[], maxQty: number): ControlledLimit[] {
  const totals = new Map<string, ControlledLimit>();
  for (const l of lines) {
    if (l.rxLevel !== 'RESTRICTED') continue;
    const found = totals.get(l.productId) ?? { productId: l.productId, name: l.name, baseQty: 0, max: maxQty, over: false };
    found.baseQty += l.qty * l.unitBaseQty;
    totals.set(l.productId, found);
  }
  return [...totals.values()].map((l) => ({ ...l, over: maxQty > 0 && l.baseQty > maxQty }));
}

export type RxGate = 'rxMissing' | 'overLimit' | 'controlledOff';

/**
 * Why the sale cannot go on before it is sent, in the screen's own order. A controlled line needs the switch on, a saved
 * prescription and a quantity within the limit; a prescription drug needs none (the server asks for none). The server judges again.
 */
export function prescriptionGate(lines: readonly RxLine[], prescriptionId: string | null, maxQty: number, controlledEnabled: boolean): RxGate | null {
  const controlled = lines.some((l) => l.rxLevel === 'RESTRICTED');
  if (!controlled) return null;
  if (!controlledEnabled) return 'controlledOff';
  if (prescriptionId === null) return 'rxMissing';
  if (controlledLimits(lines, maxQty).some((l) => l.over)) return 'overLimit';
  return null;
}
