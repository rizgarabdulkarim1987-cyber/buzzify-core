import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * The names behind the user ids on the shift, sale and return screens. Only the name of a person of the asking business
 * (staff of this pharmacy, switched off or not, or a Studio member of it) is given, never an email or anything else; an id
 * of anyone else is left out of the answer as if it did not exist. Who asks: the roles of the till and its reports (a
 * holder of `shift.use`, `report.view` or `return.approve`); a stock-only role and a support actor may not.
 */

export const NAMES_MAX = 50;
export const peopleNamesInput = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(NAMES_MAX) });

export async function peopleNames(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof peopleNamesInput>): Promise<{ names: Record<string, string> }> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'shift.use') && !canPh(ph.role, 'report.view') && !canPh(ph.role, 'return.approve')) throw new StudioError('FORBIDDEN');
  const ids = [...new Set(input.ids)];
  const users = await scoped.user.findMany({
    where: { id: { in: ids }, OR: [{ phStaffs: { some: { restaurantId: ph.restaurantId } } }, { memberships: { some: { restaurantId: ph.restaurantId } } }] },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  return { names: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}
