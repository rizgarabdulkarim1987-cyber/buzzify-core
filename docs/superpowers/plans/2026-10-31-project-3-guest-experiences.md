# Project 3: plan

Spec: `docs/superpowers/specs/2026-10-31-project-3-guest-experiences-design.md`. Test first; each slice ends green on
`tsc`, `eslint` and its tests, and is its own commit. A feature turns `live` in its own slice.

1. **Drink match.** `GuestFeatures.drinkMatch`; pure `matchesFor(catalog, productId, now)`; the dish sheet row.
2. **Mood picker.** `src/lib/moods.ts`; `GuestFeatures.moodPicker`; the chip row and the reorder.
3. **Living photos.** `GuestFeatures.livingPhotos`; the tilt and sheen wrapper in the dish sheet.
4. **Occasion moods.** Migration `Occasion.mood`; Studio select; banner and countdown.
5. **Stories.** Migration `Story`; Studio page; rail and viewer.
6. **Verify and review.** Full run, typecheck, lint, browser look, whole-branch review. Nothing pushed or merged.
