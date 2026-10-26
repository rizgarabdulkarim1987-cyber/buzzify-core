import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { cleanGuestText, COMPLAINT_STATUSES, hasContent, NOTE_MAX } from '@/server/domain/pos/complaint-rules';
import { addComplaintNote, removeComplaintContact, setComplaintStatus } from '@/server/pos/complaints';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** What a manager does with a received complaint. Online only; every change is audited by name, never with the customer's text or contact. */

const TILL = { kind: 'pos' } as const;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const setPosComplaintStatus = defineAction({
  name: 'pos.setComplaintStatus',
  permission: null,
  pos: 'complaint.manage',
  input: z.object({ complaintId: idField, from: z.enum(COMPLAINT_STATUSES), to: z.enum(COMPLAINT_STATUSES) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      await setComplaintStatus(delegates(tx), restaurantId, pos.userId, input.complaintId, { from: input.from, to: input.to });
      ctx.audit({ action: 'pos.complaint.status', entityType: 'PosComplaint', entityId: input.complaintId, changes: { status: { before: input.from, after: input.to } } });
      return { complaintId: input.complaintId };
    });
  },
});

export const addPosComplaintNote = defineAction({
  name: 'pos.addComplaintNote',
  permission: null,
  pos: 'complaint.manage',
  input: z.object({
    complaintId: idField,
    body: z
      .string()
      .transform(cleanGuestText)
      .pipe(z.string().trim().min(1, 'Enter a note').max(NOTE_MAX, 'Use at most 1000 characters'))
      .refine(hasContent, 'Enter a note'),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await addComplaintNote(delegates(tx), restaurantId, pos.userId, input.complaintId, input.body);
      ctx.audit({ action: 'pos.complaint.note', entityType: 'PosComplaint', entityId: input.complaintId, changes: { noteId: { before: null, after: done.noteId }, length: { before: null, after: done.length } } });
      return { noteId: done.noteId };
    });
  },
});

export const removePosComplaintContact = defineAction({
  name: 'pos.removeComplaintContact',
  permission: null,
  pos: 'complaint.manage',
  input: z.object({ complaintId: idField }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await removeComplaintContact(delegates(tx), restaurantId, input.complaintId);
      if (done.removed) ctx.audit({ action: 'pos.complaint.contact.remove', entityType: 'PosComplaint', entityId: input.complaintId, changes: {} });
      return done;
    });
  },
});
