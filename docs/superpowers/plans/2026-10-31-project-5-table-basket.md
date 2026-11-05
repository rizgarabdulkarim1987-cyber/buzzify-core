# Project 5 plan: the table basket

Spec: `docs/superpowers/specs/2026-10-31-project-5-table-basket-design.md`. Test-first in each task; commit after each.

1. **Rules.** `src/server/domain/pos/table-basket-rules.ts`: constants, liveness, merging parts into one cart. Tests in `tests/domain`.
2. **Schema.** `TableBasketPart` model and migration; register it as menu scoped; cross-tenant sweep entry.
3. **Service.** `src/server/pos/table-basket.ts`: read, write own part, send. Tests against Postgres.
4. **Routes.** `table-basket` GET/PUT and `table-basket/send` POST with strict zod schemas; plan gate.
5. **Entitlements and guest features.** `ordering.tableBasket` live; `tableBasket` in `guestFeatures`; test literals.
6. **Guest UI.** The table panel, cart sync, polling, three-language messages.
7. **Verify.** Type check, suite, browser check with two guests, `graphify update .`.
