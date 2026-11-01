import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEmail } from '@/server/email/templates';
import { ensureIdentity } from '@/server/retail/identities';
import { loadActor } from '@/server/studio/auth/actor';
import { authFor } from '@/server/studio/auth/auth';
import { acceptInvitation, createInvitation } from '@/server/studio/services/invitations';
import { getStudioTranslator } from '@/studio/messages';
import { isRetailOnly, visibleNav } from '@/studio/nav';
import { RetailOnlyNotice } from '@/studio/shell/RetailOnlyNotice';
import { devMail, linkParam } from '../helpers/mail';
import { GOOD, person, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { mac } from './contract-oracle';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * `POST /api/retail/v1/identities`: Retails asks for the Studio account of a staff email. An unknown address gets one
 * identity-only account and a set-password mail; a known one is answered and never changed. Review focus 7.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const CALLER = 'the-caller-secret-shared-with-retails';
const PATH = '/api/retail/v1/identities';
const IP = '203.0.113.9';
const { address, mailTo, nextTest, quiet, clean } = devMail();

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', 'the-handoff-secret-shared-with-retails');
}

async function identify(payload: unknown, ip = IP): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const { POST } = await import('@/app/api/retail/v1/identities/route');
  return POST(
    new Request(`https://studio.example.test${PATH}`, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-bz-timestamp': timestamp,
        'x-bz-signature': mac('POST', PATH, timestamp, body, CALLER),
        'x-forwarded-for': ip,
      },
    }),
  );
}

const userRow = (email: string) => prisma().user.findUnique({ where: { email: email.trim().toLowerCase() } });

/** Mutes Better Auth's warnings and the dev mailer's lines. */
function silence() {
  for (const level of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await quiet();
  await clean();
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  nextTest();
  await resetWorld();
  enableRetail();
  silence();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.stubEnv('RETAIL_URL', '');
  await clean();
});

