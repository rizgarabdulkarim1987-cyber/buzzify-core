# Sales > Dishes: every dish's selling settings in one table

**Decision (owner, 2026-10-30):** one table for all dishes, as a new page of the Sales tab.

## Goal
Signature, Featured, badges, cost, priority, serves and low-stock threshold are edited in one place instead of the dish
drawer. Allergens, dietary tags and calories stay in the drawer. Nothing guests see changes.

## Server
- `content.setSelling` (service + action, permission `content.edit`): one product, at its `version`, only the selling
  fields it is given. Runs through `editDraft` and `updateWithVersion` (draft tracking, version conflict), validates with the
  same limits as `saveProduct`, needs `content.prices` when `cost` changes, writes a `product.updated` audit line with the
  changed fields only. A call that changes nothing writes nothing and keeps the version.
- `saveProduct` and its fields are untouched (POS catalog editor and import keep using them).
- Query `sales.dishes` (permission `content.edit`): categories with their dishes (names, version, the seven fields),
  currency, locales, `canPrice`.

## Studio
- `SALES_PAGES` gets `dishes` (after Overview); route `sales/dishes`.
- `DishesTable` (TanStack table like PriceGrid): category filter, name search, rows grouped by category. Editing a row
  makes it dirty; the row has its own Save and Undo (one narrow save per row, at that row's version). A conflict reloads the
  row and says so. Switches (Signature, Featured) and badge chips save with the row's Save, not instantly, so a row is one
  clear change. Cost is disabled with a hint when the person cannot set prices.
- Phone: each row becomes a stacked card (no horizontal scroll).
- Drawer: Highlights, Selling and the badges chips are removed; a note links to Sales > Dishes. The draft keeps carrying
  those fields so a drawer save sends them unchanged.
- Overview "Fix it" links for `NO_COST` and `NO_SIGNATURE` point at `/sales/dishes`.
- Messages in `src/studio/messages/sales-dishes/{en,ar,ckb}.ts`, merged in `messages/index.ts`.

## Plan
1. Tests for `setSelling` (conflict, price permission, validation, audit, no-op, other menu) — red.
2. Service, action, server action wrapper — green.
3. Query + page + table component.
4. Messages, drawer cleanup, Overview links.
5. Typecheck, lint, vitest, browser check at desktop and phone width.
6. Commit with explicit pathspecs, push, PR via compare URL.
