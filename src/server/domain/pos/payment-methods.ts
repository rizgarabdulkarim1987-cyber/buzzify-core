/** The ways a till takes payment. Pure, so a client form can import it. */
export const POS_PAYMENT_METHODS = ['CASH', 'ZAINCASH', 'FIB', 'QICARD'] as const;
export type PosPaymentMethodKey = (typeof POS_PAYMENT_METHODS)[number];
