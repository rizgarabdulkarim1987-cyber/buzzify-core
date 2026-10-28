import { expect } from '@playwright/test';

/** A computed CSS colour (`rgb(...)`, `rgba(...)` or `color(srgb ...)`) as [r, g, b] from 0 to 255. */
export function channelsOf(colour: string): [number, number, number] {
  const numbers = colour.match(/-?[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number];
  return colour.startsWith('color(') ? (numbers.map((value) => value * 255) as [number, number, number]) : numbers;
}

/** Whether `actual` is within `tolerance` (per channel, out of 255) of `expected`. */
export function isNear(actual: string, expected: string, tolerance = 12): boolean {
  const [a, b] = [channelsOf(actual), channelsOf(expected)];
  return a.every((channel, at) => Math.abs(channel - b[at]!) <= tolerance);
}

/**
 * A fill that is now drawn from the palette's colours (a tint of two of them) matches the colour the shape was drawn with
 * to within a few steps: the signature palette is chosen to reproduce that artwork, not byte for byte.
 */
export function expectColourNear(actual: string, expected: string, tolerance = 12): void {
  expect(isNear(actual, expected, tolerance), `${actual} is within ${tolerance} of ${expected}`).toBe(true);
}
