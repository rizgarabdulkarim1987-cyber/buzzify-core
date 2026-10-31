import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { loadOverview } from '@/server/studio/services/overview';
import { businessSpace } from '@/server/studio/services/space-scope';

/**
 * The Overview: counts and lists within the reader's restaurants (every one for a Super Admin). The newest activity is
 * part of it only for a reader who may read the audit log; for anyone else it is `null`.
 */

export const overview = defineQuery({
  name: 'overview.get',
  permission: 'view',
  input: z.object({ space: businessSpace }),
  target: () => ({ kind: 'platform' }),
  run: (ctx, { space }) => loadOverview(ctx.db, ctx.scope, { activity: ctx.permissions.has('audit.view'), space }),
});
