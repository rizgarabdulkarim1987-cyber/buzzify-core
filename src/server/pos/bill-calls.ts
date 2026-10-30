import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantInfo } from '@/server/data/tenant';
import { scopedClient, type AnyDb } from '@/server/data/tenant-db';
import { expiryCutoff } from '@/server/domain/pos/customer-order-rules';
import { QrGateClosed, QrOrderRefusal, qrOrderGate } from './customer-orders-guest';

/** At most this many calls from one table inside the window; the guest is told to wait after that. */
const MAX_CALLS = 3;
const WINDOW_MS = 10 * 60_000;

/**
 * A guest at a table asks for the bill. It leaves one unseen call for the floor and, when the table has a live order that
 * is open or ready, moves it to BILL_REQUESTED. The captain's approval switch plays no part: a bill is never held back.
 * A call still unseen is not repeated (the order is still moved, when one was opened since), and a table cannot call more
 * than three times in ten minutes. A call left unseen for longer than a request waits (an hour) no longer counts.
 */
export async function callForBill(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId'>, input: { table: number }, now: Date = new Date()): Promise<{ ok: true }> {
  const gate = await qrOrderGate(prisma, tenant, input.table, now);
  if (!gate.open) throw new QrGateClosed();
  const till = scopedClient(prisma, { restaurantId: gate.restaurantId });
  return till.$transaction(async (tx) => {
    // Locks the table's row: two calls from one table are counted one after the other.
    const locked = await tx.posTable.updateMany({ where: { id: gate.tableId, restaurantId: gate.restaurantId }, data: { number: input.table } });
    if (locked.count === 0) throw new QrGateClosed();

    const [unseen, recent] = await Promise.all([
      tx.posBillCall.findFirst({ where: { restaurantId: gate.restaurantId, tableId: gate.tableId, seenAt: null, createdAt: { gt: expiryCutoff(now) } }, select: { id: true } }),
      tx.posBillCall.count({ where: { restaurantId: gate.restaurantId, tableId: gate.tableId, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } } }),
    ]);
    if (!unseen && recent >= MAX_CALLS) throw new QrOrderRefusal('TOO_MANY_REQUESTS');

    // Best effort: the call below is the notice. The move is one conditional update on the version just read, so staff
    // changing or paying the order at the same moment match nothing here (no throw, which would abort the transaction).
    const live = await tx.posOrder.findFirst({ where: { restaurantId: gate.restaurantId, tableId: gate.tableId, status: { in: ['OPEN', 'READY'] } } });
    let moved: { id: string; from: string } | null = null;
    if (live) {
      const { count } = await tx.posOrder.updateMany({
        where: { id: live.id, restaurantId: gate.restaurantId, version: live.version, status: { in: ['OPEN', 'READY'] } },
        data: { status: 'BILL_REQUESTED', version: { increment: 1 } },
      });
      if (count > 0) moved = { id: live.id, from: live.status };
    }
    // The floor already has this table's call: no second one, and an audit row only when the order moved.
    if (unseen && !moved) return { ok: true } as const;
    const call = unseen ?? (await tx.posBillCall.create({ data: { restaurantId: gate.restaurantId, tableId: gate.tableId, tableNumber: input.table, createdAt: now }, select: { id: true } }));
    await tx.auditLog.create({
      data: {
        actorId: null,
        restaurantId: gate.restaurantId,
        menuId: tenant.id,
        action: 'pos.billCall.call',
        entityType: 'PosBillCall',
        entityId: call.id,
        changes: {
          ...(unseen ? {} : { tableNumber: { before: null, after: input.table } }),
          ...(moved ? { orderId: moved.id, orderStatus: { before: moved.from, after: 'BILL_REQUESTED' } } : {}),
        },
      },
    });
    return { ok: true } as const;
  });
}

/** The calls nobody has seen yet and that are under an hour old, oldest first. */
export async function listOpenBillCalls(db: AnyDb, restaurantId: string, now: Date = new Date()): Promise<{ id: string; tableNumber: number; createdAt: Date }[]> {
  return db.posBillCall.findMany({
    where: { restaurantId, seenAt: null, createdAt: { gt: expiryCutoff(now) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tableNumber: true, createdAt: true },
  });
}

/** Marks a call seen. Returns false when it does not exist or was already seen, so the second person to tap it changes nothing. */
export async function markBillCallSeenIn(db: AnyDb, restaurantId: string, input: { id: string; userId: string }, now: Date = new Date()): Promise<boolean> {
  const { count } = await db.posBillCall.updateMany({
    where: { id: input.id, restaurantId, seenAt: null },
    data: { seenAt: now, seenByUserId: input.userId },
  });
  return count > 0;
}
