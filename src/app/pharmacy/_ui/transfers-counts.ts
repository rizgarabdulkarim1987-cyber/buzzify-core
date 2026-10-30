import { list } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { actionFor, type Reach } from './transfers-logic';

/**
 * How many open transfers wait for this person: requested ones their branch must send and sent ones it must receive. Counted
 * from the first page of each (50 rows), so a bigger number reads "50+". Only for a role that has `transfer.manage`.
 */
export async function transfersWaiting(placeInput: { restaurantId: string; branchId?: string }, reach: Reach): Promise<{ send: number; receive: number; more: boolean }> {
  const [requested, sent] = await Promise.all([
    query(list, { ...placeInput, status: 'REQUESTED', direction: 'out' }),
    query(list, { ...placeInput, status: 'SENT', direction: 'in' }),
  ]);
  const count = (rows: typeof requested.items, kind: 'send' | 'receive') => rows.filter((r) => actionFor(r, reach) === kind).length;
  return { send: count(requested.items, 'send'), receive: count(sent.items, 'receive'), more: requested.nextCursor !== null || sent.nextCursor !== null };
}
