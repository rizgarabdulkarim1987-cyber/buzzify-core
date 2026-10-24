import type { PosActor, PosGate } from './actor';

/** Where the till sends a person who is not signed in: the Studio's sign-in, which returns here (one sign-in for the app). */
export const POS_SIGN_IN = '/studio/sign-in?next=/pos';

export type PosEntry =
  | { kind: 'signIn'; to: string }
  | { kind: 'notFound' }
  | { kind: 'inactive'; reason: Extract<PosGate, { open: false }>['reason'] }
  | { kind: 'open'; actor: PosActor };

/**
 * What a till page does with the request, as data. A signed-in person with no till gets "not found", never a redirect:
 * the sign-in would send them straight back and loop.
 */
export function posEntry(input: { signedIn: boolean; actor: PosActor | null; gate: PosGate | null }): PosEntry {
  if (!input.signedIn) return { kind: 'signIn', to: POS_SIGN_IN };
  if (!input.actor) return { kind: 'notFound' };
  if (input.gate && !input.gate.open) return { kind: 'inactive', reason: input.gate.reason };
  return { kind: 'open', actor: input.actor };
}
