import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { phPlaceFor, listPhPlaces, type PhActor } from '@/server/pharmacy/actor';
import { PH_SIGN_IN, phEntry, readPlaceCookie, signPlaceCookie } from '@/server/pharmacy/entry';
import ar from '@/studio/messages/ar';
import ckb from '@/studio/messages/ckb';
import en from '@/studio/messages/en';
import pharmacyAr from '@/studio/messages/pharmacy/ar';
import pharmacyCkb from '@/studio/messages/pharmacy/ckb';
import pharmacyEn from '@/studio/messages/pharmacy/en';
import { NOW, person, pharmacy, resetWorld, useTestDatabase, prisma } from './fixture';

const actor: PhActor = {
  userId: 'u1',
  name: 'Owner',
  restaurantId: 'r1',
  restaurantName: 'Shifa',
  role: 'OWNER',
  allBranches: true,
  branchIds: ['b1', 'b2'],
  viaMembership: true,
  support: null,
  locale: 'en',
};

describe('phEntry', () => {
  it('not signed in goes to sign-in with next', () => {
    expect(PH_SIGN_IN).toBe('/studio/sign-in?next=/pharmacy');
    expect(phEntry({ signedIn: false, actor: null, gate: null })).toEqual({ kind: 'signIn', to: PH_SIGN_IN });
  });

  it('signed in without a pharmacy is notFound', () => {
    // Never a redirect to the sign-in: it would send them straight back and loop.
    expect(phEntry({ signedIn: true, actor: null, gate: null })).toEqual({ kind: 'notFound' });
  });

  it('a closed gate shows its reason', () => {
    for (const reason of ['restaurantInactive', 'notPharmacy', 'planInactive', 'archived'] as const) {
      expect(phEntry({ signedIn: true, actor, gate: { state: 'closed', reason } })).toEqual({ kind: 'closed', reason });
    }
  });

  it('a readOnly gate opens with a read-only notice', () => {
    const until = new Date('2027-01-25T09:00:00.000Z');
    expect(phEntry({ signedIn: true, actor, gate: { state: 'readOnly', until } })).toEqual({ kind: 'readOnly', actor, until });
  });

  it('an open gate opens', () => {
    expect(phEntry({ signedIn: true, actor, gate: { state: 'open' } })).toEqual({ kind: 'open', actor });
  });
});

describe('the place cookie', () => {
  const secret = 'a-test-secret-of-at-least-thirty-two-characters';

  it('reads back what it signed, for the person it was signed for', () => {
    const one = signPlaceCookie(secret, 'u1', { restaurantId: 'r1', branchId: 'b1' });
    expect(readPlaceCookie(secret, 'u1', one)).toEqual({ restaurantId: 'r1', branchId: 'b1' });
    const all = signPlaceCookie(secret, 'u1', { restaurantId: 'r1', branchId: null });
    expect(readPlaceCookie(secret, 'u1', all)).toEqual({ restaurantId: 'r1', branchId: null });
  });

  it('refuses an edited value, another person, another secret and junk', () => {
    const value = signPlaceCookie(secret, 'u1', { restaurantId: 'r1', branchId: 'b1' });
    expect(readPlaceCookie(secret, 'u1', value.replace('.b1.', '.b2.'))).toBeNull();
    expect(readPlaceCookie(secret, 'u2', value)).toBeNull();
    expect(readPlaceCookie(`${secret}x`, 'u1', value)).toBeNull();
    for (const junk of [undefined, '', 'r1.b1', 'r1.b1.', '...', `${value}.x`]) expect(readPlaceCookie(secret, 'u1', junk)).toBeNull();
  });
});

describe('pharmacy messages', () => {
  it('every pharmacy.* key exists in en, ar and ckb', () => {
    const keys = (catalog: Record<string, string>) => Object.keys(catalog).sort();
    expect(keys(pharmacyAr)).toEqual(keys(pharmacyEn));
    expect(keys(pharmacyCkb)).toEqual(keys(pharmacyEn));
    // Registered in the Studio catalogs, so the screens find them in every language.
    const all = (catalog: Record<string, string>) => keys(catalog).filter((key) => key.startsWith('pharmacy.'));
    expect(all(en)).toEqual(keys(pharmacyEn).filter((key) => key.startsWith('pharmacy.')));
    expect(all(ar)).toEqual(all(en));
    expect(all(ckb)).toEqual(all(en));
    for (const catalog of [pharmacyEn, pharmacyAr, pharmacyCkb]) {
      for (const [key, text] of Object.entries(catalog)) expect(text.trim(), key).not.toBe('');
    }
  });
});

describe('the business and branch a person may choose', () => {
  beforeAll(() => useTestDatabase());
  beforeEach(resetWorld);

  it('an owner may choose every branch or all of them; a staff member only their own branch', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const staff = await person('staff', { staff: [a.id, 'CASHIER', [a.branchIds[1]!]] });

    expect(await phPlaceFor(prisma(), owner.userId, { restaurantId: a.id, branchId: null }, NOW)).not.toBeNull();
    expect(await phPlaceFor(prisma(), owner.userId, { restaurantId: a.id, branchId: a.branchIds[0]! }, NOW)).toMatchObject({
      actor: { role: 'OWNER' },
      branchName: 'A branch 1',
    });
    expect(await phPlaceFor(prisma(), staff.userId, { restaurantId: a.id, branchId: a.branchIds[1]! }, NOW)).toMatchObject({
      branchName: 'A branch 2',
    });
    expect(await phPlaceFor(prisma(), staff.userId, { restaurantId: a.id, branchId: a.branchIds[0]! }, NOW)).toBeNull();
    expect(await phPlaceFor(prisma(), staff.userId, { restaurantId: a.id, branchId: null }, NOW)).toBeNull();
  });

  it('nobody may choose a pharmacy or a branch that is not theirs', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const staffB = await person('staffb', { staff: [b.id, 'CASHIER', [b.branchId]] });
    expect(await phPlaceFor(prisma(), staffB.userId, { restaurantId: a.id, branchId: a.branchId }, NOW)).toBeNull();
    // A branch of A named under B's id is no branch of B.
    expect(await phPlaceFor(prisma(), staffB.userId, { restaurantId: b.id, branchId: a.branchId }, NOW)).toBeNull();
  });

  it('lists each pharmacy of the person with the branches they may use', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const b = await pharmacy('B', { branches: 2 });
    const food = await pharmacy('Food', { sector: 'FOOD' });
    const who = await person('both', { membership: [a.id, 'OWNER'], staff: [b.id, 'PHARMACIST', [b.branchIds[1]!]] });
    await prisma().membership.create({ data: { userId: who.userId, restaurantId: food.id, role: 'OWNER' } });

    const places = await listPhPlaces(prisma(), who.userId, NOW);
    expect(places.map((p) => [p.restaurantName, p.allBranches, p.branches.map((x) => x.name)]).sort()).toEqual([
      ['A', true, ['A branch 1', 'A branch 2']],
      ['B', false, ['B branch 2']],
    ]);
    const nobody = await person('nobody');
    expect(await listPhPlaces(prisma(), nobody.userId, NOW)).toEqual([]);
  });
});
