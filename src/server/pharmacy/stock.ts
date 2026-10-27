/** The ledger's movement kinds (the `PhMovementType` enum of the schema); named here so this file imports nothing from the database layer. */
export type PhMovementType =
  | 'RECEIPT'
  | 'SALE'
  | 'RETURN_IN'
  | 'RETURN_QUARANTINE'
  | 'ADJUST'
  | 'DAMAGE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'SUPPLIER_RETURN'
  | 'COUNT'
  | 'QUARANTINE_RELEASE';
import type { ScopedTx } from "@/server/data/tenant-db";
import { StudioError } from "@/server/studio/framework/result";

/**
 * The stock ledger's only writer. Every change to a `PhStockBalance` and every `PhStockMovement` row goes through
 * `applyMovement` (or `reverseMovement`, which calls it), inside the caller's transaction, so a balance never changes
 * without its movement and a failed movement leaves nothing behind. A bucket never goes below zero: each decrement is
 * guarded in the statement itself (`WHERE bucket >= n`), and the table's CHECK is the backstop.
 */

export const BUCKETS = [
  "available",
  "reserved",
  "quarantine",
  "damaged",
] as const;
export type Bucket = (typeof BUCKETS)[number];
export type Deltas = Partial<Record<Bucket, number>>;

export interface MovementInput {
  restaurantId: string;
  branchId: string;
  batchId: string;
  type: PhMovementType;
  /** Signed whole numbers of the product's base unit. */
  deltas: Deltas;
  reason: string;
  userId: string;
  receiptId?: string | null;
  countId?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/** What only `reverseMovement` may add: the movement being corrected. */
type InternalInput = MovementInput & { reversesId?: string | null };

/** The types that must say why. */
const NEEDS_REASON: ReadonlySet<PhMovementType> = new Set([
  "ADJUST",
  "DAMAGE",
  "COUNT",
  "SUPPLIER_RETURN",
  "QUARANTINE_RELEASE",
]);

/**
 * For a caller that touches several balances in one transaction: take them in this order (by batch id), so two
 * transactions that touch the same balances queue instead of waiting on each other.
 */
export function lockOrder<T extends { batchId: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) =>
    a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0,
  );
}

const insufficient = (bucket: Bucket, have: number) =>
  new StudioError("CONFLICT", `Not enough stock in ${bucket}: ${have} left`, {
    phCode: "INSUFFICIENT_STOCK",
    bucket,
    have: String(have),
  });

function invalid(field: string, message: string): StudioError {
  return new StudioError("INVALID", message, { [field]: message });
}

const bucketColumns = (tx: ScopedTx, batchId: string, branchId: string) =>
  tx.phStockBalance.findFirst({
    where: { batchId, branchId },
    select: {
      available: true,
      reserved: true,
      quarantine: true,
      damaged: true,
    },
  });

/** Types that only take stock out of `available`, and types that only put it in. */
const OUT_TYPES: ReadonlySet<PhMovementType> = new Set([
  "SALE",
  "DAMAGE",
  "SUPPLIER_RETURN",
  "TRANSFER_OUT",
]);
const IN_TYPES: ReadonlySet<PhMovementType> = new Set([
  "RECEIPT",
  "RETURN_IN",
  "TRANSFER_IN",
]);
const MAX_DELTA = 2_147_483_647;

/** Applies one movement to the balance of `(batch, branch)` and records it. Returns the new movement's id. */
export async function applyMovement(
  tx: ScopedTx,
  input: MovementInput,
): Promise<{ id: string }> {
  // A smuggled reversesId is dropped: only reverseMovement corrects a movement.
  const plain: MovementInput = { ...input };
  delete (plain as InternalInput).reversesId;
  return write(tx, plain, null);
}

