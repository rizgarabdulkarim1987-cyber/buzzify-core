# A restaurant page inside the menu (the "About" tab, shown to guests as "Explore" by default)

Date: 2026-10-29. Branch: menu-intro-explore. Status: awaiting the owner's approval.

## Why
A guest browsing the menu has nowhere to read about the restaurant itself: its story, its unique offers and discounts, its hours,
where it is. The owner asked for a new tab inside the menu, on the same footing as the intro page and the wheel of fortune.

## Naming
`/{slug}/{locale}/explore` already exists: it is the immersive 3D dish scene, a plan feature (`immersive.explore`). The new page is
called `about` in code, routes and entitlement (`menu.about`). What the guest reads on the tab is a title the restaurant chooses in
each language; left empty it shows "Explore" (en), "استكشف" (ar), "گەڕان" (ckb). The 3D scene keeps its name and route.

## Goals
- A tab/page reachable from the menu's own navigation in every template style and the classic menu, without changing a style's layout:
  one entry added where the style already offers its secondary links (the builder finds the common place; styles without one get the
  same small floating entry used for the language and feedback controls).
- The restaurant writes it in Studio in every menu language: a cover photo, a story (rich text limited to headings, paragraphs, lists,
  links), a gallery, opening hours and address (from the restaurant's existing data, editable here), contact and social links.
- Offers: cards for unique offers and discounts, each with title, short text, an image, an optional price or percentage label, an
  optional validity period and an optional link to a dish or category in the menu. Expired offers hide themselves.
- On by default off; switched on per menu by the restaurant (when the plan has it); the Super Admin can switch it off.

## Non-goals
- Not a page builder: a fixed layout (cover, story, offers, hours and contact, gallery), not free blocks.
- No discount engine: an offer card is information. Prices at the till keep following the existing sales rules (the sales tools).
- No change to the 3D Explore.

## Anti-goals
- The tab must not cost the menu its speed: it loads only when opened, and the menu's first load grows by at most the entry link.
- No hidden promises: an offer with a validity period is never shown outside it, in the menu's own time zone.

## Decided by the owner
- A tab inside the menu, for the restaurant, with words about it and unique offers or discounts; may be called Explore.

## Builder's calls (not yet confirmed by the owner)
- Data: new `MenuAbout` (per menu: titles, cover asset, story by language, gallery asset ids, show-hours, show-contact) and
  `AboutOffer` (menu id, title/body by language, image, label, starts, ends, sort, active, target product or category id).
  Hours, address, phone and links are read from `Restaurant` (already there) with an override per menu only if the owner asks later.
- It is read live like `feedbackEnabled` (not part of a published snapshot), so a new offer appears without republishing the menu.
- Rich text is stored as a small safe structure (not HTML) and rendered by us, so nothing a restaurant types can run script.
- Studio: an "About" page next to Intro and Brand; offers list with drag order, duplicate and expire.
- Guest words in en, ar, ckb; right-to-left everywhere.

## Left to the builder
The navigation entry per style, the page's visual layout per direction, image variants, the empty state (tab hidden when nothing is
filled in), search-engine text (the page is public and indexable with the menu's SEO fields).
