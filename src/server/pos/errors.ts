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
  'This request was already decided': 'error.text.posRequestDecided',
  'The request has no items': 'error.text.posRequestEmpty',
  'This request expired': 'error.text.posRequestExpired',
  'The table has an order that cannot take more items': 'error.text.posOrderNotJoinable',
  'A delivery zone with this name already exists': 'error.text.posZoneNameTaken',
  'Create at most 50 delivery zones': 'error.text.posTooManyZones',
  'Create at most 100 drivers': 'error.text.posTooManyDrivers',
  'This order type is switched off': 'error.text.posTypeOff',
  'Only a takeaway or delivery order has these details': 'error.text.posOffPremiseOnly',
  'Only a delivery order has a driver': 'error.text.posDeliveryOnly',
  'The order is not paid yet': 'error.text.posNotPaid',
  'Choose a driver before the order goes out': 'error.text.posDriverRequired',
  'That driver is not available': 'error.text.posDriverInactive',
  'That step is not allowed': 'error.text.posBadStep',
  'Enter a valid phone number': 'error.text.posPhoneInvalid',
  'Enter an address': 'error.text.posAddressRequired',
  'The order was handed over and can no longer change': 'error.text.posHandedOver',
  'Use at most 120 characters': 'error.text.posNameTooLong',
  'Use 4 to 8 digits': 'error.text.posPinShape',
  'Choose a PIN that is harder to guess': 'error.text.posPinWeak',
  'This account cannot use a quick sign-in PIN': 'error.text.posPinUnavailable',
  'Register at most 20 devices': 'error.text.posTooManyDevices',
  'Enter a device name': 'error.text.posDeviceName',
  'This payment was already reversed': 'error.text.posAlreadyReversed',
  'This payment method is switched off': 'error.text.posMethodOff',
  'Card and wallet payments take the exact total': 'error.text.posExactTotal',
  'This operation was already applied': 'error.text.posOperationApplied',
  'An item with this name already exists': 'error.text.posItemNameTaken',
  'Remove the item from its recipes first': 'error.text.posItemInRecipe',
  'This item is switched off': 'error.text.posItemInactive',
  'Stock changed while you counted. Check the numbers and save again.': 'error.text.posStockChanged',
  'Each item can be counted once': 'error.text.posCountOnce',
  'A supplier with this name already exists': 'error.text.posSupplierNameTaken',
  'Enter a quantity': 'error.text.posEnterQuantity',
  'Enter a note': 'error.text.posEnterNote',
  'Use at most 1000 characters': 'error.text.posText1000',
  'This invoice was already saved': 'error.text.posInvoiceDuplicate',
  'This invoice was already voided': 'error.text.posInvoiceVoided',
  'The sum of the lines is too large': 'error.text.posInvoiceTooLarge',
  'The complaint was changed by someone else. Reload it.': 'error.text.posComplaintChanged',
  'Agree to be contacted to leave a name or phone': 'error.text.posConsentRequired',
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
