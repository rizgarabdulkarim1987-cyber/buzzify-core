import type { AiMessage, AiPurpose, AiResponse } from '@/server/ai/provider/types';
import type { DoctorMode } from '@/server/domain/pharmacy/doctor';
import { INPUT_BOUND, type MediaHint } from '@/server/domain/pharmacy/intake';
import { logError, type AiFailureCode } from '../intake/ai';
import { runBudgetedCall, type AssistantCallOptions } from '../intake/assistant-ai';
import { checkPhoto, MAX_PHOTO_BASE64_CHARS, PHOTO_MIMES, type PhotoMime } from './photo';

// The photo rules live in photo.ts (`checkPhoto`, the one validator); the action reads these two from here.
export { MAX_PHOTO_BASE64_CHARS, PHOTO_MIMES };

/**
 * The AI Doctor's one model call, under the pharmacy's AI budget (`PhAiUsageMonth`), exactly as the assistant's: the worst case
 * is reserved before the call, the actual cost is settled after it, a failure releases what was not spent, and the call log row
 * has purpose `doctor` and holds no prompt and no answer. The budget tables are written only in src/server/pharmacy/intake/
 * (enforcement), so this file builds the request and hands it to `runBudgetedCall` there.
 *
 * Models: a typed question (COMPLAINT, MEDICINE_NAME) goes to the answer model (purpose `ask`); a photo (MEDICINE_PHOTO) goes to
 * the reading model (purpose `extract`, the model that reads invoice photos). The gateway has no `fast` purpose, and its fast
 * model (`AI_MODEL_FAST`, used by `phrase`/`classify`) is not the model `AI_PRICE_MODEL` prices, so a photo sent to it would be
 * refused as AI_PRICING_MODEL_MISMATCH in production (Ruling 3: no new price keys). The price is checked against the model of
 * the purpose that runs. Both default models of both providers take images (claude-opus-5-5; gpt-5).
 *
 * Never throws: every problem is `{ ok: false, code }` with an `AiFailureCode`, and the caller shows its calm message.
 */

export interface DoctorCallArgs {
  restaurantId: string;
  mode: DoctorMode;
  /** The Doctor's system text (prompt.ts): no text from a person or the database. */
  system: string;
  /** The conversation; the pharmacist's text is already wrapped as untrusted data by the caller. */
  messages: AiMessage[];
  /** The answer schema of the mode (`answerJsonSchemaFor`). */
  jsonSchema: Record<string, unknown>;
  /** MEDICINE_PHOTO only (and required there): the photo, already validated and resized by the caller. */
  image?: { mime: PhotoMime; base64: string };
  maxOutputTokens: number;
  now: Date;
}

export type DoctorCallOptions = AssistantCallOptions;

export type DoctorCallResult = { ok: true; response: AiResponse; costMicroUsd: bigint } | { ok: false; code: AiFailureCode };

/** The model purpose of a mode: the reading model for a photo, the answer model otherwise. */
export const doctorPurposeFor = (mode: DoctorMode): AiPurpose => (mode === 'MEDICINE_PHOTO' ? 'extract' : 'ask');

/**
 * The input bound of a photo whose pixel size is not known here: a hint large enough that the bound is the fixed image maximum
 * (`INPUT_BOUND.imageTokensMax`, twice what either provider charges for its largest image), so the reservation is a true bound
 * whatever size the caller sends.
 */
export const DOCTOR_PHOTO_HINT: MediaHint = { kind: 'image', widthPx: INPUT_BOUND.imageTokensMax, heightPx: INPUT_BOUND.imageTokensMax };

/** The messages with the photo appended to the last user message (one is added when the conversation ends otherwise). */
function withPhoto(messages: AiMessage[], image: NonNullable<DoctorCallArgs['image']>): AiMessage[] {
  const part = { type: 'image' as const, mediaType: image.mime, base64: image.base64 };
  const last = messages.at(-1);
  if (last?.role !== 'user') return [...messages, { role: 'user', content: [part] }];
  return [...messages.slice(0, -1), { ...last, content: [...last.content, part] }];
}

export async function runDoctorAi(db: Parameters<typeof runBudgetedCall>[0], args: DoctorCallArgs, opts: DoctorCallOptions = {}): Promise<DoctorCallResult> {
  const ids = { restaurantId: args.restaurantId };
  // A photo belongs to photo mode and photo mode needs one: anything else is an input this call does not take (a caller's bug, so logged).
  const photo = args.mode === 'MEDICINE_PHOTO';
  if (photo !== (args.image !== undefined)) {
    logError('the doctor call got a photo outside photo mode, or photo mode without a photo', ids);
    return { ok: false, code: 'AI_INPUT_TOO_LARGE' };
  }
  // The type is the one `checkPhoto` reads from the bytes, not the caller's claim.
  let image: DoctorCallArgs['image'];
  if (args.image) {
    const checked = checkPhoto(args.image);
    if (!checked.ok) {
      logError(`the doctor call refused its photo: ${checked.code}`, ids);
      return { ok: false, code: 'AI_INPUT_TOO_LARGE' };
    }
    image = { mime: checked.mime, base64: args.image.base64 };
  }
  try {
    return await runBudgetedCall(
      db,
      {
        restaurantId: args.restaurantId,
        purpose: doctorPurposeFor(args.mode),
        logPurpose: 'doctor',
        input: { system: args.system, messages: image ? withPhoto(args.messages, image) : args.messages, jsonSchema: args.jsonSchema },
        media: image ? [DOCTOR_PHOTO_HINT] : [],
        maxOutputTokens: args.maxOutputTokens,
        now: args.now,
      },
      opts,
    );
  } catch (error) {
    logError('the doctor call failed outside the budget steps', ids, error);
    return { ok: false, code: 'AI_PROVIDER_ERROR' };
  }
}
