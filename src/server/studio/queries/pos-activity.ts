import { z } from 'zod';
import { ACTIVITY_TYPES, listActivityIn } from '@/server/pos/activity';
import { defineQuery } from '@/server/studio/framework/query';

/** Discounts, cancels, refunds, cash differences and PIN failures of this restaurant, with the staff to filter by. */
export const posActivity = defineQuery({
  name: 'pos.activity',
  permission: null,
  pos: 'report.view',
  input: z.object({
    userId: z.string().min(1).max(64).optional(),
    type: z.enum(ACTIVITY_TYPES).optional(),
    before: z.string().datetime().optional(),
  }),
  target: () => ({ kind: 'pos' }),
  run: async (ctx, input) => {
    if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
    const { rows, next } = await listActivityIn(ctx.db, ctx.restaurantId, { userId: input.userId, type: input.type, before: input.before ? new Date(input.before) : undefined });
    const staff = await ctx.db.posStaff.findMany({ where: { restaurantId: ctx.restaurantId }, select: { userId: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
    return { rows, next, staff: staff.map((s) => ({ userId: s.userId, name: s.user.name })) };
  },
});
