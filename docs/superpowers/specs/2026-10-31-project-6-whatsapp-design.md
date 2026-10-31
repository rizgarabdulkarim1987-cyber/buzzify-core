# Project 6, part 2: chat on WhatsApp (`contact.whatsapp`, Basic)

Decisions marked **[call]** are mine.

- The restaurant already has a WhatsApp number (its details form) that the Explore page and the intro show. This adds one thing: a header link on the menu, beside the restaurant's page link, that opens `https://wa.me/<digits>`.
- **[call]** Basic and above have it. The link is absent when the plan lacks the feature, when the number is not usable (7 to 15 digits after dropping a `00` prefix), and in the Studio's preview.
- **[call]** The number is read live with the menu's gate, like the plan, so no publish is needed. The slug cache may keep the old number for up to five minutes after an edit.
- **[call]** Numbers are taken as typed: one written in local form (a single leading 0, no country code) makes a link that WhatsApp cannot open. The restaurant form already shows the number as typed; a country-code hint is a later improvement, not part of this part.
- No new column, action or Studio screen.
