# Moving to buzzify.tech (one host per product)

The app runs on the VPS (compose project `menu`, deployed by `.github/workflows/deploy.yml`; the VPS side is described in
`docs/deploy/vps-deploy.md` of the Buzzify-retails repository). This page covers only what changes for the new domain.
The plan is `docs/superpowers/plans/2026-11-04-buzzify-tech-domains.md`.

**Never write the super admin host or its secret path in the repository, an issue, a chat or an email.** They live only in
the VPS's environment file and in your password manager.

## The hosts

| What | Address | Environment variable |
|---|---|---|
| Public menus (guests, QR codes) | `https://menu.buzzify.tech/<menu-address>` | `PUBLIC_MENU_HOST=menu.buzzify.tech`, `PUBLIC_MENU_ORIGIN=https://menu.buzzify.tech` |
| Menu and Cashier (owners and staff) | `https://hive-4q.buzzify.tech/studio` | `STUDIO_HOST=hive-4q.buzzify.tech`, `BETTER_AUTH_URL=https://hive-4q.buzzify.tech` |
| Pharmacy | `https://leaf-2x.buzzify.tech/pharmacy` | `PHARMACY_HOST=leaf-2x.buzzify.tech` |
| Super admin | `https://<CORE_HOST>/<CORE_GATE_PATH>` | `CORE_HOST=<CORE_HOST>`, `CORE_GATE_PATH=<CORE_GATE_PATH>` |
| Main domain and `www` | send visitors to the company page | `APEX_HOST=buzzify.tech`, `PUBLIC_ROOT_REDIRECT=https://buzzify.me` |
| Old hosts | redirect (301-style) to the new ones | `LEGACY_HOSTS=buzzify-menu.online,studio.buzzify-menu.online` |
| Pictures | unchanged: `https://media.buzzify.me` | `MEDIA_PUBLIC_URL` stays |
| Retail | its own app and address, unchanged | `RETAIL_URL` stays |

Rules: every host must differ from the others (the production check stops the build otherwise); `CORE_HOST` needs a
`CORE_GATE_PATH` of 8 to 64 letters, digits, `-` or `_`; names for owners can be changed any time, they are only settings.

## How the super admin host behaves

- Every request to it, `/` included, answers a bare `404 Not found` until the secret path is opened.
- Opening `https://<CORE_HOST>/<CORE_GATE_PATH>` sets a cookie (`__cg`, HttpOnly, Secure, valid 30 days, a keyed hash that does
  not contain the path) and goes to `/studio`. Signing in with the password and the two-factor code still follows.
- The path is a second lock, not the only one. Also limit the host to your own IP or VPN in the reverse proxy if you can.
- Change the path any time: set a new `CORE_GATE_PATH`, restart; every old cookie stops working.
- The scheduler's `/api/cron/*` routes answer on every host without the cookie (each checks its own secret).

## What the gate does not hide (and what to add in the reverse proxy)

- The app's proxy never sees Next's static files (`/_next/static/...`, `/_next/image`) nor files with an extension outside the
  Studio, till and pharmacy (`/favicon.ico`, `/cafe/en/x.png`). On the super admin host those still answer, so a visitor who
  finds the name can tell it is a Buzzify app. To hide even that, make the reverse proxy answer 404 on the super admin host
  unless the request carries a `__cg` cookie or asks for the secret path (the proxy config lives only on the server):

  ```nginx
  # inside the server block of the super admin host
  set $gate 0;
  if ($cookie___cg != "") { set $gate 1; }
  if ($uri ~ "^/<CORE_GATE_PATH>/?$") { set $gate 1; }
  if ($uri ~ "^/api/cron/") { set $gate 1; }
  if ($gate = 0) { return 404; }
  ```

  The app still checks the cookie's value; the proxy rule only keeps strangers from reaching the app at all. Also allow
  only your own IP or VPN on that server block if you can.
- Only `/studio/restaurants` and `/studio/team` are turned away on the Studio host. The other super admin pages
  (`/studio/platform`, `/pharmacies`, `/announcements`, `/activity`) are not confirmed to be for the super admin alone, so
  they stay reachable on the Studio host behind the app's own role checks. A super admin who signs in on the Studio host
  therefore still reaches them: protect the account with its password and two-factor code.
