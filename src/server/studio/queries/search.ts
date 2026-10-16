import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { findMenus, findPeople, findRestaurants, JUMP_LIMIT, PICK_LIMIT } from '@/server/studio/services/search';

/**
 * Finding things by typing: Jump to (Ctrl+K), and the pickers behind the filters and forms that choose one restaurant,
 * menu or person out of a thousand. Each is a platform read limited to the reader's restaurants, and each answers with
 * a few rows (8 for Jump to, 20 for a picker): a picker never loads everything.
 */

const PLATFORM = { kind: 'platform' } as const;

/** What was typed: trimmed, 1 to 80 characters for Jump to. */
const jumpText = z.string().trim().min(1).max(80);

/** What a picker was typed: nothing yet is allowed (the first rows by name). */
const pickText = z.string().trim().max(80).default('');

export const jump = defineQuery({
  name: 'search.jump',
  permission: 'view',
  input: z.object({ q: jumpText }),
  target: () => PLATFORM,
  run: async (ctx, { q }) => {
    const [restaurants, menus] = await Promise.all([
      findRestaurants(ctx.db, ctx.scope, q, JUMP_LIMIT),
      findMenus(ctx.db, ctx.scope, q, JUMP_LIMIT),
    ]);
    return { restaurants, menus };
  },
});

export const searchRestaurants = defineQuery({
  name: 'search.restaurants',
  permission: 'view',
  input: z.object({ q: pickText }),
  target: () => PLATFORM,
  run: async (ctx, { q }) => ({ rows: await findRestaurants(ctx.db, ctx.scope, q, PICK_LIMIT) }),
});

export const searchMenus = defineQuery({
  name: 'search.menus',
  permission: 'view',
  input: z.object({ q: pickText }),
  target: () => PLATFORM,
  run: async (ctx, { q }) => ({ rows: await findMenus(ctx.db, ctx.scope, q, PICK_LIMIT) }),
});

/** People, for choosing one in a filter. Super Admins only: it reads every account on the platform. */
export const searchPeople = defineQuery({
  name: 'search.people',
  permission: 'people.manage',
  input: z.object({ q: pickText }),
  target: () => PLATFORM,
  run: async (ctx, { q }) => ({ rows: await findPeople(ctx.db, q, PICK_LIMIT) }),
});
