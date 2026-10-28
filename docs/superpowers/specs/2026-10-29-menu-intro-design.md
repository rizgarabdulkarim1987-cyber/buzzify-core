# Intro page before the menu

Date: 2026-10-29. Branch: menu-intro-explore (cut from main). Status: awaiting the owner's approval.

## Why
Today `/{slug}` redirects at once to `/{slug}/{locale}` (the visitor's browser language) and the guest lands on the menu. Restaurants
want a front door, as other menu services have: the restaurant's own picture or video, its logo, a choice of language, and a place
for visual adverts (an event, an offer) that the restaurant or the platform uploads. The owner's reference (a live menu) shows:
full-screen photo background, the logo, language buttons (the first language alone on a row, the rest side by side under it), one
large advert card, then round icons for Instagram, Facebook, the map and the phone, and a Feedback button in the top corner.

## Goals
- An intro page shown before the menu, on by default only when the restaurant switches it on.
- Background: a photo or a video (muted, looping, with its poster frame), set by the restaurant; the platform (Super Admin) can set a
  default used when the restaurant sets none, and can switch the whole feature off for a restaurant.
- Language buttons from the menu's own locales; choosing one goes straight to the menu in that language, and the choice is remembered
  (the same cookie/preference the menu already uses), so the intro is not shown again in the same visit.
- Adverts: images uploaded in Studio, each with an optional link, a start and end time, an order, and an active switch. The intro shows
  the live ones, one card each (a slider when there are several). The Super Admin can add platform adverts that appear on every intro
  or on chosen restaurants; the restaurant sees them marked as the platform's and cannot edit them.
- Contact icons from data the restaurant already has (social links, map link, phone, WhatsApp), each shown only when filled in.
- Feedback button: the guest feedback box of the earlier spec (2026-10-26), opened from the intro as well.

## Non-goals
- No change to any menu style's layout. No new motion rules for the cashier. No advertising billing, no click payments.
- No analytics beyond what exists: advert opens are counted with the existing `track` events, nothing new is stored per guest.

## Anti-goals
- The intro must never be a wall: a visitor with JavaScript off, a slow connection or a blocked video still gets the language buttons.
- A table QR (`/{slug}/t/{table}`) goes straight to the menu with the table kept; the guest is seated and wants to order.
- A video must never autoplay with sound, never load on data-saver, and never delay the language buttons.

## Decided by the owner
- Choosing a language goes straight to the menu. The background is a photo or a video set by the restaurant and the Super Admin.
  Adverts are uploaded by the admin. The page follows the reference above.

## Builder's calls (not yet confirmed by the owner)
- Address model: `/{slug}` shows the intro when `Menu.introEnabled` is on and the visit has no language choice yet; otherwise it
  redirects as it does today. The intro is its own route, `/{slug}/intro`, so a link to it is possible; `/{slug}` redirects to it.
- Data: new `MenuIntro` (one per menu: background asset id and kind, overlay strength, show-logo, show-contact), `IntroAdvert`
  (menu id or null for a platform advert, image asset id, per-language alt text, link, start, end, sort, active). Media comes from the
  existing media library (`MediaKind.IMAGE` / `VIDEO` with poster); nothing new is stored as a file.
- Plans: a new entitlement `menu.intro` in `entitlements.ts`, live from the first plan that has a custom domain or template menus
  (builder decides from the existing table); without it the redirect works as today.
- Studio: a new "Intro" page next to Brand, using the same upload picker and permission rules as Brand; adverts list with drag order.
  The Super Admin gets a platform adverts page and a per-restaurant switch.
- Text overlays on the background get a dark gradient so buttons stay readable on any photo; the owner can set its strength.
- Guest words (en, ar, ckb) go in the existing public messages; Studio words in the studio catalogs (the translation tests enforce both).
- Right-to-left: the first language is the menu's default language; the reference layout is mirrored for Arabic and Kurdish.

## Left to the builder
Exact responsive layout (the reference is a phone), image sizes and variants for adverts, the slider's behaviour with one, two and
many adverts, the video's data-saver and reduced-motion handling, caching (the intro is public and cacheable; adverts change often),
how a platform advert chooses its restaurants.
