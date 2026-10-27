import { z } from 'zod';
import { checkRange } from '@/server/pos/range-report';
import { readSalesBreakdown } from '@/server/pos/report-breakdown';
import { defineQuery } from '@/server/studio/framework/query';

const TILL = { kind: 'pos' } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Sales by hour, item, staff member and payment method over a range of Baghdad days. */
export const posBreakdown = defineQuery({
  name: 'pos.breakdown',
  permission: null,
  pos: 'report.view',
  allowLapsed: true,
  input: z.object({ from: day, to: day }).refine((v) => !('problem' in checkRange(v.from, v.to)), { message: 'The first number must not exceed the last', path: ['from'] }),
  target: () => TILL,
  run: (ctx, input) => {
    if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
    return readSalesBreakdown(ctx.db, ctx.restaurantId, input);
  },
});
