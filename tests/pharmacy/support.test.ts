import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SupportBanner } from '@/app/pharmacy/_ui/SupportBanner';
import { formatStamp } from '@/lib/pos-format';
import { PH_PERMISSIONS } from '@/server/domain/pharmacy/permissions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import * as supportAccess from '@/server/studio/actions/support-access';
import { defineAction, runAction, type ActionDef } from '@/server/studio/framework/action';
import { defineQuery, runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as supportQueries from '@/server/studio/queries/support-access';
import { asPh, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.11', userAgent: 'vitest' };
const HOUR = 3_600_000;

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person | Actor, def: ActionDef<I, O>, input: unknown) =>
  runAction(prisma(), 'isSuperAdmin' in who ? who : await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person | Actor, def: QueryDef<I, O>, input: unknown) =>
  runQuery(prisma(), 'isSuperAdmin' in who ? who : await actorOf(who), def, input);

const branchInput = z.object({ restaurantId: z.string(), branchId: z.string().optional() });
const phTarget = (input: { restaurantId: string; branchId?: string }) => ({ kind: 'ph' as const, restaurantId: input?.restaurantId, branchId: input?.branchId });

/** A catalog read that knows nothing about support: it never audits anything itself. */
const peek = defineQuery({
  name: 'test.ph.peek',
  permission: null,
  ph: 'catalog.view',
  input: branchInput,
  target: phTarget,
  async run(ctx) {
    return { restaurantId: ctx.restaurantId, secret: 'price-list-4711' };
  },
});

const goodGrant = (email: string) => ({
  granteeEmail: email,
  scopes: ['catalog.read'],
  reason: 'Ticket 4521: prices look wrong',
  hours: 2,
  sensitiveConfirmed: false,
});

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

const auditOf = (action: string) => prisma().auditLog.findMany({ where: { action }, orderBy: { occurredAt: 'asc' } });

describe('support access grants', () => {
  it('the owner creates a 2-hour catalog.read grant for a named Super Admin', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });

    const result = await act(owner, supportAccess.grant, { ...goodGrant('  ADMIN@ph-test.example '), restaurantId: a.id });
    expect(codeOf(result)).toBe('OK');
    const rows = await prisma().supportAccessGrant.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      restaurantId: a.id,
      granteeUserId: admin.userId,
      scopes: ['catalog.read'],
      reason: 'Ticket 4521: prices look wrong',
      approvedByUserId: owner.userId,
      consentRef: null,
      startsAt: NOW,
      expiresAt: new Date(NOW.getTime() + 2 * HOUR),
      revokedAt: null,
    });
    const [audit] = await auditOf('support.grant');
    expect(audit).toMatchObject({ restaurantId: a.id, actorId: owner.userId, entityType: 'SupportAccessGrant', entityId: rows[0]!.id });

    // The owner sees it in their list, with who holds it and whether it is live.
    const listed = await ask(owner, supportQueries.listGrants, { restaurantId: a.id });
    expect(listed).toMatchObject({
      ok: true,
      data: [{ id: rows[0]!.id, granteeName: 'admin person', granteeEmail: 'admin@ph-test.example', status: 'active', scopes: ['catalog.read'] }],
    });

    // Only a Super Admin can be named: anyone else (or nobody) is refused on the field, and nothing is written.
    await person('clerk');
    for (const email of ['clerk@ph-test.example', 'nobody@ph-test.example']) {
      const refused = await act(owner, supportAccess.grant, { ...goodGrant(email), restaurantId: a.id });
      expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { granteeEmail: expect.any(String) } } });
    }
    // Longer than 72 hours is refused by the grant rules.
    expect(codeOf(await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id, hours: 73 }))).toBe('INVALID');
    expect(await prisma().supportAccessGrant.count()).toBe(1);
  });

  it('a branch manager cannot create a grant', async () => {
    const a = await pharmacy('A');
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchId]] });
    const admin = await person('admin', { superAdmin: true });

    expect(codeOf(await act(manager, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(manager, supportQueries.listGrants, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(await prisma().supportAccessGrant.count()).toBe(0);
  });

  it('a grant for rx.read without sensitiveConfirmed is refused', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });

    const refused = await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id, scopes: ['catalog.read', 'rx.read'] });
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { sensitiveConfirmed: expect.any(String) } } });
    expect(await prisma().supportAccessGrant.count()).toBe(0);

    const confirmed = await act(owner, supportAccess.grant, {
      ...goodGrant(admin.email),
      restaurantId: a.id,
      scopes: ['catalog.read', 'rx.read'],
      sensitiveConfirmed: true,
    });
    expect(codeOf(confirmed)).toBe('OK');
    expect(await prisma().supportAccessGrant.count()).toBe(1);
  });

  it('the grantee gets an actor for that pharmacy only', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    expect(codeOf(await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id }))).toBe('OK');

    const inA = await asPh(admin.userId, a.id);
    expect(inA).toMatchObject({ restaurantId: a.id, role: null, support: { scopes: new Set(['catalog.read']) } });
    expect(await asPh(admin.userId, b.id)).toBeNull();
    expect(await ask(admin, peek, { restaurantId: a.id })).toMatchObject({ ok: true, data: { restaurantId: a.id } });

    // Another Super Admin, named in no grant, has no pharmacy at all.
    const other = await person('other', { superAdmin: true });
    expect(await asPh(other.userId, a.id)).toBeNull();
    expect(codeOf(await ask(other, peek, { restaurantId: a.id }))).toBe('FORBIDDEN');
  });

  it('with grants in two pharmacies, each target is read under its own grant', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const admin = await person('admin', { superAdmin: true });
    const inA = await grant(admin, a.id, { scopes: ['catalog.read'] });
    const inB = await grant(admin, b.id, { scopes: ['stock.read'] });

    expect(await ask(admin, peek, { restaurantId: a.id })).toMatchObject({ ok: true, data: { restaurantId: a.id } });
    // B's grant lacks catalog.read: A's grant does not lend it.
    expect(codeOf(await ask(admin, peek, { restaurantId: b.id }))).toBe('FORBIDDEN');
    expect(await auditOf('support.read')).toMatchObject([{ restaurantId: a.id, entityId: inA.id }]);
    expect(inB.restaurantId).toBe(b.id);
  });

  it('the grant stops working at expiresAt even mid-session (checked on every request, not cached)', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    expect(codeOf(await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id }))).toBe('OK');

    // One signed-in session: the same Actor object for every request.
    const session = await actorOf(admin);
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('OK');
    vi.setSystemTime(new Date(NOW.getTime() + 2 * HOUR - 1));
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('OK');
    vi.setSystemTime(new Date(NOW.getTime() + 2 * HOUR));
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('FORBIDDEN');
    // The owner's list says so too.
    expect(await ask(owner, supportQueries.listGrants, { restaurantId: a.id })).toMatchObject({ ok: true, data: [{ status: 'expired' }] });
  });

  it('revoking takes effect on the very next request', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const created = await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id });
    if (!created.ok) throw new Error('grant failed');
    const session = await actorOf(admin);
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('OK');

    expect(codeOf(await act(owner, supportAccess.revoke, { restaurantId: a.id, grantId: created.data.id }))).toBe('OK');
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(await prisma().supportAccessGrant.findUniqueOrThrow({ where: { id: created.data.id } })).toMatchObject({ revokedAt: NOW });
    expect(await auditOf('support.revoke')).toMatchObject([{ restaurantId: a.id, actorId: owner.userId, entityId: created.data.id }]);
    expect(await ask(owner, supportQueries.listGrants, { restaurantId: a.id })).toMatchObject({ ok: true, data: [{ status: 'revoked' }] });
  });

  it('the owner can revoke a grant while the pharmacy is read-only', async () => {
    // Lapsed 3 days ago (period ended 10 days ago, 7 days of grace): read-only for the retention window.
    const a = await pharmacy('A', { subscription: 'EXPIRED', periodEndsInDays: -10 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const g = await grant(admin, a.id, { scopes: ['catalog.read'] });
    const session = await actorOf(admin);
    // Support reads keep working in read-only, so revoking must too.
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('OK');

    expect(codeOf(await act(owner, supportAccess.revoke, { restaurantId: a.id, grantId: g.id }))).toBe('OK');
    expect(codeOf(await ask(session, peek, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(await prisma().supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ revokedAt: NOW });
    // Creating a grant is still a write a read-only pharmacy refuses.
    expect(codeOf(await act(owner, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id }))).toBe('FORBIDDEN');
  });

  it('a closed (archived) pharmacy refuses the revoke, and every support read too', async () => {
    // Lapsed long past the 90-day window: closed. Nothing runs there, so an unrevoked grant reads nothing either.
    const a = await pharmacy('A', { subscription: 'EXPIRED', periodEndsInDays: -200 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const g = await grant(admin, a.id, { scopes: ['catalog.read'] });
    expect(codeOf(await act(owner, supportAccess.revoke, { restaurantId: a.id, grantId: g.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(await actorOf(admin), peek, { restaurantId: a.id }))).toBe('FORBIDDEN');
  });

  it('a grant issued for pharmacy A is refused on pharmacy B', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const ownerA = await person('ownerA', { membership: [a.id, 'OWNER'] });
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const created = await act(ownerA, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id });
    if (!created.ok) throw new Error('grant failed');

    // B's actor cannot be built from A's grant, and a branch of B is refused.
    expect(await asPh(admin.userId, b.id)).toBeNull();
    expect(codeOf(await ask(admin, peek, { restaurantId: b.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, peek, { restaurantId: b.id, branchId: b.branchId }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, peek, { restaurantId: a.id, branchId: b.branchId }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, peek, { restaurantId: a.id, branchId: a.branchId }))).toBe('OK');
    // B's owner can neither see nor revoke A's grant: in B it is not found, and A is not theirs.
    expect(await ask(ownerB, supportQueries.listGrants, { restaurantId: b.id })).toEqual({ ok: true, data: [] });
    expect(codeOf(await act(ownerB, supportAccess.revoke, { restaurantId: b.id, grantId: created.data.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(ownerB, supportQueries.listGrants, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await act(ownerB, supportAccess.revoke, { restaurantId: a.id, grantId: created.data.id }))).toBe('FORBIDDEN');
    expect(await prisma().supportAccessGrant.findUniqueOrThrow({ where: { id: created.data.id } })).toMatchObject({ revokedAt: null });
    // No support.read was ever filed under B.
    expect(await prisma().auditLog.count({ where: { restaurantId: b.id, action: 'support.read' } })).toBe(0);
  });

  it('every support read writes a support.read audit row naming the grant', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    const g = await grant(admin, a.id, { scopes: ['catalog.read'] });

    // `peek` does nothing to audit itself: the framework writes the row.
    expect(codeOf(await ask(admin, peek, { restaurantId: a.id }))).toBe('OK');
    expect(codeOf(await ask(admin, peek, { restaurantId: a.id, branchId: a.branchId }))).toBe('OK');
    const rows = await auditOf('support.read');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        restaurantId: a.id,
        actorId: admin.userId,
        entityType: 'SupportAccessGrant',
        entityId: g.id,
        changes: { query: { before: null, after: 'test.ph.peek' } },
      });
      // The row names what was read, never what came back.
      expect(JSON.stringify(row.changes)).not.toContain('price-list-4711');
    }

    // Staff reads, and refused support reads, write none.
    expect(codeOf(await ask(cashier, peek, { restaurantId: a.id }))).toBe('OK');
    expect(codeOf(await ask(owner, peek, { restaurantId: a.id }))).toBe('OK');
    expect(codeOf(await ask(admin, supportQueries.listGrants, { restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(await auditOf('support.read')).toHaveLength(2);
  });

  it('recordConsent without a consentRef is refused', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const admin = await person('admin', { superAdmin: true });
    const colleague = await person('colleague', { superAdmin: true });
    const food = await pharmacy('Diner', { sector: 'FOOD' });
    const input = { ...goodGrant(colleague.email), restaurantId: a.id };

    expect(codeOf(await act(admin, supportAccess.recordConsent, input))).toBe('INVALID');
    expect(codeOf(await act(admin, supportAccess.recordConsent, { ...input, consentRef: '   short   ' }))).toBe('INVALID');
    // The owner is not platform staff.
    expect(codeOf(await act(owner, supportAccess.recordConsent, { ...input, consentRef: 'Signed letter 2026-118' }))).toBe('FORBIDDEN');
    // The same rules as the owner's own grant.
    expect(
      codeOf(await act(admin, supportAccess.recordConsent, { ...input, consentRef: 'Signed letter 2026-118', scopes: ['patients.read'] })),
    ).toBe('INVALID');
    // Only a pharmacy can have one.
    expect(
      codeOf(await act(admin, supportAccess.recordConsent, { ...input, restaurantId: food.id, consentRef: 'Signed letter 2026-118' })),
    ).toBe('NOT_FOUND');
    expect(await prisma().supportAccessGrant.count()).toBe(0);

    const recorded = await act(admin, supportAccess.recordConsent, { ...input, consentRef: 'Signed letter 2026-118' });
    expect(codeOf(recorded)).toBe('OK');
    const row = await prisma().supportAccessGrant.findFirstOrThrow();
    expect(row).toMatchObject({ restaurantId: a.id, granteeUserId: colleague.userId, approvedByUserId: null, consentRef: 'Signed letter 2026-118' });
    const [audit] = await auditOf('support.grant');
    expect(audit).toMatchObject({ restaurantId: a.id, actorId: admin.userId, entityId: row.id });
    expect(JSON.stringify(audit!.changes)).toContain('consent recorded by platform');
  });

  it('recordConsent refuses a grant naming the recorder (CONSENT_SELF): a second person must be the grantee', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    const colleague = await person('colleague', { superAdmin: true });
    const base = { ...goodGrant(admin.email), restaurantId: a.id, consentRef: 'Signed letter 2026-118' };

    for (const scopes of [['catalog.read'], ['rx.read'], ['patients.read']]) {
      const result = await act(admin, supportAccess.recordConsent, { ...base, scopes, sensitiveConfirmed: true });
      expect(codeOf(result), scopes.join()).toBe('INVALID');
      if (!result.ok) expect(result.error.message).toContain('CONSENT_SELF');
    }
    expect(await prisma().supportAccessGrant.count()).toBe(0);

    // Naming a colleague works, for a sensitive scope too (the recorder is a Super Admin with a reference of 10+ characters).
    const ok = await act(admin, supportAccess.recordConsent, { ...base, granteeEmail: colleague.email, scopes: ['rx.read'], sensitiveConfirmed: true });
    expect(codeOf(ok)).toBe('OK');
  });

  it('recordConsent compares user ids, not only emails: the recorder under another address is still refused', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    const actor = await actorOf(admin); // loaded with the old address
    await prisma().user.update({ where: { id: admin.userId }, data: { email: 'renamed-admin@ph-test.example' } });
    const input = { ...goodGrant('renamed-admin@ph-test.example'), restaurantId: a.id, consentRef: 'Signed letter 2026-118', scopes: ['catalog.read'] };
    const result = await act(actor, supportAccess.recordConsent, input);
    expect(codeOf(result)).toBe('INVALID');
    if (!result.ok) expect(result.error.message).toContain('CONSENT_SELF');
    expect(await prisma().supportAccessGrant.count()).toBe(0);
  });

  it('a support actor cannot run any write action', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    const g = await grant(admin, a.id, { scopes: ['catalog.read', 'stock.read', 'sales.read', 'rx.read', 'patients.read'] });

    expect(codeOf(await act(admin, supportAccess.grant, { ...goodGrant(admin.email), restaurantId: a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await act(admin, supportAccess.revoke, { restaurantId: a.id, grantId: g.id }))).toBe('FORBIDDEN');
    // Every pharmacy permission, the reading ones too, as an action.
    for (const permission of PH_PERMISSIONS) {
      const write = defineAction({
        name: `test.ph.write.${permission}`,
        permission: null,
        ph: permission,
        input: branchInput,
        target: phTarget,
        async run() {
          return 'written';
        },
      });
      expect(codeOf(await act(admin, write, { restaurantId: a.id })), permission).toBe('FORBIDDEN');
    }
    expect(await prisma().supportAccessGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ revokedAt: null });
    expect(await prisma().supportAccessGrant.count()).toBe(1);
  });

  it('the banner renders with the expiry for a support actor and not for staff', () => {
    const expiresAt = new Date(NOW.getTime() + 2 * HOUR);
    const support = { grantId: 'g1', scopes: new Set(['catalog.read']), expiresAt };

    const en = renderToStaticMarkup(createElement(SupportBanner, { support, locale: 'en' }));
    expect(en).toContain('Support mode');
    expect(en).toContain(formatStamp(expiresAt));
    expect(en).toContain('role="status"');
    const ar = renderToStaticMarkup(createElement(SupportBanner, { support, locale: 'ar' }));
    expect(ar).not.toContain('Support mode');
    expect(ar).toContain(formatStamp(expiresAt));
    expect(renderToStaticMarkup(createElement(SupportBanner, { support: null, locale: 'en' }))).toBe('');
  });
});
