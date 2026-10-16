# Studio Core 2a spike findings (Better Auth, Prisma 7, pg_trgm)

Task 0 of `2026-10-16-studio-core-2a-platform.md`. Later tasks say "per the spike" and mean this file. The code below ran green in a scratch Vitest suite (13 tests) and type-checks under the repository's `tsc --noEmit`; statements marked "from source" were read in `node_modules` but not exercised. The spike code is deleted; this file and the pinned dependency are the only artefacts.

**Versions exercised:** `better-auth` 1.7.10 (with `@better-auth/core` 1.7.10, `@better-auth/prisma-adapter` 1.7.10, `better-call` 1.4.2), the `auth` CLI 1.7.10 (`npx auth@latest` resolved to it), Prisma 7.10.0 with `@prisma/adapter-pg` 7.10.0, embedded PostgreSQL 18.4 (`pg_trgm` 1.6), Vitest 5.0.5, `zod` 4.6.7 (Better Auth dedupes onto the repository's copy).

**Where the tests ran.** They ran against a scratch database `buzzify_spike` on the same embedded server (`127.0.0.1:54329`), not against `buzzify_test`. Putting Better Auth's tables into `buzzify_test` would have made it drift from `prisma/migrations`, and Task 7's real migration would then have failed with "relation already exists". The scratch schema was the committed `prisma/schema.prisma` plus the models below, pushed with `prisma db push --schema <temp file>` and generated into a temp output directory, so `src/generated/prisma`, `prisma/schema.prisma` and `prisma/migrations` were never touched. The pg_trgm migration experiment used a third scratch database and a temp copy of the migrations folder. All scratch databases were dropped. The dev database `buzzify` and `buzzify_test` were not modified.

## Answers at a glance

| Question | Answer |
| --- | --- |
| Install | `npm install --save-exact better-auth@1.7.10`. Adds no new `npm audit` findings: the same 9 high-severity findings (`braces`, `micromatch`, `fast-glob` via `eslint-config-next`; `deepmerge-ts`, `mysql2` via `prisma`) appear on the base lockfile. |
| Models Better Auth needs | `User`, `Session`, `Account`, `Verification`, `TwoFactor`, `RateLimit`, listed verbatim in section 2. `TwoFactor` includes `verified`, `failedVerificationCount` and `lockedUntil` besides `secret`, `backupCodes`, `userId`. |
| Create a password user while sign-up is disabled | Mechanism (a) works, so (b) was not needed: `(await auth.$context).internalAdapter.createUser(user, { method: 'admin' })`, then `internalAdapter.linkAccount({ providerId: 'credential', accountId: user.id, userId: user.id, password: await ctx.password.hash(pw) })`. The admin plugin's `createUser` endpoint is literally these two calls (read in `dist/plugins/admin/routes.mjs`), and it would add `role/banned/banReason/banExpires` and `session.impersonatedBy` columns we do not want. |
| `signInEmail` with that user | Works. Email is case-insensitive. Wrong password gives `APIError` 401 `INVALID_EMAIL_OR_PASSWORD`. |
| Public sign-up rejected | Yes, over HTTP (`400 EMAIL_PASSWORD_SIGN_UP_DISABLED`; `404` when `disabledPaths: ['/sign-up/email']` is also set) and through `auth.api.signUpEmail` (throws the same code). No user row is created. |
| `enableTwoFactor` | Returns `{ method: 'totp', totpURI, backupCodes }` with exactly 10 backup codes. It needs a live session (cookie headers) and the password. |
| `verifyTOTP` completes enrolment | Yes: sets `user.twoFactorEnabled = true`, `twoFactor.verified = true`, and rotates the session (the old cookie stops working). |
| Later `signInEmail` | Returns `{ twoFactorRedirect: true, twoFactorMethods: ['totp'] }` and sets the `two_factor` cookie; `verifyTOTP` or `verifyBackupCode` with that cookie finishes sign-in. |
| `pg_trgm` on the embedded database | Available and creatable; the Prisma `Gin` + `gin_trgm_ops` index works and produces no migration drift once `CREATE EXTENSION` is prepended by hand. **But** the embedded cluster uses the `C` locale, where `pg_trgm` produces no trigrams for Arabic or Sorani text, so the index cannot accelerate (and `%`/`similarity()` cannot match) Arabic-script search. See section 6. |
| Recommendation for search | Do not rely on trigram in 2a. Plain `ILIKE '%q%'` (Prisma `contains` with `mode: 'insensitive'`) over B-tree-indexed tables is correct for Arabic, Sorani and Latin and takes 0.26 ms at 1,001 rows. |

## 1. Install and configuration that works

```bash
npm install --save-exact better-auth@1.7.10
```

`package.json` gets `"better-auth": "1.7.10"` (no caret). `better-auth` is ESM-only and imported fine from Vitest. The repository's `postinstall` (`prisma generate`) runs on every install.

The exact configuration from the brief, type-checked against the repository's `getPrisma()`:

```ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { getPrisma } from '@/server/data/prisma';

export const auth = betterAuth({
  baseURL: 'http://localhost:3100',
  secret: process.env.BETTER_AUTH_SECRET, // spike used a fixed 40+ character string
  database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  plugins: [
    twoFactor({ issuer: 'Buzzify Studio', backupCodeOptions: { amount: 10 } }),
    nextCookies(), // must be last: it warns when another plugin follows it
  ],
  rateLimit: { enabled: true, storage: 'database' },
});
```

Import paths that exist in 1.7.10: `better-auth`, `better-auth/adapters/prisma`, `better-auth/next-js` (`nextCookies`, `toNextJsHandler`), `better-auth/plugins/two-factor` (prefer this to the `better-auth/plugins` barrel), `better-auth/plugins/admin`, `better-auth/client`, `better-auth/cookies`.

**Tests must not use the singleton `auth` built on `getPrisma()`.** `getPrisma()` reads `DATABASE_URL` and otherwise falls back to the *development* database, and nothing in the Vitest setup puts `DATABASE_URL` into the test workers (only `prisma.config.ts` imports `dotenv`), so a module-level `auth` would silently write to `buzzify`. Export a factory and a singleton, and have tests call the factory with `testPrisma()`:

```ts
export function createAuth(prisma: PrismaClient) { return betterAuth({ /* config above */ }); }
export const auth = createAuth(getPrisma());
```

The Prisma adapter looks up client delegates by model name (`prisma.user`, `prisma.session`, `prisma.account`, `prisma.verification`, `prisma.twoFactor`, `prisma.rateLimit`), so the Prisma model names must stay exactly as generated. At start-up the adapter inspects the generated client's data model and logs `Prisma schema mismatch / Missing tables ...` (or `Missing columns user.isSuperAdmin ...`) when the client was generated before the models or fields were added. Run `prisma generate` after editing the schema.

The Prisma adapter's `transaction` option defaults to `false`, so Better Auth's multi-step writes are not atomic unless you pass `transaction: true`.

## 2. Generated Prisma models (verbatim)

Command (writes a scratch file, never `prisma/schema.prisma`; always pass `--output`, because the default overwrites the project schema):

```bash
npx auth@latest generate --config <config file> --output <scratch>.prisma -y
```

The CLI also prints `generator` and `datasource` blocks at the top of its output. Do not copy those; the repository already has them. Copy only the models. Output for the brief's configuration:

```prisma
model User {
  id               String      @id
  name             String
  email            String
  emailVerified    Boolean     @default(false)
  image            String?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  twoFactorEnabled Boolean?    @default(false)
  sessions         Session[]
  accounts         Account[]
  twofactors       TwoFactor[]

  @@unique([email])
  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([token])
  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}

model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?  @default(true)
  failedVerificationCount Int?      @default(0)
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

model RateLimit {
  id          String @id
  key         String
  count       Int
  lastRequest BigInt

  @@unique([key])
  @@map("rateLimit")
}
```

Notes for Task 7:

- **No existing model collides** with these names (the repository has none called `User`, `Session`, `Account`, `Verification`, `TwoFactor` or `RateLimit`). Tables are mapped to lower-case `user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit`.
- **IDs are generated by Better Auth in the application** (32 random characters). The models have no `@default`, and `User.id` is a plain `String`, so `Membership.userId` can reference it with an ordinary relation.
- Running the generator with the Task 7 configuration (`user.additionalFields` for `isSuperAdmin`, `locale`, `deactivatedAt`, `changeEmail`, `session`, `advanced.cookiePrefix`, `disabledPaths`, two-factor plugin) changes exactly one thing: `User` gains three lines after `twoFactorEnabled`. The other five models are identical.

  ```prisma
    isSuperAdmin     Boolean     @default(false)
    locale           String      @default("en")
    deactivatedAt    DateTime?
  ```

- `TwoFactor.verified` is `false` between `enableTwoFactor` and the first successful `verifyTOTP`; `User.twoFactorEnabled` only flips to `true` at that point.
- `User.email` is unique and Better Auth lower-cases it on write and on lookup, but it does not trim; trim in `normalizeEmail`.
- `RateLimit.lastRequest` is `BigInt`; reading it returns a JavaScript `bigint`.
- Rows created by the 2FA and sign-in flows also use `Verification` (keys `2fa-<id>` and `2fa-attempts-2fa-<id>`), and `Session` rows carry `ipAddress` and `userAgent` as empty strings when no request headers are passed.

## 3. Creating a password user with sign-up disabled

Tested in a scratch Vitest test; this is the mechanism for `createPasswordUser`, invitation acceptance and the seed users.

```ts
const ctx = await auth.$context; // await once; it is memoised
const user = await ctx.internalAdapter.createUser(
  { email, name, emailVerified: true /*, isSuperAdmin: true, locale: 'ckb' with additionalFields */ },
  { method: 'admin' }, // the second argument is REQUIRED by the types
);
await ctx.internalAdapter.linkAccount({
  providerId: 'credential',
  accountId: user.id,
  userId: user.id,
  password: await ctx.password.hash(password),
});
```

What the run showed:

- The user row has `twoFactorEnabled: false`; the `account` row has `providerId: 'credential'`, `accountId` equal to the user id, and a scrypt hash (hex text, `node:crypto` scrypt) in `password`.
- `auth.api.signInEmail({ body: { email, password }, returnHeaders: true })` returns `{ response: { redirect: false, token, url: undefined, user }, headers }`. `headers.getSetCookie()` holds `better-auth.session_token=<token>.<signature>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`. There is no `Domain` attribute, so the cookie is host-only.
- The email lookup is case-insensitive (`'Owner@Example.com'` signs in as `owner@example.com`).
- `ctx.password.hash` does **not** enforce `minPasswordLength`; `ctx.password.config` is `{ minPasswordLength: 12, maxPasswordLength: 128 }`. The sign-up, change/set/reset-password and admin routes enforce it; our direct call does not. `createPasswordUser` must run the password policy (Task 7's `checkPasswordPolicy`) before hashing.
- A duplicate email makes `createUser` throw the raw `PrismaClientKnownRequestError` (`Unique constraint failed on the constraint: user_email_key`, code P2002), not a Better Auth `APIError`. Check `ctx.internalAdapter.findUserByEmail(email)` first (it lower-cases) and catch P2002 for the race, then throw `EmailTakenError`.
- The two calls are not atomic (the adapter's `transaction` option is off). If `linkAccount` fails, call `await ctx.internalAdapter.deleteUser(user.id)` to clean up; verified that it removes the user and its accounts and sessions (relations are `onDelete: Cascade`). Other helpers verified: `findUserByEmail(email, { includeAccounts: true })` returns `{ user, accounts }`; `updatePassword(userId, hash)` replaces the credential hash and the new password signs in.
- Disabling sessions for deactivation: `prisma.session.deleteMany({ where: { userId } })` takes effect immediately for `auth.api.getSession` (cookie cache is off by default).

**Public sign-up is rejected.**

```ts
const res = await auth.handler(new Request('http://localhost:3100/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3100' },
  body: JSON.stringify({ email: 'evil@example.com', password: 'a very long password here', name: 'Evil' }),
}));
// res.status === 400, body { message: 'Email and password sign up is not enabled', code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' }
await auth.api.signUpEmail({ body: { ... } }); // also throws APIError with the same body.code
```

With the Task 7 option `disabledPaths: ['/sign-up/email']` as well, the HTTP answer becomes `404 Not Found` (the route does not exist) while `auth.api.signUpEmail` still throws `EMAIL_PASSWORD_SIGN_UP_DISABLED`. Keep both options: `disabledPaths` only hides the HTTP route, `disableSignUp` protects the server API. Task 7's assertion `status >= 400` covers both.

## 4. Two-factor, server-side

### How headers and cookies work outside Next

- Endpoints that read cookies (`getSession`, `enableTwoFactor`, `verifyTOTP`, `verifyBackupCode`, `disableTwoFactor`) take `headers: Headers` containing a `cookie` header. Pass the `name=value` pairs exactly as received in `Set-Cookie` (the value is signed and URL-encoded; do not decode it).
- Endpoints that set cookies expose them only when called with `returnHeaders: true`, which changes the return type to `{ headers: Headers, response }`. Read cookies with `headers.getSetCookie()` (a `string[]`). `asResponse: true` returns a `Response` instead (not exercised).
- `nextCookies()` is harmless outside Next: its after-hook tries `import('next/headers.js')` and silently returns when there is no request scope. Inside a Server Action it additionally copies `Set-Cookie` into `cookies().set(...)`, so `returnHeaders` is not needed there, but `headers: await headers()` must still be passed to every call that reads a cookie (`cookies()` can only be written from a Server Function or Route Handler; Server Components cannot set cookies, per `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`). The in-Next behaviour was read from source and the Next docs, not exercised here.
- Some responses clear a cookie (`Max-Age=0`) and set another in the same call; the test jar must drop cleared cookies.

Test helpers that worked (suggested home: `tests/helpers/auth.ts`):

```ts
import { createHmac } from 'node:crypto';

/** Set-Cookie lines -> request Cookie header, accumulating into a jar; drops cleared cookies. */
export function cookieHeader(setCookies: string[], jar: Map<string, string> = new Map()): Headers {
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === '' || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') });
}

/** RFC 4648 base32 -> bytes */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from an otpauth:// URI, as an authenticator app would. */
export function totpFromUri(uri: string, atMs = Date.now()): string {
  const secret = base32Decode(new URL(uri).searchParams.get('secret')!);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac('sha1', secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}
```

Better Auth's own verifier accepts a window of one 30-second step either side. There is no replay protection: the same code verifies twice inside its window, so a test can reuse the enrolment code to sign in.

### The verified flow

```ts
const jar = new Map<string, string>();

// 1. Sign in (no 2FA yet) and keep the session cookie.
const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
const sessionHeaders = cookieHeader(signIn.headers.getSetCookie(), jar);

// 2. Enable. Requires a session AND the password. Returns a UNION: narrow on method.
const enabled = await auth.api.enableTwoFactor({ body: { password }, headers: sessionHeaders });
if (enabled.method !== 'totp') throw new Error('unexpected');
enabled.totpURI;     // otpauth://totp/Buzzify%20Studio:owner%40example.com?secret=<base32>&issuer=Buzzify+Studio&digits=6&period=30
enabled.backupCodes; // 10 strings shaped like 'siyEQ-7xPeA'

// 3. Complete enrolment with a code from the authenticator. Rotates the session.
const verified = await auth.api.verifyTOTP({
  body: { code: totpFromUri(enabled.totpURI) },
  headers: sessionHeaders,
  returnHeaders: true,
});
const newSessionHeaders = cookieHeader(verified.headers.getSetCookie(), jar); // use THIS from now on

// 4. Later sign-in: password step returns a redirect marker and a two_factor cookie, not a session.
const again = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
again.response; // { twoFactorRedirect: true, twoFactorMethods: ['totp'] }
const challengeHeaders = cookieHeader(again.headers.getSetCookie(), new Map());

// 5. Finish with a TOTP code or a backup code, passing the challenge cookie.
const done = await auth.api.verifyTOTP({ body: { code }, headers: challengeHeaders, returnHeaders: true });
// or: auth.api.verifyBackupCode({ body: { code: backupCodes[3] }, headers: challengeHeaders, returnHeaders: true })
const finalHeaders = cookieHeader(done.headers.getSetCookie(), jar);
const session = await auth.api.getSession({ headers: finalHeaders }); // { session, user } or null
```

Observed state transitions:

| Moment | `user.twoFactorEnabled` | `twoFactor.verified` | Notes |
| --- | --- | --- | --- |
| after `enableTwoFactor` | `false` | `false` | `signInEmail` still returns a normal session; 2FA is not enforced yet |
| after `verifyTOTP` (enrolment) | `true` | `true` | old session cookie now resolves to `null`; a new one is in the response headers |
| later `signInEmail` | `true` | `true` | response is `{ twoFactorRedirect: true, twoFactorMethods: ['totp'] }` |

The 2FA sign-in response sets exactly these cookies (default prefix; times and values vary):

```
better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
better-auth.two_factor=2fa-<id>.<signature>; Max-Age=600; Path=/; HttpOnly; SameSite=Lax
```

With the Task 7 option `advanced.cookiePrefix: 'studio'` the names become `studio.session_token`, `studio.two_factor`, and so on (verified). `session: { expiresIn: 2592000, updateAge: 86400 }` produced `Max-Age=2592000` and a session whose `expiresAt` is exactly 30.00 days out; the default without it is 7 days (`Max-Age=604800`), so the 30-day rule needs the option.

### Surprises and behaviours to design around

- **`enableTwoFactor` returns a union** (`{ method: 'otp' } | { method: 'totp', totpURI, backupCodes }`). The type checker rejects `.totpURI` until you narrow on `method === 'totp'`.
- **`verifyTOTP` during enrolment rotates the session.** The cookie used for the call is dead afterwards (`getSession` returns `null`); take the new cookie from `returnHeaders`. The `user` in that same response still shows `twoFactorEnabled: false` (stale); re-read the user to see `true`.
- **`enableTwoFactor` and `getTOTPURI` use `sessionMiddleware`; `disableTwoFactor` uses `sensitiveSessionMiddleware`**. Calling without a session throws 401 `UNAUTHORIZED`. A wrong password throws 400 `INVALID_PASSWORD`. Calling again after enrolment throws 400 `TOTP_ALREADY_ENABLED`; to re-enrol, `disableTwoFactor({ body: { password }, headers })` first (returns `{ status: true }`; the next sign-in has no `twoFactorRedirect`).
- **Calling `enableTwoFactor` again before verifying** is allowed and replaces the secret and backup codes on the existing unverified row (from source, not exercised).
- **A sign-in with 2FA removes the session the credential step created** and issues only the challenge cookie. The challenge cookie lives 600 seconds (`twoFactorCookieMaxAge`). `verifyTOTP` without that cookie throws 401 `INVALID_TWO_FACTOR_COOKIE`.
- **Brute-force limits (from source, not exercised):** at most 5 attempts per challenge, then the challenge is destroyed; the account locks for 900 seconds after 10 consecutive failures (`twoFactor({ accountLockout })` can tune this); both counters are separate from the HTTP rate limiter.
- **Backup codes** are single use (`verifyBackupCode` with a used code throws 401 `INVALID_BACKUP_CODE`), are stored encrypted as a JSON array, and have the shape `xxxxx-xxxxx`.
- **Error shape.** Everything throws `APIError` with `.name`, `.status` (string such as `'UNAUTHORIZED'`), `.statusCode` (number) and `.body = { message, code }`. Codes observed:

  | Call | Status | `body.code` |
  | --- | --- | --- |
  | `signInEmail`, wrong password or unknown email (same answer for both) | 401 | `INVALID_EMAIL_OR_PASSWORD` |
  | `signUpEmail` | 400 | `EMAIL_PASSWORD_SIGN_UP_DISABLED` |
  | `enableTwoFactor`, no session | 401 | `UNAUTHORIZED` |
  | `enableTwoFactor`, wrong password | 400 | `INVALID_PASSWORD` |
  | `enableTwoFactor`, already enabled | 400 | `TOTP_ALREADY_ENABLED` |
  | `verifyTOTP`, wrong code | 401 | `INVALID_CODE` |
  | `verifyTOTP`, no challenge cookie | 401 | `INVALID_TWO_FACTOR_COOKIE` |
  | `verifyBackupCode`, wrong or used code | 401 | `INVALID_BACKUP_CODE` |

  Failed password attempts also log `WARN [Better Auth]: Invalid password` to the console; that is expected noise in tests.

## 5. Better Auth's database rate limiter

- `rateLimit: { enabled: true, storage: 'database' }` writes to the `rateLimit` table, key `<ip>|<path>` (for example `198.51.100.7|/sign-in/email`). Five wrong-password POSTs to `/api/auth/sign-in/email` through `auth.handler` returned `401, 401, 401, 429, 429`: the default rule for `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` is 3 requests per 10 seconds, `/request-password-reset` and `/send-verification-email` are 3 per 60 seconds, and the two-factor plugin adds 3 per 10 seconds for `/two-factor/*`.
- **It applies only to requests that go through `auth.handler` (HTTP).** Six wrong-password calls to `auth.api.signInEmail` all returned 401 and none was limited. This matches plan refinement 11: Server Actions need the Studio's own Postgres limiter.
- It needs a client IP. The test passed `x-forwarded-for`. Without a resolvable IP, all clients share one `no-trusted-ip|<path>` bucket per path (it logs a warning once), which is a self-inflicted lockout for the whole sign-in page under `next dev` or behind an unconfigured proxy. Set `advanced.ipAddress.ipAddressHeaders` or `trustedProxies` in deployment.
- Expired rows are pruned lazily when a window rolls over.

## 6. pg_trgm and Prisma 7 migrations

### Extension and index

- The embedded server ships `pg_trgm` 1.6 (`pg_available_extensions`); `CREATE EXTENSION IF NOT EXISTS pg_trgm` succeeds. It is a *trusted* extension, so it does not need a superuser on a managed host such as Neon.
- Prisma accepts `@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)` with no preview feature. The generated SQL is:

  ```sql
  CREATE INDEX "Restaurant_name_idx" ON "Restaurant" USING GIN ("name" gin_trgm_ops);
  ```

- **Prisma does not emit `CREATE EXTENSION`.** Applying that file as generated fails on the shadow database with `P3006` / `P3018`, database error `42704: operator class "gin_trgm_ops" does not exist for access method "gin"`. Prepend the line by hand to the migration before applying:

  ```sql
  -- pg_trgm is a contrib extension; Prisma does not emit CREATE EXTENSION itself.
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  -- CreateIndex
  CREATE INDEX "Restaurant_name_idx" ON "Restaurant" USING GIN ("name" gin_trgm_ops);
  ```

  This matches the plan's Task 1 step 4 ("add the `pg_trgm` extension line").

### Drift, run twice

Run in a temp workspace (copy of the schema and of the three real migrations, own `prisma.config.ts`, scratch database; `prisma migrate dev --config <temp config>`):

1. `migrate dev --create-only --name trgm_restaurant_name` with the index added produced the migration above.
2. After the manual `CREATE EXTENSION` edit, `migrate dev` applied it and reported "Your database is now in sync with your schema."
3. A second `migrate dev --create-only` produced `-- This is an empty migration.` That is the no-drift result: Prisma replayed all migrations on the shadow database, compared with the schema and found nothing to add (a drifted schema would have produced non-empty SQL).
4. A stricter check agreed: `prisma migrate diff --from-migrations migrations --to-schema schema.prisma --exit-code` and `--from-config-datasource` (live database) against the schema both printed "No difference detected" and exited 0. The diff against migrations needs `datasource.shadowDatabaseUrl` in the config.

**Result: no drift.** Operational notes from this experiment:

- `migrate dev --create-only` **always writes a migration folder**, empty when nothing changed, and it **prompts for a name when `--name` is omitted**. In a non-interactive shell the prompt hangs forever, so always pass `--name` and redirect stdin (`< /dev/null`), and delete empty migration folders. Plain `migrate dev` (without `--create-only`) prints "Already in sync, no schema change or pending migration was found." when there is nothing to do (verified on the final state).
- `prisma db push` does not run `generate` in Prisma 7; run `prisma generate` after it.

### Does the index work for the product's languages?

- Latin text: yes. With 101,002 rows, `WHERE name ILIKE '%mazo%'` used a Bitmap Index Scan on the GIN index (0.7 ms). `contains` with `mode: 'insensitive'` in Prisma generates `ILIKE`, so it benefits.
- **Arabic and Sorani: no, on the local database.** The embedded cluster and every database created on it use `datcollate = datctype = C` (`scripts/db.ts` runs `initdb` with `--locale=C` and creates databases with `ENCODING 'UTF8' TEMPLATE template0`). In the `C` locale `pg_trgm` treats non-ASCII characters as separators, so `show_trgm('مطعم مازو')` is `{}`, `similarity('مطعم مازو', 'مازو')` is `0`, the `%` operator never matches, and `ILIKE '%مازو%'` cannot use the index (101,002 rows: sequential scan, 25 ms). `ILIKE '%مازو%'` itself returns the right row; only acceleration and fuzzy matching are lost.
- `C` locale also makes `lower()` and `ILIKE` ASCII-only: `'CAFÉ' ILIKE '%é%'` is `false`, `lower('ÉCOLE')` is `École`. Arabic has no case, so Arabic is unaffected.
- Alternatives tried on scratch databases: `LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'` fixes accent case-folding but `pg_trgm` still yields no Arabic trigrams; `LOCALE_PROVIDER libc LOCALE 'en-US'` (a Windows locale name) makes `pg_trgm` work for Arabic and Sorani (`similarity` 0.56). Neither is adopted: the second is not portable (`en_US.UTF-8` on Linux, absent in CI images), and `tests/helpers/global-setup.ts` and `scripts/db.ts` create databases without any locale option. Whether Neon's default locale tokenises Arabic for `pg_trgm` was not verifiable here.
- Scale: 1,001 rows, `ILIKE '%mazo%'` and `ILIKE '%مازو%'` both used a sequential scan at 0.26 ms execution. The plan's 1,000-menu list and 300 ms budget do not need an index for search.

### Fallback (recommended for 2a)

- Do not add a trigram index for the All Menus and Restaurants search. Use plain B-tree indexes for what is actually sorted and filtered (`status`, `createdAt`, foreign keys, unique `slug`) and `ILIKE '%q%'` (Prisma `contains`, `mode: 'insensitive'`) for the text box. Arabic-script search ("مازو" finds "مطعم مازو") is correct without any index.
- If Latin accent insensitivity matters ("cafe" finds "Café"), fold in the application or store a folded `searchText` column; the database cannot do it in the `C` locale. That belongs to Task 13.
- If the trigram line stays in Task 1's migration for Latin-script scaling, it is safe (no drift, proven above) but gives nothing for `ar` and `ckb` names locally.

## 7. Recommendations carried into later tasks

1. **Task 7:** build `createAuth(prisma)` plus a lazy singleton; tests use `createAuth(testPrisma())`. Keep both `disableSignUp: true` and `disabledPaths`. Keep `useSecureCookies` off outside production (the default over `http://` already is) and add `session.expiresIn = 2592000`. Pass `{ method: 'admin' }` as the second argument of `createUser`. Validate the password policy before `ctx.password.hash`. Check for an existing email before `createUser` and map P2002 to `EmailTakenError`. Delete the user if `linkAccount` fails. Add the generated models plus the three `User` fields, then run `prisma generate`.
2. **Tasks 9 and 10 (Server Actions):** pass `headers: await headers()` into every call that reads a cookie; rely on `nextCookies()` (last in `plugins`) to write cookies; call `verifyTOTP`/`verifyBackupCode` from a second action that has the challenge cookie; after `verifyTOTP` during enrolment, expect the session cookie to change.
3. **Tests for 2FA:** use `cookieHeader` and `totpFromUri` above; no mocking of time or of Better Auth is needed.
4. **Task 1 step 4 and Task 13:** the `pg_trgm` migration line is safe, but do not assume trigram search for `ar`/`ckb`. Use `ILIKE` and verify the Arabic search case from the plan's Review Focus item 5 against plain `contains`.
5. **Migration hygiene:** always `--name`, redirect stdin, and delete empty `--create-only` output.
