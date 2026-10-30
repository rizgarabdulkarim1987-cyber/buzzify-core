/** The ways a till takes payment. Pure, so a client form can import it. */
export const POS_PAYMENT_METHODS = ['CASH', 'ZAINCASH', 'FIB', 'QICARD'] as const;
export type PosPaymentMethodKey = (typeof POS_PAYMENT_METHODS)[number];

/**
 * Every method a payment can record: the ones an owner switches on, plus cash in US dollars, which has its own switch and
 * rate in the settings instead of a place in `enabledPaymentMethods`.
 */
export const POS_LEG_METHODS = [...POS_PAYMENT_METHODS, 'CASH_USD'] as const;
export type PosLegMethodKey = (typeof POS_LEG_METHODS)[number];