describe('POST /api/retail/v1/identities', () => {
  it('an unknown email creates exactly one identity-only account and answers created, not verified', async () => {
    const email = address('new');
    const response = await identify({ email, name: '  Rania Staff  ' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const answer = await response.json();
    const user = await userRow(email);
    expect(answer).toEqual({ coreUserId: user?.id, created: true, emailVerified: false });
    expect(user).toMatchObject({ email, name: 'Rania Staff', emailVerified: false, identityOnly: true, locale: 'en', isSuperAdmin: false, deactivatedAt: null });
    // No password travels and none is set: the person chooses one from the mail.
    expect(await prisma().account.count({ where: { userId: user!.id } })).toBe(0);
    expect(await prisma().membership.count()).toBe(0);
    expect(await prisma().user.count()).toBe(1);
  });

  it("without a name the account is called by the email's local part", async () => {
    const email = address('nameless');
    await identify({ email });
    expect((await userRow(email))?.name).toBe(email.slice(0, email.indexOf('@')));
    const blank = address('blank');
    await identify({ email: blank, name: '   ' });
    expect((await userRow(blank))?.name).toBe(blank.slice(0, blank.indexOf('@')));
  });

  it('case and whitespace variants map to the one account', async () => {
    const email = address('variant');
    const first = await (await identify({ email })).json();
    const again = await (await identify({ email: `  ${email.toUpperCase()}  ` })).json();
    expect(again).toEqual({ coreUserId: first.coreUserId, created: false, emailVerified: false });
    expect(await prisma().user.count()).toBe(1);
  });

  it('concurrent calls race to one account and one mail', async () => {
    const email = address('race');
    const variants = [email, email.toUpperCase(), ` ${email}`, `${email} `, email];
    const answers = await Promise.all(variants.map(async (variant) => (await identify({ email: variant })).json()));
    expect(await prisma().user.count()).toBe(1);
    const { id } = (await userRow(email))!;
    expect(answers.every((a) => a.coreUserId === id && a.emailVerified === false)).toBe(true);
    expect(answers.filter((a) => a.created)).toHaveLength(1);
    await mailTo(email, 1);
    await quiet();
    expect(await mailTo(email, 1)).toHaveLength(1);
  });

  it('sends one set-password mail after the response, and the answer never carries its link', async () => {
    const email = address('mail');
    const response = await identify({ email, name: 'Mail Person' });
    const text = await response.text();
    const [mail] = await mailTo(email);
    expect(mail?.subject).toBe(renderEmail('retailIdentity', 'en', { name: 'Mail Person', url: 'https://x.test' }).subject);
    expect(mail?.subject).toBe('Set your password to sign in to Buzzify Retail');
    const token = linkParam(mail?.text ?? '', 'token');
    expect(token).toBeTruthy();
    expect(text).not.toContain(token);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['coreUserId', 'created', 'emailVerified']);
    // A retry soon after (the owner adds the person again) sends no second mail: the first link is still fresh.
    await identify({ email });
    await quiet();
    expect(await mailTo(email, 1)).toHaveLength(1);
  });

  it('an identity-only account that never set a password gets the set-password mail again on a later call', async () => {
    const email = address('resend');
    const { coreUserId } = await (await identify({ email })).json();
    await mailTo(email, 1);
    // Ten minutes on, the first link is likely lost: the owner's retried add sends a new one.
    await prisma().authRateLimit.update({ where: { key: `retail-identity:mail:${coreUserId}` }, data: { windowStart: new Date(Date.now() - 11 * 60_000) } });
    const again = await identify({ email });
    expect(await again.json()).toEqual({ coreUserId, created: false, emailVerified: false });
    const mails = await mailTo(email, 2);
    expect(mails.every((m) => m.subject === 'Set your password to sign in to Buzzify Retail')).toBe(true);
    // Still bounded by the per-email limit: the sixth call of the hour is refused and mails nothing.
    await prisma().authRateLimit.update({ where: { key: `retail-identity:email:${email}` }, data: { count: 5 } });
    expect((await identify({ email })).status).toBe(429);
    await quiet();
    expect(await mailTo(email, 2)).toHaveLength(2);
  });

  it('an existing account with a password, or one that is not identity-only, gets no mail', async () => {
    // Identity-only, but the password is set (it has a credential): nothing to send.
    const claimed = address('claimed');
    const { coreUserId } = await ensureIdentity(prisma(), { email: claimed }, new Date());
    const token = linkParam((await mailTo(claimed))[0]?.text ?? '', 'token');
    await authFor(prisma()).api.resetPassword({ body: { token, newPassword: GOOD } });
    await mailTo(claimed, 2); // the set-password mail and "your password was changed"
    await prisma().authRateLimit.deleteMany({ where: { key: `retail-identity:mail:${coreUserId}` } });
    await identify({ email: claimed });
    // An ordinary account without a credential (made some other way) is not Retail's to mail either.
    const ordinary = await person('no-credential');
    await prisma().account.deleteMany({ where: { userId: ordinary.userId } });
    await identify({ email: ordinary.email });
    await quiet();
    expect(await mailTo(claimed, 2)).toHaveLength(2);
    expect(await prisma().verification.count({ where: { value: ordinary.userId } })).toBe(0);
  });

  it('a known verified email answers created false, emailVerified true, and changes nothing', async () => {
    const known = await person('known');
    const before = await userRow(known.email);
    const answer = await (await identify({ email: known.email.toUpperCase(), name: 'Someone Else' })).json();
    expect(answer).toEqual({ coreUserId: known.userId, created: false, emailVerified: true });
    expect(await userRow(known.email)).toEqual(before);
    await quiet();
    expect(await prisma().verification.count()).toBe(0);
  });

  it("a Super Admin's email answers emailVerified true and creates nothing", async () => {
    const admin = await person('admin', { superAdmin: true });
    const before = await userRow(admin.email);
    const answer = await (await identify({ email: admin.email, name: 'Renamed' })).json();
    expect(answer).toEqual({ coreUserId: admin.userId, created: false, emailVerified: true });
    expect(await userRow(admin.email)).toEqual(before);
    expect(await prisma().user.count()).toBe(1);
  });

  it('a deactivated user answers emailVerified false', async () => {
    const gone = await person('gone', { deactivated: true });
    expect(await (await identify({ email: gone.email })).json()).toEqual({ coreUserId: gone.userId, created: false, emailVerified: false });
  });

  it('an existing unverified account answers emailVerified false', async () => {
    const unverified = await person('unverified');
    await prisma().user.update({ where: { id: unverified.userId }, data: { emailVerified: false } });
    expect(await (await identify({ email: unverified.email })).json()).toEqual({ coreUserId: unverified.userId, created: false, emailVerified: false });
  });

  it('an invalid body answers 400 and writes nothing', async () => {
    for (const payload of [{}, { email: 'not-an-email' }, { email: `${'a'.repeat(250)}@x.test` }, { email: address('long'), name: 7 }, [], 'text']) {
      const response = await identify(payload);
      expect(response.status, JSON.stringify(payload).slice(0, 40)).toBe(400);
      expect(await response.json()).toEqual({ code: 'INVALID_INPUT' });
    }
    expect(await prisma().user.count()).toBe(0);
  });

  it('a name longer than 120 characters is cut to 120, not refused', async () => {
    const email = address('longname');
    const response = await identify({ email, name: `  ${'n'.repeat(119)} ${'x'.repeat(200)}` });
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(true);
    const user = await userRow(email);
    expect(user?.name).toBe('n'.repeat(119));
  });

  it('per-address limit answers 429 before any write', async () => {
    await prisma().authRateLimit.create({ data: { key: `retail-identity:ip:${IP}`, windowStart: new Date(), count: 600 } });
    const response = await identify({ email: address('limited-ip') });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'RATE_LIMITED' });
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await prisma().user.count()).toBe(0);
    // Another address may still ask.
    expect((await identify({ email: address('limited-ip') }, '203.0.113.10')).status).toBe(200);
  });

  it('per-email limit answers 429 before any write, whatever the letter case', async () => {
    const email = address('limited-email');
    await prisma().authRateLimit.create({ data: { key: `retail-identity:email:${email}`, windowStart: new Date(), count: 5 } });
    const response = await identify({ email: ` ${email.toUpperCase()}` }, '203.0.113.11');
    expect(response.status).toBe(429);
    expect(await prisma().user.count()).toBe(0);
    expect((await identify({ email: address('other-email') }, '203.0.113.11')).status).toBe(200);
  });

  it('a batch of 50 new emails from one address all succeed', async () => {
    // Retails adds staff from one egress address, up to 50 at once; its ai-config polls share the per-address budget.
    for (let i = 0; i < 50; i += 1) expect((await identify({ email: address(`batch-${i}`) })).status, `call ${i}`).toBe(200);
    expect(await prisma().user.count()).toBe(50);
  });

  it('five calls an hour per email pass and the sixth is refused', async () => {
    const email = address('five');
    for (let i = 0; i < 5; i += 1) expect((await identify({ email }, `203.0.113.${20 + i}`)).status).toBe(200);
    expect((await identify({ email }, '203.0.113.30')).status).toBe(429);
  });
});

