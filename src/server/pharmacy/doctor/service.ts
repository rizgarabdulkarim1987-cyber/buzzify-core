import { MAX_TOKENS } from '@/server/ai/provider/models';
import type { ScopedClient } from '@/server/data/tenant-db';
import {
  answerJsonSchemaFor,
  DOCTOR_DISCLAIMER_KEY,
  finalizeAnswer,
  normalizeForScreening,
  REFER_GENERIC,
  RX_ONLY_INGREDIENTS,
  screenComplaint,
  type ComplaintAnswer,
  type ComplaintOption,
  type DoctorMode,
  type MedicineAnswer,
  type RedFlagCode,
} from '@/server/domain/pharmacy/doctor';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { logError, type AiFailureCode } from '../intake/ai';
import { doctorAccess, type DoctorAccessReason } from './access';
import { runDoctorAi, type DoctorCallOptions } from './doctor-ai';
import { claimsPriceOrStock, hasAnyDigit, matchOptions, type MatchedOption } from './matcher';
import { buildSystemPrompt, cleanDoctorText, doctorUserText, type DoctorQuestion } from './prompt';

/**
 * The AI Doctor's one request (spec "AI Doctor behaviour"; plan Task 6). In order:
 *  1. access: the plan's AI budget, the role's `ai.use`, the owner or the staff switch (`doctorAccess`), and a branch the person
 *     may use. A refusal is a `StudioError` and nothing is called or written;
 *  2. a complaint is screened for red flags (`screenComplaint`); a red flag answers REFER and the model is never asked;
 *  3. the budgeted model call (`runDoctorAi`): a failure is UNAVAILABLE with a calm reason (the budget is settled there, once);
 *  4. the reply is re-checked (`finalizeAnswer`); an invalid or empty one is UNAVAILABLE FAILED;
 *  5. the app decides what is shown: an unsure reply is UNSURE (a fixed hint, no model text); in a complaint every option and line
 *     that names a prescription-only medicine is dropped (the built-in deny list and every RX/RESTRICTED product of the catalog),
 *     the rest is matched to this branch's stock (`matchOptions`: prices and quantities from the database only), and when the
 *     model's options are all dropped the answer is REFER NEEDS_PRESCRIPTION, never an empty answer;
 *  6. one `PhDoctorLog` row through `env.record` (the action writes it in the transaction of its audit entry): who, branch, mode,
 *     at most 280 characters of the cleaned question (none for a photo), the shown answer (only after `finalizeAnswer`), model,
 *     tokens, outcome. Never the photo.
 *
 * The "always consult a doctor" line is NOT part of the result: the app renders it (DOCTOR_DISCLAIMER_KEY) under every result.
 */

export type AskDoctorInput = DoctorQuestion & { branchId: string };

export type ShownComplaintAnswer = Omit<ComplaintAnswer, 'options'>;

export type DoctorResult =
  | { kind: 'ANSWER'; mode: 'COMPLAINT'; answer: ShownComplaintAnswer; options: MatchedOption[]; mustRefer: boolean }
  | { kind: 'ANSWER'; mode: 'MEDICINE_NAME' | 'MEDICINE_PHOTO'; answer: MedicineAnswer; options: []; mustRefer: false }
  | { kind: 'REFER'; reasons: RedFlagCode[] }
  | { kind: 'UNSURE'; hint: 'CLEARER_PHOTO' | 'MORE_DETAIL' }
  | { kind: 'UNAVAILABLE'; reason: 'NOT_IN_PLAN' | 'NOT_CONFIGURED' | 'LIMIT' | 'FAILED' };

/** What the action returns: the result and the message key of the app's own "consult a doctor" line, shown under every result. */
export type DoctorResponse = DoctorResult & { disclaimerKey: typeof DOCTOR_DISCLAIMER_KEY };

/** Plain JSON, as stored in `PhDoctorLog.answer`. */
export type DoctorJsonValue = string | number | boolean | null | DoctorJsonValue[] | DoctorJsonObject;
export interface DoctorJsonObject {
  [key: string]: DoctorJsonValue;
}

/** `PhDoctorLog.outcome` (the table's CHECK holds the same three). */
export type DoctorOutcome = 'ANSWERED' | 'REFUSED' | 'FAILED';

