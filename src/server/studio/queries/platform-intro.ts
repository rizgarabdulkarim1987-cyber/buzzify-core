import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';

/** The platform's intro background and every platform advert, for the Super Admin's page. */
export const platformIntro = defineQuery({
  name: 'platform.intro',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx) => {
    const [defaults, adverts] = await Promise.all([
      ctx.db.platformIntro.findUnique({ where: { id: 'singleton' } }),
      ctx.db.platformAdvert.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return { backgroundAssetId: defaults?.backgroundAssetId ?? null, adverts };
  },
});