describe('what an identity-only account is in the Studio', () => {
  it('an identity-only account sees the Retail page, not the working areas', async () => {
    const { coreUserId } = await ensureIdentity(prisma(), { email: address('page') }, new Date());
    const actor = (await loadActor(prisma(), coreUserId))!;
    expect(actor.identityOnly).toBe(true);
    expect(isRetailOnly(actor)).toBe(true);
    expect(visibleNav(actor)).toEqual([]);
    const html = renderToStaticMarkup(RetailOnlyNotice({ t: getStudioTranslator('en'), retailUrl: 'https://retail.test' }));
    expect(html).toContain('This account is for Buzzify Retail');
    expect(html).toContain('href="https://retail.test"');
    // Without the link configured the page still says what the account is, with no link.
    expect(renderToStaticMarkup(RetailOnlyNotice({ t: getStudioTranslator('ar'), retailUrl: null }))).not.toContain('href=');

    // An ordinary account (and a Super Admin) is not.
    const ordinary = (await loadActor(prisma(), (await person('ordinary')).userId))!;
    expect(ordinary.identityOnly).toBeUndefined();
    expect(isRetailOnly(ordinary)).toBe(false);
    expect(visibleNav(ordinary).length).toBeGreaterThan(0);
  });

  it('resetting the password marks the email verified', async () => {
    const email = address('reset');
    const { coreUserId } = await ensureIdentity(prisma(), { email, name: 'Reset Person' }, new Date());
    const token = linkParam((await mailTo(email))[0]?.text ?? '', 'token');
    await authFor(prisma()).api.resetPassword({ body: { token, newPassword: GOOD } });
    const user = await prisma().user.findUniqueOrThrow({ where: { id: coreUserId } });
    expect(user.emailVerified).toBe(true);
    // Better Auth 1.7.10 makes the credential the account did not have.
    const credential = await prisma().account.findFirst({ where: { userId: coreUserId, providerId: 'credential' } });
    expect(credential?.password).toBeTruthy();
    expect(await (await identify({ email })).json()).toEqual({ coreUserId, created: false, emailVerified: true });
    // A reset asked for later is the ordinary reset mail: the password is already set.
    await authFor(prisma()).api.requestPasswordReset({ body: { email } });
    const mails = await mailTo(email, 3);
    expect(mails.map((m) => m.subject)).toContain(renderEmail('reset', 'en', { url: 'https://x.test' }).subject);
  });

  it('accepting a Studio invitation clears identityOnly', async () => {
    const admin = await person('inviter', { superAdmin: true });
    const cafe = await pharmacy('Cafe', { sector: 'FOOD', subscription: 'none' });
    const email = address('invited');
    const { coreUserId } = await ensureIdentity(prisma(), { email }, new Date());
    const { url } = await createInvitation(prisma(), {
      email, restaurantId: cafe.id, role: 'DESIGNER', asSuperAdmin: false, invitedById: admin.userId, now: new Date(),
    });
    await acceptInvitation(prisma(), { token: url.slice(url.lastIndexOf('/') + 1), signedInUserId: coreUserId, now: new Date() });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: coreUserId } })).identityOnly).toBe(false);
    const actor = (await loadActor(prisma(), coreUserId))!;
    expect(isRetailOnly(actor)).toBe(false);
  });
});
