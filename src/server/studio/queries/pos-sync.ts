import { z } from 'zod';
import { readSyncSnapshot } from '@/server/pos/sync-snapshot';
import { defineQuery } from '@/server/studio/framework/query';

/** What the offline till works from. Read for the person's own restaurant, with the same gate as the order screen. */

const TILL = { kind: 'pos' } as const;

export const posSyncSnapshot = defineQuery({
  name: 'pos.syncSnapshot',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => {
    if (ctx.pos === null) throw new Error('A till query ran without a restaurant');
    return readSyncSnapshot(ctx.db, ctx.pos);
  },
});
