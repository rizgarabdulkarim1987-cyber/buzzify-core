import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PhActor, PhGate } from './actor';

/** Where the pharmacy sends a person who is not signed in: the Studio's sign-in, which returns here (one sign-in). */
export const PH_SIGN_IN = '/studio/sign-in?next=/pharmacy';

export type PhEntry =
  | { kind: 'signIn'; to: string }
  | { kind: 'notFound' }
  | { kind: 'closed'; reason: Extract<PhGate, { state: 'closed' }>['reason'] }
  | { kind: 'readOnly'; actor: PhActor; until: Date }
  | { kind: 'open'; actor: PhActor };

/**
 * What a pharmacy page does with the request, as data. A signed-in person with no pharmacy gets "not found", never a
 * redirect: the sign-in would send them straight back and loop.
 */
export function phEntry(input: { signedIn: boolean; actor: PhActor | null; gate: PhGate | null }): PhEntry {
  if (!input.signedIn) return { kind: 'signIn', to: PH_SIGN_IN };
  if (!input.actor) return { kind: 'notFound' };
  if (input.gate?.state === 'closed') return { kind: 'closed', reason: input.gate.reason };
  if (input.gate?.state === 'readOnly') return { kind: 'readOnly', actor: input.actor, until: input.gate.until };
  return { kind: 'open', actor: input.actor };
}

/** The cookie that remembers which pharmacy and branch the person chose. HttpOnly; its value is signed. */
export const PH_PLACE_COOKIE = 'bz_ph_place';

/** A chosen pharmacy and branch; `branchId` null is "All branches". */
export interface PhPlace {
  restaurantId: string;
  branchId: string | null;
}

const ALL = '*';
const ID = /^[A-Za-z0-9_-]+$/;

function mac(secret: string, userId: string, restaurantId: string, branch: string): string {
  return createHmac('sha256', secret).update(['ph-place', userId, restaurantId, branch].join('\n')).digest('base64url');
}

/** `restaurant.branch.signature`, signed for one person: a value copied to another person's browser is worth nothing. */
export function signPlaceCookie(secret: string, userId: string, place: PhPlace): string {
  const branch = place.branchId ?? ALL;
  return `${place.restaurantId}.${branch}.${mac(secret, userId, place.restaurantId, branch)}`;
}

/**
 * The place a cookie value names, when it is well formed and signed for `userId`; null otherwise. A good signature
 * only says the person chose it once: the caller still checks it against what the person may use now.
 */
export function readPlaceCookie(secret: string, userId: string, value: string | undefined): PhPlace | null {
  const parts = value?.split('.') ?? [];
  if (parts.length !== 3) return null;
  const [restaurantId, branch, given] = parts as [string, string, string];
  if (!ID.test(restaurantId) || !(branch === ALL || ID.test(branch)) || given === '') return null;
  const expected = Buffer.from(mac(secret, userId, restaurantId, branch));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { restaurantId, branchId: branch === ALL ? null : branch };
}

/**
 * The input fields every pharmacy definition takes: the pharmacy (and branch) it works on. Its target is `phTargetOf`.
 * The framework resolves the person's identity in that pharmacy alone and refuses one that is not theirs, so the value is
 * checked wherever it comes from; server code fills it from the validated chosen place (`currentPhPlaceInput` in
 * `./actor`), and Server Action wrappers (Task 19+) receive it from pages that got it the same way.
 */
export const phPlaceInput = z.object({
  restaurantId: z.string().min(1).max(64),
  branchId: z.string().min(1).max(64).optional(),
});

/** The `ph` target of a pharmacy definition's input. */
export function phTargetOf(input: { restaurantId: string; branchId?: string }): { kind: 'ph'; restaurantId: string; branchId?: string } {
  return { kind: 'ph', restaurantId: input.restaurantId, branchId: input.branchId };
}

/** The cookie's attributes: HttpOnly, Lax, sent to the pharmacy only, Secure everywhere but development and test. */
export function placeCookieOptions(env: Record<string, string | undefined> = process.env) {
  const devLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return { httpOnly: true, sameSite: 'lax' as const, path: '/pharmacy', maxAge: 400 * 24 * 3600, secure: !devLike };
}
