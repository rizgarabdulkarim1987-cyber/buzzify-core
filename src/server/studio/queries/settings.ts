import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { OFFERED_CURRENCIES, OFFERED_TIME_ZONES } from '@/server/studio/services/menus';
import { getPlatformSettings } from '@/server/studio/services/settings';

/** What the Settings screen reads. Super Admins only (`platform.settings`, which no client policy can grant). */

export const platformSettings = defineQuery({
  name: 'settings.get',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }),
  run: async (ctx) => {
    const [settings, updated] = await Promise.all([
      getPlatformSettings(ctx.db),
      ctx.db.platformSetting.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);
    return {
      settings,
      /** When any setting was last saved; null while every setting is still the built-in default. */
      updatedAt: updated?.updatedAt.toISOString() ?? null,
      currencies: OFFERED_CURRENCIES,
      timeZones: OFFERED_TIME_ZONES,
    };
  },
});
