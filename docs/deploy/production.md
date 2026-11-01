# Putting Buzzify Menu Studio online

This guide takes the app from this repository to a live site:

- **`https://studio.buzzify.me`** is the Studio, where your team signs in.
- **`https://menu.buzzify.me/<address>`** is where guests open a published menu.

Both are the same app on **Vercel**. The data lives in a **Neon** database (PostgreSQL), sign-in and invitation emails
go out through **Resend**, and pictures, logos and downloads are kept in **Cloudflare R2**, served from
**`https://media.buzzify.me`**.

You create every account and you type every secret yourself. Nothing secret belongs in this repository,
which is public, in a chat, or in an email. Keep each value in a password manager as you go.

Plan for one to two hours, plus waiting for DNS (the internet's address book) to catch up.

## Before you start

1. **Check the current prices** on each provider's pricing page before you sign up: [Vercel](https://vercel.com/pricing),
   [Neon](https://neon.com/pricing), [Resend](https://resend.com/pricing) and [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/). Prices and free allowances change, so this
   guide does not quote any. Vercel's free Hobby plan is for personal, non-commercial projects; a business site needs the
   **Pro** plan, which scheduled publishing needs too (Vercel Cron runs every minute only on Pro).
2. **The code must be on the `main` branch of the GitHub repository.** Vercel deploys `main` as the live site. Work on
   another branch reaches the site once it is merged into `main`.
3. **You need access to the DNS settings of `buzzify.me`** (at your domain registrar or wherever its records are kept),
   and to know whether they are on Cloudflare: R2 serves files on your own address only for a domain whose DNS Cloudflare
   holds (step 3b).
4. **A computer with this repository** and Node.js 22.19 or newer, with `npm install` already run. You use it once, in
   step 7, to create the first administrator.

> **The production database must start empty.** One of the migrations (`restaurant_menu_split`) deletes every row in the
> `Restaurant` table. On a brand-new Neon database that is harmless. Never point this app's deploy at a database that holds
> data you want to keep.

### The settings you will collect

Each of these is an **environment variable**: a named setting that Vercel hands to the app. You add them to Vercel in
step 4. Where each comes from is explained in the steps; the table repeats them all at the end.

| Name | What it is |
|---|---|
| `DATABASE_URL` | Neon's *pooled* address of the database (what the app uses) |
| `DIRECT_DATABASE_URL` | Neon's *direct* address (what database updates use) |
| `BETTER_AUTH_SECRET` | A long random secret that protects sign-in |
| `BETTER_AUTH_URL` | `https://studio.buzzify.me` |
| `RESEND_API_KEY` | The key that lets the app send email through Resend |
| `PUBLIC_MENU_HOST` | `menu.buzzify.me` |
| `STUDIO_HOST` | `studio.buzzify.me` |
| `PUBLIC_MENU_ORIGIN` | `https://menu.buzzify.me` |

| `R2_ACCOUNT_ID` | Your Cloudflare account's ID (step 3b) |
| `R2_ACCESS_KEY_ID` | The access key of an R2 token limited to the bucket |
| `R2_SECRET_ACCESS_KEY` | That token's secret |
| `R2_BUCKET` | `buzzify-media` |
| `MEDIA_PUBLIC_URL` | `https://media.buzzify.me` |
| `CRON_SECRET` | A long random secret the scheduler sends with every call (step 3c) |

Two more are optional and have sensible defaults: `EMAIL_FROM` and `PUBLIC_ROOT_REDIRECT`.

## Step 1. Neon: the database

1. Sign up at [neon.com](https://neon.com) and create a **project**. Name it `buzzify-menu`. For the region choose
   **AWS Europe (Frankfurt), `eu-central-1`**: it is next to where the app runs on Vercel, which keeps the app fast. Keep
   the other defaults.
2. In the project, click **Connect**. You will copy two addresses (connection strings) from this panel. Each looks like
   `postgresql://user:password@host/database?sslmode=require` and contains the database password.
   - Switch **Connection pooling** **on** and copy the address. Its host contains `-pooler`. This is **`DATABASE_URL`**.
   - Switch **Connection pooling** **off** and copy the address again. Its host has no `-pooler`. This is
     **`DIRECT_DATABASE_URL`**.
3. Save both in your password manager, labelled so you can tell them apart. The pooled address shares the database between
   many short visits, which is what a hosted app needs. Database updates (migrations) need the direct one.

## Step 2. Resend: email

The Studio emails invitations and password resets from `studio@buzzify.me`. Resend only sends from a domain you have proved
you own.

1. Sign up at [resend.com](https://resend.com), open **Domains** and add **`buzzify.me`**. If it asks for a region, choose a
   European one. (Resend suggests sending from a subdomain such as `updates.buzzify.me`. If you prefer that, add that
   instead and set `EMAIL_FROM` in step 4 to an address on it.)
2. Resend lists DNS records to add (open the domain's **Records** tab). They are typically two `TXT` records (SPF and DKIM)
   and an `MX` or `CNAME` record. Add each one at your DNS provider **exactly as shown**. If your DNS provider offers a
   proxy (Cloudflare's orange cloud), turn it **off** for these records.
3. Add a DMARC record too, which tells receiving mail servers what to do with forged mail: a `TXT` record named `_dmarc`
   with the value `v=DMARC1; p=none; rua=mailto:YOU@YOUR-MAILBOX;`, replacing the last address with a mailbox you read.
   If `_dmarc.buzzify.me` already exists, keep the one you have: a domain can have only one.
4. Back in Resend press **Verify**. This often takes about 15 minutes and can take much longer while DNS spreads. Continue
   with the other steps while you wait.
5. Open **API Keys**, create a key with sending access to the `buzzify.me` domain, and copy it now: Resend shows it once.
   This is **`RESEND_API_KEY`** (it starts with `re_`). Save it in your password manager.

## Step 3. Make the sign-in secret

`BETTER_AUTH_SECRET` signs people's sessions and also encrypts their two-factor secrets. Make it on your own computer.
In Git Bash (or any terminal that has `openssl`):

```bash
openssl rand -base64 32
```

Without `openssl`, this works anywhere Node.js is installed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The result is a line of 44 characters. Copy it straight into your password manager. **Do not lose it and do not change it
later.** If it changes, everyone is signed out and the saved two-factor codes can no longer be read (see "Changing
`BETTER_AUTH_SECRET`" under Day to day, before you ever do it). Never reuse it anywhere else.

## Step 3b. Cloudflare R2: pictures and downloads

Pictures, logos, QR code downloads and spreadsheets are kept in an R2 bucket. Browsers send them to it and fetch them from
it directly, through links that work for a few minutes, so a 15 MB photo never passes through Vercel (whose functions
accept at most 4.5 MB).

1. **First decide where `buzzify.me`'s DNS lives.** R2 serves a bucket on your own address (here `media.buzzify.me`) only
   when the domain's DNS is on Cloudflare. If it already is, go on. If it is elsewhere, either move the domain's
   nameservers to Cloudflare (the free plan is enough; Cloudflare copies the existing records, check that every one came
   across before you switch), or serve the files from a different domain whose DNS Cloudflare holds and use that address
   wherever this guide says `media.buzzify.me`. R2's own `r2.dev` address is rate-limited and meant for testing; do not
   use it for guests.
2. In the Cloudflare dashboard open **R2 Object Storage** and subscribe to it (it asks for a payment method even for the free
   allowance).
3. **Create bucket:** name `buzzify-media`, location **Automatic** (or Eastern Europe, near Frankfurt), storage class
   **Standard**.
4. **Its address:** open the bucket, then **Settings, Public access, Custom Domains, Connect Domain**, and enter
   `media.buzzify.me`. Cloudflare adds the DNS record by itself. Wait until it shows **Active**. Leave the `r2.dev` address
   **disabled**.
5. **Uploads from the Studio (CORS):** in the bucket's **Settings, CORS policy**, choose **Add CORS policy** and paste:

   ```json
   [
     {
       "AllowedOrigins": ["https://studio.buzzify.me"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type", "content-length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

6. **Cleanup rules:** in the bucket's **Settings, Object lifecycle rules**, add three rules, each deleting objects **1 day**
   after they were uploaded: one for the prefix `uploads/`, one for `imports/` and one for `exports/`. These folders hold
   files on their way somewhere (a picture before it is checked, a spreadsheet before it is read, a download after it was
   handed out); everything else in the bucket is kept.
7. **The app's key:** on the R2 overview page choose **Manage API tokens**, then **Create Account API token**. Give it the
   permission **Object Read & Write**, choose **Apply to specific buckets only** and pick `buzzify-media`, and leave the
   expiry at **Forever**. Copy the **Access Key ID** and the **Secret Access Key** into your password manager: the secret is
   shown only once. Your **Account ID** is on the R2 overview page.

You now have `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`buzzify-media`) and
`MEDIA_PUBLIC_URL` (`https://media.buzzify.me`, without a slash at the end).

## Step 3c. The scheduler's secret

A publish can be scheduled for a time on the menu's clock. Every minute Vercel Cron calls the app's
`/api/cron/publish` (the repository's `vercel.json` sets this up), which makes every revision whose time has come live.
Each call carries `CRON_SECRET`, and the app refuses any call without it. Make it the way you made the sign-in secret,
as a **different** value:

```bash
openssl rand -base64 32
```

Keep it in your password manager. Vercel sends it with each call by itself once the variable is set (step 4).

## Step 4. Vercel: the project

1. Sign up at [vercel.com](https://vercel.com) with the GitHub account that owns the repository, and choose the **Pro**
   plan (see "Before you start").
2. **Add New, then Project.** Import the `buzzify-menu` repository. Vercel recognises it as a Next.js app.
3. Leave **Build and Output Settings** on the same screen as they are, **Build Command** included. The repository's
   `vercel.json` tells Vercel to build with `npm run vercel-build`, which first checks the settings, then updates the
   database, then builds the app, and `vercel.json` takes precedence over that field. (If you ever switched **Override**
   on for the Build Command, switch it off again, so that one place decides.)
4. Open **Environment Variables** and add these, one by one, with the values you collected. (You can also add them after
   the project exists, under **Settings, Environment Variables**.) Each must apply to the **Production** environment only:
   untick Preview and Development, or edit the variable afterwards if Vercel ticked them for you. This matters: every deploy
   updates the database it is connected to, and a preview of some other branch must never touch the live one.

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the pooled address from step 1 |
   | `DIRECT_DATABASE_URL` | the direct address from step 1 |
   | `BETTER_AUTH_SECRET` | the secret from step 3 |
   | `BETTER_AUTH_URL` | `https://studio.buzzify.me` |
   | `RESEND_API_KEY` | the key from step 2 |
   | `PUBLIC_MENU_HOST` | `menu.buzzify.me` (no `https://`) |
   | `STUDIO_HOST` | `studio.buzzify.me` (no `https://`) |
   | `PUBLIC_MENU_ORIGIN` | `https://menu.buzzify.me` |
   | `R2_ACCOUNT_ID` | the account ID from step 3b |
   | `R2_ACCESS_KEY_ID` | the access key from step 3b |
   | `R2_SECRET_ACCESS_KEY` | the secret access key from step 3b |
   | `R2_BUCKET` | `buzzify-media` |
   | `MEDIA_PUBLIC_URL` | `https://media.buzzify.me` |
   | `CRON_SECRET` | the secret from step 3c |

   If Vercel lets you mark a variable as a **Secret** (hidden after saving), do that for `DATABASE_URL`,
   `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `R2_SECRET_ACCESS_KEY` and `CRON_SECRET`.

   Add `EMAIL_FROM` only if you want a different sender than the default `Buzzify Core <studio@buzzify.me>`, and
   `PUBLIC_ROOT_REDIRECT` only to send visitors of `https://menu.buzzify.me/` somewhere other than `https://buzzify.me`.

   **Never add `DEV_SEED_PASSWORD` or `ALLOW_REMOTE_DEV_SEED`.** The first creates test accounts with a password that is
   written in the public repository. The second only exists to override a safety check in the development seed, and
   production has no use for it. The deploy check refuses a deploy that has `DEV_SEED_PASSWORD`.
5. Press **Deploy**. If any variable is missing or wrong, this first attempt stops at the settings check with a list of what
   to fix (step 6), which does no harm.
6. Once the project exists, open **Settings** and set two more things:
   - **Build and Deployment, Ignored Build Step**: choose **Only build production**. Without this, Vercel also builds
     every other branch as a preview, and those builds stop at the settings check because the variables are for
     Production only.
   - **General, Node.js Version**: choose 22.x or newer (the app needs 22.19 or newer).

The repository's `vercel.json` already runs the app's server code in **Frankfurt (`fra1`)**, next to the database. After the
first deploy you can see it under **Settings, Functions**.

## Step 5. The two addresses (domains and DNS)

1. In the Vercel project open **Settings, Domains** and add **`studio.buzzify.me`**, then add **`menu.buzzify.me`**. Both
   belong to the Production environment.
2. For each, Vercel shows a `CNAME` record to create. Its value is specific to your project, so copy it from Vercel rather
   than from anywhere else. At your DNS provider create:
   - a `CNAME` record named `studio` (some providers want the full `studio.buzzify.me`) with the value Vercel shows,
   - a `CNAME` record named `menu` with the value Vercel shows.

   Turn any proxy (such as Cloudflare's orange cloud) **off** for these two records. Leave the records for `buzzify.me`
   itself, the company site, alone.
3. Wait until Vercel shows both domains as configured. It then issues the security certificates (the padlock) by itself.

Vercel also gives the project an address of its own, such as `https://buzzify-menu.vercel.app` (and one per deploy). In
production that address answers a plain "Not found" for every page, on purpose: only `studio.buzzify.me` and
`menu.buzzify.me` serve the app, so there is never a second address for the Studio next to the menus. Use the two
addresses above, also when Vercel's **Visit** button offers the `.vercel.app` one.

## Step 6. Deploy

1. In the Vercel project open **Deployments**. If the first deploy ran before the variables were complete, open the latest
   one, choose **Redeploy** from its menu, and try again.
2. Open the deploy's **build log** and look for three things, in this order:
   1. `The production environment is complete.` If the log instead lists the problems, fix those variables (Settings,
      Environment Variables), then redeploy. The list names variables and what is wrong; it never shows a value.
   2. Prisma applying the migrations to Neon and ending with `All migrations have been successfully applied`. This builds
      all the tables. It runs on every deploy and applies only what is new.
   3. The Next.js build finishing.

   If the log shows neither the settings check nor the migrations, see "If something goes wrong" below.
3. When it is ready, `https://studio.buzzify.me` opens the sign-in page. There is nobody who can sign in yet: that is
   step 7.
4. **The scheduler:** open **Settings, Cron Jobs**. It lists `/api/cron/publish`, every minute. **View Logs** beside it
   shows each run; a run answers `{"activated":0}` when nothing was due. A `401` there means `CRON_SECRET` is missing or
   different in the Production environment.

## Step 7. Create the first administrator (Super Admin)

Accounts are by invitation only, so the very first one is made from a terminal. You run this on your own computer, aimed at
the live database, **once**. It needs the tables from step 6, so deploy first.

You point the command at Neon by setting `DATABASE_URL` for that one command, using the **direct** address
(`DIRECT_DATABASE_URL`) from step 1. The address contains the database password, so it is never typed into the command
itself: terminals keep a history of the commands you type, in a file on your computer (Git Bash writes `~/.bash_history`
when the window closes; PowerShell writes `ConsoleHost_history.txt` as you go). Instead the commands below ask for the
address, you paste it at the prompt (PowerShell shows it as asterisks, Git Bash shows nothing: that is expected), and
press Enter.

In **PowerShell**, paste this whole block at once:

```powershell
try {
  $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', (Read-Host 'Direct address' -AsSecureString)).Password
  npm run studio:create-admin
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
```

In **Git Bash**:

```bash
( read -rsp 'Direct address: ' DATABASE_URL; echo; export DATABASE_URL; npm run studio:create-admin; unset DATABASE_URL )
```

What you paste at the prompt goes into the variable and nowhere else: it is not part of a command, so it is not saved in
the history (PowerShell's history records only what you type at its own prompt, not what `Read-Host` reads), and the
screen shows it only as asterisks or not at all. The variable lives only as long as the command: PowerShell's `finally`
removes it even if you press Ctrl+C, and in Git Bash the parentheses run everything in a sub-shell that takes the variable
with it when it ends.

1. The script's first line says which database it will change, for example
   `Database: ep-quiet-sun-123456.eu-central-1.aws.neon.tech/neondb`. **Check that this is your Neon host.** If it says
   `127.0.0.1` or `the development database`, the variable did not take: press Ctrl+C and start again.
2. Answer the prompts: your name, your email address, and a password (at least 12 characters and not a common one) typed
   twice. The password is not shown on screen and goes to the database only as a hash.
3. It ends with `Created the Super Admin …`, followed by a line with a `127.0.0.1` address. Ignore that address: the script
   cannot know your live one. Use `https://studio.buzzify.me`.
4. Nothing else to clean up: the address was never in a command or readable on screen, and the variable is already
   gone. (Closing the window would not have helped with a command that held it: that is when Git Bash saves its
   history.)

## Step 8. Sign in and set up two-factor

1. Open `https://studio.buzzify.me` and sign in with the email and password from step 7.
2. Super Admins must use two-factor sign-in, so the first sign-in goes to its setup. Scan the QR code with an
   authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or your password manager),
   type the 6-digit code it shows, and **save the ten recovery codes** somewhere safe. Each works once if you lose your
   phone.
3. From now on, signing in asks for your password and then a code from the app.

## Step 9. Optional: load the demo menus

The repository contains three fictional places with full menus: the café ATELIER (`/atelier`), Riverlight Coffee
(`/riverlight`) and Hot Brick Burgers (`/hot-brick`, in Sorani first and priced in dinars). They are the quickest way to
see real menus online, and each is published as revision 1.

Run this **once**, on your own computer, aimed at the live database, like step 7 (and the same way: the commands ask for
the direct address). First make sure the demo accounts are not switched on: open the `.env` file in the repository and, if
it has a line starting `DEV_SEED_PASSWORD`, put a `#` in front of it for now.

PowerShell, the whole block at once:

```powershell
try {
  $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', (Read-Host 'Direct address' -AsSecureString)).Password
  npm run db:seed
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
```

Git Bash:

```bash
( read -rsp 'Direct address: ' DATABASE_URL; echo; export DATABASE_URL; npm run db:seed; unset DATABASE_URL )
```

Expect three lines that begin `Seeded atelier`, `Seeded riverlight` and `Seeded hot-brick`, each published as revision 1,
and a line saying the development users were skipped. Then `https://menu.buzzify.me/atelier`, `/riverlight` and
`/hot-brick` show the menus.

Running it again later does not add second copies: it replaces each demo menu with a fresh one (its revisions and any
changes made to it in the Studio are lost). Once a demo menu has been deleted in the Studio, or moved to another address,
the command refuses and changes nothing at all: that address stays reserved for good.

- If the script refuses and says `DEV_SEED_PASSWORD` is set or that the database is not on this machine, it did what it is
  for: nothing was written. Comment out `DEV_SEED_PASSWORD` in `.env` and run it again. **Do not set
  `ALLOW_REMOTE_DEV_SEED=1`** to get past it: that would create the three test accounts, with the published password,
  in your live database.
- The demo menus are public pages. When real clients arrive, remove each in the Studio: open All menus, then the menu,
  then Manage, Archive, then Manage, Delete menu; then delete its restaurant. Its address stays reserved for good, so no
  other menu can take it.

## Step 10. Check that it works

Go through this list once. Use a private (incognito) window for the guest and owner parts, so they do not share your
administrator session.

1. `https://studio.buzzify.me` opens the sign-in page with a valid padlock.
2. Sign in as the Super Admin. After the password it asks for the code from your authenticator app, then shows Overview.
3. `https://menu.buzzify.me/studio` shows a plain "Not found", and so does `https://studio.buzzify.me/atelier`. Each address
   serves only its own half of the app. The project's own Vercel address (Settings, Domains lists it, such as
   `https://buzzify-menu.vercel.app/studio`) shows the same plain "Not found": that is by design (step 5).
4. `https://menu.buzzify.me/` sends you to `https://buzzify.me` (or to `PUBLIC_ROOT_REDIRECT` if you set it).
5. **Create a restaurant:** Restaurants, then New restaurant. Enter a name, a type and a city, and press Create restaurant.
6. **Create a menu:** All menus, then New menu. Choose that restaurant and enter a name and an address (the part after
   `menu.buzzify.me/`, for example `test-cafe`). It opens on its Content tab, empty.
7. **Fill it and publish:** on Content add a category and a dish with a price (or import a spreadsheet on Import and export).
   Press Publish, then Publish again to confirm. It says "Published as revision 1".
8. **Open it as a guest:** `https://menu.buzzify.me/test-cafe` (your address) shows the menu. Try the same address with
   `/ar` and `/ckb` on the end for Arabic and Sorani.
9. **Invite an owner:** open your new restaurant, then its People tab, then Invite an owner. Use an email address you can
   read that is **not** your administrator's address (a second mailbox, or an alias of your own such as
   `yourname+owner@gmail.com`). Press Send invitation. Copy the invitation link shown if you wish: it appears only then.
10. **Accept it:** in the private window open the link from the email (look in spam the first time). Choose a name and a
    password and create the account. You land in the Studio as the restaurant's owner and see only that restaurant.
    In Resend, the Emails list shows the invitation as delivered.
11. **Clean up:** as the administrator, archive and then delete the test menu (Manage, Archive; then Manage, Delete menu),
    then delete the test restaurant. The test owner's account stays: deactivate it under People. The test menu's address
    stays reserved.

12. **Pictures:** open **Media**, choose the test restaurant's library, and upload a photo of about 15 MB (the most the
    library takes). It is sent, then finished in well under a minute, and shows in the grid. Choose it and **Open the
    file**: its address starts with `https://media.buzzify.me/`. Upload the same photo from a phone too, if you like.
13. **A scheduled publish:** on the test menu change a price, then **Manage, Schedule publish…** and choose a time two
    minutes ahead. Revisions shows it waiting. Within a minute of that time the guest page shows the new price and
    Revisions shows it live. (Schedule a publish only when it matters: cancelling it, on Revisions, is fine too.)

If all thirteen pass, the platform is live.

## Day to day

**Releasing a change.** Merge it into `main`. Vercel builds it, checks the settings, applies any new database migrations
and switches the live site over only when the build succeeds. A failed check or build leaves the previous version online.
Database migrations are not undone by rolling back a deploy, so keep each migration compatible with the version before it.

**Backups.** The database has no other backup yet. Neon keeps a history of changes and can rewind the database to an earlier
moment (**point-in-time restore**); how far back depends on your Neon plan, so read that on Neon's pricing page. To use it,
open the project in the Neon console and look for **Backup & Restore** (or **Restore** in the branch's menu). Prefer to
restore into a **new branch** first and look at it, instead of rewinding the live one. A rewind also rewinds accounts,
sessions and everything published since. Try this once before you need it.

**Changing the database password or the Resend key.** Change it at the provider, update the variable in Vercel, and
redeploy: a variable change only applies to deploys made after it.

**Changing `BETTER_AUTH_SECRET`: only if it leaked.** Do not change it for any other reason. It does two jobs. It signs the
sign-in cookies, and it locks (encrypts) every person's two-factor key and recovery codes in the database. A new secret
cannot open what the old one locked, and the Studio has no screen that resets someone else's two-factor (a Super Admin
cannot even turn their own off). So after a change:

- Everyone is signed out. Passwords, restaurants and menus are untouched, and people who never turned two-factor on simply
  sign in with their password.
- Everyone who had two-factor on still passes the password step, then fails: the code is refused, and so is every recovery
  code, because the Studio can no longer read what was saved. That includes the only Super Admin, so without the recovery
  below you would be locked out of the Studio.

Before you change it, make sure you can do the recovery: you can sign in to the Neon console and open the **SQL Editor** for
this project, and `npm run studio:create-admin` works on your computer (step 7). Pick a quiet moment and recover straight
after.

1. Make a new secret as in step 3 and save it in your password manager, next to the old one. Replace `BETTER_AUTH_SECRET` in
   Vercel with it, then redeploy.
2. In the Neon console open the **SQL Editor**, choose the production database (the name at the end of your
   `DIRECT_DATABASE_URL`, usually `neondb`) and run these two statements:

   ```sql
   DELETE FROM "twoFactor";
   UPDATE "user" SET "twoFactorEnabled" = false;
   ```

   They remove the unreadable two-factor records of everybody, and change nothing else. Switching the flag off alone is not
   enough: the saved records have to go as well.
3. Everyone signs in with their password. A Super Admin is taken straight to the two-factor setup: a new QR code and new
   recovery codes, as in step 8. Designers and owners can switch two-factor on again under Account.

If you cannot use the SQL Editor, you can still get back in with a second Super Admin. Run step 7 again as
`npm run studio:create-admin -- --force`, with an email address nobody has used. Keep the `--` before `--force`: without it
npm keeps the flag for itself and the script refuses, because a Super Admin already exists. The new person signs in with
their password and sets up two-factor, which is then stored under the new secret. That gives you a working administrator and
nothing more: it does not reset anyone else. The others stay locked out until the SQL above clears them, or until you
deactivate them (People) and invite them again with different email addresses.

**Upgrading Next.js.** `src/server/data/cache.ts` works around a timing mismatch inside Next.js 16.4.1, which could
otherwise make guests keep seeing the old menu for a moment after a change is published. After a Next.js upgrade, run
`npm test`. The cache test reaches into Next's internals and fails loudly if they moved; do not deploy until it passes
again, or until the workaround has been re-checked against the new version.

**Not set up yet.** Image storage on Cloudflare R2 (`media.buzzify.me`) and scheduled publishing (a Vercel cron job) arrive
with milestone 2b. They add more variables (`R2_*`, `MEDIA_PUBLIC_URL`, `CRON_SECRET`), and this guide will gain their steps.

## Linking Buzzify Retail (optional)

Buzzify Retail ("Retails", its own app and database) runs the shops' tills, stock and staff. The Studio stays the place
where a retail shop is created, gets its owner, its plan and its subscription, and where people sign in. The link between
the two is off until `RETAIL_URL` is set. Without it nothing is sent, the two retail cron routes answer
`{"disabled":true}`, and the deploy check ignores the other `RETAIL_*` settings.

### What goes over the link

| From | Call | When | Carries |
|---|---|---|---|
| Studio | `POST /api/core/v1/provision` on Retails | Once per shop, when it has an owner who accepted and a `retail` subscription | The shop's name, its branches (sent only this once), currencies, and its first snapshot |
| Studio | `POST /api/core/v1/state` on Retails | After every change Retails must know (owner, plan or its limits, subscription, suspend/archive, the AI switch, Resync) | The snapshot: a version number, the shop's status, the plan and its five limits, the subscription dates, the AI switch and the owner |
| Studio | `GET /api/core/v1/state` on Retails | The hourly reconcile, about once a day per shop | Nothing; Retails answers its version, status and this month's AI use |
| Retails | `GET /api/retail/v1/ai-config` on the Studio | When Retails' AI is used, at most once a minute per Retails server | Nothing; the Studio answers its saved Anthropic key (or the `ANTHROPIC_API_KEY` setting) and model |
| Retails | `POST /api/retail/v1/identities` on the Studio | When an owner adds staff in Retails | An email and a name; the Studio answers the person's Studio account (and makes a sign-in-only account with a set-password email for a new address) |
| Browser | Retails `.../handoff/start` -> Studio `/api/retail/v1/handoff` -> Retails `.../handoff/callback` | "Sign in with Studio" in Retails, or **Open Retails** in the Studio | A sign-in token valid for 60 seconds, in the address of the last step |

Every server-to-server call is signed and refused without the right secret. Retails ignores a snapshot whose version is
not higher than the one it has, which is why **Resync** sends the same content at a new version.

### The settings, and their twins in Retails

Each Studio setting has a twin in Retails that holds **the same value**. Make each secret the way you made the sign-in
secret (`openssl rand -base64 32`; at least 16 characters, 32 or more recommended), every one different from the others
and from `CRON_SECRET` and `BETTER_AUTH_SECRET`. Put each value into both apps yourself; never paste one into a chat, an
email or the repository.

| Studio | Retails twin | What it does |
|---|---|---|
| `RETAIL_URL` | `APP_URL` | Retails' address. The Studio calls it and sends sign-ins back only to it |
| `RETAIL_SYNC_SECRET` | `CORE_SYNC_SECRET` | Signs the Studio's provision and state calls |
| `RETAIL_CALLER_SECRET` | `CORE_OUT_SECRET` | Checks Retails' ai-config and identities calls |
| `RETAIL_CALLER_SECRET_PREVIOUS` | (Retails' previous `CORE_OUT_SECRET`) | Optional, only while that secret is being changed |
| `RETAIL_HANDOFF_SECRET` | `CORE_HANDOFF_SECRET` | Signs the sign-in token |
| (the Studio's own address) | `CORE_BASE_URL` | Where Retails calls the Studio |

Three rules about the two addresses:

- **`RETAIL_URL` must be written exactly like Retails' `APP_URL`**: `https://`, lowercase, no path, no trailing slash, no
  `:443`. Retails builds the sign-in return address from `APP_URL` as written and the Studio accepts only the one built
  from `RETAIL_URL`, so `https://Retail.example.com` against `https://retail.example.com` refuses every sign-in. The deploy
  check refuses a `RETAIL_URL` that is not written that way.
- **Retails' `CORE_BASE_URL` is the Studio's address** (`https://studio.buzzify.me` here), never the menu address. On the
  menu address `/api/retail/...` is a 404, and Retails reads a 404 from ai-config as "the Studio has no key": its AI
  switches off without any other error.
- Both are `https://` in production. Each app refuses plain `http` there.

### The two scheduled jobs

These are not in `vercel.json`. Add them to the scheduler that already calls `/api/cron/subscriptions` (on Hostinger:
hPanel Cron Jobs, see `docs/deploy/hostinger.md`; elsewhere an external scheduler such as cron-job.org). Both are a `GET`
with the header `Authorization: Bearer <CRON_SECRET>`, the same secret as the other jobs:

| Address | How often | What it does |
|---|---|---|
| `/api/cron/retail-sync` | **every minute, never more often** | Delivers what is queued: up to 40 shops per run, with retries |
| `/api/cron/retail-reconcile` | every hour | Checks up to 50 shops against Retails (each about once a day) and re-sends what Retails lost or never got |

Retails allows the Studio 120 calls a minute. One sync run per minute (at most 40 calls), the reconcile (50 an hour) and
the immediate attempts after a change stay under it; a second sync job, or one every 30 seconds, would not. Each run
answers its counts as JSON, `{"disabled":true}` without `RETAIL_URL`, `401` for a wrong secret and `503` when
`CRON_SECRET` is not set. Most changes are delivered at once; a plan change, the subscription sweep and changes to people
wait for the next sync run, so up to a minute.

**What retries and what does not.** When Retails is down or slow, a delivery is retried after 1, 2, 4 ... minutes, at most
an hour apart, 20 times. That is about 15 hours; after it the shop shows **failed**, and only the daily reconcile queues it
again, so once Retails is back a shop can wait up to another 24 hours. Press **Resync** on the shop's Retail tab to send
it at once. When Retails refuses the content itself (a 400, 413 or 422, such as a plan limit Retails will not accept),
neither the sync nor the reconcile retries it: fix the cause, then press **Resync** (the next change to the shop also
sends it again). That page shows each shop's state (waiting for the owner or the subscription, retrying, failed, synced).

**A retail plan must allow the shop's branches.** A shop's branches are set when it is created and are managed in
Retails afterwards, and Retails refuses a shop with more branches than its plan allows. So the billing screens refuse to
start, change or reactivate a retail subscription on a plan with fewer branches than the shop has ("This plan allows
fewer branches than the shop has").

**Who Retails sees as the owner.** The snapshot names one owner: the shop's earliest active OWNER in the Studio. A
second owner added in the Studio gets no role in Retails from that (the owner can invite them in Retails). To hand a shop
over, add the new owner in the Studio, then remove the first one: the next snapshot names the new owner, and Retails
makes them the owner. The new owner then signs in again (Open Retails) to see the shop.

**Restoring the Studio's database.** When the Studio's database is restored from a backup, its version numbers can fall
behind what Retails already has, and Retails would ignore the older numbers. The Studio notices (from Retails' answer to a
delivery, or from the reconcile), jumps above Retails' number and sends the current details again. To be safe, press
**Resync** on each retail shop after a restore.

### Changing a secret

Each side has a "previous" setting that accepts the old value while the new one rolls out, so a change never breaks the
link. Change one secret at a time, in this order:

- **`RETAIL_SYNC_SECRET` / `CORE_SYNC_SECRET`** and **`RETAIL_HANDOFF_SECRET` / `CORE_HANDOFF_SECRET`** (the Studio signs,
  Retails checks):
  1. Retails: put the old value in `CORE_SYNC_SECRET_PREVIOUS` (or `CORE_HANDOFF_SECRET_PREVIOUS`) and the new one in
     `CORE_SYNC_SECRET` (or `CORE_HANDOFF_SECRET`); redeploy Retails. It now accepts both.
  2. Studio: put the new value in `RETAIL_SYNC_SECRET` (or `RETAIL_HANDOFF_SECRET`); redeploy.
  3. Retails: remove the `_PREVIOUS` value; redeploy.
- **`RETAIL_CALLER_SECRET` / `CORE_OUT_SECRET`** (Retails signs, the Studio checks):
  1. Studio: put the old value in `RETAIL_CALLER_SECRET_PREVIOUS` and the new one in `RETAIL_CALLER_SECRET`; redeploy.
  2. Retails: put the new value in `CORE_OUT_SECRET`; redeploy.
  3. Studio: clear `RETAIL_CALLER_SECRET_PREVIOUS`; redeploy.

A secret that leaked is changed the same way, but quickly, and the leaked value is never kept as "previous" longer than
the rollout takes.

### Keep sign-in addresses out of access logs

The sign-in token travels in the address of the last step, and the handoff's state in the steps before it. Configure the
web server, proxy or CDN in front of each app not to store the query string of these paths in its access logs:

- Studio: `/api/retail/v1/handoff`
- Retails: `/api/core/v1/handoff/start` and `/api/core/v1/handoff/callback`

The token lives 60 seconds, is bound to the browser that started the sign-in and is used once, but a log that keeps it is
still a place it can be read. The apps themselves never log it.

### Switching the link on (once, with the owner's approval)

1. **The migrations.** The release that brings the link adds migrations, and the deploy runs `prisma migrate deploy` on
   production by itself. One of them is `ALTER TYPE ... ADD VALUE 'RETAIL'`, which **cannot be undone**: rolling back the
   deploy leaves it in place. Before you merge, take a fresh backup (a Neon snapshot or a restore point of the production
   branch), rehearse the migrations on a branch made from it, and pick a quiet merge window with the owner.
2. **The settings.** Retails first: its `APP_URL`, `CORE_BASE_URL` and the three secrets. Then the Studio's five
   (`RETAIL_CALLER_SECRET_PREVIOUS` stays empty), and a redeploy. The deploy check names any that is missing or wrong.
3. **The two jobs** above.
4. **Plans and prices.** The `retail` product starts **turned off**, and there are no retail plans. On the billing
   screens, make the retail plans (names, the five limits) and their prices, then turn the product on. Until then no
   retail shop can be given a subscription, so none is sent to Retails.
5. **A first shop.** Create a retail business (Restaurants, sector Retail, with the owner's email), start its trial on
   its billing tab, and once the owner has accepted the invitation check its Retail tab: it shows **synced** within a
   minute. **Open Retails** in the owner's sidebar then signs them in to Retails.

### Before merging (not done yet)

- **Not tested against the real Retails.** The link is tested only against a stand-in for Retails that checks every
  request with a copy of Retails' own checks. The end-to-end run with the real Retails app (create a shop, see it in
  Retails, sign in through Open Retails) has **not** been done, and the browser test `tests/e2e/studio-retail.spec.ts`
  has **never passed**. Do both before merging.
- **Super Admin spaces.** `main` has Super Admin "spaces" (`businessSpace` food or pharmacy, in
  `src/server/studio/services/space-scope.ts`) that do not know RETAIL. Rebasing this work onto `main` must add a retail
  space before merging.
- The fresh backup, the rehearsal and the owner's merge window from step 1 above.

## If something goes wrong

| What you see | What to do |
|---|---|
| The build log lists variables after "The production environment is not ready" | Fix each named variable in Vercel (Settings, Environment Variables) and redeploy. The line says what is wrong with it |
| The build log shows no settings check and no `prisma migrate deploy` | The commit that was built does not have the `buildCommand` line in `vercel.json` (it must be on `main`, see "Before you start"). The Build Command field in the dashboard does not decide this, `vercel.json` does. Merge the current code into `main` and redeploy |
| The migration step cannot connect to the database | `DIRECT_DATABASE_URL` must be the direct address (no `-pooler` in the host), with `?sslmode=require`. If it has `&channel_binding=require`, remove that part. Neon may also be waking from idle: redeploy |
| A domain stays "Invalid configuration" | Compare your DNS record with what Vercel shows. Remove other `A`, `AAAA` or `CNAME` records on that same name, and turn off any DNS proxy |
| The sign-in page loads but signing in fails | `BETTER_AUTH_URL` must be exactly the address you are using, `https://studio.buzzify.me` |
| Invitation or reset emails do not arrive | In Resend, check the domain shows **Verified** and read its Logs. `EMAIL_FROM` must be an address on the verified domain. The Studio also shows the invitation link right after you send it |
| `menu.buzzify.me/<address>` is a 404 | The menu is not published, or it is suspended or archived. Open it in the Studio and check its status |
| Every page on one host is a 404 | `PUBLIC_MENU_HOST` or `STUDIO_HOST` has a typo, or includes `https://` |
| Every page on the `.vercel.app` address is a 404 | By design: in production only the two hosts serve the app (step 5). Open `https://studio.buzzify.me` or `https://menu.buzzify.me` |
| `studio:create-admin` says a table does not exist | Deploy first (step 6): the tables are made by the deploy |
| Retails' "Sign in with Studio" ends on a plain "Bad request" from the Studio | `RETAIL_URL` is not written exactly like Retails' `APP_URL` (case, trailing slash, port) |
| A retail shop's Retail tab stays on **retrying** | Retails is down, or the secrets differ: `RETAIL_SYNC_SECRET` must equal Retails' `CORE_SYNC_SECRET` (a `401` from Retails is retried, not refused) |
| A retail shop shows **failed** with a code | Retails refused the content (for example a plan limit). Fix the cause, then press **Resync** |
| Retails' AI says it is unavailable although the Studio has a key | Retails' `CORE_BASE_URL` points at the menu address, or `CORE_OUT_SECRET` differs from `RETAIL_CALLER_SECRET` |

## Safety rules

- The repository is public. Never commit a `.env` file, an address from Neon, a key from Resend or the sign-in secret.
  `.env` is already ignored by git.
- A secret that has been seen by someone who should not have it is leaked: replace it at the provider and in Vercel.
- Nobody who helps with this setup, an AI assistant included, needs to see a secret. Do not paste one into a chat.

## Good to know

- `npm ci --omit=dev` still installs a few packages that Better Auth's optional test-tool dependency pulls in. That is
  harmless, and Vercel installs its own way, so it does not affect a deploy.
- The logs may show a notice from the database driver that the SSL mode `require` is treated as `verify-full`. It is only a
  notice about how a future version will behave; the connection works.
- Preview deployments of other branches are switched off on purpose (step 4). When you want them, give them their own
  database and variables, never the live ones.

## All the settings in one place

| Name | Needed | Where it comes from | Example shape |
|---|---|---|---|
| `DATABASE_URL` | yes | Neon, Connect, pooling on | `postgresql://…-pooler….neon.tech/…?sslmode=require` |
| `DIRECT_DATABASE_URL` | yes | Neon, Connect, pooling off | `postgresql://….neon.tech/…?sslmode=require` |
| `BETTER_AUTH_SECRET` | yes | You, step 3 | 32 or more characters |
| `BETTER_AUTH_URL` | yes | You | `https://studio.buzzify.me` |
| `RESEND_API_KEY` | yes | Resend, API Keys | `re_…` |
| `PUBLIC_MENU_HOST` | yes | You | `menu.buzzify.me` |
| `STUDIO_HOST` | yes | You | `studio.buzzify.me` |
| `PUBLIC_MENU_ORIGIN` | yes | You | `https://menu.buzzify.me` |
| `R2_ACCOUNT_ID` | yes | Cloudflare, R2 overview | 32 hexadecimal characters |
| `R2_ACCESS_KEY_ID` | yes | Cloudflare, R2 API token | 32 characters |
| `R2_SECRET_ACCESS_KEY` | yes | Cloudflare, R2 API token (shown once) | 64 characters |
| `R2_BUCKET` | yes | You, step 3b | `buzzify-media` |
| `MEDIA_PUBLIC_URL` | yes | You, step 3b | `https://media.buzzify.me` |
| `CRON_SECRET` | yes | You, step 3c | 32 or more characters |
| `RETAIL_URL` | only to link Buzzify Retail | Retails' `APP_URL`, written the same way | `https://retail.buzzify.me` |
| `RETAIL_SYNC_SECRET` | with `RETAIL_URL` | You; the same value as Retails' `CORE_SYNC_SECRET` | 16 or more characters (32 recommended) |
| `RETAIL_CALLER_SECRET` | with `RETAIL_URL` | You; the same value as Retails' `CORE_OUT_SECRET` | 16 or more characters (32 recommended) |
| `RETAIL_CALLER_SECRET_PREVIOUS` | no; only while changing that secret | Its old value | 16 or more characters |
| `RETAIL_HANDOFF_SECRET` | with `RETAIL_URL` | You; the same value as Retails' `CORE_HANDOFF_SECRET` | 16 or more characters (32 recommended) |
| `EMAIL_FROM` | no | You | `Buzzify Core <studio@buzzify.me>` (the default) |
| `PUBLIC_ROOT_REDIRECT` | no | You | `https://buzzify.me` (the default) |
| `DEV_SEED_PASSWORD` | never in production | | |
| `ALLOW_REMOTE_DEV_SEED` | never in production | | |

The deploy checks all of this before it touches the database, and lists every problem at once.
