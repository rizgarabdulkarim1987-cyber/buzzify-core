# Cashier edits reach the guests' menu

**Problem.** The till reads the catalog menu's draft rows; guests read the menu's live revision. A product edited at the
till changes the draft only, so guests keep seeing the old name, price or category until someone publishes in the Studio.

**Decision (user, 2026-10-27).** Publish automatically after every cashier edit of the product list.

**Design.**
- One wrapper, `publishAfter(run)`, in `src/server/pos/catalog-publish.ts`. It runs the edit, then, in a second
  transaction scoped to the catalog menu, calls `publishMenu`.
- Only a menu that already has a live revision is republished. A till-only catalog menu (never published) stays a draft
  and nothing becomes public by accident.
- A blocked publish (validation issue) or a lost race never fails the edit: the draft change stays, the till shows it.
  The failure is written to the audit log as `pos.catalog.publish_skipped`.
- Wrapped actions: createCategory, updateCategory, deleteCategory, createProduct, saveProductBasics, deleteProduct,
  importApply. Not wrapped: setAvailability (hidden and sold-out are live switches, read without a publish) and setProductSetting (till-only).
- Known trade-off, accepted by the user: a publish carries any other unfinished draft edits made in the Studio.

**Steps.**
1. Failing tests: `tests/pos/catalog-publish.test.ts`.
2. Implement `catalog-publish.ts`; wrap the actions in `src/server/studio/actions/pos.ts`.
3. Run `tests/pos` and `tests/publish`; lint `src`; typecheck.
