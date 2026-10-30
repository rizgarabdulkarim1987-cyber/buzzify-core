# Cashier batch 4: printing, cash drawer, barcode and kitchen expo

Date: 2026-10-28. Branch `cashier-printing` (cut from `cashier-currency`, so it also carries Batch 3 until that merges). The user asked for the work to run on every printer model ("اجعل عملك على كل الانواع") and said go. Open choices are my call and marked **(call)**.

## Why

Today the till prints with the browser's print dialog (`window.print()`): a dialog every time, no cash drawer, and every kitchen section shares one printer. A real till prints silently, opens the drawer on a cash sale, takes a barcode scanner, and the pass shows when a whole table is ready.

## Goals

1. **Silent printing on any ESC/POS thermal printer** (58 or 80 mm; network or USB) for the receipt, the kitchen ticket, the shift slip and the delivery slip.
2. **Cash drawer opens** on a cash or dollar payment, and by a manual "open drawer" action that is audited.
3. **Barcode scanner** adds a product to the order, online and offline.
4. **Kitchen printers per section** (grill, bar, pastry each print their own ticket) and an **Expo screen** showing each order's sections and when all are ready.

## Non-goals

No fiscal printer. No label or sticker printing. No Bluetooth printers. No cloud print relay (the print bridge runs on the till's own network). Browser print stays as the fallback and is not removed.

## The constraint that shapes it

A web page served over https cannot open a raw TCP connection (port 9100) or talk to a Windows printer. **Earlier in the conversation I said a LAN printer receives the order "directly" from the browser; that was wrong.** Something local must carry the bytes.

## Decisions

- **A small local print bridge (call).** `print-bridge/` is a zero-dependency Node program the owner runs on the till PC (a Windows `.cmd` starter is included). It listens on `127.0.0.1:9101` and takes `POST /print` with `{ target, dataBase64 }`. `target` is `tcp://host:port` (network printers, port 9100) or `file://<path>` (a USB printer shared in Windows as `\\localhost\NAME`, written as raw bytes). Because it forwards raw bytes, **one bridge serves every brand**. The page reaches it at `http://127.0.0.1:9101` (browsers allow this from https pages). It answers `GET /health` and allows only the till's origin (CORS from the configured origin list).
- **The document is drawn as an image (call).** A receipt becomes a list of rows (`PaperRow`: align, left, right, size, bold, divider, optional barcode). The browser draws the rows on a canvas, where the browser's own text engine shapes Arabic and Kurdish correctly, then converts to a 1-bit bitmap and sends ESC/POS `GS v 0` raster. No code pages, no per-model fonts. The raster is sent in bands of 256 lines so cheap printers with small buffers do not overflow.
- **Printers are restaurant data, the bridge address is per device (call).** `PosPrinter` rows (name, role, transport, address, paper width, cut, drawer, drawer pin, kitchen section) are managed in Settings. The bridge URL is stored per device (localStorage, default `http://127.0.0.1:9101`) because each till PC has its own bridge.
- **Roles.** `RECEIPT` (receipt, shift slip, delivery slip, manual drawer), `KITCHEN` (tickets; optional `sectionId`; a ticket for a section goes to its printer, else to a KITCHEN printer with no section, else it is not printed and the browser screen remains). Exactly one `RECEIPT` printer is the default.
- **Drawer kick** is `ESC p m t1 t2` appended to the receipt job (pin 2 or pin 5 per printer). It is sent only when the payment has a cash or dollar leg. A refund reversal paying cash out also opens it. A manual open needs the `shift.manage`-level permission already used for expenses and writes an audit row `pos.drawer.open` with a reason.
- **Printing never blocks or undoes a sale (call).** The payment is saved first; the print is a client-side job afterward. A failed job shows a message with "Retry" and "Print with the browser"; nothing is lost because the receipt page can always re-print. Print jobs are not queued offline beyond the page's own retry.
- **Barcode (call).** `PosProductSetting.barcode` (text, leading zeros kept, unique per restaurant when set). Scanners are keyboard wedges: a burst of characters faster than 40 ms apart ending in Enter, outside any text field, is a scan. An unknown code shows "no product with this barcode". The code is edited in the catalog screen, included in the offline snapshot, and the till resolves it with no network.
- **Expo (call).** A new `/pos/kitchen/expo` screen (kitchen-role and manager permission, same as the kitchen screen) groups cards by order: one tile per order listing each section as waiting / ready; an order whose sections are all ready is highlighted "ready to run". It reads the same queue as the kitchen screen and sends nothing new.
- **Reprint rule.** A reprint of a receipt carries the word "copy" at the top (`pos.receipt.copy`), and is audited as `pos.receipt.reprint`.

## Data

- `PosPrinter { id, restaurantId, name, role PosPrinterRole, transport PosPrinterTransport (NETWORK|FILE), address String, paperWidth Int (58|80), cut Boolean, drawerPin Int? (2|5), isDefault Boolean, sectionId String?, sortOrder Int }` and enums `PosPrinterRole { RECEIPT KITCHEN }`, `PosPrinterTransport { NETWORK FILE }`.
- `PosProductSetting.barcode String?` with a partial unique index on `(restaurantId, barcode)`.
- No change to payments, shifts or orders.

## Phases

- **A. Pure printing core**: `PaperRow` model, ESC/POS builder, raster packer, bridge protocol, receipt/ticket row builders.
- **B. Bridge and printer settings**: `print-bridge/`, `PosPrinter` CRUD, Settings screen, test print.
- **C. Wiring**: receipt, ticket and slips print silently; drawer kick; reprint audit.
- **D. Barcode**.
- **E. Expo**.

## Review focus

- Arabic and Kurdish text and mixed LTR numbers render in the right order on a 58 mm and an 80 mm paper.
- A bitmap whose width is not a multiple of 8 and a blank (all-white) document.
- Bridge refused, printer off, timeout: the sale stays paid and the user can retry.
- A cash payment opens the drawer once, a card-only payment does not, a split bill opens it per cash part.
- A barcode scanned while typing in a field, a code with leading zeros, the same code on two products (refused at save).
- A section with no printer, and a printer deleted while a section points to it.
