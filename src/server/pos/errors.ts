import { StudioError, type ErrorCode } from '@/server/studio/framework/result';

/**
 * The till's refusals: the English sentence the server answers with, and the Studio message that says it in the person's
 * language (`src/studio/errors.ts` spreads this into `SERVER_TEXT`). Only a sentence listed here can be thrown with
 * `refuse`, so a refusal cannot reach an Arabic or Sorani page untranslated.
 */
export const POS_TEXT = {
  'A table has an open order': 'error.text.posTableInUse',
  'Table numbers already in use': 'error.text.posTableNumbers',
  'The table already has an open order': 'error.text.posTableOccupied',
  'The first number must not exceed the last': 'error.text.posRangeOrder',
  'Create at most 200 tables at a time': 'error.text.posRangeSize',
} as const;

export type PosText = keyof typeof POS_TEXT;

/** An expected refusal with one of the till's own sentences. Throw the result. */
export function refuse(code: ErrorCode, text: PosText, fields?: Record<string, string>): StudioError {
  return new StudioError(code, text, fields);
}

/** A Prisma unique-constraint violation (P2002), duck-typed so it also matches errors from a driver adapter. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