export interface DoctorLogRow {
  restaurantId: string;
  branchId: string;
  staffId: string;
  mode: DoctorMode;
  questionText: string | null;
  answer: DoctorJsonObject;
  model: string;
  inputTokens: number;
  outputTokens: number;
  outcome: DoctorOutcome;
}

export interface DoctorEnv {
  db: Parameters<typeof runDoctorAi>[0];
  scoped: ScopedClient;
  ph: PhActor | null;
  now: Date;
  /** Injected by tests (a scripted provider, a price); production uses the platform's configuration. */
  ai?: DoctorCallOptions;
  /** Writes the log row: the action does it in one transaction with its audit entry. */
  record(row: DoctorLogRow): Promise<void>;
}

/** The refusals a person can meet, by access reason (each in SERVER_TEXT, en/ar/ckb). */
export const DOCTOR_REFUSALS: Readonly<Record<Exclude<DoctorAccessReason, 'OK'>, string>> = {
  NO_ACTOR: 'You cannot use the AI Doctor here',
  NOT_IN_PLAN: 'The AI Doctor is not in your plan',
  NO_PERMISSION: 'Your role cannot use the AI Doctor',
  SWITCH_OFF: 'The owner has not turned on the AI Doctor for you',
};

/** At most this much of the question is kept in the log (the table's CHECK holds the same). */
export const DOCTOR_LOG_TEXT_MAX = 280;
/** The answer's output bound: the full complaint or medicine shape, well under the answer model's cap. */
const MAX_OUTPUT_TOKENS = Math.min(MAX_TOKENS.ask, 2000);
/** How many prescription-only catalog products are read for the name screen; a catalog with more fails closed (see `rxScreen`). */
const RX_READ_LIMIT = 5000;

const unavailableOf = (code: AiFailureCode): Extract<DoctorResult, { kind: 'UNAVAILABLE' }>['reason'] => {
  if (code === 'AI_NOT_IN_PLAN') return 'NOT_IN_PLAN';
  if (code === 'AI_NOT_CONFIGURED' || code === 'AI_PRICING_NOT_SET' || code === 'AI_PRICING_MODEL_MISMATCH') return 'NOT_CONFIGURED';
  if (code === 'AI_BUDGET_REACHED') return 'LIMIT';
  return 'FAILED';
};

const outcomeOf = (result: DoctorResult): DoctorOutcome => (result.kind === 'REFER' ? 'REFUSED' : result.kind === 'UNAVAILABLE' ? 'FAILED' : 'ANSWERED');

/** What is kept of a result in the log: the shown answer, and of each matched item only its ids (the price is the catalog's). */
function loggedAnswer(result: DoctorResult): DoctorJsonObject {
  if (result.kind !== 'ANSWER') return { ...result };
  const options = result.options.map((o) => ({ ingredient: o.ingredient, note: o.note, status: o.status, items: o.items.map((i) => ({ productId: i.productId, unitId: i.unitId })) }));
  return { kind: result.kind, mode: result.mode, mustRefer: result.mustRefer, answer: { ...result.answer }, options };
}

// The prescription-only name screen ---------------------------------------------------------------------------------------

const LATIN = /^[a-z0-9 .+\-/]+$/;

/** A term found in a normalized text: a Latin term at the start of a word, an Arabic or Kurdish one anywhere (a prefix such as ال or و is common). */
function contains(text: string, term: string): boolean {
  if (!LATIN.test(term)) return text.includes(term);
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1]!)) return true;
  }
  return false;
}

/**
 * Whether a text names a prescription-only medicine: any term of `RX_ONLY_INGREDIENTS`, or the trade name, generic name or
 * active ingredient of any RX or RESTRICTED product of this pharmacy's catalog (and each part of a combination such as
 * "amoxicillin + clavulanate"). Spelling is folded the way the red-flag screen folds it. A catalog with more prescription-only
 * products than one read holds names every text as prescription-only (fail closed: nothing is suggested, the answer refers).
 */
