# Project 6, part 5: the TV menu board (`display.tvBoard`, Premium)

Decisions marked **[call]** are mine.

## What it is
A page for the screen on the restaurant's wall: `/<menu>/<locale>/tv`. It shows the live menu, category by category, large enough to read from across the room, and turns the page by itself. Nobody touches it.

## Rules
- **[call] Address.** The menu's own address plus `/tv`, in any of the menu's languages (`/atelier/ar/tv`). Premium has it; a plan without it answers 404, as does a paused or unknown menu.
- **[call] Content.** The dishes the menu shows and can serve now: sold out, switched off and out-of-daypart dishes are left out, an emptied category is skipped. Each dish: photo (or its drawn art), name, price in the menu's currency and numerals. Prices, names and colours are the menu's own, so a change published in the Studio reaches the screen on its own.
- **[call] Pages.** Six dishes a page (3 by 2 on a landscape screen, 2 by 3 on a portrait one), one category at a time; a long category runs over several pages. The category's name and "page 2 of 3" sit above, the restaurant's name below. A thin progress line marks the position in the whole loop.
- **[call] Turning.** Every 12 seconds, a gentle cross-fade (none for a screen set to reduced motion). `?seconds=` sets 5 to 60. Arrow keys step by hand when the screen is being set up; `F` goes full screen. The cursor is hidden.
- **[call] Live.** The page asks the server for fresh data every 5 minutes without leaving the loop's place on screen.
- **No ordering.** No cart, search, bill, waiter or any guest tool on this page; it is a sign, not a menu.
- Not in this part: a link to it in the Studio, choosing categories for the screen, videos, a different loop per screen, offers and stories on the board.
