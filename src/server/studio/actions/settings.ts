import { z } from 'zod';
import { LOCALES } from '@/lib/locale';
import {
  currencyField,
  localesField,
  MAX_RESERVED_SLUGS,
  normalizeReservedSlugs,
  senderNameField,
  settingValues,
  timeZoneField,
  type PlatformSettings,
} from '@/server/domain/platform-settings';
import { normalizeSlugInput, SLUG_MAX } from '@/server/domain/slug';
import type { Prisma } from '@/generated/prisma/client';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { getPlatformSettings } from '@/server/studio/services/settings';

/**
 * The platform's settings: one action that saves the whole form. Only Super Admins hold `platform.settings`, and a client
 * policy can never grant it. The audit row lists each setting that changed, before and after.
 */

const PLATFORM = { kind: 'platform' } as const;

/** What a reserved word may be before it is cleaned: any text up to a sensible length. */
const typedWord = z.string().max(100, 'This is too long');

const settingsInput = z.object({
  reservedSlugs: z
    .array(typedWord)
    .max(MAX_RESERVED_SLUGS, `Reserve at most ${MAX_RESERVED_SLUGS} words`)
    // A word with nothing a slug can hold (Arabic script, symbols) would be dropped without a trace: say so instead.
    .refine(
      (words) => words.every((word) => word.trim() === '' || normalizeSlugInput(word) !== ''),
      'Use lowercase letters, digits and single hyphens',
    )
    .refine((words) => words.every((word) => normalizeSlugInput(word).length <= SLUG_MAX), `Use at most ${SLUG_MAX} characters`),
  emailSenderName: senderNameField,
  defaults: z
    .object({
      locales: localesField,
      defaultLocale: z.enum(LOCALES, 'Choose one of the languages offered'),
      currency: currencyField,
      timezone: timeZoneField,
    })
    // With no language chosen, that is the one problem to fix; the default is checked against a list there is.
    .refine((defaults) => defaults.locales.length === 0 || defaults.locales.includes(defaults.defaultLocale), {
      path: ['defaultLocale'],
      message: 'Choose the default language among the menu languages',
    }),
});

/** Flattens the stored settings to the dotted names the audit row uses: `defaults.currency`, not `defaults`. */
function flat(settings: PlatformSettings): Record<string, unknown> {
  const { reservedSlugs, emailSenderName, defaults } = settingValues(settings) as {
    reservedSlugs: unknown;
    emailSenderName: unknown;
    defaults: PlatformSettings['defaults'];
  };
  return {
    reservedSlugs,
    emailSenderName,
    'defaults.locales': defaults.locales,
    'defaults.defaultLocale': defaults.defaultLocale,
    'defaults.currency': defaults.currency,
    'defaults.timezone': defaults.timezone,
  };
}

export const updatePlatformSettings = defineAction({
  name: 'settings.update',
  permission: 'platform.settings',
  input: settingsInput,
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const before = await getPlatformSettings(tx);
      const next: PlatformSettings = {
        reservedSlugs: normalizeReservedSlugs(input.reservedSlugs),
        emailSenderName: input.emailSenderName,
        defaults: input.defaults,
      };

      // A menu that has the word as its address, or had it, would be cut off from the platform's own rule: refuse, and say
      // which menu. Words reserved before are not checked again, so the other settings stay saveable. A deleted menu's
      // address (a tombstone, `menuId` null) is nobody's.
      const added = next.reservedSlugs.filter((word) => !before.reservedSlugs.includes(word));
      if (added.length > 0) {
        const holder = await tx.menuSlug.findFirst({
          where: { slug: { in: added }, menuId: { not: null } },
          select: { slug: true, menu: { select: { name: true } } },
        });
        const current = holder ? null : await tx.menu.findFirst({ where: { slug: { in: added } }, select: { slug: true, name: true } });
        const word = holder?.slug ?? current?.slug;
        const menu = holder?.menu?.name ?? current?.name;
        if (word !== undefined && menu !== undefined) {
          const message = `${word} is already the address of the menu ${menu}`;
          throw new StudioError('INVALID', message, { reservedSlugs: message, inUseWord: word, inUseMenu: menu });
        }
      }

      const was = flat(before);
      const now = flat(next);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const name of Object.keys(now)) {
        if (JSON.stringify(was[name]) !== JSON.stringify(now[name])) changes[name] = { before: was[name], after: now[name] };
      }
      if (Object.keys(changes).length === 0) return { settings: before, changed: false };

      const stored = settingValues(next);
      const prior = settingValues(before);
      for (const key of Object.keys(stored) as Array<keyof typeof stored>) {
        if (JSON.stringify(stored[key]) === JSON.stringify(prior[key])) continue;
        const value = stored[key] as Prisma.InputJsonValue;
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value, updatedById: ctx.actor.userId },
          update: { value, updatedById: ctx.actor.userId },
        });
      }

      ctx.audit({ action: 'settings.updated', entityType: 'PlatformSetting', entityId: 'platform', changes });
      return { settings: next, changed: true };
    }),
});
