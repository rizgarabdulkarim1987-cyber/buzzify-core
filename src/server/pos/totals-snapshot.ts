import { z } from 'zod';
import { optionsSnapshotSchema } from './orders';

const amount = z.number().int().min(0);
/** `reason` is the discount's reason (such as COMP); absent in receipts paid before reasons existed. */
const discountSchema = z.object({ kind: z.enum(['AMOUNT', 'PERCENT']), value: z.number().int(), reason: z.string().nullable().optional() });

/**
 * Everything the receipt needs, copied when the order is paid: the totals, what produced them and the lines paid for
 * (cancelled lines left out). It never changes when the menu or the rates change later.
 */
export const totalsSnapshotSchema = z.object({
  subtotal: amount,
  invoiceDiscount: amount,
  service: amount,
  tax: amount,
  deliveryFee: amount.default(0),
  total: amount,
  /** What the restaurant's rounding step added (+) or took off (-) to reach `total`; absent in receipts paid before rounding existed. */
  rounding: z.number().int().default(0),
  /** The business's tax number as it was when the bill was paid, so a later edit never rewrites a tax document; absent if none. */
  taxNumber: z.string().optional(),
  invoiceDiscountInput: discountSchema.nullable(),
  rates: z.object({ serviceRatePercent: z.number().int(), taxRatePercent: z.number().int() }),
  lines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quantity: z.number().int().min(1),
      unitPrice: amount,
      options: optionsSnapshotSchema,
      /** What the menu's offer took off one unit (whole IQD); absent in receipts paid before offers reached the till. */
      promoPerUnit: amount.default(0),
      discount: discountSchema.nullable(),
      lineTotal: amount,
    }),
  ),
});

export type TotalsSnapshot = z.infer<typeof totalsSnapshotSchema>;

/** A stored payment's snapshot, checked. A snapshot that does not match the schema is corrupt data, never guessed at. */
export function parseTotalsSnapshot(paymentId: string, value: unknown): TotalsSnapshot {
  const parsed = totalsSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error(`The stored totals of payment ${paymentId} are corrupt`, { cause: parsed.error });
  return parsed.data;
}