async function rxScreen(scoped: ScopedClient): Promise<(text: string) => boolean> {
  const rows = await scoped.phProduct.findMany({
    where: { rxLevel: { not: 'OTC' } },
    select: { tradeName: true, genericName: true, activeIngredient: true },
    take: RX_READ_LIMIT + 1,
  });
  if (rows.length > RX_READ_LIMIT) return () => true;
  const terms = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    for (const part of [raw, ...raw.split(/[+/,&]|\band\b|\bwith\b/i)]) {
      const term = normalizeForScreening(part);
      if (term.length >= 3) terms.add(term);
    }
  };
  for (const term of RX_ONLY_INGREDIENTS) add(term);
  for (const row of rows) [row.tradeName, row.genericName, row.activeIngredient].forEach(add);
  const list = [...terms];
  return (text: string) => {
    const plain = normalizeForScreening(text);
    return plain !== '' && list.some((term) => contains(plain, term));
  };
}

// The request -------------------------------------------------------------------------------------------------------------

export async function askDoctor(env: DoctorEnv, input: AskDoctorInput): Promise<DoctorResult> {
  const { ph, scoped, now } = env;
  const limits = ph ? await limitsOf(env.db, ph.restaurantId, now) : null;
  const access = doctorAccess({ actor: ph, aiBudgetMinor: limits?.aiMonthlyBudgetMinor ?? 0 });
  if (!access.allowed || !ph) throw new StudioError('FORBIDDEN', DOCTOR_REFUSALS[access.reason === 'OK' ? 'NO_ACTOR' : access.reason]);
  if (!ph.branchIds.includes(input.branchId)) throw new StudioError('FORBIDDEN');

  const typed = input.mode === 'MEDICINE_PHOTO' ? null : cleanDoctorText(input.text);
  const usage = { model: 'none', inputTokens: 0, outputTokens: 0 };
  const finish = async (result: DoctorResult): Promise<DoctorResult> => {
    await env.record({
      restaurantId: ph.restaurantId,
      branchId: input.branchId,
      staffId: ph.userId,
      mode: input.mode,
      questionText: typed === null ? null : Array.from(typed).slice(0, DOCTOR_LOG_TEXT_MAX).join(''),
      answer: loggedAnswer(result),
      ...usage,
      outcome: outcomeOf(result),
    });
    return result;
  };

  if (input.mode === 'COMPLAINT') {
    const screen = screenComplaint({ text: input.text, ageYears: input.ageYears, pregnant: input.pregnant });
    if (screen.mustRefer) return finish({ kind: 'REFER', reasons: screen.reasons });
  }

  const called = await runDoctorAi(
    env.db,
    {
      restaurantId: ph.restaurantId,
      mode: input.mode,
      system: buildSystemPrompt(ph.locale, input.mode),
      messages: [{ role: 'user', content: [{ type: 'text', text: doctorUserText(input) }] }],
      jsonSchema: answerJsonSchemaFor(input.mode),
      ...(input.mode === 'MEDICINE_PHOTO' ? { image: { mime: input.mime as 'image/jpeg', base64: input.imageBase64 } } : {}),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      now,
    },
    env.ai ?? {},
  );
  if (!called.ok) return finish({ kind: 'UNAVAILABLE', reason: unavailableOf(called.code) });
  usage.model = called.response.model.slice(0, 200);
  usage.inputTokens = called.response.inputTokens;
  usage.outputTokens = called.response.outputTokens;
  const text = called.response.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');

  // The model was paid for: whatever goes wrong from here (a database read, the matcher), the request is still logged once, as
  // FAILED, and the person sees the calm message. The budget was settled inside runDoctorAi and is not touched again.
  let shown: DoctorResult;
  try {
    shown = await decide(scoped, ph, input, text, now);
  } catch (error) {
    logError('the doctor answer could not be prepared after the model call', { restaurantId: ph.restaurantId }, error);
    shown = { kind: 'UNAVAILABLE', reason: 'FAILED' };
  }
  return finish(shown);
}

/** Lines of the model whose text names a price or a stock level are never shown (prices and quantities come from the database). */
const priceFree = (list: readonly string[], digitsToo = false) => list.filter((line) => !claimsPriceOrStock(line) && !(digitsToo && hasAnyDigit(line)));
const priceFreeLine = (line: string) => (claimsPriceOrStock(line) ? '' : line);

/** A name the catalog can be matched against: no letter outside the Latin script (an Arabic or Kurdish spelling is matched by nothing, so it fails closed). */
const LATIN_NAME = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\p{M}]*$/u;
const latinName = (name: string) => LATIN_NAME.test(name.normalize('NFKC'));

