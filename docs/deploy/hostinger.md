# Going live on Hostinger (buzzify-menu.online)

Public menus are served at `https://buzzify-menu.online/<menu-address>` and the Studio at
`https://studio.buzzify-menu.online/studio`. Both are the same Node.js app on the Hostinger website
`buzzify-menu.online`; `studio.buzzify-menu.online` is an alias (parked domain) of it. The database is Neon
(PostgreSQL) and email goes through Resend, because the hosting plan only offers MySQL databases.

`docs/deploy/production.md` describes the Vercel setup. Its sections on Neon, Resend, the first Super Admin, the
optional ATELIER seed, backups and changing the auth secret apply here too.

## How a deploy works

Hostinger clones `main` from GitHub, runs `npm install`, then `npm run build:host`:

1. `tsx scripts/check-env.ts` stops the deploy and names every missing or wrong setting.
2. `prisma migrate deploy` updates the database (it uses `DIRECT_DATABASE_URL`).
3. `BUILD_TARGET=standalone next build` builds Next.js's self-contained server, which Hostinger runs on its own port.

Build settings on Hostinger: Node.js 22, framework Next.js, output directory `.next`, build script `build:host`,
package manager npm, source GitHub `rizgarabdulkarim1987-cyber/buzzify-menu`, branch `main`.

## Settings (Hostinger → Websites → buzzify-menu.online → Node.js → Environment variables)

Already set (not secret):

| Name | Value |
|---|---|
| `PUBLIC_MENU_HOST` | `buzzify-menu.online` |
| `STUDIO_HOST` | `studio.buzzify-menu.online` |
| `PUBLIC_MENU_ORIGIN` | `https://buzzify-menu.online` |
| `PUBLIC_ROOT_REDIRECT` | `https://buzzify.me` (where `buzzify-menu.online/` sends visitors) |
| `BETTER_AUTH_URL` | `https://studio.buzzify-menu.online` |
| `EMAIL_FROM` | `Buzzify Studio <studio@buzzify-menu.online>` |

You add these four yourself in hPanel (never paste them into a chat, an email or a file in the repository):

| Name | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → your project → Connect → **Pooled** connection string (its host contains `-pooler`) |
| `DIRECT_DATABASE_URL` | Neon → the same screen with pooling switched off (the host without `-pooler`) |
| `BETTER_AUTH_SECRET` | Run this on your computer and copy the output: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `RESEND_API_KEY` | Resend → API Keys → Create (sending access) |

Never add `DEV_SEED_PASSWORD` or `ALLOW_REMOTE_DEV_SEED` here. If a Neon address ends with `&channel_binding=require` and
the build cannot connect, remove that part.

## Your steps

1. **Neon:** create a free account and a project in **AWS Europe Central (Frankfurt)**. Keep both connection strings
   for the table above.
2. **Resend:** create a free account, add the domain `buzzify-menu.online`, and share the DNS records Resend shows
   (they are not secret) so they can be added in Hostinger's DNS; then press Verify in Resend. Create an API key.
3. **Hostinger:** add the four variables above.
4. **Deploy:** start the Node.js build from GitHub (`main`, build script `build:host`). Watch the log: it must show the
   settings check passing, `prisma migrate deploy`, and `next build`.
5. **First Super Admin:** on your computer, in the project folder, follow step 7 of `docs/deploy/production.md`
   (`npm run studio:create-admin` with `DATABASE_URL` set to the Neon **direct** address for that one command).
6. **ATELIER demo (once):** follow step 9 of `docs/deploy/production.md` (`npm run db:seed` with the direct address
   and `DEV_SEED_PASSWORD` not set).
7. **Sign in:** open `https://studio.buzzify-menu.online/studio`, sign in, and set up the authenticator app.
8. **Check:** `https://buzzify-menu.online/atelier` shows the demo menu; `https://buzzify-menu.online/` goes to
   buzzify.me; `https://buzzify-menu.online/studio` answers 404 (the Studio lives only on the studio address).

## Later deploys

Push to `main`, then start a new build in Hostinger (or turn on automatic deployment for the repository). Changing a
variable in hPanel needs a new build, because some values are read while building.