- Emailed verification and change-address links are always built on the Studio host, whichever host asked for them.
- The gate cookie is a fixed keyed hash of the secret path: it cannot be revoked for one browser. Changing
  `CORE_GATE_PATH` (or `BETTER_AUTH_SECRET`) invalidates every copy at once.
- The pharmacy host serves the shared account pages (`/studio/sign-in`, `/forgot`, `/reset`, `/invite`, `/setup-two-factor`,
  `/two-factor`, `/account`) so pharmacists can sign in there; the rest of `/studio` is 404 on it.

## DNS and certificate (at the registrar or Cloudflare for `buzzify.tech`)

1. Confirm which address is the VPS (`buzzify.tech` points at `2.57.91.91` today, `buzzify-menu.online` at `187.126.23.110`).
2. Add `A  *  →  <VPS IP>` (one wildcard record covers every host above, so the names are not listed in public DNS) and keep
   `A  @` and `www` pointing at the VPS.
3. Get one wildcard certificate for `buzzify.tech` and `*.buzzify.tech` (DNS challenge). A certificate per name would put each
   name into the public certificate logs; the wildcard does not.
4. The reverse proxy sends every `*.buzzify.tech` name to the `menu` app and **keeps the `Host` header** (the app routes by it).
   The retail host goes to the retail app's own port.

## Settings to change together (the VPS environment file, then restart)

1. The variables in the table above. Keep the old `STUDIO_HOST`/`PUBLIC_MENU_HOST` names only inside `LEGACY_HOSTS`.
2. `EMAIL_FROM` to an address on `buzzify.tech`, after **Resend** verifies the domain (add its DNS records, press Verify).
3. **R2 CORS** (Cloudflare): allowed origin `https://hive-4q.buzzify.tech` (the Studio host), replacing the old one.
4. **Schedulers** (cron on the VPS or an external one): `https://hive-4q.buzzify.tech/api/cron/publish` (every minute),
   `/api/cron/subscriptions` (every 15 minutes), `/api/cron/retail-sync` (every minute), `/api/cron/retail-reconcile` (hourly).
   The old addresses keep answering until the old hosts are retired, so nothing stops during the move.
5. **Retail** (in its own repository): `CORE_BASE_URL=https://hive-4q.buzzify.tech`. It must be the Studio host: on the menu
   host `/api/retail/...` is a 404, which Retail reads as "no AI key". Nothing else on the Retail side changes.
6. Menus already printed or shared with the old address keep working through the redirect.

## Checks after the deploy (expected results)

| Request | Answer |
|---|---|
| `https://menu.buzzify.tech/atelier` | the demo menu, 200 |
| `https://menu.buzzify.tech/studio` | 404 |
| `https://buzzify.tech/` and any path on it | redirect to the company page |
| `https://hive-4q.buzzify.tech/` | redirect to `/studio`; the sign-in page opens |
| `https://hive-4q.buzzify.tech/pharmacy` | 404 |
| `https://leaf-2x.buzzify.tech/pharmacy` (signed out) | redirects to `/studio/sign-in?next=/pharmacy`, which opens on that host |
| `https://leaf-2x.buzzify.tech/studio` | 404 |
| `https://<CORE_HOST>/` and `/studio` | 404, as if nothing were there |
| `https://<CORE_HOST>/<CORE_GATE_PATH>` | goes to `/studio`, then sign-in and two-factor |
| `https://hive-4q.buzzify.tech/studio/restaurants` | 404 (the super admin's pages are only on the core host) |
| `https://buzzify-menu.online/atelier?lang=ar` | redirect to `https://menu.buzzify.tech/atelier?lang=ar` |
| `https://buzzify-menu.online/` | redirect to the company page, as before |
| `https://<server IP>/` | no menu and no sign-in |
| a password-reset email | arrives from the new sender, link on the Studio host |
| a photo upload, a publish scheduled two minutes ahead | works (R2 CORS, scheduler) |
| Retail's "open in Core" and a sync run | works with the new `CORE_BASE_URL` |

A Menu-only restaurant must see no cashier entry, and a Cashier-only restaurant no menu entry, after signing in on the Studio
host (the Studio already gates products by subscription; confirm it once with real accounts).

## Rollback

Before the change take a Neon snapshot of `production`. If a check fails, restore the previous environment file and restart:
the old hosts still exist in DNS and in the proxy until you retire them. Retire the old domain last, and keep renewing it:
saved links and QR codes may still point at it.
