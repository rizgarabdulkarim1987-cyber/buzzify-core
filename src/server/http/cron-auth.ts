import { timingSafeEqual } from 'node:crypto';

/** Whether the request carries the scheduler's secret, compared in constant time. */
export function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
