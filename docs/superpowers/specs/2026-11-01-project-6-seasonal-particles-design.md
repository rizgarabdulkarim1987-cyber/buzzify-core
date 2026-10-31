# Project 6, part 7: seasonal particles (`design.seasonalParticles`, Pro)

Decisions marked **[call]** are mine.

## What it is
A light effect that floats over the guest menu: snow for winter, leaves for autumn, petals for spring, sparks for an evening, confetti for a celebration. The last item of Project 6.

## Rules
- **[call] One effect per menu, or none.** Five effects: snow, leaves, petals, sparks, confetti. The choice is a column on the menu (`Menu.seasonEffect`, null for none); the database refuses any other value.
- **[call] Where it is set.** The Design tab, a "Seasonal effect" row under the gallery. It is live like the Sales switches: it saves on its own, no publish, and the cached gate is expired so guests get it at once. It is not part of a design template or a published revision, so changing a template never turns it off and a rollback never changes it.
- **[call] What guests see.** One canvas fixed over every guest page (menu, dish, cart, Explore, TV board), never catching a tap, drawn below modal sheets' backdrops' own stacking by a fixed z-index. About 42 particles, 22 on a screen under 640 px, at most 2x pixel ratio.
- **[call] Care for the guest.** Nothing is drawn for a guest whose device asks for less motion. The loop stops while the tab is hidden and resumes after. Particles are round, soft and small, never over the dish text for long: they fall or rise slowly (30 to 120 px per second).
- **[call] The plan.** Pro and Premium. A plan without the feature cannot choose an effect but can still clear one; a stored effect is ignored on such a plan and comes back if the plan returns. The Studio shows the upgrade hint under the picker.
- **[call] Who.** Whoever may edit the design (`brand.edit`), the same as the Design tab.
- Not in this part: a schedule that turns an effect on by date, several effects together, a preview inside the Studio, a per-page choice, custom colours (the effect keeps its own colours so it reads on both light and dark themes).
