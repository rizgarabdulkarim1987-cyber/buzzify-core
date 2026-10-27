# Guest feedback box and language popup in every menu

Date: 2026-10-26. Branch: menu-styles-templates (new work branch to be cut from it).

## Why
Guests of any menu style must be able to switch language and tell the restaurant a complaint or suggestion. Today the language
switch is inline links in the header and the complaint link exists only on the table page (`/t/[table]`), only when the till is
subscribed and `PosSettings.complaintsEnabled` (default false) is on. Menus without a table or a till have neither.

## Goals
- One floating control pair present in all 35 template styles and the classic `MenuApp`, without changing any style's layout.
- Language: a globe button opens a popup listing the tenant's locales (replaces the inline links in `Header` and `TemplateHeader`).
- Feedback: a button opens a popup: kind (complaint / suggestion), text, optional name and phone (consent as today).
- Works on every menu, with or without a table number or a till. Reached from a table QR, the message carries the table number.
- Restaurants read the messages in the Studio, whether or not they have the till.
- On by default; the restaurant can switch it off.

## Non-goals
- No change to the till's complaint workflow (statuses, notes, AI labels) beyond showing suggestions.
- No motion added in the cashier. No new layout per style.

## Anti-goals
- The controls must not cover the cart bar, the product sheet or a style's own navigation, and must not hide dishes.
- No data from a guest is trusted beyond text; keep honeypot, consent rule, per-IP/table/restaurant limits.

## Decided by the owner
- Every menu, no table required. Floating button that opens a popup. Studio reading for all restaurants.

## Builder's calls (not yet confirmed by the owner)
- Reuse `PosComplaint` (`tableId`/`tableNumber` already optional); add a SUGGESTION value to its category enum (migration).
- Gate = the Menu subscription is live (not the till subscription). A new per-menu switch, default on, in Studio settings.
- Rate limits keep their current numbers; with no table the per-table limits become per-IP-per-day.
- The guest words stay in `complaint/words.ts` style (en, ar, ckb), extended with the suggestion kind and popup labels.
- Studio gets a "Feedback" view listing the messages (read-only plus mark handled); permission follows who may read the menu.

## Left to the builder
Placement of the floating pair per RTL/LTR and safe areas; focus trap and Escape on the popups; how the pair avoids `CartBar`.
