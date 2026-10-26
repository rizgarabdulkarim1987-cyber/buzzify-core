import { z } from 'zod';
import { excerpt } from '@/server/domain/pos/complaint-rules';
import { defineQuery } from '@/server/studio/framework/query';

/** The messages guests left through the menu's box, for the restaurant's people. Contacts show only to those who edit content. */

const FEEDBACK_ROWS = 100;

export const restaurantFeedback = defineQuery({
  name: 'restaurants.feedback',
  permission: 'view',
  input: z.object({ restaurantId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }) as const,
  run: async (ctx) => {
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A restaurant query ran without a restaurant');
    const withContact = ctx.permissions.has('content.edit');
    const [menus, rows] = await Promise.all([
      ctx.db.menu.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, feedbackEnabled: true } }),
      ctx.db.posComplaint.findMany({
        where: { restaurantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: FEEDBACK_ROWS,
        select: { id: true, category: true, body: true, createdAt: true, tableNumber: true, contactName: true, contactPhone: true, locale: true },
      }),
    ]);
    return {
      menus,
      rows: rows.map((row) => ({
        id: row.id,
        category: row.category,
        body: row.body,
        excerpt: excerpt(row.body),
        createdAt: row.createdAt,
        tableNumber: row.tableNumber,
        locale: row.locale,
        contactName: withContact ? row.contactName : null,
        contactPhone: withContact ? row.contactPhone : null,
      })),
    };
  },
});
