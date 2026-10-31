# Project 6, part 4: the stamp card (`loyalty.stampCard`, Pro)

Decisions marked **[call]** are mine.

## What it is
A guest who orders from the table with their phone collects one stamp for every order of theirs that is paid. At N stamps the card is full and the guest can ask for the reward with their next order; the cashier sees it on the request and gives it.

## Rules
- **[call] No account.** The phone keeps a random card token per restaurant (like the table basket's); the server stores only its SHA-256. Clearing the browser loses the card. That is the price of no sign-in; a phone-number card is a later step.
- **[call] Earning.** A guest's order request (QR order, or the table basket when the guest sent it) carries the card token. When the order it became is **fully paid**, each distinct card on it gets one stamp, once per order (a unique row per order and card). Orders paid in parts stamp when the last part is paid. A later reversal of the payment does not take the stamp back.
- **[call] Redeeming.** With a full card the guest ticks "Use my reward" when sending. The request carries it; the cashier's request card shows the reward's text. **The cashier gives the reward by hand** (a discount line or a free item); nothing in the bill changes by itself. When that order is paid, the card spends N stamps (stamps may stay above N for the next card).
- **[call] The owner's switch.** Off by default. In the cashier's settings: switch, stamps needed (3 to 20, default 8), reward text (up to 80 characters, one text for all languages). A plan without `loyalty.stampCard` cannot switch it on, an existing switch stays stored but the card is not shown or earned (the plan-lock pattern).
- The guest sees the card only at a scanned table where ordering is open and the program is on. The card is read with the token in a header, never the address.
- Limits: one card per token and restaurant. The unique row per order and card bounds the stamps; no other limit is needed.

## Not in this part
Phone-number cards, expiry of stamps, several rewards, stamping orders paid by someone else without a QR order, the Studio's reports of stamps.
