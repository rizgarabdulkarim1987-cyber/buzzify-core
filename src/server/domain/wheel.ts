/** The wheel of fortune's pure rules (docs/superpowers/specs/2026-10-29-menu-wheel-of-fortune-design.md). */

export const MIN_SLICES = 4;
export const MAX_SLICES = 12;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 100;
export const MAX_SPINS_PER_DAY = 10;
/** An address (a shared Wi-Fi, a café's router) may spin this many times what one guest may. */
export const IP_SPIN_FACTOR = 3;

export interface WeightedSlice {
  id: string;
  weight: number;
}

/**
 * The winner: a weighted draw. `random(n)` returns a whole number from 0 up to n - 1 (the server passes `crypto.randomInt`);
 * a slice of weight 0 owns no position, so it never wins. Throws when no slice has any weight.
 */
export function drawSlice(slices: readonly WeightedSlice[], random: (n: number) => number): string {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.weight), 0);
  if (total <= 0) throw new Error('A wheel needs at least one slice with weight');
  let position = random(total);
  for (const slice of slices) {
    if (slice.weight <= 0) continue;
    if (position < slice.weight) return slice.id;
    position -= slice.weight;
  }
  throw new Error('The random source returned a position outside the wheel');
}

export type WheelProblem = 'SLICE_COUNT' | 'WEIGHT' | 'SPINS_PER_DAY';

/** What a restaurant may save: 4 to 12 slices, whole weights from 1 to 100, 1 to 10 spins a day. Null when it is fine. */
export function validateWheel(wheel: { slices: readonly { weight: number }[]; spinsPerDay: number }): WheelProblem | null {
  if (wheel.slices.length < MIN_SLICES || wheel.slices.length > MAX_SLICES) return 'SLICE_COUNT';
  if (wheel.slices.some((slice) => !Number.isInteger(slice.weight) || slice.weight < MIN_WEIGHT || slice.weight > MAX_WEIGHT)) return 'WEIGHT';
  if (!Number.isInteger(wheel.spinsPerDay) || wheel.spinsPerDay < 1 || wheel.spinsPerDay > MAX_SPINS_PER_DAY) return 'SPINS_PER_DAY';
  return null;
}

/** Whether `now` falls inside the wheel's dates: a missing bound is open and the end is inclusive. */
export function wheelOpen(wheel: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  const time = now.getTime();
  return (wheel.startsAt === null || wheel.startsAt.getTime() <= time) && (wheel.endsAt === null || wheel.endsAt.getTime() >= time);
}

/** The calendar day an instant falls on in a time zone, as `YYYY-MM-DD`: the day spins are counted in. */
export function dayOf(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A guest may spin up to the limit; an address up to three times it, so one spin on a shared Wi-Fi does not block the next guest. */
export function spinAllowed({ guestSpins, ipSpins, spinsPerDay }: { guestSpins: number; ipSpins: number; spinsPerDay: number }): boolean {
  return guestSpins < spinsPerDay && ipSpins < spinsPerDay * IP_SPIN_FACTOR;
}
