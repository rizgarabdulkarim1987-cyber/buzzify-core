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
  'Kitchen mode is off': 'error.text.posKitchenOff',
  'Nothing new to send to the kitchen': 'error.text.posNothingToSend',
  'The order is waiting for approval': 'error.text.posWaitingApproval',
  'The order cannot be paid': 'error.text.posPayRefused',
  'Cannot pay an empty order': 'error.text.posPayEmpty',
  'The total changed. Check the bill and try again.': 'error.text.posTotalChanged',
  'The amount is less than the total': 'error.text.posAmountShort',
  'Use at most 100 characters': 'error.text.posRefTooLong',
  'You already have an open shift': 'error.text.posShiftOpen',
  'Open a shift before taking payments': 'error.text.posShiftNeeded',
  'The shift is closed': 'error.text.posShiftClosed',
  'Use at most 200 characters': 'error.text.posReasonTooLong',
  'Use at most 300 characters': 'error.text.posTextTooLong',
  'Nothing to change': 'error.text.posNothingToChange',
  'Choose a size': 'error.text.posChooseSize',
  'Choose an option for every required group': 'error.text.posChooseRequired',
  'Choose only as many options as the group allows': 'error.text.posChooseTooMany',
  'Enter a reason': 'error.text.posEnterReason',
  'Only a dine-in order sits at a table': 'error.text.posDineInOnly',
  'That option is not available': 'error.text.posOptionUnavailable',
  'The bill cannot be requested for this order': 'error.text.posBillRefused',
  'The discount is larger than the line': 'error.text.posDiscountTooBig',
  'The line is cancelled': 'error.text.posLineCancelled',
  'The line was sent to the kitchen and can no longer change': 'error.text.posLineSent',
  'The order cannot be cancelled': 'error.text.posCancelRefused',
  'The order is paid, cancelled or rejected and can no longer change': 'error.text.posOrderLocked',
  'The order was changed by someone else. Reload it and try again.': 'error.text.posOrderChanged',
  'This product is not available': 'error.text.posProductUnavailable',
  'Could not open the order. Try again.': 'error.text.posOpenFailed',
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
