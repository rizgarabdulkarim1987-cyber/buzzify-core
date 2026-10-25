import { z } from 'zod';

/**
 * What a till device may queue while it is offline, and what the server answers for each. Pure (zod only) so the device and
 * the server read the same shapes. Every kind is an existing till action; nothing else is queueable.
 */

export const OP_KINDS = ['openOrder', 'addLine', 'sendToKitchen', 'requestBill', 'cancelOrder', 'payCash'] as const;
export type OpKind = (typeof OP_KINDS)[number];

const INT32 = 2_147_483_647;
const id = z.string().min(1).max(64);
const uuid = z.uuid();

/** An order the server knows (`id`), or one an earlier operation opened (`op`, that operation's id). */
export const orderRefSchema = z.union([z.object({ id }).strict(), z.object({ op: uuid }).strict()]);
export type OrderRef = z.infer<typeof orderRefSchema>;

const base = { operationId: uuid, deviceId: uuid, clientAt: z.iso.datetime() };
const expectedVersion = z.number().int().min(1).max(INT32);
const money = z.number().int().min(0).max(INT32);
const text = z.string().trim().max(300);

const onOrder = { orderRef: orderRefSchema, expectedVersion };

export const operationSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('openOrder'), payload: z.object({ tableId: id }).strict() }).strict(),
  z
    .object({
      ...base,
      ...onOrder,
      kind: z.literal('addLine'),
      payload: z
        .object({
          productId: id,
          quantity: z.number().int().min(1).max(999),
          note: text,
          variantId: id.optional(),
          optionIds: z.array(id).max(50),
        })
        .strict(),
    })
    .strict(),
  z.object({ ...base, ...onOrder, kind: z.literal('sendToKitchen'), payload: z.object({}).strict() }).strict(),
  z.object({ ...base, ...onOrder, kind: z.literal('requestBill'), payload: z.object({}).strict() }).strict(),
  z.object({ ...base, ...onOrder, kind: z.literal('cancelOrder'), payload: z.object({ reason: text }).strict() }).strict(),
  z.object({ ...base, ...onOrder, kind: z.literal('payCash'), payload: z.object({ expectedTotal: money, amountReceived: money }).strict() }).strict(),
]);
export type Op = z.infer<typeof operationSchema>;

/** The request body of `POST /api/pos/sync`: one to 25 operations, applied in order. */
export const MAX_BATCH = 25;
export const syncRequestSchema = z.object({ deviceId: uuid, operations: z.array(z.unknown()).min(1).max(MAX_BATCH) }).strict();

export const SYNC_ERROR_CODES = [
  'stale',
  'locked',
  'totalChanged',
  'tableOccupied',
  'shiftRequired',
  'productUnavailable',
  'forbidden',
  'invalid',
  'operationMismatch',
  'wrongActor',
  'unknownRef',
  'failed',
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export type OpAnswer =
  | { operationId: string; status: 'done'; replayed: boolean; result: Record<string, unknown> }
  | {
      operationId: string;
      status: 'error';
      code: SyncErrorCode;
      /** The order's version now, for `stale`. */
      currentVersion: number | null;
      /** The order's status now, for `locked`. */
      orderStatus: string | null;
      /** For `totalChanged`: the total the cashier saw and the one the server computes now. */
      detail?: { expectedTotal: number; total: number };
    }
  | { operationId: string; status: 'skipped' };

/** The operation id of an unparsed operation, so even an invalid one gets an answer addressed to it. */
export function operationIdOf(raw: unknown): string {
  const value = typeof raw === 'object' && raw !== null ? (raw as { operationId?: unknown }).operationId : undefined;
  return typeof value === 'string' ? value : '';
}
