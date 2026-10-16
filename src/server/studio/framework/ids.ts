import { randomBytes } from 'node:crypto';

const BLOCK = 36 ** 4;
let counter = Math.floor(Math.random() * BLOCK);

/**
 * A new row id in the shape Prisma's `cuid()` default gives (25 lowercase letters and digits starting with `c`): the
 * time, a per-process counter and 56 random bits. For an action that needs a row's id before the row exists, such as
 * a menu created in a transaction scoped to it (`ActionContext.newId`).
 */
export function createId(): string {
  const time = Date.now().toString(36).padStart(9, '0').slice(-9);
  counter = (counter + 1) % BLOCK;
  const count = counter.toString(36).padStart(4, '0');
  const random = BigInt(`0x${randomBytes(7).toString('hex')}`).toString(36).padStart(11, '0').slice(-11);
  return `c${time}${count}${random}`;
}