async function write(
  tx: ScopedTx,
  input: MovementInput,
  reversesId: string | null,
): Promise<{ id: string }> {
  const changes = BUCKETS.map(
    (bucket) => [bucket, input.deltas[bucket] ?? 0] as const,
  );
  for (const [bucket, delta] of changes) {
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > MAX_DELTA)
      throw invalid(bucket, "Use a whole number of at most 2147483647");
  }
  if (reversesId === null) {
    const available = input.deltas.available ?? 0;
    if (OUT_TYPES.has(input.type) && available > 0)
      throw invalid("deltas", "This kind of movement cannot add stock");
    if (IN_TYPES.has(input.type) && available < 0)
      throw invalid("deltas", "This kind of movement cannot remove stock");
    if (
      input.type === "RECEIPT" &&
      changes.some(([bucket, delta]) => bucket !== "available" && delta !== 0)
    ) {
      throw invalid("deltas", "A receipt adds to available stock only");
    }
  }
  if (changes.every(([, delta]) => delta === 0))
    throw invalid("deltas", "A movement must change some quantity");
  const reason = input.reason.trim();
  if (NEEDS_REASON.has(input.type) && reason === "")
    throw invalid("reason", "Enter the reason");
  if (input.userId === "")
    throw invalid("userId", "A movement needs the person who made it");

  // The business's own batch and branch only; the product is the batch's, never the caller's.
  const [batch, branch] = await Promise.all([
    tx.phBatch.findFirst({
      where: { id: input.batchId, restaurantId: input.restaurantId },
      select: { productId: true },
    }),
    tx.branch.findFirst({
      where: { id: input.branchId, restaurantId: input.restaurantId },
      select: { id: true },
    }),
  ]);
  if (!batch) throw new StudioError("NOT_FOUND", "Batch not found");
  if (!branch) throw new StudioError("NOT_FOUND", "Branch not found");

  // First use creates the row. skipDuplicates (ON CONFLICT DO NOTHING) is the retry-on-race the unique
  // (batch, branch) index needs: a plain create that lost the race would raise P2002 and abort this transaction.
  try {
    await tx.phStockBalance.createMany({
      data: [
        {
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          productId: batch.productId,
          batchId: input.batchId,
        },
      ],
      skipDuplicates: true,
    });
  } catch (error) {
    // A client limited to other branches refuses the write with a plain Error: tell the caller it is not allowed.
    if (error instanceof Error && error.message.startsWith("Branch scope"))
      throw new StudioError("FORBIDDEN");
    throw error;
  }

  // One statement for every bucket: the decrements are guarded in its WHERE, so it either applies whole or not at all.
  const where: Record<string, unknown> = {
    batchId: input.batchId,
    branchId: input.branchId,
  };
  const data: Record<string, { increment: number } | { decrement: number }> =
    {};
  for (const [bucket, delta] of changes) {
    if (delta > 0) data[bucket] = { increment: delta };
    if (delta < 0) {
      where[bucket] = { gte: -delta };
      data[bucket] = { decrement: -delta };
    }
  }
  const updated = await tx.phStockBalance.updateMany({ where, data });
  if (updated.count !== 1) {
    const now = await bucketColumns(tx, input.batchId, input.branchId);
    for (const [bucket, delta] of changes) {
      const have = now?.[bucket] ?? 0;
      if (delta < 0 && have < -delta) throw insufficient(bucket, have);
    }
    // Nothing short and nothing updated: the row changed under us. Retryable.
    throw new StudioError("CONFLICT");
  }

  const row = await tx.phStockMovement.create({
    data: {
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      productId: batch.productId,
      batchId: input.batchId,
      type: input.type,
      availableDelta: input.deltas.available ?? 0,
      reservedDelta: input.deltas.reserved ?? 0,
      quarantineDelta: input.deltas.quarantine ?? 0,
      damagedDelta: input.deltas.damaged ?? 0,
      reason,
      userId: input.userId,
      receiptId: input.receiptId ?? null,
      countId: input.countId ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reversesId,
    },
    select: { id: true },
  });
  return row;
}

const alreadyReversed = () =>
  new StudioError("CONFLICT", "This movement was already reversed", {
    phCode: "ALREADY_REVERSED",
  });

const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "P2002";

/**
 * Corrects a movement with a new one of the same batch, branch and type and exactly the opposite deltas. A reversal
 * cannot be reversed and a movement is reversed once. If the opposite would take a bucket below zero (the stock has
 * since been sold) it fails INSUFFICIENT_STOCK: that is the right answer, not a bug.
 */
export async function reverseMovement(
  tx: ScopedTx,
  movementId: string,
  by: { userId: string; reason: string },
): Promise<{ id: string }> {
  if (by.reason.trim() === "") throw invalid("reason", "Enter the reason");
  const original = await tx.phStockMovement.findFirst({
    where: { id: movementId },
  });
  if (!original) throw new StudioError("NOT_FOUND", "Movement not found");
  if (original.reversesId !== null) {
    throw new StudioError("CONFLICT", "A reversal cannot be reversed", {
      phCode: "REVERSAL_OF_REVERSAL",
    });
  }
  const reversed = () =>
    tx.phStockMovement.findFirst({
      where: { reversesId: movementId },
      select: { id: true },
    });
  if (await reversed()) throw alreadyReversed();

  try {
    return await write(
      tx,
      {
        restaurantId: original.restaurantId,
        branchId: original.branchId,
        batchId: original.batchId,
        type: original.type,
        deltas: {
          available: -original.availableDelta,
          reserved: -original.reservedDelta,
          quarantine: -original.quarantineDelta,
          damaged: -original.damagedDelta,
        },
        reason: by.reason,
        userId: by.userId,
        receiptId: original.receiptId,
        countId: original.countId,
        refType: original.refType,
        refId: original.refId,
      },
      original.id,
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyReversed();
    // A parallel reversal that committed first took the stock this one wanted: that is "already reversed", not "sold".
    if (
      error instanceof StudioError &&
      error.fields?.phCode === "INSUFFICIENT_STOCK" &&
      (await reversed())
    )
      throw alreadyReversed();
    throw error;
  }
}
