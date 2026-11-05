# Pharmacy Sell: "Screen layout" with cashier looks (design)

The restaurant cashier has a "Screen layout" dialog with a "Cashier look" section (eight thumbnails, a checkmark on the chosen one,
kept per device in the `pos-desk` cookie, applied as `data-desk` on the till root, pure CSS at lg+). The pharmacy Sell screen gets
the same dialog and behaviour.

## Reuse and adapt

| Restaurant piece | Pharmacy |
|---|---|
| `Dialog` (studio/ui) | reused as is |
| `DeskSection` thumbnail grid (button, `aria-pressed`, checkmark at `end-1 top-1`, `.wire` sketches) | new `SellLookPicker` with the same markup and classes; sketches redrawn for Sell |
| per-device cookie + `router.refresh()` | same: cookie `ph-look` (1 year), read on the server in `sell/page.tsx`, so no flash |
| `.till[data-desk]` CSS at lg+ | `[data-look]` on `sell-workspace`, rules in `pharmacy.css` under `@media (min-width:1024px)`; phones keep their layout |
| Tables section | dropped (restaurant only) |
| Big photos | dropped: pharmacy products have no photos, a "photo" look would be empty tiles |

## The looks (7)

The Sell page is: search + results | cart + pay bar, with the Doctor panel at 2xl and the Doctor sheet below. Looks change the
arrangement, not colours, and there is no motion.

1. **Classic**: results | cart (today).
2. **Quick rows**: one line per product (name, chips, unit buttons on one row), narrower cart. Best for scanning many items.
3. **Cards**: results as a grid of big cards, big add buttons.
4. **Split**: results and cart in equal halves.
5. **Board**: results on top, the cart as a dock along the bottom (lines left, pay bar right).
6. **Register**: cart first (start side, wide), results compact beside it.
7. **Stack**: one centred column: search, results, cart, pay.

Default is Classic. An unknown cookie value falls back to Classic. Every look keeps the same DOM (scanner capture, held carts,
dialogs, Doctor slot and float), so behaviour cannot differ per look.

## Not doing

No new components per look (CSS only, like the restaurant's: Split/Board/Register/Stack are layout approximations).
No server-side setting (per device only).
