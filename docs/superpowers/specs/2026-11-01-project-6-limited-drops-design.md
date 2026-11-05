# Project 6, part 6: limited drops (`selling.limitedDrops`, Pro)

Decisions marked **[call]** are mine.

## What it is
A dish that is on the menu only between two times: a seasonal special, a Friday-only plate, a one-night tasting dish. Before the window and after it guests do not see it; inside it the dish carries a label that counts down to the end.

## Rules
- **[call] Where it is set.** On the Availability tab, next to sold out, stock and hidden: two date-time fields (from, until) and "Set the drop" / "Remove the drop". It is live like those switches: no publish, the guests' data is refreshed at once. The times are the person's own browser time zone; they are stored as exact instants.
- **[call] Before and after.** Outside the window the dish is treated as hidden: it leaves the menu, the cart quote, QR orders, the TV board, and the bundles and rules that name it. There is no "coming soon" teaser in this part. The edges are exact, because the window is applied on every request over the cached overlay.
- **[call] The label.** Inside the window: "Limited · ends in 3 hours" (days, hours or minutes, in the guest's language and digits), updated each minute, on the dish's row, its page and the template cards. The number is the real end the restaurant set; nothing counts down to an invented time.
- **[call] Rules of a window.** Both ends or neither (the database refuses a half window); the end must be after the start and still ahead when it is set; one window per dish.
- **[call] The plan.** Pro and Premium. A plan without the feature cannot set a window but can still remove one; a stored window is ignored on such a plan (the dish is an ordinary one, whatever the date) and comes back if the plan returns. The Studio shows the upgrade hint.
- **[call] Menus and copies.** The window is not in a published revision and is not copied when a menu is duplicated.
- Not in this part: a teaser before the start, repeating windows, a drop's own page, announcing a drop with a story or an offer, per-drop stock limits (the dish's own stock count already does that).
