import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { aiErrorCode } from '@/server/ai/ai-error-code';
import { AiProviderError } from '@/server/ai/errors';
import { clearAiProviderCache, pingAiProvider, resolveAiProvider, aiSettingsInput, AiSettingsKeyError, writeAiSettings } from '@/server/ai/settings';
import { StudioError } from '@/server/studio/framework/result';
import { defineAction } from '@/server/studio/framework/action';

/**
 * The AI provider and its key (Studio → Settings → AI). Only the platform owner holds `plans.manage`, so only they save or
 * remove a key. The audit row names what changed (which provider, whether a key was saved or removed, which models) and
 * never a key or its last characters.
 */

const PLATFORM = { kind: 'platform' } as const;

export const saveAiSettings = defineAction({
  name: 'ai.saveSettings',
  permission: 'plans.manage',
  input: aiSettingsInput,
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      let change;
      try {
        change = await writeAiSettings(delegates(tx), input, ctx.actor.userId);
      } catch (error) {
        if (error instanceof AiSettingsKeyError) throw new StudioError('INVALID', undefined, { apiKey: 'noEncryptionKey' });
        throw error;
      }
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (change.provider.before !== change.provider.after) changes.provider = { before: change.provider.before, after: change.provider.after };
      for (const [name, what] of Object.entries(change.keys)) changes[`${name}.key`] = { before: what === 'removed' ? 'saved' : null, after: what === 'removed' ? null : 'saved' };
      for (const name of change.models) changes[`${name}.models`] = { before: null, after: 'changed' };
      if (Object.keys(changes).length > 0) ctx.audit({ action: 'ai.settings.update', entityType: 'AiSettings', entityId: 'ai', changes });
      return { changed: Object.keys(changes).length > 0 };
    }),
});

/**
 * One tiny real request, so the owner learns at once whether the saved key and model work. Nothing is stored and no
 * restaurant's usage is counted. Answers { ok: true } or { ok: false, code } like the till's AI actions.
 */
export const testAiProvider = defineAction({
  name: 'ai.testProvider',
  permission: 'plans.manage',
  input: z.object({}),
  target: () => PLATFORM,
  run: async (ctx) => {
    clearAiProviderCache();
    try {
      const provider = await resolveAiProvider(ctx.db);
      if (!provider) return { ok: false as const, code: 'aiUnavailable' as const, provider: null, detail: 'no key' };
      await pingAiProvider(provider);
      return { ok: true as const, provider: provider.name, detail: null };
    } catch (error) {
      return { ok: false as const, code: aiErrorCode(error), provider: null, detail: error instanceof AiProviderError ? error.detail : error instanceof Error ? error.name : null };
    }
  },
});
