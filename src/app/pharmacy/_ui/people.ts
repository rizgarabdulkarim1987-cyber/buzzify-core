import { names } from '@/server/pharmacy/queries/people';
import { query } from '@/server/studio/framework/invoke';

/**
 * The names for the user ids on a page (`ph.people.names`, at most 50, own business only). A name is a nicety: if the
 * read fails or an id is unknown the page shows the short id instead, never an error.
 */
export async function peopleOf(placeInput: { restaurantId: string; branchId?: string }, ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 50);
  if (wanted.length === 0) return {};
  try {
    return (await query(names, { ...placeInput, ids: wanted })).names;
  } catch {
    return {};
  }
}
