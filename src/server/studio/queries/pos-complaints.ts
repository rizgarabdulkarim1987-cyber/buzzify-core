import { z } from 'zod';
import { canPos } from '@/server/domain/pos/permissions';
import { COMPLAINT_STATUSES } from '@/server/domain/pos/complaint-rules';
import { countNewComplaints, listComplaints, readComplaint } from '@/server/pos/complaints';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';

/** The complaints box for managers. The list never carries a contact; the detail does, only for those who manage complaints. */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

export const posComplaints = defineQuery({
  name: 'pos.complaints',
  permission: null,
  pos: 'complaint.view',
  input: z.object({ status: z.enum(COMPLAINT_STATUSES).optional(), before: z.coerce.date().optional() }),
  target: () => TILL,
  run: (ctx, input) => listComplaints(ctx.db, restaurantOf(ctx), { ...input, take: 50 }),
});

export const posComplaint = defineQuery({
  name: 'pos.complaint',
  permission: null,
  pos: 'complaint.view',
  input: z.object({ complaintId: idField }),
  target: () => TILL,
  run: (ctx, input) => readComplaint(ctx.db, restaurantOf(ctx), input.complaintId, ctx.pos !== null && canPos(ctx.pos.role, 'complaint.manage')),
});

/** For the till frame's navigation: the page is always listed, and this says how many are new. */
export const posComplaintBadge = defineQuery({
  name: 'pos.complaintBadge',
  permission: null,
  pos: 'complaint.view',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    // The box belongs to the menu, which every restaurant has, so the page is always in the till's navigation.
    return { show: true, count: await countNewComplaints(ctx.db, restaurantOf(ctx)) };
  },
});
