# Project 6, part 3: share a dish as a card (`share.dishCards`, Pro)

Decisions marked **[call]** are mine.

- A "Share this dish" button on the open dish (classic page and template detail). It fetches the dish's card, a 1080×1350 PNG, and shares it with the dish's link through the phone's share sheet. **[call]** A phone that cannot share files shares the link alone; a computer saves the card.
- The card shows the dish's first photo, its name and price in the menu's own language and colours (the brand's current theme), and the restaurant's name. **[call]** A dish with no photo gets a plain panel; 3D art is not drawn.
- `GET /api/<menu>/share-card?slug=&locale=`: 404 for a plan without the feature or a dish the menu does not show, 400 for a bad slug, 30 a minute per address, cached five minutes. The price is the menu's own, from the published catalog.
- **[call]** The text is drawn as outlines with the printed QR code's text shaper, so Arabic and Kurdish join correctly and no font is needed to open the card. Its Arabic font has no Latin letters, so a line mixing scripts is set in runs, each in its own font.
- **[call]** Pro and Premium have it. Not shown in the Studio's preview.
- Out of scope: other card sizes, a QR code on the card, sharing a whole category.
