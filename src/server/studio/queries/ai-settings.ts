import { z } from 'zod';
import { readAiSettings } from '@/server/ai/settings';
import { defineQuery } from '@/server/studio/framework/query';

/** The AI provider settings for the platform owner: which provider runs and where each key comes from, never a key. */
export const aiSettings = defineQuery({
  name: 'ai.settings',
  permission: 'plans.manage',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: (ctx) => readAiSettings(ctx.db),
});
