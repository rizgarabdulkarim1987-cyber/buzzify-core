import type { PosComplaintCategory, PosComplaintStatus } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { canMove, excerpt } from '@/server/domain/pos/complaint-rules';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';

/**
 * The manager's side of the complaints box. A list row never carries the contact; only the detail does, and only to a person
 * who may manage complaints. Notes are only ever added. Every status move is conflict-checked against the status the
 * person saw.
 */

export interface ComplaintRow {
  id: string;
  status: PosComplaintStatus;
  category: PosComplaintCategory | null;
  excerpt: string;
  createdAt: Date;
  tableNumber: number | null;
  orderNumber: number | null;
  hasContact: boolean;
  noteCount: number;
}

export async function listComplaints(db: AnyDb, restaurantId: string, input: { status?: PosComplaintStatus; before?: Date; take?: number }): Promise<ComplaintRow[]> {
  const rows = await db.posComplaint.findMany({
    where: { restaurantId, ...(input.status ? { status: input.status } : {}), ...(input.before ? { createdAt: { lt: input.before } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(input.take ?? 50, 1), 100),
    select: { id: true, status: true, category: true, body: true, createdAt: true, tableNumber: true, orderNumber: true, contactName: true, contactPhone: true, _count: { select: { notes: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    category: row.category,
    excerpt: excerpt(row.body),
    createdAt: row.createdAt,
    tableNumber: row.tableNumber,
    orderNumber: row.orderNumber,
    hasContact: row.contactName !== null || row.contactPhone !== null,
    noteCount: row._count.notes,
  }));
}

export async function countNewComplaints(db: AnyDb, restaurantId: string): Promise<number> {
  return db.posComplaint.count({ where: { restaurantId, status: 'NEW' } });
}

export async function hasAnyComplaint(db: AnyDb, restaurantId: string): Promise<boolean> {
  return (await db.posComplaint.count({ where: { restaurantId }, take: 1 })) > 0;
}

export interface ComplaintDetail {
  id: string;
  status: PosComplaintStatus;
  category: PosComplaintCategory | null;
  body: string;
  createdAt: Date;
  tableNumber: number | null;
  orderNumber: number | null;
  /** Null unless the reader may manage complaints and a name or phone is still stored. */
  contact: { name: string | null; phone: string | null; consentAt: Date | null } | null;
  contactRemoved: boolean;
  statusChangedAt: Date | null;
  statusChangedByName: string | null;
  order: { id: string; number: number; lines: { name: string; quantity: number; options: string[]; cancelled: boolean }[] } | null;
  notes: { id: string; body: string; at: Date; userName: string }[];
}

export async function readComplaint(db: AnyDb, restaurantId: string, complaintId: string, mayManage: boolean): Promise<ComplaintDetail> {
  const row = await db.posComplaint.findFirst({ where: { id: complaintId, restaurantId }, include: { notes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
  if (!row) throw new StudioError('NOT_FOUND');
  const userIds = [...new Set([...row.notes.flatMap((n) => (n.userId ? [n.userId] : [])), ...(row.statusChangedByUserId ? [row.statusChangedByUserId] : [])])];
  const [users, order] = await Promise.all([
    userIds.length > 0 ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    row.orderId
      ? db.posOrder.findFirst({ where: { id: row.orderId, restaurantId }, select: { id: true, number: true, lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { nameSnapshot: true, quantity: true, optionsSnapshot: true, cancelledAt: true } } } })
      : Promise.resolve(null),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const hasContact = row.contactName !== null || row.contactPhone !== null;
  return {
    id: row.id,
    status: row.status,
    category: row.category,
    body: row.body,
    createdAt: row.createdAt,
    tableNumber: row.tableNumber,
    orderNumber: row.orderNumber,
    contact: mayManage && hasContact ? { name: row.contactName, phone: row.contactPhone, consentAt: row.contactConsentAt } : null,
    contactRemoved: row.contactRemovedAt !== null,
    statusChangedAt: row.statusChangedAt,
    statusChangedByName: row.statusChangedByUserId ? (names.get(row.statusChangedByUserId) ?? null) : null,
    order: order
      ? {
          id: order.id,
          number: order.number,
          lines: order.lines.map((line) => ({
            name: line.nameSnapshot,
            quantity: line.quantity,
            options: Array.isArray(line.optionsSnapshot) ? (line.optionsSnapshot as { name?: unknown }[]).flatMap((o) => (typeof o.name === 'string' ? [o.name] : [])) : [],
            cancelled: line.cancelledAt !== null,
          })),
        }
      : null,
    notes: row.notes.map((note) => ({ id: note.id, body: note.body, at: note.createdAt, userName: note.userId ? (names.get(note.userId) ?? '') : '' })),
  };
}

export async function setComplaintStatus(db: AnyDb, restaurantId: string, userId: string, complaintId: string, input: { from: PosComplaintStatus; to: PosComplaintStatus }) {
  if (!canMove(input.from, input.to)) throw refuse('CONFLICT', 'That step is not allowed');
  const { count } = await db.posComplaint.updateMany({
    where: { id: complaintId, restaurantId, status: input.from },
    data: { status: input.to, statusChangedAt: new Date(), statusChangedByUserId: userId },
  });
  if (count === 0) {
    const exists = await db.posComplaint.findFirst({ where: { id: complaintId, restaurantId }, select: { id: true } });
    if (!exists) throw new StudioError('NOT_FOUND');
    throw refuse('CONFLICT', 'The complaint was changed by someone else. Reload it.');
  }
}

/** Appends a note; the audit row holds its id and length, not the text. */
export async function addComplaintNote(db: AnyDb, restaurantId: string, userId: string, complaintId: string, body: string) {
  const complaint = await db.posComplaint.findFirst({ where: { id: complaintId, restaurantId }, select: { id: true } });
  if (!complaint) throw new StudioError('NOT_FOUND');
  const note = await db.posComplaintNote.create({ data: { restaurantId, complaintId, userId, body }, select: { id: true } });
  return { noteId: note.id, length: [...body].length };
}

/** Deletes the name and phone (the text, links and notes stay). A second call changes nothing. */
export async function removeComplaintContact(db: AnyDb, restaurantId: string, complaintId: string): Promise<{ removed: boolean }> {
  const complaint = await db.posComplaint.findFirst({ where: { id: complaintId, restaurantId }, select: { id: true } });
  if (!complaint) throw new StudioError('NOT_FOUND');
  const { count } = await db.posComplaint.updateMany({
    where: { id: complaintId, restaurantId, contactRemovedAt: null, OR: [{ contactName: { not: null } }, { contactPhone: { not: null } }] },
    data: { contactName: null, contactPhone: null, contactConsentAt: null, contactRemovedAt: new Date() },
  });
  return { removed: count > 0 };
}