/** What is shown for the model's reply (steps 4 and 5 of the header). */
async function decide(scoped: ScopedClient, ph: PhActor, input: AskDoctorInput, text: string, now: Date): Promise<DoctorResult> {
  if (input.mode !== 'COMPLAINT') {
    const checked = finalizeAnswer(text, input.mode);
    if (!checked.ok) return { kind: 'UNAVAILABLE', reason: 'FAILED' };
    if (!checked.answer.confident) return { kind: 'UNSURE', hint: input.mode === 'MEDICINE_PHOTO' ? 'CLEARER_PHOTO' : 'MORE_DETAIL' };
    const a = checked.answer;
    // Medicine answers keep their numbers (strength, leaflet dose, storage temperature); a price or stock claim is dropped from every field.
    const answer: MedicineAnswer = {
      productName: priceFreeLine(a.productName),
      activeIngredient: priceFreeLine(a.activeIngredient),
      uses: priceFree(a.uses, true),
      doseAsLabelled: priceFreeLine(a.doseAsLabelled),
      contraindications: priceFree(a.contraindications),
      interactions: priceFree(a.interactions),
      sideEffects: priceFree(a.sideEffects),
      warnings: priceFree(a.warnings),
      storage: priceFreeLine(a.storage),
      confident: true,
    };
    return { kind: 'ANSWER', mode: input.mode, answer, options: [], mustRefer: false };
  }

  const checked = finalizeAnswer(text, 'COMPLAINT');
  if (!checked.ok) return { kind: 'UNAVAILABLE', reason: 'FAILED' };
  const answer = checked.answer;
  if (answer.unsure) return { kind: 'UNSURE', hint: 'MORE_DETAIL' };

  const namesRx = await rxScreen(scoped);
  let safetyLineDropped = false;
  // A line is dropped when it names a prescription-only medicine or claims a price or stock level. Likely causes have no use for a number.
  const keep = (list: readonly string[], safety: boolean, digitsToo = false) =>
    list.filter((line) => {
      const drop = line !== REFER_GENERIC && (namesRx(line) || claimsPriceOrStock(line) || (digitsToo && hasAnyDigit(line)));
      if (drop && safety) safetyLineDropped = true;
      return !drop;
    });
  const shown: ShownComplaintAnswer = {
    redFlags: keep(answer.redFlags, true),
    likelyCauses: keep(answer.likelyCauses, false, true),
    askNext: keep(answer.askNext, false),
    tellCustomer: keep(answer.tellCustomer, false),
    referIf: keep(answer.referIf, true),
    cautions: keep(answer.cautions, true),
    unsure: false,
  };

  // An option is kept only with a Latin name that names no prescription-only medicine (deny list and catalog), in its ingredient or any brand.
  const allowed: ComplaintOption[] = answer.options
    .filter((o) => latinName(o.ingredient) && o.tradeNames.every(latinName) && !namesRx(o.ingredient) && !o.tradeNames.some(namesRx))
    .map((o) => ({ ...o, note: namesRx(o.note) ? '' : o.note }));
  const settings = await scoped.phSettings.findFirst({ select: { defaultCurrency: true } });
  const options = allowed.length === 0 ? [] : await matchOptions({ scoped, ph, branchId: input.branchId, currency: settings?.defaultCurrency ?? 'IQD', now }, allowed);
  // The model suggested something and none of it may be shown: it needed a prescription-only medicine, so the answer refers.
  if (answer.options.length > 0 && options.length === 0) return { kind: 'REFER', reasons: ['NEEDS_PRESCRIPTION'] };
  // Some of it was dropped (here, or by the matcher's catalog check): the model thought a prescription medicine fits, so the answer refers too.
  const optionDropped = options.length < answer.options.length;

  // A safety line that was dropped, or a dropped option: the answer refers with the app's generic line.
  if ((safetyLineDropped || optionDropped) && !shown.referIf.includes(REFER_GENERIC)) shown.referIf.push(REFER_GENERIC);
  const mustRefer = answer.redFlags.length > 0 || safetyLineDropped || optionDropped || options.length === 0;
  return { kind: 'ANSWER', mode: 'COMPLAINT', answer: shown, options, mustRefer };
}