import type { PrismaClient } from '@/generated/prisma/client';
import { assertAuditSafe } from '@/server/domain/pharmacy/audit-fields';
import type { PhActor } from './actor';

/**
 * The audit row of one read of an attachment: who and which file, and how many bytes. No patient field, no file name. A read is
 * audited whether or not the pharmacy is read-only (an audit row is not pharmacy data).
 */
export async function auditAttachmentRead(prisma: PrismaClient, ph: PhActor, file: { id: string; sizeBytes: number }): Promise<void> {
  const changes = { fileId: { before: null, after: file.id }, bytes: { before: null, after: file.sizeBytes } };
  assertAuditSafe('PhRxAttachment', changes);
  await prisma.auditLog.create({
    data: { actorId: ph.userId, restaurantId: ph.restaurantId, action: 'ph.rx.attachment.read', entityType: 'PhRxAttachment', entityId: file.id, changes },
  });
}
