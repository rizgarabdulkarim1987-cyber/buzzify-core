import { z } from 'zod';
import { EVENT_TYPES } from '@/server/data/events';
import { COMPLAINT_CATEGORIES, COMPLAINT_RAW_MAX, CONTACT_NAME_MAX } from '@/server/domain/pos/complaint-rules';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { LOCALES, MAX_LINES, MAX_QUANTITY } from '@/server/domain/types';

const id = z.string().min(1).max(64);
const locale = z.enum(LOCALES).default('en');

export const cartSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: id,
        variantId: id.nullable().default(null),
        optionIds: z.array(id).max(20).default([]),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
      }),
    )
    .max(MAX_LINES)
    .default([]),
  bundles: z
    .array(z.object({ bundleId: id, quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
    .max(10)
    .default([]),
});

export const quoteRequestSchema = z.object({
  locale,
  cart: cartSchema,
});

export const searchIndexRequestSchema = z.object({});

export const suggestionsRequestSchema = z.object({
  context: z.enum(['menu', 'product', 'cart']),
  locale,
  product: z
    .object({
      productId: id,
      variantId: id.nullable().default(null),
      optionIds: z.array(id).max(20).default([]),
    })
    .optional(),
  cart: cartSchema.default({ lines: [], bundles: [] }),
  dismissedIds: z.array(z.string().max(128)).max(100).default([]),
});

export const eventsRequestSchema = z.object({
  anonymousSessionId: z.string().min(8).max(64),
  tableNumber: z.number().int().min(1).max(999).nullable().default(null),
  events: z
    .array(
      z.object({
        type: z.enum(EVENT_TYPES),
        productId: id.optional(),
        suggestionId: z.string().max(128).optional(),
        /** The printed QR code a menu view came from (`?qr=` on the address it opened). */
        qrCodeId: z.string().min(1).max(64).optional(),
        payload: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(20),
});

/** A guest's QR order. Strict: a price, a total or any field not listed here is refused, never ignored. */
export const qrOrderSchema = z.strictObject({
  table: z.number().int().min(1).max(999),
  locale,
  cart: z.strictObject({
    lines: z
      .array(
        z.strictObject({
          productId: id,
          variantId: id.nullable().default(null),
          optionIds: z.array(id).max(20).default([]),
          quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity),
          note: z.string().trim().max(QR_LIMITS.maxNote).default(''),
        }),
      )
      .min(1)
      .max(QR_LIMITS.maxLines),
    bundles: z.array(z.strictObject({ bundleId: id, quantity: z.number().int().min(1).max(MAX_QUANTITY) })).max(10).default([]),
  }),
  note: z.string().trim().max(QR_LIMITS.maxNote).default(''),
});

/** The secret a guest's phone keeps for a table's basket; only its hash is stored. */
export const basketToken = z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** A guest replacing their own part of the table basket. Strict, like the QR order: no price, no total. */
export const basketPartSchema = z.strictObject({
  table: z.number().int().min(1).max(999),
  token: basketToken,
  name: z.string().trim().max(24).default(''),
  lines: z
    .array(
      z.strictObject({
        productId: id,
        variantId: id.nullable().default(null),
        optionIds: z.array(id).max(20).default([]),
        quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity),
        note: z.string().trim().max(QR_LIMITS.maxNote).default(''),
      }),
    )
    .max(QR_LIMITS.maxLines),
});

/** A guest sending the whole table's basket. */
export const basketSendSchema = z.strictObject({
  table: z.number().int().min(1).max(999),
  token: basketToken,
  locale,
  note: z.string().trim().max(QR_LIMITS.maxNote).default(''),
});

/** A guest's complaint. Strict; `website` is the honeypot, a field no person sees and so one that stays empty. */
export const complaintSchema = z.strictObject({
  table: z.number().int().min(1).max(999).optional(),
  locale,
  clientKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  body: z.string().max(COMPLAINT_RAW_MAX),
  category: z.enum(COMPLAINT_CATEGORIES).optional(),
  contactName: z.string().trim().max(CONTACT_NAME_MAX).optional(),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,24}$/).optional(),
  consent: z.boolean().default(false),
  website: z.string().max(200).default(''),
});

/** A spin: the winner is the server's to draw, so the guest sends nothing but the language the prize line is read in. */
export const wheelSpinSchema = z.strictObject({ locale: z.enum(LOCALES).optional() });
