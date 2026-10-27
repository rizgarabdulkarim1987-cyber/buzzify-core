# Staff appearance, logos and platform announcements: design

Date: 2026-10-26. Status: draft for approval. Applies to the Studio (owner, manager) and the Menu POS cashier (`src/app/pos`: cashier, kitchen).

## Intent

Four roles use the product all day: owner, manager, cashier, kitchen. Each should make the screens comfortable for themselves without anyone else being affected and without being able to make them unreadable. The product's name should appear as the Buzzify logo, not typed text. A restaurant owner should see their own logo. The Buzzify team needs one place to write a message and have it reach every cashier.

## Parts

### 1. Personal appearance (per person)

Each person chooses, for themselves only:
- font (from a fixed list that includes Arabic and Kurdish-capable faces);
- background colour;
- button colour;
- text colour;
- button shape: round or square.

Decided by the user: owner, manager, cashier and kitchen each change their own appearance, with no clashes between people.

Decisions made by me (to be confirmed or changed when reading):
- The choice is saved on the person's account, so it follows them to any device. Two people on one till each get their own look after they switch user.
- No role can change another person's appearance. There is no restaurant-wide theme.
- Readability guard: a choice with too little contrast (text vs background, button text vs button) is refused or corrected with a message, so no one can make the screen unreadable. Status colours that carry meaning (paid, late, error) stay fixed.
- A "Reset to default" action.
- Per `cashier-no-motion`: no animation is added in the cashier (applying a change is instant).

### 2. Buzzify logo instead of typed name

Everywhere the interface prints the word "Buzzify" as the product mark (for example `src/studio/shell/Wordmark.tsx`, the cashier header, sign-in), show the Buzzify logo image/SVG instead. The user said the logo file already exists next to them; its location is not yet known (see open questions).

### 3. Restaurant logo

The owner can set the restaurant's own logo (the restaurant already has `logoAssetId` in the media library). Where a restaurant mark is shown in the Studio and the cashier, show it; fall back to the Buzzify logo when none is set. The Buzzify logo stays where it identifies the product rather than the restaurant (my call; to confirm).

### 4. Platform announcements

- Written by the Buzzify team in Business Core (sibling repo `buzzify-business-core`), not by restaurant owners. Decided by the user.
- Delivered to every cashier. Shown in a dedicated place in the cashier screen.
- Mine (guesses): the announcement has a title, a body, and optional start/end time; the cashier shows the active ones in a banner with a way to read all and to dismiss one per person; kitchen also sees them; the cashier works offline, so the last received list is cached. Language follows the person's locale (en, ar, ckb) with a fallback.

## Goals

- Everyone's look is theirs alone; no accidental unreadable screen.
- Logo appears correctly in light and dark backgrounds and right-to-left layouts.
- A Core announcement reaches the cashier within about a minute while online.

## Non-goals

- A restaurant-wide brand theme for staff screens.
- Changing the guest menu's look (styles/templates are separate work).
- Restaurant owners writing announcements.
- Motion of any kind in the cashier.

## Anti-goals

- One person's change appearing on someone else's screen.
- A choice that makes text unreadable, or hides status colours.
- A new cashier flow that slows down order taking.

## Constraints

- Follow existing design tokens in `src/studio/studio.css`; the appearance feature overrides tokens, it does not fork components.
- Cashier must keep working offline.
- Core is a separate repo and the menu talks to it through the existing link/entitlement paths; manual payments only.
- Arabic and Kurdish text must never be split per character.

## Left to the builder

- Storage shape (columns on `User` vs a settings table), the contrast algorithm, the font list.
- Transport for announcements (menu pulls from Core, or Core pushes through the existing outbox/webhook path) and the Core-side authoring screen.
- Where exactly the announcement place sits in the cashier layout.

## Calls made after the builder check (mine, to confirm)

- Sign-in: every staff member has their own account; the till's quick switch (PIN) changes the active person, so appearance stored on the account is applied on switch, with the last-known look cached for offline.
- Contrast guard refuses a bad pick (the swatch is disabled with a one-line reason); WCAG AA, 4.5:1 for text, 3:1 for button outlines.
- Core side is in scope: a small authoring screen in `buzzify-business-core`, usable by Buzzify team accounts only. The plan splits into a menu part and a Core part.
- Announcements go to all restaurants, no targeting for now. One body per locale (en, ar, ckb); a missing locale falls back to the first filled one. Studio owner/manager, cashier and kitchen all see them.
- Logo replacement covers the Studio, the cashier and sign-in. Not the guest menu, emails or receipts.

- Update 2026-10-26 (user's answer): "Core" for announcements means the Super Admin area inside this app, not the sibling repo. This overrides the "second repo" call above; there is one repo and one database and no transport.

## Open questions for the user

1. (Answered by the user, 2026-10-26.) The Buzzify logo appears on every screen, at the bottom. The restaurant's logo takes the top (header) when set; with none set the header shows the Buzzify logo too. This supersedes the "Buzzify only on sign-in" call in part 3 and the replacement scope in "Calls made": the footer mark is on all Studio, cashier, kitchen and sign-in screens, small and unobtrusive, and it must not cost space on the order screen.
2. (Answered by the user, 2026-10-26.) The Buzzify logo was sent in chat as two images: a white wordmark on a black circle (for dark backgrounds) and a black wordmark with a blue dot on white (for light backgrounds). They are raster (webp); the builder adds them to the repo and makes SVG/PNG variants. The blue dot is the brand accent.
