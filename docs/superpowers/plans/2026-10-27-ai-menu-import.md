# AI menu import (Studio + cashier)

Goal: a person gives an AI a photo, a PDF or a link to another menu; it reads categories, products, descriptions and prices
and (from a link) the product pictures, and shows them as the usual import preview. Nothing is written until the person
applies it. Offered in the Studio "Import and export" tab and in the cashier's Menu page ("Product list").

Decisions (the author's calls, the user opted out of the question round):

- **One importer.** The AI turns its reading into the Studio's own menu sheet (CSV in `SHEET_COLUMNS`), stores it like any
  upload and calls `parseImport`. Preview, draft-hash check, apply and audit are the existing ones, for both screens.
- **Gate.** The restaurant's AI package (`requireAi`) and `runAi` metering, new feature `MENU_IMPORT`. A Super Admin switches
  the package on, as for every other AI feature.
- **Input.** `file` (JPEG/PNG/WebP/PDF, at most 5 MB, magic bytes checked) or `link` (http/https). A link is fetched by the
  server behind an SSRF guard (public addresses only, redirects re-checked, 2 MB, 10 s). The page's text, its JSON-LD and a
  numbered list of its images go to the model as untrusted data. A page that shows no readable products (script-rendered)
  is refused with "upload a photo or PDF instead".
- **Prices** come back as the text printed (`"6,000"`, `"4.50"`); the sheet parser validates them, so a bad price is an
  `invalid` row in the preview, not model arithmetic. For a link the printed digits must appear in the page text.
- **Names** are placed in `name_en` / `name_ar` / `name_ckb` by the script they are written in.
- **Limits.** At most 300 products per reading; categories matched to the menu's existing ones by name.
- **Pictures (phase 2).** Only from a link: the model picks an image by its index (never a URL), the server downloads it
  behind the same guard, stores it as a library asset and keeps `slug -> assetId` on the import job; apply attaches it to
  the product it creates. A photo or PDF gives no pictures in this version.

Steps

1. `PosAiFeature.MENU_IMPORT` migration; `ai/menu-import.ts` (schema, reading, sheet building) with tests on the fake provider.
2. `ai/link-fetch.ts` (guard, text and image extraction) with tests.
3. Actions `import.aiRead` (Studio, `import.run`) and `pos.importAiPreview` (`catalog.manage`); multipart routes.
4. Studio UI: AI section in `ImportExport`; cashier UI: AI section in `CatalogImport`; en/ar/ckb messages.
5. Phase 2 pictures: `ImportJob.photos`, download + asset, attach on apply.
6. Verify in the browser, code review.
