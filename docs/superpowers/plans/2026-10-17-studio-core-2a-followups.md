# Studio Core 2a: follow-ups

Milestone 2a (Platform) is complete on `studio-core`. These items were found during its reviews and deliberately
left for later. They are the only record of them once the execution ledger is deleted.

## Preconditions for milestone 2b

1. **Restore to draft must keep ids.** `writeDraftFromSnapshot` (`src/server/publish/draft.ts`) creates new ids, which
   is right for duplicating a menu. Restoring a revision into its own menu must reuse the snapshot's ids (delete the old
   rows first in the same transaction). Otherwise live sold-out and hidden switches cannot reach live products until the
   next publish, and carts keyed by product id break.
2. **Every draft edit refreshes the draft hash in the same transaction.** `publishMenu` reads the draft with several
   queries; its snapshot is only consistent if every draft-edit transaction also updates the `Menu` row
   (`refreshDraftHash`). Restaurant-level fields that enter the snapshot (today only `Restaurant.name`) refresh the hash of
   all the restaurant's menus after commit, as `updateRestaurant` now does.
3. **Restore must also restore what the round trip loses today:** the rail style when motion is off, the frozen
   `logoText`, and menu settings (currency, languages, SEO, engine config).
4. **`studioRoute` POST routes must require `Origin` or `application/json`** before the first one ships
   (`src/server/studio/framework/route.ts`).
5. **No Studio route path may contain a dot** under `/api/studio/` unless the proxy matcher is changed: dotted paths skip
   the proxy's host rules.
6. **Cross-tenant sweep:** every new action or query needs a fixture entry in `tests/studio/cross-tenant.test.ts` (the
   test fails without one). For the seven definitions whose permission no designer or owner can hold, the sweep cannot
   tell a permission refusal from a tenant refusal; correct the file's opening comment.
7. **Cross-restaurant duplicate must copy media assets** once `MediaAsset` exists (spec 6.5).
8. **Set-like lists** (dayparts, allergens, dietary tags, badges, languages) are hashed in stored order; the editor
   should write them in a canonical order so re-saving the same set does not show unpublished changes.

## Before real traffic

- **Prune `AuthRateLimit`** rows on a schedule (keys come from typed emails and IPs).
- **Cache across instances:** `src/server/data/cache.ts` works around a Next 16.4.1 clock mismatch and a late-store race
  on the instance that ran the change. Another Vercel instance still relies on Next's own tag invalidation; a stale
  late-stored entry can be served from it for up to 300 s. Re-check the workaround on every Next upgrade (its unit test
  imports Next internals and fails loudly if they move).
- **Previews:** the production-host 404 rule keys on `NODE_ENV`, which is also `production` on Vercel Preview. Before
  enabling previews with both hosts configured, key the rule on `VERCEL_ENV === 'production'`.
- **Changing `BETTER_AUTH_SECRET` locks out two-factor users** (see the deployment guide). Better Auth 1.7.10 supports
  versioned secrets (`BETTER_AUTH_SECRETS`) for lockout-free rotation; wiring it is a separate decision.

## Smaller items

- Archived-menu copy assumes restoring shows the revision; restore returns to the status before archiving.
- Ctrl+K's `KeyK` fallback also fires on Colemak and Dvorak (Ctrl+E, Ctrl+T); fall back to the key code only when the
  typed key is not a Latin letter.
- Primary-button focus ring is about 1.9:1 against white; add a white gap or an ink outer ring.
- Regenerated recovery codes are lost if their dialog is closed with Escape; add an "I have saved them" gate.
- Picker popovers are unnamed dialogs and announce "Nothing found" before the first search.
- Platform Settings is last-write-wins; a stale form can drop a colleague's newly reserved word.
- All Menus search does not match former slugs or city; Jump to does.
- Super Admin restaurant pickers load every restaurant; bulk actions run up to 200 publishes in one Server Action.
- The menu page renders the menu five times per request (layout, page, metadata, not-found); React `cache()` could
  deduplicate.
- No automated check that Studio code stays out of public chunks, and `/atelier/en/t/04` has about 100 bytes of headroom
  under the first network window; a build-time check would guard both.
- A stronger Turbopack chunk merge measured LCP about 2.36 s on the menu; it changes chunk reuse on navigation and was
  not adopted.
- The 1,000-menu load seed is opt-in tooling only (`npm run db:seed:load`, `npm run test:load` on the test database); it
  never runs by default.
