# Buzzify Menu: product roadmap after Studio Core

Status: agreed with the user, 2026-10-18
Base: `main` at 6fd2227 (Studio Core 2b merged and deployed on Hostinger)

## Why

The user wants Buzzify Menu to beat competing digital menus by giving the restaurant control over everything its
guests see, and to sell that control in tiers. Their words: "templates to be selected, backgrounds to be uploaded,
motion graphic, 3D model, style, control on everything ... make these as privileges".

Each project below is its own design, plan, branch and pull request, built in this order. Each later project asks the
entitlement check from Project 1 ("may this restaurant use feature X?") for every feature it adds, using the feature
key reserved for it in `docs/superpowers/specs/2026-10-18-plans-and-entitlements-design.md`.

## The projects, in order

1. **Privileges and subscription tiers.** Plans (Basic, Pro, Premium) that decide which features each restaurant may
   use, set by a Super Admin, with an upgrade hint on locked features, a guest menu that respects them, and downgrades
   that never break a published menu. Design: `2026-10-18-plans-and-entitlements-design.md`.
2. **Templates and full style control.** Selectable templates; uploaded backgrounds (image and video); motion presets
   and intensity; colours; fonts; category rail style; a live preview of all of it.
3. **Guest experiences.**
   - "What are you in the mood for": a picker that reorders the menu by tags.
   - Living photos: tilt parallax, steam, sheen.
   - Instagram-style restaurant stories.
   - Time-of-day and occasion moods: a Ramadan iftar countdown, Newroz, Eid.
   - Drink-and-dish match.
4. **Real 3D models.** Uploaded GLB models per dish on the 3D stage and in Explore, and AR on the table.
5. **Order together at the table.** A shared, live basket for everyone at one table.
6. **Extra ideas the user welcomed.**
   - Call the waiter or ask for the bill from the table.
   - A digital loyalty stamp card.
   - Shareable dish cards for Instagram.
   - A TV / menu-board display mode for in-store screens.
   - Limited-time drops with countdowns.
   - Seasonal particle effects.
   - A WhatsApp order or reservation button.

## Working agreements that carry over

- The user explains things in Arabic and prefers replies in Arabic (code and paths stay as they are). They are not
  technical: anything they must do gets exact click-by-click steps, and what they report is checked (they sometimes
  press a ready-made reply button before doing the step).
- Process per project: brainstorm, a written design in `docs/superpowers/specs/`, a plan in `docs/superpowers/plans/`,
  test-driven implementation, one whole-branch review at the end, a pull request to `main`. Nothing is built before the
  user approves the design.
- Agents cannot merge or push to `main`; the user merges. Hostinger deploys automatically when `main` changes (about
  three minutes). Production settings live in hPanel; secrets are never typed into pages.
